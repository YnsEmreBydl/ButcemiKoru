import { Link, router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetIcon } from '@/components/budget/budget-icon';
import { BudgetColors, BudgetRadius } from '@/constants/budget-theme';
import type { BudgetResult } from '@/domain/budget';
import type { ApplicationBudget, BudgetAccess, ScopedSave } from '@/data/budget/application-contracts';
import { BudgetStorageError, storageErrorMessage } from '@/data/budget/errors';
import { useApplicationRepository } from '@/features/application/provider';

import { PaymentForm } from './payment-form';
import { prepareBudgetSave, savedBudgetToDraft } from './persistence';
import { PreviewResult } from './preview-result';
import { SetupField } from './setup-field';
import {
  emptySetupDraft,
  emptySetupErrors,
  type PaymentDraft,
  type SetupDraft,
  type SetupErrors,
} from './types';

type MainField = 'balance' | 'payday' | 'savings';
type PaymentField = 'name' | 'amount' | 'dueDate';
type InitialState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; saved: ApplicationBudget | null; supported: boolean; access: BudgetAccess | null };

export default function BudgetSetupScreen() {
  const repository = useApplicationRepository();
  const [draft, setDraft] = useState<SetupDraft>(emptySetupDraft);
  const [errors, setErrors] = useState<SetupErrors>(emptySetupErrors);
  const [preview, setPreview] = useState<BudgetResult | null>(null);
  const [initial, setInitial] = useState<InitialState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const saveCommand = useRef<ScopedSave | null>(null);
  const mounted = useRef(true);
  const nextPaymentId = useRef(1);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    async function load() {
      try {
        const session = await repository.open(new Date().toISOString()), saved = session.saved;
        if (active) {
          if (saved) setDraft(savedBudgetToDraft(saved));
          setInitial({ status: 'ready', saved, supported: true, access: session.access });
        }
      } catch (error) {
        if (active) {
          if (error instanceof BudgetStorageError && error.code === 'UNSUPPORTED') setInitial({ status: 'ready', saved: null, supported: false, access: null });
          else setInitial({ status: 'error', message: storageErrorMessage(error) });
        }
      }
    }
    void load();
    return () => { active = false; mounted.current = false; };
  }, [loadAttempt, repository]);

  function invalidateSave() { saveCommand.current = null; setSaveError(null); }

  function changeMain(field: MainField, value: string) {
    if (initial.status === 'ready' && initial.saved?.expenses.length && (field === 'balance' || field === 'payday')) return;
    invalidateSave();
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, general: undefined }));
  }

  function changePayment(id: string, field: PaymentField, value: string) {
    invalidateSave();
    setDraft((current) => ({
      ...current,
      payments: current.payments.map((payment) => payment.id === id ? { ...payment, [field]: value } : payment),
    }));
    setErrors((current) => ({
      ...current,
      general: undefined,
      payments: current.payments.map((error) => error.id === id ? { ...error, [field]: undefined } : error),
    }));
  }

  function addPayment() {
    invalidateSave();
    while (draft.payments.some((row) => row.id === `setup-payment-${nextPaymentId.current}`)) nextPaymentId.current += 1;
    const payment: PaymentDraft = {
      id: `setup-payment-${nextPaymentId.current}`,
      name: '', amount: '', dueDate: '',
    };
    nextPaymentId.current += 1;
    setDraft((current) => ({ ...current, payments: [...current.payments, payment] }));
  }

  function removePayment(id: string) {
    invalidateSave();
    setDraft((current) => ({ ...current, payments: current.payments.filter((payment) => payment.id !== id) }));
    setErrors((current) => ({ ...current, general: undefined, payments: current.payments.filter((error) => error.id !== id) }));
  }

  function submitPreview() {
    Keyboard.dismiss();
    if (initial.status === 'ready' && initial.access?.schema === 3 && initial.saved?.result.requiresNewPeriod) {
      setErrors({ payments: [], general: 'Bu dönem sona erdi. Maaş tarihini eski dönemde değiştirmek yerine yeni dönem açın.' }); return;
    }
    try {
      // Read the clock exactly once, on submit. The same instant anchors the initial balance.
      const asOf = new Date().toISOString();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const outcome = prepareBudgetSave(draft, { asOf, timeZone }, initial.status === 'ready' ? initial.saved : null, 'preview-only');
      if (outcome.status === 'invalid') {
        setErrors(outcome.errors);
        AccessibilityInfo.announceForAccessibility('Ön izleme hesaplanamadı. İşaretli alanları kontrol edin.');
      } else {
        setErrors(emptySetupErrors());
        setPreview(outcome.result);
        AccessibilityInfo.announceForAccessibility('Bütçe ön izlemesi açıldı. Bilgileriniz kaydedilmedi.');
      }
    } catch (error) {
      setErrors({ payments: [], general: 'Ön izleme hesaplanamadı. Cihazın tarih ve saat ayarlarını kontrol edip yeniden deneyin.' });
      console.error('Budget preview failed:', error instanceof Error ? error.name : 'UnknownError');
    }
    scroll.current?.scrollTo({ y: 0, animated: false });
  }

  async function saveBudget() {
    if (savingRef.current || initial.status !== 'ready' || !initial.supported) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const asOf = new Date().toISOString();
      let command = saveCommand.current;
      if (!command) {
        const operationId = await repository.newOperationId();
        const outcome = prepareBudgetSave(draft, { asOf, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, initial.saved, operationId);
        if (outcome.status === 'invalid') {
          if (mounted.current) { setErrors(outcome.errors); setSaveError('Bilgiler doğrulanamadı. Düzenleyip yeniden deneyin.'); }
          return;
        }
        if (!initial.access) throw new BudgetStorageError('MIGRATION', 'Form erişimi doğrulanamadı.');
        command = { ...outcome.command, access: initial.access };
        saveCommand.current = command;
      }
      // Retry the same immutable operation, but revalidate against the actual current clock.
      await repository.save({ ...command, input: { ...command.input, asOf } });
      if (mounted.current) {
        AccessibilityInfo.announceForAccessibility('Bütçe bu cihaza kaydedildi.');
        router.replace('/');
      }
    } catch (error) {
      if (mounted.current) setSaveError(storageErrorMessage(error));
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const hasErrors = Boolean(errors.general || errors.balance || errors.payday || errors.savings || errors.payments.length);
  const openingLocked = initial.status === 'ready' && Boolean(initial.saved?.expenses.length);
  const needsPeriod = initial.status === 'ready' && initial.access?.schema === 3 && Boolean(initial.saved?.result.requiresNewPeriod);

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scroll}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <View style={styles.navigation}>
              <Link href="/" replace asChild>
                <Pressable accessibilityRole="link" style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
                  <Text style={styles.backText}>‹ Ana ekrana dön</Text>
                </Pressable>
              </Link>
              <Text style={styles.previewBadge}>YEREL BÜTÇE</Text>
            </View>

            {initial.status === 'loading' ? <Text style={styles.description}>Yerel bütçe okunuyor…</Text> : initial.status === 'error' ? (
              <View style={styles.form}>
                <Text style={styles.errorText}>{initial.message}</Text>
                <Pressable accessibilityRole="button" onPress={() => { setInitial({ status: 'loading' }); setLoadAttempt((value) => value + 1); }} style={styles.submit}><Text style={styles.submitText}>Tekrar dene</Text></Pressable>
              </View>
            ) : preview ? (
              <View style={styles.form}>
              <PreviewResult
                result={preview}
                editingDisabled={saving}
                notice={initial.supported ? 'Bu bir ön izlemedir. Kaydetmeden yeni bilgiler veya değişiklikler uygulanmaz.' : 'Web ön izlemesi kayıt yapmaz. Kalıcı kayıt için iOS veya Android uygulamasını kullanın.'}
                onEdit={() => {
                  setPreview(null);
                  scroll.current?.scrollTo({ y: 0, animated: false });
                }}
              />
              <Text style={styles.smallNote}>Yerel veritabanı varsayılan olarak şifreli değildir. Uygulama bulut yedeği veya cihazlar arası eşitleme sağlamaz.</Text>
              {saveError && <Text accessibilityLiveRegion="polite" style={styles.errorText}>{saveError} Girdileriniz bu ekranda duruyor.</Text>}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving || !initial.supported || preview.requiresNewPeriod, busy: saving }}
                disabled={saving || !initial.supported || preview.requiresNewPeriod}
                onPress={() => { void saveBudget(); }}
                style={[styles.submit, (saving || !initial.supported || preview.requiresNewPeriod) && { opacity: 0.45 }]}>
                <Text style={styles.submitText}>{saving ? 'Kaydediliyor…' : !initial.supported ? 'Web’de yerel kayıt kapalı' : initial.saved ? 'Güncellemeleri kaydet' : 'Bütçemi Kaydet'}</Text>
              </Pressable>
              {preview.requiresNewPeriod && <Text style={styles.errorText}>Kaydetmek için sonraki maaş tarihini güncelleyin.</Text>}
              </View>
            ) : (
              <View style={styles.form}>
                <View style={styles.intro}>
                  <Text accessibilityRole="header" style={styles.heading}>{initial.saved ? 'Bütçe bilgilerinizi düzenleyin.' : 'Bugünkü paranla başlayalım.'}</Text>
                  <Text style={styles.description}>{initial.saved ? 'Kayıtlı bütçenizi düzenleyin. Kaydetmeden değişiklikler uygulanmaz.' : 'Bütçenizi oluşturun. Üyelik veya banka bağlantısı gerekmez.'}</Text>
                  {needsPeriod && <Link href="/periods" style={styles.backText}>Bu dönem sona erdi · Yeni dönem oluştur</Link>}
                </View>
                <View style={styles.notice}>
                  <BudgetIcon name="info" size={18} color={BudgetColors.green} />
                  <Text style={styles.noticeText}>{!initial.supported ? 'Web’de kalıcı kayıt bu sürümde desteklenmiyor. Yalnızca geçici ön izleme yapabilirsiniz.' : openingLocked ? 'Harcama geçmişiniz korunur. Başlangıç bilgileri kilitlidir. Aktif dönemde birikim ve bekleyen fatura değişiklikleri yalnızca kaydedince uygulanır.' : 'Kaydet düğmesiyle bütçe bu cihazda kalır. Kaydedilmemiş değişiklikler çıkışta kaybolur. Bakiye aynı kalırsa eski başlangıç anı korunur; bakiyeyi değiştirirseniz yeni başlangıç alınır.'}</Text>
                </View>

                {hasErrors && (
                  <View accessibilityLiveRegion="polite" style={styles.errorSummary}>
                    <Text style={styles.errorTitle}>Bilgileri kontrol edelim</Text>
                    <Text style={styles.errorText}>{errors.general ?? 'İşaretli alanları düzeltip yeniden ön izleyin.'}</Text>
                  </View>
                )}

                <View style={styles.card}>
                  <Text accessibilityRole="header" style={styles.cardTitle}>1. Bakiye ve maaş tarihi</Text>
                  {Boolean(initial.saved?.expenses.length) && <Text style={styles.noticeText}>Harcama geçmişi bulunduğu için başlangıç bakiyesi ve maaş tarihi kilitli. İptal edilen kayıtlar da geçmişe dahildir. Güvenli yeni dönem ve bakiye yeniden başlangıcı bu sürümde sunulmaz.</Text>}
                  <SetupField
                    label={openingLocked ? 'Başlangıç bakiyesi (kilitli, TL)' : 'Şu an kullanılabilir bakiye (TL)'}
                    value={draft.balance}
                    editable={!initial.saved?.expenses.length}
                    onChangeText={(value) => changeMain('balance', value)}
                    placeholder="Örn. 15.000,50"
                    helper={openingLocked ? 'Bu, ilk kurulumdaki bakiyedir. Sonradan kaydedilen harcamalar ana ekranda bundan düşülür; burayı güncel banka bakiyesiyle değiştirmek çift sayıma yol açabilir.' : 'Bugün hesabınızda gerçekten kullanabildiğiniz tutarı yazın. Sonraki maaşı eklemeyin; geçmiş harcamalar bu bakiyeye zaten dahildir. Eksi bakiye de girebilirsiniz.'}
                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                    error={errors.balance}
                  />
                  <Text style={styles.smallNote}>Ondalık için virgül, binlik için nokta kullanın: 1.234,50. Kuruş en fazla iki hanedir.</Text>
                  <SetupField
                    label="Sonraki maaş tarihi"
                    value={draft.payday}
                    editable={!initial.saved?.expenses.length}
                    onChangeText={(value) => changeMain('payday', value)}
                    placeholder="GG.AA.YYYY"
                    helper={`Tarihler ${initial.saved ? `bütçenizin ${initial.saved.input.timeZone} saat diliminde` : 'cihazınızın yerel saat diliminde'} değerlendirilir. Bugün veya geçmişteki tarih yeni dönem uyarısı verir.`}
                    maxLength={10}
                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                    error={errors.payday}
                  />
                </View>

                <View style={styles.card}>
                  <Text accessibilityRole="header" style={styles.cardTitle}>2. Bekleyen faturalar</Text>
                  <Text style={styles.description}>Yalnızca henüz ödenmemiş, maaş gününden önce ödeyeceğiniz faturaları ekleyin. Vadesi geçmiş ama ödenmemiş faturalar da dahil.</Text>
                  <Text style={styles.smallNote}>Faturayı kaldırmak ödeme kaydı oluşturmaz. Bu sürümde fatura ödeme takibi yoktur. Harcama geçmişi varsa başlangıç bakiyesi kilitlidir; ödenen faturayı yalnızca silmek bakiyeyi doğru güncellemez.</Text>
                  {draft.payments.length === 0 && <Text style={styles.smallNote}>Fatura eklenmedi. Bekleyen ödemeniz yoksa bu bölümü boş bırakabilirsiniz.</Text>}
                  {draft.payments.map((payment, index) => (
                    <PaymentForm
                      key={payment.id}
                      payment={payment}
                      index={index}
                      errors={errors.payments.find((error) => error.id === payment.id)}
                      onChange={changePayment}
                      onRemove={removePayment}
                    />
                  ))}
                  <Pressable accessibilityRole="button" onPress={addPayment} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
                    <BudgetIcon name="add" size={18} color={BudgetColors.green} />
                    <Text style={styles.addText}>Fatura ekle</Text>
                  </Pressable>
                </View>

                <View style={styles.card}>
                  <Text accessibilityRole="header" style={styles.cardTitle}>3. Birikim hedefi</Text>
                  <SetupField
                    label="Ayrılacak birikim (isteğe bağlı, TL)"
                    value={draft.savings}
                    onChangeText={(value) => changeMain('savings', value)}
                    placeholder="Örn. 1.000,00"
                    helper="Bu maaş döneminde harcamadan ayırmak istediğiniz tutar. Boş bırakırsanız sıfır kabul edilir."
                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                    error={errors.savings}
                  />
                </View>

                <Pressable accessibilityRole="button" onPress={submitPreview} style={({ pressed }) => [styles.submit, pressed && styles.pressed]}>
                  <Text style={styles.submitText}>Ön izlemeyi hesapla</Text>
                </Pressable>
                <Text style={styles.smallNote}>Ön izleme kayıt yapmaz. Sonuç ekranındaki kaydetme işlemiyle yerel kayıt tamamlanır; banka bağlantısı kurulmaz.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    maxWidth: 580,
    paddingHorizontal: 20,
    paddingBottom: 28
  },
  navigation: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20
  },
  back: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 10
  },
  backText: {
    color: BudgetColors.green,
    fontSize: 13,
    fontWeight: '600'
  },
  previewBadge: {
    color: BudgetColors.secondary,
    fontSize: 10,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0.7
  },
  form: {
    gap: 20
  },
  intro: {
    gap: 12
  },
  heading: {
    color: BudgetColors.ink,
    fontSize: 29,
    lineHeight: 37,
    fontWeight: '700',
    letterSpacing: -0.6
  },
  description: {
    color: BudgetColors.secondary,
    fontSize: 13,
    lineHeight: 21
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 16,
    borderRadius: 16,
    backgroundColor: BudgetColors.greenSoft
  },
  noticeText: {
    flex: 1,
    color: BudgetColors.green,
    fontSize: 12,
    lineHeight: 20
  },
  card: {
    padding: 20,
    borderRadius: BudgetRadius.card,
    backgroundColor: BudgetColors.surface,
    borderWidth: 1,
    borderColor: BudgetColors.border,
    gap: 20
  },
  cardTitle: {
    color: BudgetColors.ink,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700'
  },
  smallNote: {
    color: BudgetColors.secondary,
    fontSize: 12,
    lineHeight: 20
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 50,
    padding: 12,
    borderWidth: 1,
    borderColor: BudgetColors.greenBorder,
    borderRadius: 12,
    backgroundColor: BudgetColors.greenSoft
  },
  addText: {
    color: BudgetColors.green,
    fontSize: 14,
    fontWeight: '600'
  },
  submit: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: BudgetColors.primary,
    borderRadius: 16
  },
  submitText: {
    color: BudgetColors.surface,
    fontSize: 16,
    fontWeight: '600'
  },
  errorSummary: {
    padding: 16,
    gap: 6,
    borderRadius: 16,
    backgroundColor: '#FFF3EC',
    borderWidth: 1,
    borderColor: '#E9CDBB'
  },
  errorTitle: {
    color: '#803A24',
    fontSize: 14,
    fontWeight: '700'
  },
  errorText: {
    color: '#803A24',
    fontSize: 13,
    lineHeight: 21
  },
  pressed: {
    opacity: 0.75
  }
});
