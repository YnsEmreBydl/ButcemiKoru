# Günlük Bütçem — Ana Ekran Prototipi

Tarih: 25 Ekim 2026, Europe/Istanbul.

İkinci geliştirme aşamasında yalnızca ana ekranın çalışan görsel prototipi oluşturuldu. Ekran açık tema kullanır; tüm bütçe ve harcama verileri DEMO olarak işaretlenmiştir.

## Görsel içerik

- Krem beyaz zemin, beyaz yüzeyler, koyu metinler ve bütçe kartında ölçülü yeşil tonları.
- Uygulama adı ve görünür DEMO işareti.
- Büyük günlük harcama bütçesi: `₺1.250,00`.
- Maaş gününe kalan örnek süre: `12 gün`; örnek maaş tarihi: `6 Kasım`.
- Toplam kalan örnek bütçe: `₺15.000,00`.
- `Harcama Ekle` ve `Bunu Alırsam?` eylemleri.
- Market, kahve ve ulaşım için üç örnek harcama.
- Ekranın altında tüm tutarların örnek olduğunu ve gerçek hesaplara bağlı olmadığını açıklayan metin.

İki buton da React Native `Modal` ile bir DEMO açıklaması açacak şekilde bağlandı. `Anladım` düğmesi açıklamayı kapatır; Android geri tuşu için `onRequestClose` tanımlandı. Harcama kaydetme veya satın alma hesabı yapıldığı izlenimi veren bir sonuç üretilmez. Örnek veriler değişmez.

## Rotalar ve yapı

İlk olarak mevcut `src/app/_layout.tsx`, `/` ve `/explore` rotaları, native/web sekme bileşenleri ve tema yapısı incelendi.

`/`, yeni ana ekranı gösterir. `/explore` dosyası ve başlangıç içeriği korunmuştur. Kök yerleşim, yalnızca ilk ekranı öne çıkarmak için Expo Router `Stack` düzenine geçirildi; başlangıç şablonunun Home/Explore sekme çubuğu ana ekranda gösterilmez. Önceki sekme bileşenleri silinmedi. `/explore` doğrudan açıldığında başlıklı bir ekran olarak çalışmaya devam eder.

Kök yerleşimde açık tema ve koyu durum çubuğu simgeleri kullanılır. Önceki Expo logosu animasyon katmanı ana akıştan çıkarıldı; splash ekranının yönetimi Expo Router'a bırakıldı. `app.json` değiştirilmedi.

| Dosya | Görevi |
| --- | --- |
| `src/app/index.tsx` | Ana ekran, bölüm düzeni ve DEMO pencere durumu. |
| `src/app/_layout.tsx` | Açık tema, durum çubuğu ve mevcut rotaların Stack düzeni. |
| `src/components/budget/budget-overview.tsx` | Günlük bütçe ve maaş dönemi özeti. |
| `src/components/budget/quick-action.tsx` | Yeniden kullanılabilir eylem kartı. |
| `src/components/budget/expense-list.tsx` | Örnek harcama satırları ve kategori görünümü. |
| `src/components/budget/demo-notice.tsx` | Kaydırılabilir, kapatılabilir DEMO açıklama penceresi. |
| `src/components/budget/budget-icon.tsx` | iOS SF Symbols ve Android/web Material Symbols eşleştirmeleri. |
| `src/constants/budget-theme.ts` | Renkler ve köşe yarıçapları. |
| `src/data/demo-budget.ts` | Salt okunur, sabit örnek veriler. |
| `src/utils/currency.ts` | Türkçe TRY görüntüleme ve ekran okuyucu para metinleri. |

Yeni bağımlılık yüklenmedi. Görev başındaki dosya özetleriyle karşılaştırılarak `package.json`, `package-lock.json`, `app.json`, `tsconfig.json` ve `eslint.config.js` dosyalarının değişmediği doğrulandı.

## Küçük ekran ve erişilebilirlik

- İçerik `SafeAreaView` ve `ScrollView` ile güvenli alanlara yerleştirildi; kısa ekranlarda içerik kaydırılır.
- Ekran genişliğine göre sarılabilen özet ve eylem düzenleri kullanıldı. Büyük sistem yazısı ayarında (`fontScale > 1.3`) özetler ve eylemler tek sütuna geçer.
- Günlük büyük tutar, dar alana sığacak biçimde ölçeklenebilir; tam değer ayrıca ekran okuyucu etiketiyle sunulur.
- Eylem kartlarının minimum yüksekliği 104, pencere kapatma düğmesinin minimum yüksekliği 52 React Native birimidir.
- Başlık, buton, demo açıklaması ve harcama satırı için erişilebilirlik etiketleri kullanıldı. Dekoratif simgeler ekran okuyucudan gizlendi.
- DEMO penceresi açıkken arka plan içeriği erişilebilirlik ağacından gizlenir. Web'de pencere açılınca kapatma düğmesine odak verilir.
- Açıklama penceresinin içeriği de kaydırılabilir; büyük yazı ve kısa ekran için sabit gövde yüksekliği kullanılmadı.
- Sistem yazı tipleri kullanılır; uzaktan font veya görsel indirme gerektiren yeni bir kaynak eklenmedi.

