import { Tabs, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FontFamily } from '@/constants/tokens';
import { useColors } from '@/hooks/use-colors';

// The center "Create" tab isn't a real destination — its button intercepts the
// press and routes to New Invoice (the most common create). The create.tsx route
// renders null and is never shown.
function CreateTabButton() {
  const c = useColors();
  return (
    <View style={styles.createWrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create new invoice"
        onPress={() => router.push('/invoice/newInvoice')}
        style={({ pressed }) => [
          styles.createBtn,
          { backgroundColor: c.accent, opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <Text style={[styles.createPlus, { color: c.accentInk }]}>+</Text>
      </Pressable>
    </View>
  );
}

export default function TabLayout() {
  const c = useColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: c.accentDeep,
        tabBarInactiveTintColor: c.tabIconDefault,
        tabBarStyle: { backgroundColor: c.background, borderTopColor: c.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="invoices"
        options={{
          title: 'Invoices',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="doc.text.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{ title: '', tabBarButton: () => <CreateTabButton /> }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="line.3.horizontal" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="gearshape.fill" color={color} />,
        }}
      />
      {/* Routable but off the tab bar — reached from the Menu hub / Home. */}
      <Tabs.Screen name="items" options={{ href: null }} />
      <Tabs.Screen name="customers" options={{ href: null }} />
      <Tabs.Screen name="purchases" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  createWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  createBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  createPlus: { fontSize: 30, fontFamily: FontFamily.bold, lineHeight: 34, marginTop: -2 },
});
