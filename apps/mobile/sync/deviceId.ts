// Stable per-install identity for sync.
//
// Each device writes ONLY its own change-diary in Drive (changes-<deviceId>.json),
// which is what makes serverless multi-device sync safe: no two devices ever write
// the same file, so Drive's lack of locking can't cause a lost update. For that to
// hold, this id MUST be unique across every device on the account — a collision
// means two devices share one diary and silently overwrite each other (the precise
// failure the whole design avoids).
//
// So: a 'phone-' prefix purely as a human hint when eyeballing the files in Drive,
// followed by a cuid that GUARANTEES uniqueness. A short random suffix was rejected
// on purpose — even a small collision chance defeats the point.
//
// Minted once on first call, then read back from SecureStore forever. Caveat: an
// app uninstall wipes SecureStore, so a reinstall mints a NEW id and starts a fresh
// diary; the old diary is harmlessly orphaned and the device re-seeds from Drive
// (design D11). Surviving reinstall would need a device-level id and is optional polish.

import { cuid } from '@neu/shared'
import * as SecureStore from 'expo-secure-store'

const DEVICE_ID_KEY = 'neu.sync.deviceId'

// Session cache so repeated calls don't hit SecureStore. Cleared on reload, which
// is fine — the next call just reads the persisted value back.
let cached: string | null = null

export async function getDeviceId(): Promise<string> {
  if (cached) return cached

  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY)
  if (existing) {
    cached = existing
    return existing
  }

  const minted = `phone-${cuid()}`
  await SecureStore.setItemAsync(DEVICE_ID_KEY, minted)
  cached = minted
  return minted
}
