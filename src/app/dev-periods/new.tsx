import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { AccessibilityInfo, ActivityIndicator, Keyboard, Platform, Pressable, Text, View } from 'react-native';

import type { PeriodScopeV3 } from '@/data/budget/v3-contracts';
import { formatMinorTRY } from '@/features/budget-setup/format';
import { SetupField } from '@/features/budget-setup/setup-field';
import { parsePeriodScope, sameScope, scopeOf } from '@/features/periods/contracts';
import type { FixtureScenario } from '@/features/periods/fixture-port';
import { usePeriodStore } from '@/features/periods/hooks';
import { Action, Card, Check, Notice, PeriodShell, PreviewSummary, ui } from '@/features/periods/period-ui';
import { periodRange } from '@/features/periods/presentation';
import { usePeriodPreview } from '@/features/periods/preview-provider';

export default function NewPeriodRoute() {
  const { routes } = usePeriodPreview();
  const params = useLocalSearchParams<{ bookId?: string; periodId?: string; publicId?: string }>();
  const scope = parsePeriodScope(params);
  if (!scope) return <PeriodShell title="Dönem doğrulanamadı" subtitle="Bağlantıdaki dönem kimliği eksik veya geçersiz." back={() => router.replace(routes.home)}><Notice error>Başka bir döneme otomatik geçilmedi.</Notice></PeriodShell>;
  return <NewPeriodForm scope={scope} />;
}

