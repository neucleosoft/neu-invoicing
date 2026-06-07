import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

// Hermes has no global Buffer, but Drizzle's blob(buffer) column reads via
// Buffer.from(). Any purchase bill carrying a scanned-image attachment would
// crash on read without this. Install it once, before anything touches the db.
import { Buffer } from 'buffer';
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

import { useColorScheme } from '@/hooks/use-color-scheme';
import { runMigrations, schema, useDb } from '@/db';
import { AuthProvider, useAuth } from '@/auth';

export default function RootLayout() {
  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      }
    >
      <SQLiteProvider databaseName="neu-invoicing.db" onInit={runMigrations} useSuspense>
        <AuthProvider>
          <RootLayoutInner />
        </AuthProvider>
      </SQLiteProvider>
    </Suspense>
  );
}

function RootLayoutInner() {
  const colorScheme = useColorScheme();
  const { user, loading } = useAuth();
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
    const inLoginRoute = segments[0] === 'login';
    // Specifically the SETUP screen, NOT the whole company/ folder. The edit
    // screen (company/edit) also lives under `company`, and conflating them was
    // bouncing a user who tapped "Edit company profile" straight back to home.
    const inCompanySetup = segments[0] === 'company' && segments[1] === 'setup';

    if (!user && !inLoginRoute) {
      router.replace('/login');
      return;
    }
    if (user && inLoginRoute) {
      router.replace('/(tabs)');
      return;
    }
    // Auth is settled and the user is in. Now gate on company — but only once
    // the company check has resolved.
    if (user && hasCompany === false && !inCompanySetup) {
      router.replace('/company/setup');
    } else if (user && hasCompany === true && inCompanySetup) {
      // Company got created → leave the SETUP screen for the app. (Editing an
      // existing company is on company/edit, which this no longer matches.)
      router.replace('/(tabs)');
    }
  }, [user, segments, loading, hasCompany, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
