import { useEffect, useState } from 'react';
import { Alert, DevSettings, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/auth';
import { checkCloudBackup, restoreFromCloud, type CloudBackupInfo } from '@/sync/drive';

export default function SettingsScreen() {
  const { user, accessToken, signOut } = useAuth();
  const liveDb = useSQLiteContext();

  const [backupInfo, setBackupInfo] = useState<CloudBackupInfo | null>(null);
  const [backupLoading, setBackupLoading] = useState(true);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Auto-load cloud backup status when the screen opens so the user sees
  // "Last cloud backup: <date>" without having to tap anything first.
  useEffect(() => {
    if (!accessToken) {
      setBackupLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await checkCloudBackup(accessToken);
        if (!cancelled) setBackupInfo(info);
      } catch (e) {
        if (!cancelled) setBackupError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBackupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

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
              await restoreFromCloud(accessToken, liveDb);
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
            <ThemedText type="defaultSemiBold">{user?.name ?? 'Signed out'}</ThemedText>
            <ThemedText>{user?.email ?? ''}</ThemedText>
          </View>
        </View>
      </ThemedView>

      <ThemedView style={styles.section}>
        <ThemedText type="subtitle">Backup & Restore</ThemedText>

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
            <ThemedText>No cloud backup yet. Sync from desktop first.</ThemedText>
          )
        )}

        <View style={styles.warningBox}>
          <ThemedText style={styles.warningText}>
            Restoring overwrites your local data with the cloud copy. Any unsynced changes on this
            device will be lost.
          </ThemedText>
        </View>

        <Pressable
          onPress={handleRestore}
          disabled={restoring || backupLoading || !backupInfo?.exists}
          style={[
            styles.dangerButton,
            (restoring || backupLoading || !backupInfo?.exists) && styles.disabledButton,
          ]}
        >
          <ThemedText style={styles.dangerButtonText}>
            {restoring ? 'Restoring & reloading…' : 'Restore from cloud'}
          </ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={styles.section}>
        <Pressable onPress={handleSignOut} style={styles.signOutButton}>
          <ThemedText style={styles.signOutText}>Sign out</ThemedText>
        </Pressable>
      </ThemedView>
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
});
