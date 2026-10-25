# Günlük Bütçem — İlk Bütçe Kurulum Ekranı

Tarih: 25 Ekim 2026. Ortam: Expo 58.0.19, React Native 0.88.0, TypeScript 6.0.3 ve Node.js 24.4.0.

`/budget-setup` rotası ve mevcut bütçe motorunu kullanan geçici ön izleme akışı oluşturuldu. Ana ekrana **Bütçe kurulumunu ön izle — Kendi tutarlarınla dene · kaydedilmez** erişimi eklendi. DEMO bütçeler, harcamalar ve mevcut eylemler korundu.

Ön izleme: `http://localhost:8082/budget-setup`. Aynı bağlantıya DEMO ana ekrandaki yeni erişimden de ulaşılabilir.

## Form ve sonuç akışı

Form; şu an kullanılabilir hesap bakiyesi, sonraki maaş tarihi, bekleyen faturaların adı/tutarı/tarihi ve isteğe bağlı birikim hedefini alır. Kullanıcı hesabı veya banka bağlantısı istenmez.

Bakiye açıklaması, sonraki maaşın eklenmemesini ve geçmiş harcamaların bu bakiyeye zaten dahil olduğunu belirtir. Faturalar eklenebilir ve kaldırılabilir. Eklenmiş bir satır eksikse sessizce atlanmaz; tamamlanması veya kaldırılması istenir. Boş birikim hedefi sıfırdır. Negatif bakiye geçerlidir; negatif birikim veya sıfır/negatif fatura geçerli değildir.

Hesaplama yalnızca **Ön izlemeyi hesapla** düğmesinde çalışır. Sonuç aynı rotada formun yerine gösterilir. Günlük öneri, işaretli toplam harcanabilir tutar, maaşa kalan gün, fatura/birikim rezervleri ve varsa bütçe açığı görünür. **Bilgileri düzenle** önceki form girdilerine döndürür; eski sonucu kapatır.

Sonuçta şu açıklama bulunur: **Bu bir ön izlemedir, bilgileriniz henüz kaydedilmiyor**. Kaydet düğmesi, kayıt başarısı bildirimi veya saklanmış hesap izlenimi yoktur. Ekrandan çıkışta ya da sayfa yenilemesinde geçici veriler kaybolur. SQLite, başka kalıcı depolama, ağ API'si, üyelik veya ödeme sistemi eklenmedi.

## Değişen dosyalar

| Dosya | İşlem / amaç |
| --- | --- |
| `src/app/budget-setup.tsx` | Yeni Expo Router rotası; ekran bileşenini dışa aktarır. |
| `src/app/_layout.tsx` | Yalnızca yeni rota başlığı eklendi. |
| `src/app/index.tsx` | DEMO ekranına etiketli kurulum erişimi eklendi. |
| `src/features/budget-setup/setup-screen.tsx` | Form state'i, olay işleyicileri ve ön izleme geçişi. |
| `src/features/budget-setup/setup-field.tsx` | Etiket, açıklama, erişilebilir giriş ve alan hatası. |
| `src/features/budget-setup/payment-form.tsx` | Fatura satırı ve kaldırma eylemi. |
| `src/features/budget-setup/preview-result.tsx` | Aktif/sona ermiş dönem ve negatif bütçe görünümü. |
| `src/features/budget-setup/types.ts` | Form, hata, dönüşüm ve ön izleme tipleri. |
| `src/features/budget-setup/input.ts` | Güvenli Türkçe para ve takvim tarihi ayrıştırma. |
| `src/features/budget-setup/format.ts` | Tam sayı kuruşu hassasiyet kaybetmeden TRY olarak gösterme. |
| `src/features/budget-setup/preview.ts` | Doğrulama ve mevcut `calculateBudget` API'sine adaptasyon. |
| `tests/budget-setup/input.test.ts` | 58 para/tarih/biçimlendirme testi. |
| `tests/budget-setup/preview.test.ts` | 18 form ve motor entegrasyonu testi. |
| `scripts/test-budget.mjs` | Mevcut ve yeni test klasörlerini birlikte keşfetmek için genişletildi. |
| `tsconfig.budget-tests.json` | Saf form adaptörleri ve yeni testler derleme kapsamına alındı. |
| `README.md` | Yeni rota, geçici veri davranışı ve test kapsamı belgelendi. |
| `BUTCE_KURULUM_RAPORU.md` | Bu teslimat ve öğretici açıklamalar. |
| `raporlar/kurulum-formu-test-sonuclari.txt` | 158 testin tam çalışma çıktısı. |
| `raporlar/kurulum-guvenlik-denetimi.json` | Güncel tam npm audit çıktısı. |
| `raporlar/kurulum-guvenlik-uretim.json` | Güncel üretim npm audit çıktısı. |

