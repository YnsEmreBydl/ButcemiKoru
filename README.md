# Günlük Bütçem

React Native, Expo SDK 58, TypeScript ve Expo Router ile geliştirilen mobil bütçe uygulaması. iOS/Android üzerinde bütçe kurulumu, SQLite ile yerel kayıt, gerçek harcama ekleme, harcama geçmişi ve hatalı kayıt iptali bulunur. Banka bağlantısı, fatura ödeme işlemi ve ödeme sistemi yoktur.

## Çalıştırma

1. Bağımlılıkları kurun:

   ```bash
   npm install
   ```

2. Geliştirme sunucusunu başlatın:

   ```bash
   npx expo start
   ```

Web ön izlemesi için `npm run web` kullanılabilir. Mobilde SDK 58 ile uyumlu Expo Go veya development build kullanılır. Bağlı iPhone/Expo Go/Hermes üzerinde ayrı bir test veritabanıyla kayıt, iptal, rollback ve yeniden açılış doğrulandı. Formu elle doldurarak uçtan uca test ve APK/IPA derlemesi yapılmadı; ayrıntılı kapsam harcama raporundadır.

## Uygulama akışı

- `/`: Kayıtlı bütçe ve gerçek harcama geçmişi okunur, doğrulanır ve mevcut `calculateBudget` motoruyla hesaplanır. Günlük öneri, bugünün başlangıç hedefi/kalanı ve ileri ortalama gösterilir. Hatalı harcama iptal edilebilir. Henüz bütçe yoksa kurulum açılır.
- `/budget-setup`: İlk kurulum veya mevcut kaydı düzenleme. Ön izleme kayıt yapmaz. Sonuçtaki **Bütçemi Kaydet / Güncellemeleri kaydet** tamamlanınca ana ekran açılır. Hatalarda girdiler korunur.
- `/expense-add`: Türkçe tutar, altı sabit kategori ve isteğe bağlı açıklama ile gerçek harcama kaydı. Başarı yalnızca commit sonrasında gösterilir. İlk geçerli kaydetme denemesinin gerçekleşme zamanı tekrar denemelerde korunur.
- `/demo`: Önceki prototip, açık DEMO etiketiyle ayrıdır. Örnek veriler gerçek bütçeye aktarılmaz.
- `/explore`: Önceki başlangıç şablonu korunur.

Web paket üretimi çalışır; **bu sürümde web üzerinde kalıcı kayıt kapalıdır**, geçici kurulum ön izlemesi kullanılabilir. Expo SQLite web gereksinimleri ve native transaction farkı [SQLite raporunda](SQLITE_RAPORU.md) açıklanır.

## Veri ve hesaplama

`src/data/budget/` repository katmanıdır. `gunluk-butcem.db`, mevcut veriler korunarak migration **v2** ile açılır. Başlangıç bakiyesi, saat dilimi, maaş tarihi, birikim ve faturalar yanında harcamalar da saklanır. Para sütunları tam sayı kuruş (`INTEGER`) tutar; finansal `REAL` hesap yapılmaz. İptal edilen harcamalar silinmez; hesaplamadan çıkarılır.

`src/domain/budget/` değişmedi. Başlangıç bakiyesine dahil eski hareketler ikinci kez düşülmez, maaş geliri üretilmez ve banka hareketleri otomatik alınmaz. Harcama geçmişi varsa, iptal edilmiş olsa bile, başlangıç bakiyesi/anı, saat dilimi ve maaş tarihi kilitlidir. Aktif dönemde birikim ve bekleyen faturalar düzenlenebilir. Sona ermiş döneme yeni harcama eklenmez; hata düzeltmek için iptal yapılabilir. Yeni dönem açma ve bakiye yeniden başlangıcı bu sürümde yoktur.

Veritabanı uygulama düzeyinde **şifreli değildir**. Uygulama otomatik bulut yedeği veya cihazlar arası eşitleme yapmaz. İşletim sisteminin kendi yedekleme ayarları ayrıca geçerlidir. Görünümden çıkmak kayıtları silmez; uygulamayı kaldırmak/verilerini temizlemek farklı işlemlerdir.

## Kod kontrolleri

```sh
npm test
npx expo lint
npx tsc --noEmit
npx expo-doctor
npx expo export --platform all --output-dir /private/tmp/gunluk-butcem-export
```

`npm test`, Node.js 24'ün yerleşik araçlarını kullanır; yeni test bağımlılığı yoktur. **256 test**: önceki 192 test ve gerçek SQLite dosyaları kullanan 64 yeni harcama/migration/adaptör testi. Ayrıca iPhone'da ayrı veritabanıyla **13 native kontrol** geçti; bunlar npm test sayısına dahil değildir. Node 24.4.0, `node:sqlite` için deneysel API uyarısı verir. Motorun API'si ve matematiği [modül dokümantasyonundadır](src/domain/budget/README.md).

Önceki tam ve `--omit=dev` audit raporlarında **5 yüksek önem dereceli bulgu** bulunuyor. Bu aşamada paketler değiştirilmedi, audit yenilenmedi ve `npm audit fix` uygulanmadı.

## Raporlar

- [Gerçek harcama, v2 şema, finansal kurallar ve iPhone testleri](HARCAMA_RAPORU.md)
- [iPhone/Hermes BigInt biçimlendirme hatası ve gerçek cihaz doğrulaması](BIGINT_HATA_RAPORU.md)
- [SQLite, şema, değişen dosyalar, öğretici açıklamalar ve testler](SQLITE_RAPORU.md)
- [Kurulum ekranı, state/type açıklamaları ve test sonuçları](BUTCE_KURULUM_RAPORU.md)
- [Bütçe motoru, matematik ve gerçek test sonuçları](BUTCE_MOTORU_RAPORU.md)
- [Ana ekran prototipi ve test sonuçları](ANA_EKRAN_RAPORU.md)
- [İlk kurulum](KURULUM_RAPORU.md)
- [ESLint ve güvenlik incelemesi](GUVENLIK_RAPORU.md)
