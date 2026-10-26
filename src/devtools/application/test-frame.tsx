import { useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { IntegrationHost } from './host.native';

export function IntegrationFrame({ host, children }: { host: IntegrationHost; children: ReactNode }) {
  const state = useSyncExternalStore(host.subscribe,host.getSnapshot,host.getSnapshot);
  const disabled = state.app.phase !== 'ready';
  return <View style={{ flex: 1 }}><View style={{ paddingTop: 54, padding: 12, backgroundColor: '#FFF2D8', gap: 7 }}>
    <Text style={{ fontSize: 11, fontWeight: '700' }}>7D-3 · BAĞIMSIZ TEST · YALNIZ SENTETİK KAYITLAR</Text>
    <View style={{ flexDirection: 'row', gap: 22 }}>
      <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} style={{ minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }} onPress={() => router.replace('/')}><Text>Ana ekran</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} style={{ minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }} onPress={() => router.push('/periods')}><Text>Dönemler</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} style={{ minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }} onPress={() => router.push('/explore')}><Text>Testler</Text></Pressable>
    </View>
    {disabled && <Text>Açılış doğrulanıyor; gezinme tamamlanana kadar kapalı.</Text>}
  </View>{children}</View>;
}
export function IntegrationControls({ host }: { host: IntegrationHost }) {
  const state = useSyncExternalStore(host.subscribe,host.getSnapshot,host.getSnapshot);
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 18 }}>
    <Text style={{ fontSize: 25, fontWeight: '700' }}>Üretim açılışı entegrasyon testi</Text>
    <Text>Bu ayrı giriş ana uygulamanın kaynak ekranlarını kullanır. Veritabanları bağımsız dosyalardır; gerçek bütçe açılmaz.</Text>
    <Text>Açılış: {state.app.phase} · Şema: {state.app.schema}</Text>
    <Pressable accessibilityRole="button" disabled={state.running} onPress={() => { void host.run(); }} style={{ padding: 18, backgroundColor: '#DCEBDE', borderRadius: 12 }}><Text>Yeni bağımsız altyapı testlerini çalıştır</Text></Pressable>
    <Text>{state.stage}</Text>
    {state.report && <><Text>{state.report.passed} geçti · {state.report.failed} başarısız</Text>{state.report.results.map(row => <Text key={row.id}>{row.status} · {row.id}{row.detail ? ` · ${row.detail}` : ''}</Text>)}</>}
    {state.error && <Text>{state.error}</Text>}
  </ScrollView>;
}
