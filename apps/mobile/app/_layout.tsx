import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

// useFonts from expo-font (runs on the app's React) — NOT from the Inter
// package, whose 0.4.x build bundles its own React 18 and would trigger an
// "Invalid hook call" against the app's React 19. We import only the font
// assets (plain .ttf refs, no React) from @expo-google-fonts/inter.
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';

// Hermes has no global Buffer, but Drizzle's blob(buffer) column reads via
// Buffer.from(). Any purchase bill carrying a scanned-image attachment would
// crash on read without this. Install it once, before anything touches the db.
import { Buffer } from 'buffer';
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

import { useColorScheme } from '@/hooks/use-color-scheme';
import { loadThemePreference } from '@/hooks/theme-preference';
import { initAppLog } from '@/utils/appLog';
import { runMigrations, schema, useDb } from '@/db';
import { registerDbReload } from '@/db/reload';
import { AuthProvider, useAuth } from '@/auth';
import { AppLockGate } from '@/components/AppLockGate';
import { AutoSync } from '@/sync/AutoSync';

// Field logging first — a crash during boot must still leave a trace.
initAppLog()

// Load the persisted theme override before first render settles — a stale
// 'system' flash for one frame is fine; a permanent ignore of the user's
// choice is not.
void loadThemePreference()

export default function RootLayout() {
  // Hold the app until Inter is ready so text doesn't flash in the system font
  // and then re-layout. Loads from a bundled asset (no native rebuild).
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  // Restore soft-reboot: bumping the epoch remounts the provider subtree AND
  // hands SQLiteProvider a fresh onInit identity. Both matter — expo-sqlite's
  // Suspense provider caches the open database globally, keyed on prop
  // identity (including onInit), so a bare key remount would return the same
  // stale handle the restore just closed. New identity → true re-open, and
  // runMigrations re-runs (re-seeds the HLC ratchet from the restored file).
  const [dbEpoch, setDbEpoch] = useState(0);
  useEffect(() => {
    registerDbReload(() => setDbEpoch((e) => e + 1));
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onDbInit = useCallback((db: SQLiteDatabase) => runMigrations(db), [dbEpoch]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      }
    >
      <SQLiteProvider key={dbEpoch} databaseName="neu-invoicing.db" onInit={onDbInit} useSuspense>
        <AuthProvider>
          <RootLayoutInner />
        </AuthProvider>
      </SQLiteProvider>
    </Suspense>
  );
}

function RootLayoutInner() {
  const colorScheme = useColorScheme();
  const { user, offlineMode, loading } = useAuth();
  const db = useDb();
  const segments = useSegments();
  const router = useRouter();

  // Does a company profile exist yet? null = not checked yet (don't act on it).
  // One Company row is the sender identity behind every document, so a signed-in
  // user without one is sent to setup. Mirrors desktop's onboarding gate.
  const [hasCompany, setHasCompany] = useState<boolean | null>(null);

  // Re-check on the top-level route segment too: after setup.tsx creates the
  // company and navigates to /(tabs), the segment change re-runs this so
  // hasCompany flips to true — otherwise the gate would bounce the user right
  // back to setup. Cheap (one indexed COUNT-style read) and keeps the gate and
  // the just-created row in sync without cross-component state.
  const topSegment = segments[0];

  useEffect(() => {
    let cancelled = false;
    db.select({ id: schema.company.id })
      .from(schema.company)
      .limit(1)
      .then((rows) => {
        if (!cancelled) setHasCompany(rows.length > 0);
      })
      .catch(() => {
        // If the check fails, don't trap the user on a blank screen — treat as
        // "has company" so the app still opens; Settings can fix the profile.
        if (!cancelled) setHasCompany(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, topSegment]);

  // Redirect imperatively based on auth + company state. Each guard waits for
  // its own state to be KNOWN before acting (loading / hasCompany===null),
  // so a not-yet-resolved value never triggers a wrong redirect.
  useEffect(() => {
    if (loading) return;
    // Widened on purpose: without generated route types (.expo/types — absent
    // on CI), expo-router's fallback types segments as a 1-tuple and indexing
    // [1] fails to compile.
    const segs: string[] = segments;
    const inLoginRoute = segs[0] === 'login';
    // Specifically the SETUP screen, NOT the whole company/ folder. The edit
    // screen (company/edit) also lives under `company`, and conflating them was
    // bouncing a user who tapped "Edit company profile" straight back to home.
    const inCompanySetup = segs[0] === 'company' && segs[1] === 'setup';

    // Offline mode counts as "allowed in", same as desktop where offlineMode is
    // accepted alongside a real Google session.
    const authed = !!user || offlineMode;

    if (!authed && !inLoginRoute) {
      router.replace('/login');
      return;
    }
    if (authed && inLoginRoute) {
      router.replace('/(tabs)');
      return;
    }
    // Auth is settled and the user is in. Now gate on company — but only once
    // the company check has resolved. (Offline users still need a company too.)
    if (authed && hasCompany === false && !inCompanySetup) {
      router.replace('/company/setup');
    } else if (authed && hasCompany === true && inCompanySetup) {
      // Company got created → leave the SETUP screen for the app. (Editing an
      // existing company is on company/edit, which this no longer matches.)
      router.replace('/(tabs)');
    }
  }, [user, offlineMode, segments, loading, hasCompany, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Foreground auto-sync (S3): renders nothing; pulls+pushes on focus and
          every minute while active. Tripwire pauses still require the manual
          Sync button in Settings. */}
      <AutoSync />
      {/* App lock wraps the WHOLE navigator so no route or deep link renders
          under it; AutoSync stays outside — the lock protects eyes, not sync. */}
      <AppLockGate>
        {/* Default headerShown: false — detail/edit/new screens render their
            own header. Without this, unregistered routes (invoice/[id], etc.)
            fall back to Expo's default header which shows the raw filename. */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="company/setup" />
          <Stack.Screen name="company/edit" />
          <Stack.Screen
            name="modal"
            options={{ presentation: 'modal', title: 'Modal', headerShown: true }}
          />
        </Stack>
      </AppLockGate>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