function NewPeriodForm({ scope }: { scope: PeriodScopeV3 }) {
  const session = usePeriodPreview(), { workspace, routes, mode } = session, controller = workspace.form(scope);
  const state = usePeriodStore(controller);
  useFocusEffect(useCallback(() => { void controller.load().then(() => controller.checkFreshness()); }, [controller]));
  const editable = state.phase === 'editing' && !state.loading;
  const moneyKeyboard = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';
  const source = state.source, review = state.review, completed = state.result;
  const fieldErrors = Boolean(state.errors.balance || state.errors.payday || state.errors.savings || state.errors.payments.length);
  return <PeriodShell title="Yeni döneminizi oluşturun" subtitle="Güncel bakiyenizi belirleyin. Geçmişinizi arşivde koruyarak devam edin." back={() => router.replace(routes.home)}>
    {state.loading && <View style={ui.row}><ActivityIndicator /><Text style={ui.small}>Kaynak dönem okunuyor…</Text></View>}
    {state.message && <Notice error={!state.loaded || (state.phase !== 'success' && state.phase !== 'editing')}>{state.message}</Notice>}
    {!state.loaded && !state.loading && state.message && <Action label="Kaynak dönemi tekrar yükle" onPress={() => { void controller.load(); }} />}
    {state.phase === 'success' && completed ? <Card>
      <Text style={ui.eyebrow}>{mode === 'demo' ? 'ÖRNEK İŞLEM TAMAMLANDI' : 'DÖNEM KAYDEDİLDİ'}</Text><Text style={ui.sectionTitle}>{periodRange(completed.target)}</Text>
      <Text style={ui.description}>Kaynak dönem arşivde. {completed.target.status === 'closed' ? 'Bu işlemin hedef dönemi de daha sonra kapanmış.' : (mode === 'demo' ? 'Yeni örnek dönem hazır.' : 'Yeni dönem hazır.')} {mode === 'demo' ? 'Bu deneme gerçek bütçenizi değiştirmedi.' : 'Dönem bilgileri bu cihazda saklanır.'}</Text>
      <Action label="Arşivlenen dönemi incele" onPress={() => router.push({ pathname: routes.archive, params: { periodId: String(completed.source.id), bookId: String(completed.source.bookId), publicId: completed.source.publicId } })} />
      <Action label={mode === 'demo' ? 'Örnek dönemlere dön' : 'Dönemlere dön'} secondary onPress={() => router.replace(routes.home)} />
    </Card> : <>
      {(state.phase === 'conflict' || state.phase === 'review') && <Card>
        <Text style={ui.sectionTitle}>Veriler değişti; yeniden inceleyin</Text><Text style={ui.small}>Girdileriniz aynı döneme bağlı olarak korunuyor. Güncel bilgiler kendiliğinden eski komuta uygulanmaz.</Text>
        {state.canRetrySameAttempt && <Action label="Aynı işlemin sonucunu tekrar kontrol et" secondary onPress={() => { void controller.retrySameAttempt(); }} />}
        <Action label="Değişiklikleri incele" secondary busy={state.reviewing} onPress={() => { void controller.reviewChanges(); }} />
        {review && <>
          <View style={ui.divider} /><Text style={ui.small}>Şu an aktif dönem</Text><Text style={ui.sectionTitle}>{review.source ? periodRange(review.source) : 'Aktif dönem bulunmuyor'}</Text>
          {review.source && sameScope(scope, scopeOf(review.source)) && review.source.result.requiresNewPeriod ? <>
            <Text style={ui.small}>Kaynak dönem aynı, kayıtları güncellenmiş. Faturaları yeniden seçmeniz, ön izlemeyi yenilemeniz ve iki onayı tekrar vermeniz gerekir.</Text>
            <Action label="Güncel bilgileri inceleyerek devam et" onPress={() => { controller.acceptReview(); }} />
          </> : <><Notice error>Aktif dönem artık farklı veya henüz sona ermemiş. Bu form ona aktarılmayacak.</Notice><Action label={mode === 'demo' ? 'Aktif örnek dönemi aç' : 'Aktif dönemi aç'} secondary onPress={() => router.replace(routes.home)} /></>}
        </>}
      </Card>}
      {source && <>
        <Notice>Kaynak dönem: {periodRange(source)}. Önceki bakiye ve harcamalar yeni başlangıca eklenmez.</Notice>
        {!source.result.requiresNewPeriod ? <Card><Text style={ui.sectionTitle}>Bu dönem henüz sona ermedi</Text><Text style={ui.small}>Maaş günü gelmeden yeni dönem açılamaz.</Text></Card> : <>
          <Card>
            <Text style={ui.sectionTitle}>Yeni başlangıcınız</Text>
            <SetupField label="Güncel kullanılabilir bakiye (TL)" value={state.draft.balance} onChangeText={value => controller.change('balance', value)} editable={editable}
              keyboardType={moneyKeyboard} placeholder="Bakiyenizi siz yazın" error={state.errors.balance} helper="Şu an gerçekten kullanılabilir tutar. Sıfır veya negatif bakiye yazabilirsiniz. Maaş tutarı değildir." />
            <SetupField label="Sonraki maaş tarihi" value={state.draft.payday} onChangeText={value => controller.change('payday', value)} editable={editable} keyboardType={moneyKeyboard}
              placeholder="GG.AA.YYYY" maxLength={10} error={state.errors.payday} helper={mode === 'demo' ? 'Örnek gün olan 04.11.2026 tarihinden sonra olmalı.' : 'Bütçenizin yerel takviminde bugünden sonraki maaş tarihini yazın.'} />
            <SetupField label="Birikim hedefi (TL) · İsteğe bağlı" value={state.draft.savings} onChangeText={value => controller.change('savings', value)} editable={editable} keyboardType={moneyKeyboard}
              placeholder="Örn. 1.000,00" error={state.errors.savings} helper="Boş bırakırsanız birikim için tutar ayrılmaz." />
          </Card>
          <Card>
            <Text style={ui.sectionTitle}>Taşımak istediğiniz faturalar</Text><Text style={ui.small}>Her faturayı siz seçin. İsim ve tutar kaynak kayıttan kopyalanır; bu aşamada vadesini düzenleyebilirsiniz. Eski fatura yerinde kalır.</Text>
            {source.payments.length === 0 && <Text style={ui.small}>Bu dönemde taşınabilecek fatura yok.</Text>}
            {source.payments.map(payment => {
              const row = state.draft.payments.find(draft => draft.sourcePaymentId === payment.id);
              if (!row) return null;
              return <View key={payment.id} style={{ gap: 10 }}>
                <Check label={`${payment.name} · ${formatMinorTRY(payment.amountMinor)}`} checked={row.selected} disabled={!editable} onChange={() => controller.changePayment(payment.id, { selected: !row.selected })} />
                {row.selected && <SetupField label={`${payment.name} için yeni dönem vadesi`} value={row.dueDate} editable={editable} keyboardType={moneyKeyboard} maxLength={10}
                  onChangeText={dueDate => controller.changePayment(payment.id, { dueDate })} placeholder="GG.AA.YYYY" error={state.errors.payments.find(error => error.id === payment.id)?.dueDate}
                  helper="Yeni maaş tarihinden önce olmalı. Ödenmemiş eski vade tarihini de koruyabilirsiniz." />}
              </View>;
            })}
          </Card>
          {state.errors.general && <Notice error>{state.errors.general}</Notice>}
          {fieldErrors && <Notice error>Ön izleme hesaplanamadı. Yukarıdaki işaretli tutar, tarih ve fatura alanlarını kontrol edin.</Notice>}
          <Action label="Ön izlemeyi hesapla" secondary disabled={!editable} onPress={() => {
            Keyboard.dismiss(); controller.preview();
            AccessibilityInfo.announceForAccessibility(controller.getSnapshot().preview ? 'Ön izleme hazır. Bakiyeyi ve arşivlemeyi ayrıca onaylayın.' : 'Ön izleme hesaplanamadı. İşaretli alanları kontrol edin.');
          }} />
          {state.preview && <>
            {!editable && state.phase !== 'saving' && state.phase !== 'failed' && <Notice error>Bu önceki ön izlemedir. Güncel bilgileri incelemeden işlem yapılamaz.</Notice>}
            <PreviewSummary result={state.preview.result} />
            <Card>
              <Text style={ui.sectionTitle}>Devam etmeden önce</Text>
              <Check label="Yazdığım bakiyenin güncel ve kullanılabilir olduğunu onaylıyorum." checked={state.draft.balanceConfirmed} disabled={!editable} onChange={() => controller.confirm('balanceConfirmed', !state.draft.balanceConfirmed)} />
              <Check label="Eski dönemin arşivleneceğini ve finansal kayıtlarının değiştirilemeyeceğini anladım." checked={state.draft.archiveConfirmed} disabled={!editable} onChange={() => controller.confirm('archiveConfirmed', !state.draft.archiveConfirmed)} />
              {state.errors.confirmation && <Notice error>{state.errors.confirmation}</Notice>}
              <Action label={state.phase === 'saving' ? (mode === 'demo' ? 'Örnek işlem tamamlanıyor…' : 'Dönem kaydediliyor…') : state.phase === 'failed' ? 'Aynı işlemi tekrar kontrol et' : (mode === 'demo' ? 'Yeni dönemi oluştur · Ön izleme' : 'Yeni dönemi kaydet')}
                busy={state.phase === 'saving'} disabled={!['editing', 'failed'].includes(state.phase)} onPress={() => { Keyboard.dismiss(); void controller.save(); }} />
              <Text style={ui.small}>Hesaplamak kayıt yapmaz. İşlem bitmeden başarı gösterilmez. Ekranlar arasında gezinmek işlemi yeniden başlatmaz.</Text>
            </Card>
          </>}
          {session.mode === 'demo' && <DemoScenarioControls session={session} editable={editable} />}
        </>}
      </>}
    </>}
  </PeriodShell>;
}

function DemoScenarioControls({ session, editable }: { session: Extract<ReturnType<typeof usePeriodPreview>, { mode: 'demo' }>; editable: boolean }) {
  const scenario = usePeriodStore(session.scenario), setScenario = session.setScenario;
  return (
          <Card>
            <Text style={ui.eyebrow}>GELİŞTİRME TESTİ</Text><Text style={ui.small}>Yalnız sıradaki örnek kayıt denemesini etkiler. Gerçek veriye erişmez.</Text>
            <View style={[ui.row, { justifyContent: 'flex-start' }]}>{([
              ['normal', 'Normal'], ['io', 'Kayıt hatası'], ['conflict', 'Veri değişikliği'], ['lost-ack', 'Yanıt kaybı'],
            ] satisfies [FixtureScenario, string][]).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: scenario === value, disabled: !editable }} disabled={!editable}
              onPress={() => setScenario(value)} style={[ui.back, { paddingHorizontal: 12, borderRadius: 12, backgroundColor: scenario === value ? '#EAF2E9' : '#F6F7F4' }]}><Text style={ui.small}>{label}</Text></Pressable>)}</View>
          </Card>
  );
}
