import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, DevSettings, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useSQLiteContext } from 'expo-sqlite';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/auth';
import { schema, useDb } from '@/db';
import { Button } from '@/components/ui/Button';
import {
  backupToCloud,
  checkCloudBackup,
  cloudIsAheadOfThisDevice,
  restoreFromCloud,
  type CloudBackupInfo,
} from '@/sync/drive';
import { getSyncActivity, type SyncActivityEntry } from '@/sync/activityLog';
import { LAST_ROW_SYNC_KEY } from '@/sync/AutoSync';
import { getLadderInfo, restoreFromLadder, type LadderRungInfo } from '@/sync/ladder';
import { rowSyncNow } from '@/sync/rowSync';
import { getBackupFrequency, setBackupFrequency, type BackupFrequency } from '@/sync/scheduledBackup';
import { recomputeAll, type RecomputeReport } from '@/utils/recompute';
import { getSetting, setSetting } from '@/utils/appSettings';
import {
  PO_GENERAL_TERMS_DEFAULT,
  PO_SETTINGS_KEYS,
  PO_SPECIAL_INSTRUCTIONS_DEFAULT,
} from '@/utils/poDefaults';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@/hooks/theme-preference';

export default function SettingsScreen() {
  const { user, accessToken, getFreshAccessToken, signOut, signIn } = useAuth();
  const liveDb = useSQLiteContext();
  const db = useDb();

  const [backupInfo, setBackupInfo] = useState<CloudBackupInfo | null>(null);
  const [backupLoading, setBackupLoading] = useState(true);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [ladderInfo, setLadderInfo] = useState<LadderRungInfo[]>([]);
  const [ladderRestoring, setLadderRestoring] = useState<string | null>(null);

  // Theme override (Appearance): light / dark / system, applied app-wide by
  // the use-color-scheme hook.
  const [themePref, setThemePrefState] = useState<ThemePreference>(getThemePreference());
  function handleThemeChange(p: ThemePreference) {
    setThemePrefState(p);
    void setThemePreference(p);
  }

  // PO boilerplate (mirrors desktop Settings → Purchase Order Defaults) —
  // stored in the Settings table, printed on every PO PDF.
  const [poSpecial, setPoSpecial] = useState('');
  const [poTerms, setPoTerms] = useState('');
  const [poSaving, setPoSaving] = useState(false);
  useEffect(() => {
    (async () => {
      setPoSpecial((await getSetting(db, PO_SETTINGS_KEYS.specialInstructions)) ?? PO_SPECIAL_INSTRUCTIONS_DEFAULT);
      setPoTerms((await getSetting(db, PO_SETTINGS_KEYS.generalTerms)) ?? PO_GENERAL_TERMS_DEFAULT);
    })();
  }, [db]);
  async function handleSavePoDefaults() {
    setPoSaving(true);
    try {
      await setSetting(db, PO_SETTINGS_KEYS.specialInstructions, poSpecial);
      await setSetting(db, PO_SETTINGS_KEYS.generalTerms, poTerms);
      Alert.alert('Saved', 'These notes now print on every Purchase Order PDF.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setPoSaving(false);
    }
  }

  // Automatic full-backup cadence (mirrors desktop's Automatic backup select).
  const [backupFreq, setBackupFreqState] = useState<BackupFrequency>('off');
  useEffect(() => {
    getBackupFrequency().then(setBackupFreqState);
  }, []);
  async function handleFreqChange(freq: BackupFrequency) {
    setBackupFreqState(freq);
    await setBackupFrequency(freq);
  }

  // Company name shown in the Business section. null = still loading, '' = no
  // company yet. Reloaded on focus so it updates after editing the profile.
  const [companyName, setCompanyName] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      db.select({ name: schema.company.name })
        .from(schema.company)
        .limit(1)
        .then((rows) => setCompanyName(rows[0]?.name ?? ''));
    }, [db]),
  );

  // Auto-load cloud backup status when the screen opens so the user sees
  // "Last cloud backup: <date>" without having to tap anything first.
  // getFreshAccessToken silently renews an expired badge, so this works days
  // after sign-in instead of only within the first hour.
  useEffect(() => {
    if (!accessToken) {
      setBackupLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const fresh = await getFreshAccessToken();
        if (!fresh) throw new Error('Session expired — sign in again.');
        const info = await checkCloudBackup(fresh);
        if (!cancelled) setBackupInfo(info);
        // Time-machine rungs, best-effort — a ladder listing failure must not
        // hide the main backup status.
        try {
          const rungs = await getLadderInfo(fresh);
          if (!cancelled) setLadderInfo(rungs);
        } catch { /* rung list stays empty */ }
      } catch (e) {
        if (!cancelled) setBackupError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBackupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, getFreshAccessToken]);

  function formatBackupDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function handleRestore() {
    if (!backupInfo?.exists) {
      Alert.alert('No cloud backup', 'There is no backup to restore — sync from desktop first.');
      return;
    }
    if (!accessToken) {
      Alert.alert('Not signed in', 'Sign in with Google to restore.');
      return;
    }
    const sourceLabel = backupInfo.modifiedTime
      ? formatBackupDate(backupInfo.modifiedTime)
      : 'an unknown time';
    Alert.alert(
      'Restore from cloud?',
      `This will REPLACE all your local data with the cloud backup from ${sourceLabel}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace local data',
          style: 'destructive',
          onPress: async () => {
            setRestoring(true);
            try {
              const fresh = await getFreshAccessToken();
              if (!fresh) throw new Error('Session expired — sign in again.');
              await restoreFromCloud(fresh, liveDb);
              DevSettings.reload();
            } catch (e) {
              setRestoring(false);
              Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }

  // Time-machine restore: same destructive flow as handleRestore, but from an
  // older ladder rung. Rungs are photo-stripped — bill photos re-download
  // lazily after the reload.
  const LADDER_LABELS: Record<string, string> = {
    'backup-daily.db': 'Daily (freshest)',
    'backup-weekly.db': 'Weekly (kept ~7 days old on purpose)',
    'backup-monthly.db': 'Monthly (kept ~30 days old on purpose)',
  };

  function handleLadderRestore(rung: LadderRungInfo) {
    if (!rung.modifiedTime) return;
    Alert.alert(
      'Go back in time?',
      `This will REPLACE all your local data with the ${LADDER_LABELS[rung.name] ?? rung.name} copy from ${formatBackupDate(rung.modifiedTime)}. Bill photos re-download when you open them. The next sync re-merges anything newer from your other device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace local data',
          style: 'destructive',
          onPress: async () => {
            setLadderRestoring(rung.name);
            try {
              const fresh = await getFreshAccessToken();
              if (!fresh) throw new Error('Session expired — sign in again.');
              await restoreFromLadder(fresh, liveDb, rung.name);
              DevSettings.reload();
            } catch (e) {
              setLadderRestoring(null);
              Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }

  // The actual upload. Owns its busy state so it can also be fired from the
  // overwrite-confirm dialog's callback.
  async function performBackup() {
    if (!accessToken) return;
    setBackingUp(true);
    try {
      const fresh = await getFreshAccessToken();
      if (!fresh) throw new Error('Session expired — sign in again.');
      const info = await backupToCloud(fresh, liveDb);
      setBackupInfo(info);
      setBackupError(null);
      Alert.alert('Backed up', 'Your data is safely in Google Drive.');
    } catch (e) {
      Alert.alert('Backup failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBackingUp(false);
    }
  }

  // Overwrite guard: if the cloud holds a backup this phone hasn't synced with
  // (e.g. the desktop uploaded since), confirm before replacing it. This is the
  // exact failure mode that caused a real data-loss incident — never overwrite
  // another device's newer backup silently.
  async function handleBackup() {
    if (!accessToken) {
      Alert.alert('Not signed in', 'Sign in with Google to back up.');
      return;
    }
    setBackingUp(true);
    try {
      const token = await getFreshAccessToken();
      if (!token) throw new Error('Session expired — sign in again.');
      const fresh = await checkCloudBackup(token);
      const cloudAhead = await cloudIsAheadOfThisDevice(fresh);
      setBackingUp(false);

      if (cloudAhead) {
        const when = fresh.modifiedTime ? formatBackupDate(fresh.modifiedTime) : 'an unknown time';
        Alert.alert(
          'Replace cloud backup?',
          `The cloud has a backup from ${when} that this phone hasn't synced with — it may be from your desktop. Backing up now will REPLACE it with this phone's data.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace cloud backup', style: 'destructive', onPress: () => void performBackup() },
          ],
        );
        return;
      }
      await performBackup();
    } catch (e) {
      setBackingUp(false);
      Alert.alert('Backup failed', e instanceof Error ? e.message : String(e));
    }
  }

  // Device Sync — exchanges individual document changes with the desktop via
  // per-device Drive diaries (S2 row-sync). Idempotent; safe to re-tap.
  const [rowSyncing, setRowSyncing] = useState(false);
  const [rowSyncSummary, setRowSyncSummary] = useState<string | null>(null);
  const [syncActivity, setSyncActivity] = useState<SyncActivityEntry[]>([]);
  const [lastRowSyncAt, setLastRowSyncAt] = useState<number | null>(null);

  const refreshSyncInfo = useCallback(() => {
    getSyncActivity().then(setSyncActivity);
    SecureStore.getItemAsync(LAST_ROW_SYNC_KEY).then((v) =>
      setLastRowSyncAt(v ? Number(v) : null),
    );
  }, []);

  useEffect(() => {
    refreshSyncInfo();
  }, [refreshSyncInfo]);

  function finishRowSync(r: Awaited<ReturnType<typeof rowSyncNow>>) {
    if (!r.success) {
      setRowSyncSummary(`Sync failed: ${r.error ?? 'unknown error'}`);
      return;
    }
    const bits = [`pulled ${r.applied ?? 0}`, `pushed ${r.pushedPackets ?? 0}`];
    if (r.localRenumbers) bits.push(`${r.localRenumbers} renumbered`);
    if (r.recomputeChanges) bits.push(`${r.recomputeChanges} totals corrected`);
    if (r.photosPushed) bits.push(`${r.photosPushed} photo${r.photosPushed === 1 ? '' : 's'} uploaded`);
    setRowSyncSummary(`Synced ✓ — ${bits.join(' · ')}`);
  }

  async function handleRowSync() {
    setRowSyncing(true);
    setRowSyncSummary(null);
    try {
      const fresh = await getFreshAccessToken();
      if (!fresh) throw new Error('Session expired — sign in again.');
      const r = await rowSyncNow(db, fresh);

      // D6 tripwire: the pull wants to remove many live records — a human
      // decides before anything is applied.
      if (r.needsConfirmation) {
        setRowSyncing(false);
        Alert.alert(
          'Large removal incoming',
          `The other device wants to archive or cancel ${r.removalsPending} records here. Apply them? (Cancel keeps everything so you can investigate first.)`,
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () =>
                setRowSyncSummary(`Sync paused — ${r.removalsPending} incoming removals were NOT applied.`),
            },
            {
              text: 'Apply removals',
              style: 'destructive',
              onPress: async () => {
                setRowSyncing(true);
                try {
                  finishRowSync(await rowSyncNow(db, fresh, { confirmRemovals: true }));
                } catch (e) {
                  setRowSyncSummary(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setRowSyncing(false);
                  refreshSyncInfo();
                }
              },
            },
          ],
        );
        return;
      }

      finishRowSync(r);
    } catch (e) {
      setRowSyncSummary(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRowSyncing(false);
      refreshSyncInfo();
    }
  }

  // Data Health — run the shared recompute engine as a dry run and show what differs.
  // Checking never writes; "Fix now" applies the rebuilt numbers after a confirm.
  const [healthReport, setHealthReport] = useState<RecomputeReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [fixing, setFixing] = useState(false);

  async function handleHealthCheck() {
    setChecking(true);
    try {
      setHealthReport(await recomputeAll(db));
    } catch (e) {
      Alert.alert('Check failed', e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  function handleHealthFix() {
    const n = healthReport?.totalChanges ?? 0;
    if (n === 0) return;
    Alert.alert(
      'Fix these numbers?',
      `${n} stored ${n === 1 ? 'number' : 'numbers'} will be rewritten to match your documents. Your invoices, payments and notes themselves are never touched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fix now',
          onPress: async () => {
            setFixing(true);
            try {
              await recomputeAll(db, { apply: true });
              // Re-check so the box below reflects the fresh state, not the stale diff.
              setHealthReport(await recomputeAll(db));
              Alert.alert('Fixed', `${n} ${n === 1 ? 'number' : 'numbers'} corrected.`);
            } catch (e) {
              Alert.alert('Fix failed', e instanceof Error ? e.message : String(e));
            } finally {
              setFixing(false);
            }
          },
        },
      ],
    );
  }

  // Stock counts are quantities, not rupees.
  function fmtHealthValue(v: number | string, sectionTitle: string): string {
    if (typeof v !== 'number') return v;
    return sectionTitle === 'Item stock' ? String(v) : `₹${v.toFixed(2)}`;
  }

  const healthChecked = healthReport?.sections.reduce((sum, s) => sum + s.checked, 0) ?? 0;

  function handleSignOut() {
    Alert.alert('Sign out?', 'You will need to sign in again to use the app.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedText type="title">Settings</ThemedText>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Profile</ThemedText>
        <View style={styles.profileRow}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]} />
          )}
          <View style={styles.profileText}>
            <ThemedText type="defaultSemiBold">{user?.name ?? 'Using offline'}</ThemedText>
            <ThemedText>{user?.email ?? 'Not signed in'}</ThemedText>
          </View>
        </View>
        {!user && (
          <Pressable onPress={() => signIn()} style={styles.keyButton}>
            <ThemedText style={styles.keyButtonText}>Sign in with Google</ThemedText>
          </Pressable>
        )}
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Business</ThemedText>
        <ThemedText style={styles.businessHint}>
          Your company details — shown on invoices and documents.
        </ThemedText>
        <Pressable
          onPress={() =>
            router.push(companyName ? '/company/edit' : '/company/setup')
          }
          style={styles.businessRow}
        >
          <View style={styles.profileText}>
            <ThemedText type="defaultSemiBold">
              {companyName || (companyName === '' ? 'No company set up' : 'Loading…')}
            </ThemedText>
            <ThemedText style={styles.businessAction}>
              {companyName ? 'Edit company profile' : 'Set up your business'}
            </ThemedText>
          </View>
          <ThemedText style={styles.businessChevron}>›</ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Device Sync (beta)</ThemedText>
        <ThemedText style={styles.businessHint}>
          Exchanges individual changes with your desktop through your Google Drive — nothing
          is wiped wholesale, and every total is rebuilt from the documents after the merge.
        </ThemedText>
        <Button
          title="Sync changes now"
          variant="primary"
          onPress={handleRowSync}
          loading={rowSyncing}
          disabled={!accessToken || backingUp || restoring || ladderRestoring != null}
        />
        {lastRowSyncAt ? (
          <ThemedText style={styles.businessHint}>
            Last synced {new Date(lastRowSyncAt).toLocaleString()} · auto-syncs every minute while the app is open
          </ThemedText>
        ) : null}
        {rowSyncSummary ? (
          <ThemedText style={styles.businessHint}>{rowSyncSummary}</ThemedText>
        ) : null}
        {syncActivity.length > 0 && (
          <View style={styles.statusBox}>
            <ThemedText style={styles.activityTitle}>
              Sync activity — every renumber, conflict and pause gets a receipt
            </ThemedText>
            {syncActivity.slice(0, 10).map((e, i) => (
              <ThemedText key={i} style={styles.activityRow}>
                {new Date(e.at).toLocaleString()} — {e.detail}
              </ThemedText>
            ))}
          </View>
        )}
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Backup & Restore</ThemedText>

        {!accessToken && (
          <ThemedText style={styles.businessHint}>
            Sign in with Google to enable cloud backup &amp; restore.
          </ThemedText>
        )}
        {backupLoading && <ThemedText>Checking cloud…</ThemedText>}
        {backupError && (
          <ThemedText style={styles.error}>Couldn&apos;t reach cloud: {backupError}</ThemedText>
        )}
        {!backupLoading && backupInfo && (
          backupInfo.exists ? (
            <View style={styles.statusBox}>
              <View style={styles.statusRow}>
                <ThemedText style={styles.statusLabel}>Last cloud backup</ThemedText>
                <ThemedText style={styles.statusValue}>
                  {backupInfo.modifiedTime ? formatBackupDate(backupInfo.modifiedTime) : '—'}
                </ThemedText>
              </View>
              <View style={styles.statusRow}>
                <ThemedText style={styles.statusLabel}>Size</ThemedText>
                <ThemedText style={styles.statusValue}>
                  {backupInfo.size ? `${(backupInfo.size / 1024).toFixed(0)} KB` : '—'}
                </ThemedText>
              </View>
            </View>
          ) : (
            <ThemedText>No cloud backup yet — back up now to create one.</ThemedText>
          )
        )}

        {accessToken && (
          <View style={styles.freqRow}>
            <ThemedText style={styles.statusLabel}>Automatic backup</ThemedText>
            <View style={styles.freqChips}>
              {(['off', 'daily', 'weekly', 'monthly'] as BackupFrequency[]).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => handleFreqChange(f)}
                  style={[styles.freqChip, backupFreq === f && styles.freqChipActive]}
                >
                  <ThemedText
                    style={[styles.freqChipText, backupFreq === f && styles.freqChipTextActive]}
                  >
                    {f === 'off' ? 'Off' : f[0].toUpperCase() + f.slice(1)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <Button
          title="Back up to Google Drive"
          variant="primary"
          onPress={handleBackup}
          loading={backingUp}
          disabled={!accessToken || restoring || rowSyncing || ladderRestoring != null}
        />

        <View style={styles.warningBox}>
          <ThemedText style={styles.warningText}>
            Restoring overwrites your local data with the cloud copy. Any unsynced changes on this
            device will be lost.
          </ThemedText>
        </View>

        <Pressable
          onPress={handleRestore}
          disabled={restoring || backupLoading || rowSyncing || ladderRestoring != null || !backupInfo?.exists}
          style={[
            styles.dangerButton,
            (restoring || backupLoading || rowSyncing || ladderRestoring != null || !backupInfo?.exists) && styles.disabledButton,
          ]}
        >
          <ThemedText style={styles.dangerButtonText}>
            {restoring ? 'Restoring & reloading…' : 'Restore from cloud'}
          </ThemedText>
        </Pressable>

        {ladderInfo.some((l) => l.modifiedTime) && (
          <>
            <ThemedText style={styles.businessHint}>
              Time machine — older automatic copies, kept at different ages on purpose so a
              mistake noticed late can still be undone. Photos are not inside these copies;
              they re-download when you open a bill.
            </ThemedText>
            {ladderInfo
              .filter((l) => l.modifiedTime)
              .map((rung) => (
                <View key={rung.name} style={styles.statusBox}>
                  <View style={styles.statusRow}>
                    <ThemedText style={styles.statusLabel}>
                      {LADDER_LABELS[rung.name] ?? rung.name}
                    </ThemedText>
                    <ThemedText style={styles.statusValue}>
                      {rung.modifiedTime ? formatBackupDate(rung.modifiedTime) : '—'}
                      {rung.size ? ` · ${(rung.size / 1048576).toFixed(1)} MB` : ''}
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => handleLadderRestore(rung)}
                    disabled={restoring || backingUp || rowSyncing || ladderRestoring != null}
                    style={[
                      styles.dangerButton,
                      (restoring || backingUp || rowSyncing || ladderRestoring != null) &&
                        styles.disabledButton,
                    ]}
                  >
                    <ThemedText style={styles.dangerButtonText}>
                      {ladderRestoring === rung.name ? 'Restoring & reloading…' : 'Restore this copy…'}
                    </ThemedText>
                  </Pressable>
                </View>
              ))}
          </>
        )}
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Data Health</ThemedText>
        <ThemedText style={styles.businessHint}>
          Rebuilds every balance, invoice status and stock count from your documents and
          compares them to what&apos;s stored. Checking changes nothing.
        </ThemedText>

        <Button
          title="Check my numbers"
          variant="secondary"
          onPress={handleHealthCheck}
          loading={checking}
          disabled={fixing}
        />

        {healthReport && !healthReport.stockAvailable && (
          <ThemedText style={styles.businessHint}>
            Stock was skipped — this database hasn&apos;t been migrated yet.
          </ThemedText>
        )}

        {healthReport && healthReport.totalChanges === 0 && (
          <View style={styles.healthOkBox}>
            <ThemedText style={styles.healthOkText}>
              ✓ All {healthChecked} numbers match your documents.
            </ThemedText>
          </View>
        )}

        {healthReport && healthReport.totalChanges > 0 && (
          <>
            <View style={styles.healthDriftBox}>
              {healthReport.sections
                .filter((s) => s.changes.length > 0)
                .map((s) => (
                  <View key={s.title} style={styles.healthSection}>
                    <ThemedText style={styles.healthSectionTitle}>{s.title}</ThemedText>
                    {s.changes.slice(0, 5).map((ch) => (
                      <ThemedText key={ch.id} style={styles.healthChange}>
                        {ch.name}: {fmtHealthValue(ch.stored, s.title)} →{' '}
                        {fmtHealthValue(ch.rebuilt, s.title)}
                      </ThemedText>
                    ))}
                    {s.changes.length > 5 && (
                      <ThemedText style={styles.healthChange}>
                        …and {s.changes.length - 5} more
                      </ThemedText>
                    )}
                  </View>
                ))}
              <ThemedText style={styles.healthSummary}>
                {healthReport.totalChanges}{' '}
                {healthReport.totalChanges === 1 ? 'difference' : 'differences'} found. Fixing
                rewrites only these stored totals — never your documents.
              </ThemedText>
            </View>
            <Button
              title="Fix now"
              variant="danger"
              onPress={handleHealthFix}
              loading={fixing}
              disabled={checking}
            />
          </>
        )}
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Appearance</ThemedText>
        <View style={styles.freqChips}>
          {(['light', 'dark', 'system'] as ThemePreference[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => handleThemeChange(p)}
              style={[styles.freqChip, themePref === p && styles.freqChipActive]}
            >
              <ThemedText style={themePref === p ? styles.freqChipTextActive : styles.freqChipText}>
                {p[0].toUpperCase() + p.slice(1)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Tax Settings</ThemedText>
        <ThemedText style={styles.businessHint}>
          Tax rates are configured per item — open an item to set its GST rate.
          Common GST rates in India: essential goods 0%/5%, standard goods
          12%/18%, luxury goods 28%, services 18%.
        </ThemedText>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Purchase Order Defaults</ThemedText>
        <ThemedText style={styles.businessHint}>
          These notes print on every Purchase Order PDF — special instructions
          below the items table, general terms on the last page.
        </ThemedText>
        <ThemedText style={styles.statusLabel}>Special Instructions</ThemedText>
        <TextInput
          value={poSpecial}
          onChangeText={setPoSpecial}
          multiline
          style={styles.poInput}
          placeholderTextColor="#9ca3af"
        />
        <ThemedText style={styles.statusLabel}>General Terms &amp; Conditions</ThemedText>
        <TextInput
          value={poTerms}
          onChangeText={setPoTerms}
          multiline
          style={[styles.poInput, styles.poInputTall]}
          placeholderTextColor="#9ca3af"
        />
        <View style={styles.poActions}>
          <Pressable
            onPress={() => {
              setPoSpecial(PO_SPECIAL_INSTRUCTIONS_DEFAULT);
              setPoTerms(PO_GENERAL_TERMS_DEFAULT);
            }}
            style={styles.poReset}
          >
            <ThemedText>Reset to defaults</ThemedText>
          </Pressable>
          <Button
            title={poSaving ? 'Saving…' : 'Save PO defaults'}
            variant="primary"
            onPress={handleSavePoDefaults}
            disabled={poSaving}
          />
        </View>
      </ThemedView>

      {user && (
        <ThemedView style={styles.section}>
          <Pressable onPress={handleSignOut} style={styles.signOutButton}>
            <ThemedText style={styles.signOutText}>Sign out</ThemedText>
          </Pressable>
        </ThemedView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 48, paddingBottom: 48, gap: 24 },
  section: { gap: 12 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarPlaceholder: { backgroundColor: '#ccc' },
  profileText: { flex: 1 },
  businessHint: { fontSize: 13, opacity: 0.6, lineHeight: 18 },
  businessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  businessAction: { fontSize: 13, color: '#007AFF', marginTop: 2 },
  businessChevron: { fontSize: 24, opacity: 0.4 },
  statusBox: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  statusLabel: { opacity: 0.7 },
  statusValue: { fontWeight: '500', textAlign: 'right', flexShrink: 1 },
  warningBox: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
    padding: 12,
    borderRadius: 4,
  },
  warningText: { color: '#7f1d1d', fontSize: 13 },
  dangerButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledButton: { opacity: 0.5 },
  dangerButtonText: { color: 'white', fontWeight: '600' },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#dc2626',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  signOutText: { color: '#dc2626', fontWeight: '600' },
  error: { color: 'red' },
  healthOkBox: {
    backgroundColor: '#f0fdf4',
    borderLeftWidth: 3,
    borderLeftColor: '#16a34a',
    padding: 12,
    borderRadius: 4,
  },
  healthOkText: { color: '#14532d', fontSize: 13 },
  healthDriftBox: {
    backgroundColor: '#fffbeb',
    borderLeftWidth: 3,
    borderLeftColor: '#d97706',
    padding: 12,
    borderRadius: 4,
    gap: 10,
  },
  healthSection: { gap: 2 },
  activityTitle: { fontSize: 12, fontWeight: '600', opacity: 0.7 },
  activityRow: { fontSize: 12, opacity: 0.7, lineHeight: 17 },
  healthSectionTitle: { color: '#78350f', fontSize: 13, fontWeight: '600' },
  healthChange: { color: '#92400e', fontSize: 13, lineHeight: 18 },
  healthSummary: { color: '#78350f', fontSize: 13, fontWeight: '600' },
  freqRow: { gap: 6 },
  freqChips: { flexDirection: 'row', gap: 8 },
  freqChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  freqChipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  freqChipText: { fontSize: 13 },
  freqChipTextActive: { color: 'white', fontWeight: '600' },
  poInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#111827',
    backgroundColor: '#f9fafb',
    minHeight: 120,
    textAlignVertical: 'top',
  },
  poInputTall: { minHeight: 180 },
  poActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  poReset: { paddingVertical: 10 },
  keyButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  keyButtonText: { color: 'white', fontWeight: '600' },
});
