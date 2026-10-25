# Günlük Bütçem

React Native, Expo SDK 58, TypeScript ve Expo Router ile geliştirilen mobil bütçe uygulaması. iOS/Android üzerinde ilk kurulum, SQLite ile yerel kayıt, kayıtlı bütçenin hesaplanması ve düzenlenmesi bulunur. Gerçek harcama ekleme, banka bağlantısı ve ödeme sistemi henüz yoktur.

## Çalıştırma

1. Bağımlılıkları kurun:

   ```bash
   npm install
   ```

2. Geliştirme sunucusunu başlatın:

   ```bash
   npx expo start
   ```

Web ön izlemesi için `npm run web` kullanılabilir. Native doğrulama için SDK 58 ile uyumlu bir development build gerekir. SQLite kayıt akışının gerçek cihaz testi ve APK/IPA derlemesi henüz yapılmadı; Metro/Hermes paket üretimi doğrulandı. Para biçimlendirme hatası ayrıca bağlı iPhone/Expo Go/Hermes üzerinde doğrulandı; kapsamı aşağıdaki hata raporundadır.

## Uygulama akışı

- `/`: Yerel kayıt okunur, doğrulanır ve mevcut `calculateBudget` motoruyla güncel an için hesaplanır. Henüz kayıt yoksa kurulum açılır. Okuma hatası boş kurulum gibi değerlendirilmez.
- `/budget-setup`: İlk kurulum veya mevcut kaydı düzenleme. Ön izleme kayıt yapmaz. Sonuçtaki **Bütçemi Kaydet / Güncellemeleri kaydet** tamamlanınca ana ekran açılır. Hatalarda girdiler korunur.
- `/demo`: Önceki prototip, açık DEMO etiketiyle ayrıdır. Örnek veriler gerçek bütçeye aktarılmaz.
- `/explore`: Önceki başlangıç şablonu korunur.

Web paket üretimi çalışır; **bu sürümde web üzerinde kalıcı kayıt kapalıdır**, geçici kurulum ön izlemesi kullanılabilir. Expo SQLite web gereksinimleri ve native transaction farkı [SQLite raporunda](SQLITE_RAPORU.md) açıklanır.

## Veri ve hesaplama

`src/data/budget/` repository katmanıdır. `gunluk-butcem.db`, sürüm 1 migration ile oluşturulur. Başlangıç bakiyesi ve anı, TRY para birimi, bütçenin saat dilimi, maaş tarihi, birikim ve faturalar birlikte kaydedilir. Para sütunları tam sayı kuruş (`INTEGER`) tutar; finansal `REAL` hesap yapılmaz.

`src/domain/budget/` değişmedi. Geçmiş harcama veya gelecek maaş geliri üretilmez. Bu aşamada hareket kaydı yoktur; yeni gerçek harcamalar otomatik izlenmez. Güncel bakiye ve bekleyen faturalar düzenleme formundan güncellenebilir.

Veritabanı uygulama düzeyinde **şifreli değildir**. Uygulama otomatik bulut yedeği veya cihazlar arası eşitleme yapmaz. İşletim sisteminin kendi yedekleme ayarları ayrıca geçerlidir. Görünümden çıkmak kayıtları silmez; uygulamayı kaldırmak/verilerini temizlemek farklı işlemlerdir.

## Kod kontrolleri

```sh
npm test
npx expo lint
npx tsc --noEmit
npx expo-doctor
npx expo export --platform all --output-dir /private/tmp/gunluk-butcem-export
```

`npm test`, Node.js 24'ün yerleşik araçlarını kullanır; yeni test bağımlılığı yoktur. **192 test**: önceki 158 test, gerçek SQLite dosyaları kullanan 28 test, native API için 3 mock testi, 1 web destek sınırı testi ve 2 Hermes para biçimlendirme regresyon testi. Node 24.4.0, `node:sqlite` için deneysel API uyarısı verir. Expo SQLite sürücüsüyle gerçek cihazda kayıt testi henüz yapılmadı. Motorun API'si ve matematiği [modül dokümantasyonundadır](src/domain/budget/README.md).

Son tam ve `--omit=dev` audit taramalarında **5 yüksek önem dereceli bulgu** devam ediyor. Zorlayıcı yükseltme veya `npm audit fix` uygulanmadı.

## Raporlar

- [iPhone/Hermes BigInt biçimlendirme hatası ve gerçek cihaz doğrulaması](BIGINT_HATA_RAPORU.md)
- [SQLite, şema, değişen dosyalar, öğretici açıklamalar ve testler](SQLITE_RAPORU.md)
- [Kurulum ekranı, state/type açıklamaları ve test sonuçları](BUTCE_KURULUM_RAPORU.md)
- [Bütçe motoru, matematik ve gerçek test sonuçları](BUTCE_MOTORU_RAPORU.md)
- [Ana ekran prototipi ve test sonuçları](ANA_EKRAN_RAPORU.md)
- [İlk kurulum](KURULUM_RAPORU.md)
- [ESLint ve güvenlik incelemesi](GUVENLIK_RAPORU.md)
