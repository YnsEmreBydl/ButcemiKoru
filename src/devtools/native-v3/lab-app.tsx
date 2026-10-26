import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { createNativeLabRuntime } from './runtime.native';
import type { LabConfig } from './types';

/** Standalone entry only; deliberately not an Expo Router route in the budget application. */
export default function NativeV3LabApp({config}:{config:LabConfig}){
  const [runtime]=useState(()=>createNativeLabRuntime(config));
  // Register only the committed React instance; Strict Mode render retries cannot start tests.
  useEffect(()=>{globalThis.__GB_V3_NATIVE_LAB__=runtime;return()=>{if(globalThis.__GB_V3_NATIVE_LAB__===runtime)globalThis.__GB_V3_NATIVE_LAB__=undefined;};},[runtime]);
  const state=useSyncExternalStore(runtime.subscribe,runtime.getSnapshot,runtime.getSnapshot);
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.badge}>BAĞIMSIZ GELİŞTİRME TESTİ · ÜRETİM DEĞİL</Text>
    <Text style={styles.title}>SQLite v3 Native Lab</Text>
    <Text style={styles.copy}>Bu giriş ana bütçe uygulamasını açmaz. Yalnız yeni ve bağımsız sentetik SQLite dosyalarını kullanır. Gerçek bütçe veritabanına erişilmez.</Text>
    <Text style={styles.copy}>{state.identity.platform} · Hermes: {String(state.identity.hermes)} · Fiziksel cihaz: {String(state.identity.physicalDevice)}</Text>
    <Pressable accessibilityRole="button" disabled={state.status==='running'} onPress={()=>{void runtime.run();}} style={styles.button}><Text style={styles.buttonText}>Yeni bağımsız test turu başlat</Text></Pressable>
    <Text accessibilityLiveRegion="polite" style={styles.copy}>Durum: {state.status}{state.stage?` · ${state.stage}`:''}</Text>
    {state.report&&<View style={styles.card}><Text style={styles.title}>{state.report.passed} geçti · {state.report.failed} başarısız</Text><Text style={styles.copy}>SQLite {state.report.sqliteVersion}</Text>
      <Text style={styles.copy}>Tur: {state.report.runId} · Bu açılışta tamamlanan tur: {state.history.length}</Text>
      {state.report.results.map(result=><Text key={result.id} style={result.status==='passed'?styles.copy:styles.error}>{result.status==='passed'?'✓':'✕'} {result.id}{result.detail?` · ${result.detail}`:''}</Text>)}
      <Text style={styles.copy}>Bu sonuçlar OS süreç öldürme, fiziksel disk doldurma veya gerçek native cold restart kanıtı değildir.</Text></View>}
    <Pressable accessibilityRole="button" disabled={state.status==='running'} onPress={()=>{void runtime.resume();}} style={styles.button}><Text style={styles.buttonText}>Son başarılı turun kalıcılığını doğrula</Text></Pressable>
    {state.resume&&<Text style={styles.copy}>Kalıcılık: {state.resume.passed?'geçti':'başarısız'} · Yeni JS çalışma zamanı: {String(state.resume.freshJavaScriptRuntime)}</Text>}
    {state.error&&<Text style={styles.error}>Tanılama: {state.error}</Text>}
    <Text style={styles.copy}>Her tam tur yeni bir dosya grubu kullanır. Önceki turlar silinmez. Yeniden açılışta kalıcılık düğmesi son başarılı turun dosyalarını kontrol eder.</Text>
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#F6F7F4'},content:{padding:24,gap:18},badge:{fontSize:11,color:'#285C43',fontWeight:'700'},title:{fontSize:25,fontWeight:'700',color:'#24352C'},copy:{fontSize:14,lineHeight:22,color:'#425447'},button:{minHeight:52,padding:16,borderRadius:14,backgroundColor:'#285C43'},buttonText:{color:'#fff',fontSize:15,fontWeight:'600'},card:{gap:12,padding:16,backgroundColor:'#fff',borderRadius:16},error:{fontSize:14,lineHeight:22,color:'#922F2F'}});