Bütçe motorunun tüm dosyaları ve mevcut 82 testin kaynakları görev başlangıcındaki özetlerle byte düzeyinde karşılaştırıldı; değişmediler. `package.json`, `package-lock.json`, `app.json`, ana `tsconfig.json`, ESLint ayarı ve DEMO veri dosyası da aynı kaldı. Yeni paket kurulmadı. Yeni ekran/erişim dışında eski arayüz bileşenleri değiştirilmedi.

## React state nasıl çalışıyor?

Ekranda üç ayrı state vardır:

```ts
const [draft, setDraft] = useState<SetupDraft>(emptySetupDraft);
const [errors, setErrors] = useState<SetupErrors>(emptySetupErrors);
const [preview, setPreview] = useState<BudgetResult | null>(null);
```

`draft`, kullanıcının henüz tamamlamamış olabileceği metinleri saklar. Örneğin kişi `1.234,50` yazarken geçici olarak `1.234,` görünebilir. Bu yüzden giriş anında her tuşta sayıya çevrilmez; `TextInput.value` state'ten gelir ve `onChangeText` metni state'e yazar. State değişince React ilgili görünümü tekrar oluşturur.

`errors`, her alanın ve fatura satırının açıklamasını tutar. Hata olan alan düzenlenince o alanın eski hatası temizlenir; diğer alanların hataları korunur. Fatura kaldırılınca ona ait hatalar da kaldırılır.

`preview`, motorun geçerli sonucudur. Başlangıçta `null` olduğu için form görünür. Hesaplama başarılı olunca sonuç atanır ve sonuç görünümü açılır. Düzenleme düğmesi `preview` değerini yeniden `null` yapar; `draft` silinmediğinden önceki girdiler geri gelir. Kullanıcı tekrar hesaplayana kadar eski sonuç gösterilmez.

Fatura dizileri yerinde değiştirilmez. `setDraft(current => ...)`, en güncel state üzerinden yeni dizi/nesne oluşturur. `map` düzenler, `filter` kaldırır, spread ile ekleme yapılır. Satırların kimliği dizi sırası değildir; böylece ortadaki satır kaldırılınca başka satırın girdisi/hatası ona geçmez.

`useRef` yalnızca yeniden çizim gerektirmeyen satır kimlik sayacı ve kaydırma referansı içindir. Sayaç düğme olayında artırılır; state güncelleyici fonksiyonun içinde artırılmaz. Böylece React geliştirme denetimleri güncelleyiciyi tekrar çağırsa da onun içinde yan etki oluşmaz. `useEffect` kullanılmadı.

## TypeScript tipleri ne işe yarıyor?

`SetupDraft`, form verilerinin henüz sayı olmadığını açık eder:

```ts
type SetupDraft = Readonly<{
  balance: string;
  payday: string;
  savings: string;
  payments: readonly PaymentDraft[];
}>;
```

`readonly`, state dizisine yanlışlıkla `push` yapılmasını ve alanların doğrudan değiştirilmesini önlemeye yardımcı olur. `MainField` ve `PaymentField` birleşimleri, alan güncelleyicilerine yanlış bir alan adı gönderilmesini sınırlar.

Ayrıştırma ve ön izleme sonuçları başarı/hata olarak ayrılır:

```ts
type ParsedField<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };
```

Kod `if (parsed.ok)` dediğinde TypeScript `value` alanının kullanılabilir olduğunu bilir. Hata kolunda yalnızca `message` vardır. Benzer şekilde `PreviewOutcome.status` alanı, ekranın hatayı mı sonucu mu okuyabileceğini belirler. `any` veya denetlenmemiş `as BudgetInput` dönüşümü kullanılmaz; doğrulanmış alanlardan `const input: BudgetInput = ...` oluşturulur.

