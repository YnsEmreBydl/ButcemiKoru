import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetIcon } from '@/components/budget/budget-icon';
import { BudgetOverview } from '@/components/budget/budget-overview';
import { DemoNotice, type DemoNoticeContent } from '@/components/budget/demo-notice';
import { ExpenseList } from '@/components/budget/expense-list';
import { QuickAction } from '@/components/budget/quick-action';
import { BudgetColors } from '@/constants/budget-theme';
import { demoBudget, demoExpenses } from '@/data/demo-budget';

const demoNotices = {
  expense: {
    title: 'Harcama Ekle',
    description:
      'Burası yeni harcamalarını ekleyeceğin alan olacak. Bu görsel prototipte harcama girişi ve kaydetme henüz etkin değil.',
  },
  purchase: {
    title: 'Bunu Alırsam?',
    description:
      'Bir alışverişin bütçene etkisini burada görebileceksin. Bu görsel prototipte satın alma senaryosu veya gerçek bütçe hesabı yapılmıyor.',
  },
} satisfies Record<string, DemoNoticeContent>;

export default function HomeScreen() {
  const [notice, setNotice] = useState<DemoNoticeContent | null>(null);

  return (
    <>
      <SafeAreaView
        accessibilityElementsHidden={notice !== null}
        importantForAccessibility={notice ? 'no-hide-descendants' : 'auto'}
        style={styles.screen}>
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.brand}>
                <View style={styles.brandIcon}>
                  <BudgetIcon name="wallet" size={21} color={BudgetColors.green} />
                </View>
                <Text style={styles.brandName}>Günlük Bütçem</Text>
              </View>
              <View accessible accessibilityLabel="Demo uygulama, örnek veriler" style={styles.demoBadge}>
                <Text style={styles.demoBadgeText}>DEMO</Text>
              </View>
            </View>
            <View style={styles.intro}>
              <Text style={styles.date}>{demoBudget.dateLabel}</Text>
              <Text accessibilityRole="header" style={styles.heading}>
                Bugün, dengede.
              </Text>
              <Text style={styles.subtitle}>Küçük adımlar, daha rahat bir ay.</Text>
            </View>
            <BudgetOverview {...demoBudget} />
            <View style={styles.actions}>
              <QuickAction
                title="Harcama Ekle"
                icon="add"
                primary
                onPress={() => setNotice(demoNotices.expense)}
              />
              <QuickAction
                title="Bunu Alırsam?"
                icon="question"
                onPress={() => setNotice(demoNotices.purchase)}
              />
            </View>
            <Link href="/budget-setup" asChild>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Gerçek bütçe kurulumunu aç. DEMO verileri aktarılmaz."
                style={({ pressed }) => [styles.setupLink, pressed && styles.setupLinkPressed]}>
                <BudgetIcon name="wallet" size={22} color={BudgetColors.green} />
                <View style={styles.setupLinkContent}>
                  <Text style={styles.setupLinkTitle}>Gerçek bütçe kurulumunu aç</Text>
                  <Text style={styles.setupLinkNote}>DEMO dışı · mobilde yerel kayıt</Text>
                </View>
                <BudgetIcon name="arrow" size={16} color={BudgetColors.green} />
              </Pressable>
            </Link>
            <View style={styles.expensesSection}>
              <View style={styles.sectionHeader}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  Son harcamalar
                </Text>
                <Text style={styles.sectionNote}>Örnek hareketler</Text>
              </View>
              <ExpenseList expenses={demoExpenses} />
            </View>
            <View style={styles.demoFooter}>
              <BudgetIcon name="info" size={16} color={BudgetColors.secondary} />
              <Text style={styles.demoFooterText}>
                DEMO · Tüm tutarlar ve harcamalar örnektir.{'\n'}
                Gerçek hesaplarına bağlı değildir.
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      <DemoNotice content={notice} onClose={() => setNotice(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  setupLink: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 16, minHeight: 76, borderWidth: 1, borderColor: BudgetColors.greenBorder, borderRadius: 20, backgroundColor: BudgetColors.surface },
  setupLinkContent: { flex: 1, gap: 5 },
  setupLinkTitle: { color: BudgetColors.ink, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  setupLinkNote: { color: BudgetColors.secondary, fontSize: 11, lineHeight: 18 },
  setupLinkPressed: { opacity: 0.75 },
  screen: {
    flex: 1,
    backgroundColor: BudgetColors.background
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center'
  },
  content: {
    width: '100%',
    maxWidth: 540,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap'
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1
  },
  brandIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: BudgetColors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  brandName: {
    color: BudgetColors.ink,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.4,
    flexShrink: 1
  },
  demoBadge: {
    borderWidth: 1,
    borderColor: BudgetColors.greenBorder,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: BudgetColors.greenSoft
  },
  demoBadgeText: {
    color: BudgetColors.green,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2
  },
  intro: {
    marginTop: 30,
    marginBottom: 24,
    gap: 7
  },
  date: {
    color: BudgetColors.secondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    lineHeight: 16
  },
  heading: {
    color: BudgetColors.ink,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -1
  },
  subtitle: {
    color: BudgetColors.secondary,
    fontSize: 14,
    lineHeight: 21
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16
  },
  expensesSection: {
    marginTop: 30,
    gap: 14
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap'
  },
  sectionTitle: {
    color: BudgetColors.ink,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.4
  },
  sectionNote: {
    color: BudgetColors.secondary,
    fontSize: 11,
    lineHeight: 17
  },
  demoFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: 22,
    paddingHorizontal: 8
  },
  demoFooterText: {
    flexShrink: 1,
    color: BudgetColors.secondary,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 18
  }
});
