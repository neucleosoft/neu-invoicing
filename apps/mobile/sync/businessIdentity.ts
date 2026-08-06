// Business-identity guard — sync's "are we the same company?" handshake.
//
// One Google account syncs ONE business (June design rule). Nothing used to
// enforce it: any database meeting the account's diaries got merged — which is
// exactly how test invoices invaded a restored copy of the real books (the
// /52-/53 renumber avalanche). The guard closes that hole:
//
//   • the first device to sync stamps `business-identity.json` on the account
//     with its company row's permanent id (NOT the name — renames stay free);
//   • every sync compares before merging; a mismatch ABORTS the sync with a
//     receipt naming both businesses;
//   • the deliberate escape hatch is Reset sync data, which deletes the marker
//     (and diaries) so the next device to sync stamps its business fresh.

import { schema, useDb } from '@/db'

import { getDeviceId } from './deviceId'

type Db = ReturnType<typeof useDb>

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

export const IDENTITY_MARKER_NAME = 'business-identity.json'

export type IdentityCheck =
  | { ok: true }
  | { ok: false; remoteName: string; localName: string }

async function findMarkerId(accessToken: string): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${IDENTITY_MARKER_NAME}' and trashed=false`,
    fields: 'files(id)',
    pageSize: '1',
  })
  const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Identity marker lookup failed (${res.status})`)
  const files = ((await res.json()) as { files?: { id: string }[] }).files ?? []
  return files[0]?.id ?? null
}

async function writeMarker(
  accessToken: string,
  fileId: string | null,
  body: { companyId: string; companyName: string },
): Promise<void> {
  let id = fileId
  if (!id) {
    const createRes = await fetch(DRIVE_FILES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: IDENTITY_MARKER_NAME, parents: ['appDataFolder'] }),
    })
    if (!createRes.ok) throw new Error(`Identity marker create failed (${createRes.status})`)
    id = ((await createRes.json()) as { id: string }).id
  }
  const uploadRes = await fetch(`${DRIVE_UPLOAD_URL}/${id}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stampedAt: Date.now(), stampedBy: await getDeviceId() }),
  })
  if (!uploadRes.ok) throw new Error(`Identity marker upload failed (${uploadRes.status})`)
}

/** Compare this device's company against the account's marker; stamp the
 *  marker when the account has none. Mismatch = caller must NOT sync. */
export async function ensureBusinessIdentity(
  db: Db,
  accessToken: string,
): Promise<IdentityCheck> {
  const [company] = await db
    .select({ id: schema.company.id, name: schema.company.name })
    .from(schema.company)
    .limit(1)
  // No local company yet (fresh device before restore/onboarding): nothing to
  // protect on this side — the restore/first-sync flow handles seeding.
  if (!company) return { ok: true }

  const markerId = await findMarkerId(accessToken)
  if (!markerId) {
    await writeMarker(accessToken, null, { companyId: company.id, companyName: company.name })
    return { ok: true }
  }

  const res = await fetch(`${DRIVE_FILES_URL}/${markerId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Identity marker download failed (${res.status})`)
  let marker: { companyId?: string; companyName?: string } | null = null
  try {
    marker = (await res.json()) as { companyId?: string; companyName?: string }
  } catch {
    marker = null
  }
  // Unreadable/corrupt marker: re-stamp rather than brick sync forever.
  if (!marker?.companyId) {
    await writeMarker(accessToken, markerId, { companyId: company.id, companyName: company.name })
    return { ok: true }
  }

  if (marker.companyId === company.id) {
    // Same business — keep the displayed name current after renames.
    if (marker.companyName !== company.name) {
      await writeMarker(accessToken, markerId, { companyId: company.id, companyName: company.name })
    }
    return { ok: true }
  }

  return {
    ok: false,
    remoteName: marker.companyName || 'another business',
    localName: company.name,
  }
}