Domain'in `BudgetResult` tipi de dönem durumunu ayırır. `periodStatus === 'active'` kolunda `daily` vardır; bugün/geçmiş maaş kolunda `daily` null'dır. Sonuç bileşeni bu ayrımı kontrol ettiği için günlük öneriyi yokken okumaz veya sıfırmış gibi göstermez.

## Formdan domain fonksiyonuna veri akışı

```text
TextInput metni
    ↓ onChangeText
draft state'i
    ↓ Ön izlemeyi hesapla
tek bir asOf + cihazın açık timeZone değeri
    ↓ createSetupPreview(draft, context)
Türkçe tutar / takvim / satır doğrulaması
    ↓ tipli BudgetInput
mevcut calculateBudget(input)
    ↓ BudgetResult
preview state'i → PreviewResult
```

UI, düğmeye basıldığında saati bir kere okur. Aynı zaman hem `input.asOf` hem `balanceSnapshot.capturedAt` olarak kullanılır. Başlangıç bakiyesi o andaki mevcut bakiye kabul edilir. Kurulumda `transactions: []` gönderilir; DEMO harcamaları veya bakiyede zaten bulunan geçmiş hareketler eklenmez. Sonraki maaş yalnızca tarihtir; gelir tutarı olarak bakiyeye eklenmez.

Fatura adı formda kalır; mevcut motor sözleşmesi kimlik, kuruş tutarı ve vade tarihi alır. Bu nedenle isim için domain tipi değiştirilmedi. Geçerli aktif dönemde maaş gününde veya sonrasında vadesi gelen fatura reddedilir; motorun bunu sessizce rezerv dışı bırakması kullanıcıya görünmez bir eksiltme yaratmaz. Vadesi geçmiş fakat ödenmemiş fatura geçerlidir.

Maaş tarihi bugün/geçmişteyse motorun kendi yeni dönem sonucu gösterilir. Tarih ileri taşınmaz. Bu durumda girilen tarihe göre rezervlerin güncel dönem için yeterli olmayabileceği sonuçta açıklanır; günlük öneri verilmez. Genel hatalar, alan hataları ve toplam taşma hatası Türkçe açıklamaya dönüşür.

## Hata yapmaya en açık üç nokta

1. **Para metnini sayıya çevirme — `input.ts:8`.** `parseFloat(text) * 100` kullanılmamalıdır: virgülü yanlış okuyabilir ve ikili ondalık hassasiyet kaybı yaratabilir. Burada nokta yalnızca geçerli binlik grubu, virgül kuruş ayracıdır. `1.234` = 1.234 TL; `1234.50` geçersizdir. Kuruş haneleri metin olarak birleştirilir, `BigInt` ile sınır kontrolü yapılır ve yalnızca güvenli tam sayı `number` döner. `0,009` yuvarlanmaz, reddedilir. Gösterimde de kuruş önce floating-point TL'ye çevrilmez.
2. **Bakiye başlangıcı ve yerel gün — `setup-screen.tsx:73`, `preview.ts:51`.** Ayrı saat okumaları, örtük UTC varsayımı veya DEMO/geçmiş harcamalarını eklemek yanlış gün ve çift sayım yaratabilir. Tek bir an ve açık saat dilimi kullanılır; bakiye başlangıcı aynı andır. Tarihler, `Date` ile gece yarısına dönüştürülmez; motorun takvim doğrulayıcısı üzerinden ISO takvim tarihine çevrilir.
3. **State'i yerinde değiştirme ve eski sonuç gösterme — `setup-screen.tsx:47`.** Diziyi değiştirmek veya satır sırasını kimlik yapmak yanlış satırların güncellenmesine yol açabilir. Fonksiyonel state güncellemesi ve sabit kimlik kullanılır. Düzenlemeye dönüşte önceki ön izleme kapanır; hesaplama render veya effect içinde otomatik tetiklenmez.

## Test sonuçları

