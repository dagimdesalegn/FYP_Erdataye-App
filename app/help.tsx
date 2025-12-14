import { AppButton } from '@/components/app-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function ActionCard({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  children: React.ReactNode;
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  return (
    <ThemedView style={[styles.card, { borderColor: isDark ? '#2E3236' : '#EEF2F6' }]}>
      <View style={styles.cardHeader}>
        <View style={styles.iconWrap}>
          <MaterialIcons name={icon} size={22} color={isDark ? '#DC2626' : '#0F172A'} />
        </View>
        <View style={styles.cardHeaderText}>
          <ThemedText style={styles.cardTitle}>{title}</ThemedText>
          <ThemedText style={styles.cardSubtitle}>{subtitle}</ThemedText>
        </View>
      </View>
      {children}
    </ThemedView>
  );
}

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: Math.max(insets.top, 10) + 8, paddingBottom: Math.max(insets.bottom, 18) + 24 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.logoHeader}>
          <Image
            source={{ uri: 'https://img.icons8.com/color/256/ambulance.png' }}
            style={styles.logo}
            contentFit="contain"
          />
        </View>

        <ActionCard
          title="Help for me"
          subtitle="Request an ambulance for your own emergency"
          icon="health-and-safety">
          <AppButton
            label="Request Ambulance (Me)"
            onPress={() => alert('Request for me (demo)')}
            variant="primary"
            fullWidth
            style={styles.primaryBig}
          />
        </ActionCard>

        <ActionCard
          title="Help for others"
          subtitle="Request an ambulance for someone else"
          icon="group">
          <AppButton
            label="Request Ambulance (Other)"
            onPress={() => alert('Request for others (demo)')}
            variant="secondary"
            fullWidth
            style={styles.secondaryBig}
          />
        </ActionCard>

        <ActionCard
          title="Direct call"
          subtitle="Call dispatch immediately"
          icon="phone-in-talk">
          <AppButton
            label="DIRECT CALL"
            onPress={() => alert('Direct call (demo)')}
            variant="ghost"
            fullWidth
            style={styles.callBtn}
          />
        </ActionCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scroll: {
    padding: 16,
    gap: 16,
  },
  logoHeader: {
    alignItems: 'center',
    paddingBottom: 6,
  },
  logo: {
    width: 160,
    height: 160,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EEF2F6',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  primaryBig: {
    paddingVertical: 16,
    borderRadius: 16,
  },
  secondaryBig: {
    paddingVertical: 16,
    borderRadius: 16,
  },
  callBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#FDE68A',
    borderColor: '#FDE68A',
  },
});
