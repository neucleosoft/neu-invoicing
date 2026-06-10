import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { HubCard } from '@/components/ui/HubCard';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Spacing } from '@/constants/tokens';

type IconName = ComponentProps<typeof IconSymbol>['name'];
type Entry = { title: string; subtitle: string; icon: IconName; route: string };

// The Menu hub — everything that isn't a primary tab, grouped like the desktop
// sidebar. Invoices stays a tab; this is its sibling document types + purchases
// + masters + money + reports. Replaces the old "Documents" link and the
// Purchases-tab hub.
const GROUPS: { heading: string; items: Entry[] }[] = [
  {
    heading: 'Sales',
    items: [
      { title: 'Quotations', subtitle: 'Price estimates you send', icon: 'doc.text.fill', route: '/quotation' },
      { title: 'Proforma Invoices', subtitle: 'Pre-sale invoices', icon: 'doc.text.fill', route: '/proforma' },
      { title: 'Delivery Challans', subtitle: 'Goods moved with or before billing', icon: 'doc.text.fill', route: '/challan' },
      { title: 'Credit / Debit Notes', subtitle: 'Adjust an issued invoice', icon: 'doc.text.fill', route: '/creditNote' },
      { title: 'Previous Invoices', subtitle: 'Imported / legacy invoices', icon: 'doc.text.fill', route: '/previousInvoice' },
    ],
  },
  {
    heading: 'Purchases',
    items: [
      { title: 'Purchase Bills', subtitle: 'Record what you buy from suppliers', icon: 'cart.fill', route: '/purchase' },
      { title: 'Purchase Orders', subtitle: 'Intent-to-buy issued before the bill', icon: 'doc.text.fill', route: '/purchaseOrder' },
      { title: 'Suppliers', subtitle: 'People and businesses you buy from', icon: 'person.fill', route: '/supplier' },
      { title: 'Supplier Items', subtitle: "Each supplier's catalog and prices", icon: 'cube.fill', route: '/supplierItem' },
    ],
  },
  {
    heading: 'Parties & Items',
    items: [
      { title: 'Customers', subtitle: 'People you sell to', icon: 'person.fill', route: '/(tabs)/customers' },
      { title: 'Items', subtitle: 'Your products and services', icon: 'cube.fill', route: '/(tabs)/items' },
    ],
  },
  {
    heading: 'Money',
    items: [
      { title: 'Payments', subtitle: 'Money received and paid out', icon: 'wallet.pass.fill', route: '/payment' },
      { title: 'Cash & Bank', subtitle: 'Your cash and bank balances', icon: 'wallet.pass.fill', route: '/cashBank' },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { title: 'Reports & GST', subtitle: 'Business reports, GST returns, ledgers', icon: 'chart.line.uptrend.xyaxis', route: '/reports' },
    ],
  },
];

export default function MenuScreen() {
  return (
    <Screen>
      <ThemedText type="title">Menu</ThemedText>
      {GROUPS.map((group) => (
        <View key={group.heading} style={styles.group}>
          <SectionHeader title={group.heading} />
          <View style={styles.cards}>
            {group.items.map((it) => (
              <HubCard
                key={it.title}
                title={it.title}
                subtitle={it.subtitle}
                icon={it.icon}
                onPress={() => router.push(it.route as never)}
              />
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = {
  group: { gap: Spacing.sm },
  cards: { gap: Spacing.sm },
} as const;