| Kontrol | Sonuç |
| --- | --- |
| `npm test` | 158/158 başarılı; 0 başarısız, 0 atlanan, 0 iptal. |
| Önceki bütçe testleri | 82/82; önceki test adlarının tamamının yeni çalışma çıktısında bulunduğu doğrulandı. |
| Yeni testler | 58 giriş/biçimlendirme + 18 form/entegrasyon = 76 test. |
| `npx tsc --noEmit` | Başarılı; çıkış kodu 0. |
| `npx expo lint` | Başarılı; 0 hata, 0 uyarı. |
| `npx expo-doctor` | Başarılı; 20/20 kontrol. |
| iOS paket üretimi | Başarılı; Hermes `.hbc` üretildi. |
| Android paket üretimi | Başarılı; Hermes `.hbc` üretildi. |
| Web paket üretimi | Başarılı; `/budget-setup` istemci paketi ve SSR sunucu çıktısı üretildi. |
| `/`, `/budget-setup`, `/explore` | HTTP 200; gerekli metinler, yeni bağlantı ve DEMO tutarları doğrulandı. |
| Yapı bütünlüğü | 44 korunan kaynak/test/yapılandırma dosyası aynı; domain ve 82 eski test değişmedi. |

Yeni testler Türkçe virgül/binlik grupları, negatif/sıfır tutarlar, fazla ondalık, güvenli tam sayı sınırı, tam kuruş gösterimi, geçersiz takvim tarihleri, artık yıl, eksik alan/satır, fatura vadesi, boş birikim, negatif bütçe, bugün/geçmiş maaş, saat dilimi/DST, taşma ve girdinin değişmemesini kapsar.

Örnek testte saat 25 Ekim 2026 İstanbul, bakiye `15.000,50`, fatura `2.000,00`, birikim `1.000,00`, maaş tarihi `04.11.2026` olduğunda motor: **12.000,50 TL harcanabilir tutar, 10 gün ve 1.200,05 TL günlük öneri** döndürdü.

Paket üretim komutu:

```sh
npx expo export --platform ios --platform android --platform web --output-dir /private/tmp/gunluk-butcem-setup-preview
```

Testler Node.js 24'ün yerleşik çalıştırıcısıyla devam eder. Yeni test klasörlerini keşfetme ve saf adaptörleri derleme kapsamı dışında test altyapısı değiştirilmedi.

## Güvenlik ve yapılmayan testler

Güncel `npm audit --json` ve `npm audit --omit=dev --json` taramalarının ikisi de **5 yüksek önem dereceli bulgu** bildirdi. Kritik/orta/düşük bulgu sayısı sıfırdır. Etkilenen paketler: `node-forge`, `zod`, `@expo/code-signing-certificates`, `@expo/cli`, `expo`. Önceki ayrıntılı [güvenlik raporundaki](GUVENLIK_RAPORU.md) iki temel bildirim ve bağımlılık zincirleri geçerlidir. Ham güncel raporlar `raporlar/kurulum-guvenlik-denetimi.json` ve `raporlar/kurulum-guvenlik-uretim.json` dosyalarındadır. Audit'in çıkış kodu 1, açık bulgular nedeniyle oluştu; tarama başarısızlığı değil. `audit fix`, zorlayıcı düzeltme veya paket yükseltmesi yapılmadı.

Gerçek iOS/Android cihaz testi yapılmadı. Bu oturumda bağlı tarayıcı listesi boş olduğundan formu doldurma, butonlara dokunma, klavye açılınca kaydırma, ekran görüntüsü ve VoiceOver/TalkBack testleri de elle/uçtan uca doğrulanmadı. HTTP testi formun sunucu çıktısını doğrular; kullanıcı etkileşimi testi değildir. Native paket üretimi de APK/IPA kurulumu veya cihazda çalışma testi anlamına gelmez. Bunlar kalan doğrulama sınırlarıdır.

Metro yalnızca mevcut `NO_COLOR` / `FORCE_COLOR` ortam uyarılarını verdi; paket üretimi başarılı tamamlandı. Saat dilimi, yerel klavye ve büyük yazı davranışları kodda ele alındı, fiziksel cihazda doğrulanmadı.

Bu görev geçici kurulum ön izlemesiyle tamamlandı. SQLite veya başka bir sonraki aşamanın geliştirmesine başlanmadı.

Teknik referanslar: [Expo SDK 58 Router](https://docs.expo.dev/versions/v58.0.0/sdk/router/), [kontrollü TextInput](https://reactnative.dev/docs/textinput), [KeyboardAvoidingView](https://reactnative.dev/docs/keyboardavoidingview).
