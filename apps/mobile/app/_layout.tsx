import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { runMigrations } from '@/db';
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
  const segments = useSegments();
  const router = useRouter();

  // Redirect imperatively based on auth state.
  useEffect(() => {
    if (loading) return;
    const inLoginRoute = segments[0] === 'login';
    if (!user && !inLoginRoute) {
      router.replace('/login');
    } else if (user && inLoginRoute) {
      router.replace('/(tabs)');
    }
  }, [user, segments, loading, router]);

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
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', title: 'Modal', headerShown: true }}
        />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
