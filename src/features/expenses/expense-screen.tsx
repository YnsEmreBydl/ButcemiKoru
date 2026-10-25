import { Link, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetColors } from '@/constants/budget-theme';
import { expenseCategories, type AddExpenseCommand } from '@/data/budget/contracts';
import { BudgetStorageError, storageErrorMessage } from '@/data/budget/errors';
import { getBudgetRepository } from '@/data/budget/platform';
import { SetupField } from '@/features/budget-setup/setup-field';
import { useSavedBudget } from '@/features/saved-budget/use-saved-budget';

import { categoryLabels, prepareExpense, reconcileExpenseAttempt, type ExpenseDraft, type ExpenseErrors } from './adapter';

export default function ExpenseScreen() {
  const { state, refresh, acceptSaved } = useSavedBudget();
  const [draft, setDraft] = useState<ExpenseDraft>({ amount: '', category: 'market', description: '' });
  const [errors, setErrors] = useState<ExpenseErrors>({});
  const [working, setWorking] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const attempt = useRef<AddExpenseCommand | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saved = state.status === 'ready' ? state.saved : null;
  const locked = working || uncertain;

  function edit(next: ExpenseDraft) {
    if (busy.current || locked) return;
    attempt.current = null;
    setDraft(next); setErrors({});
  }

  function showSuccess() {
    if (!mounted.current) return;
    AccessibilityInfo.announceForAccessibility('Harcama bu cihaza kaydedildi.');
    router.replace('/');
  }

  async function save() {
    if (busy.current || !saved) return;
    busy.current = true; setWorking(true); setErrors({}); Keyboard.dismiss();
    // The occurrence is the tap, not the potentially later data-entry/commit attempt.
    const occurredAt = new Date().toISOString();
    try {
      const repository = await getBudgetRepository();
      let command = attempt.current;
      if (!command) {
        const operationId = await repository.newOperationId();
        const createdAt = new Date().toISOString();
        const result = prepareExpense(draft, saved, { operationId, occurredAt, createdAt, asOf: createdAt });
        if (result.status === 'invalid') { if (mounted.current) setErrors(result.errors); return; }
        command = result.command; attempt.current = command;
      }
      await repository.addExpense({ ...command, asOf: new Date().toISOString() });
      showSuccess();
    } catch (error) {
      if (mounted.current) {
        const ambiguous = attempt.current !== null && (!(error instanceof BudgetStorageError) || error.code === 'IO');
        setUncertain(ambiguous);
        if (!ambiguous) attempt.current = null;
        setErrors({ general: storageErrorMessage(error) });
      }
    } finally { busy.current = false; if (mounted.current) setWorking(false); }
  }

  async function checkOutcome() {
    const command = attempt.current;
    if (busy.current || !command) return;
    busy.current = true; setWorking(true);
    try {
      const repository = await getBudgetRepository();
      const latest = await repository.load(new Date().toISOString());
      const outcome = reconcileExpenseAttempt(command, latest);
      if (outcome === 'saved') { showSuccess(); return; }
      if (mounted.current) {
        if (outcome === 'conflict') { setErrors({ general: 'İşlem kimliğiyle farklı bir kayıt bulundu. Ana ekrandan geçmişi kontrol edin.' }); return; }
        attempt.current = null; setUncertain(false);
        if (latest) acceptSaved(latest); else refresh();
        setErrors({ general: 'Bu denemeye ait kayıt bulunmadı. Girdileriniz duruyor; kontrol edip yeniden kaydedebilirsiniz.' });
      }
    } catch (error) { if (mounted.current) setErrors({ general: storageErrorMessage(error) }); }
    finally { busy.current = false; if (mounted.current) setWorking(false); }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.content}>
            <Link href="/" replace style={styles.link}>‹ Ana ekrana dön</Link>
            <Text accessibilityRole="header" style={styles.title}>Harcama ekle</Text>
            <Text style={styles.note}>Gerçekte yaptığınız harcamayı kaydedin. Bu işlem banka hesabınızdan para çekmez veya ödeme başlatmaz.</Text>
            {state.status === 'loading' && <Text accessibilityLiveRegion="polite" style={styles.note}>Bütçe okunuyor…</Text>}
            {(state.status === 'error' || state.status === 'unsupported') && <View style={styles.card}>
              <Text accessibilityLiveRegion="polite" style={styles.error}>{state.message}</Text>
              {state.status === 'error' && <Pressable accessibilityRole="button" onPress={refresh} style={styles.secondary}><Text style={styles.link}>Tekrar dene</Text></Pressable>}
            </View>}
            {state.status === 'ready' && !saved && <Link href="/budget-setup" style={styles.link}>Önce bütçemi oluştur</Link>}
            {saved && <>
              {state.status === 'ready' && state.message && <Text style={styles.error}>{state.message} Son okunan bilgiler gösteriliyor.</Text>}
              {saved.result.requiresNewPeriod && <Text style={styles.error}>Bu dönem sona erdi. Yeni harcama eklenmez; ana ekrandan hatalı kayıtları iptal edebilirsiniz. Güvenli yeni dönem açılışı bu sürümde bulunmuyor.</Text>}
              <View style={styles.card}>
                <SetupField label="Harcama tutarı (TL)" value={draft.amount} onChangeText={(amount) => edit({ ...draft, amount })}
                  placeholder="Örn. 245,50" helper="Ondalık için virgül kullanın. En fazla iki kuruş hanesi; tutar sıfırdan büyük olmalıdır."
                  keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'} editable={!locked} error={errors.amount} />
                <Text style={styles.label}>Kategori</Text>
                <View style={styles.categories} accessibilityRole="radiogroup" accessibilityLabel="Harcama kategorisi">
                  {expenseCategories.map((category) => <Pressable key={category} accessibilityRole="radio"
                    accessibilityState={{ selected: draft.category === category, disabled: locked }} disabled={locked}
                    onPress={() => edit({ ...draft, category })} style={[styles.category, draft.category === category && styles.selected]}>
                    <Text style={[styles.categoryText, draft.category === category && styles.selectedText]}>{categoryLabels[category]}</Text>
                  </Pressable>)}
                </View>
                <SetupField label="Açıklama (isteğe bağlı)" value={draft.description} onChangeText={(description) => edit({ ...draft, description })}
                  placeholder="Örn. Haftalık alışveriş" maxLength={200} editable={!locked} error={errors.description} />
              </View>
              <Text style={styles.note}>Harcama zamanı, Kaydet’e dokunduğunuz andır. Bu sürümde geçmiş tarih seçimi yoktur. Bakiye yetmese de gerçek harcama kaydedilebilir; oluşan açık gösterilir.</Text>
              <Text style={styles.note}>Bu işlem bekleyen faturayı ödenmiş saymaz; fatura ödeme takibi bu sürümde bulunmuyor.</Text>
              {errors.general && <Text accessibilityLiveRegion="polite" style={styles.error}>{errors.general} Girdileriniz korunuyor.</Text>}
              {uncertain && <View style={styles.card}>
                <Text style={styles.note}>Kaydın sonucu kesinleşmedi. Çift kayıt oluşturmamak için girdiler geçici olarak kilitli. Aynı işlemi tekrar deneyin veya durumu kontrol edin.</Text>
                <Pressable accessibilityRole="button" disabled={working} onPress={() => { void checkOutcome(); }} style={styles.secondary}><Text style={styles.link}>Kaydın durumunu kontrol et</Text></Pressable>
              </View>}
              <Pressable accessibilityRole="button" accessibilityState={{ busy: working, disabled: working || (saved.result.requiresNewPeriod && !uncertain) }}
                disabled={working || (saved.result.requiresNewPeriod && !uncertain)} onPress={() => { void save(); }}
                style={[styles.button, (working || (saved.result.requiresNewPeriod && !uncertain)) && styles.disabled]}>
                <Text style={styles.buttonText}>{working ? 'İşlem sürüyor…' : uncertain ? 'Aynı işlemi tekrar dene' : 'Harcamayı kaydet'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={working || uncertain} onPress={refresh} style={styles.secondary}><Text style={styles.link}>Güncel bütçeyi yükle · girdiler korunur</Text></Pressable>
            </>}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BudgetColors.background },
  scroll: { alignItems: 'center', flexGrow: 1 },
  content: { width: '100%', maxWidth: 560, padding: 20, gap: 20 },
  title: { color: BudgetColors.ink, fontSize: 29, fontWeight: '700' },
  note: { color: BudgetColors.secondary, fontSize: 13, lineHeight: 21 },
  card: { backgroundColor: BudgetColors.surface, borderRadius: 24, padding: 20, gap: 16, borderWidth: 1, borderColor: BudgetColors.border },
  label: { color: BudgetColors.ink, fontSize: 14, fontWeight: '600' },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: BudgetColors.border },
  selected: { backgroundColor: BudgetColors.primary, borderColor: BudgetColors.primary },
  categoryText: { color: BudgetColors.ink, fontSize: 14 },
  selectedText: { color: BudgetColors.surface, fontWeight: '600' },
  error: { color: '#922F2F', fontSize: 14, lineHeight: 22 },
  button: { backgroundColor: BudgetColors.primary, minHeight: 54, padding: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: BudgetColors.surface, fontSize: 15, fontWeight: '600' },
  secondary: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: 0.5 },
  link: { color: BudgetColors.green, fontSize: 13, lineHeight: 22, paddingVertical: 8 },
});