Hesaplanan temel metin kontrastları: ana metin `12,05:1`, ikincil metin `4,83:1`, günlük tutar `6,80:1`, birincil eylem metni `11,42:1`. Bunlar renk çiftlerinin sayısal denetimidir; cihaz üstünde erişilebilirlik sertifikasyonu anlamına gelmez.

## Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| `npx expo lint` | Başarılı; 0 hata, 0 uyarı. |
| `npx tsc --noEmit` | Başarılı; çıkış kodu 0. |
| `npx expo-doctor` | Başarılı; 20/20 kontrol. |
| iOS üretim paketi | Başarılı; Hermes `.hbc` çıktısı üretildi. |
| Android üretim paketi | Başarılı; Hermes `.hbc` çıktısı üretildi. |
| Web üretim paketi | Başarılı; istemci ve sunucu paketleri üretildi. |
| Metro durum yanıtı | `packager-status:running`. |
| `/` yanıtı | HTTP 200; uygulama adı, bütçeler, eylemler, harcamalar ve DEMO metni doğrulandı. |
| `/explore` yanıtı | HTTP 200; önceki başlangıç içeriğinin korunduğu doğrulandı. |
| Türkçe para biçimi | Pozitif, negatif, ondalıklı, sıfır ve ekran okuyucu metni denetlendi. |
| Metin renkleri | Dört temel renk çiftinin kontrastı 4,5:1 üzerindedir. |
| Yapılandırma bütünlüğü | Beş mevcut yapılandırma/paket dosyası görev başlangıcıyla aynı. |

Paket üretim komutu:

```sh
npx expo export --platform ios --platform android --platform web --output-dir /private/tmp/gunluk-butcem-home-preview
```

Türkçe para biçimi örnekleri: `₺1.250,00`, `₺15.000,00`, `-₺485,50`, `₺0,00`. Ekran okuyucu metninde `Türk lirası` kullanılır. Tutarlar `Intl.NumberFormat('tr-TR')` ile biçimlendirilir; finansal hesaplama yapılmaz.

## Test sınırları ve ortam notları

Bu oturumda bağlı tarayıcı listesi boştu. Ayrıca `xcrun simctl` bulunamadı ve Android araçları kullanılabilir değildi. Bu nedenle ekran görüntüsü, gerçek cihaz/simülatör görsel onayı, dokunmatik buton denemesi ve VoiceOver/TalkBack ile elle kontrol yapılmadı. Butonlar kodda bağlandı, TypeScript/lint ve platform paket üretimi başarılıdır; etkileşim testinin yapılmadığı açıkça belirtilmektedir. Küçük ekran ve büyütülmüş yazı davranışı kod düzeyinde ele alındı, cihaz üstünde görsel olarak doğrulanmadı.

8081 portunda aynı projeye ait mevcut bir sunucu bulunduğundan bu süreç durdurulmadı. HTTP doğrulaması 8082 portunda ayrı bir sunucuyla yapıldı. İnceleme için bu sunucu `http://localhost:8082` adresinde açık bırakıldı.

Metro, ortamda `NO_COLOR` ve `FORCE_COLOR` birlikte tanımlı olduğu için renk uyarıları verdi. Doğrudan Node ile TypeScript yardımcı dosyaları okunurken de modül türü uyarısı oluştu; bu test için Expo'nun paket yapılandırması değiştirilmedi. Bu uyarılar kontrollerin başarılı tamamlanmasını engellemedi.

Gerçek bütçe motoru, SQLite, Laravel API, ödeme sistemi veya başka uygulama ekranı geliştirilmedi. Önceki güvenlik bulgularına yönelik otomatik düzeltme ya da paket yükseltmesi uygulanmadı.

Teknik referanslar: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), [güvenli alanlar](https://docs.expo.dev/versions/v58.0.0/sdk/safe-area-context/), [platform simgeleri](https://docs.expo.dev/versions/v58.0.0/sdk/symbols/).
