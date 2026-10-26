# Günlük Bütçem — 6. aşama: gerçek harcamalar

26 Ekim 2026, Europe/Istanbul. Yeni bağımlılık eklenmedi. Expo, React Native, Hermes ve bütçe motoru değiştirilmedi.

## Sonuç ve kullanım

Ana ekrandaki **Harcama ekle**, `/expense-add` ekranını açar. Pozitif Türkçe tutar, Market/Yemek/Ulaşım/Alışveriş/Eğlence/Diğer kategorilerinden biri ve isteğe bağlı en fazla 200 karakter açıklama kaydedilir. Kategori yönetimi veya fatura ödeme işlemi yoktur.

Başarılı commit sonrasında ana ekran açılır, mevcut motor kayıtlı hareketlerle yeniden hesaplanır. Gerçek geçmiş en yeni gerçekleşme zamanından eskiye sıralanır. İptal, onay penceresinden sonra yapılır; satır geçmişte **İptal edildi** durumuyla kalır. Tutar/kategori/açıklama yerinde düzenlenmez; hatalı kayıt iptal edilip doğru kayıt eklenebilir. İptal bankadan iade başlatmaz.

Boş geçmişte açık bir mesaj, geçersiz tutarda alan hatası gösterilir. Başarısız yazma form girdilerini temizlemez. İptal veya yenileme hatasında son okunan bütçe ekranda kalır ve eski olabileceği açıklanır. DEMO ayrı rotadadır, gerçek kayda katılmaz.

## Şema v2 ve mevcut veriler

[migrations.ts](src/data/budget/migrations.ts), v1 SQL metnini değiştirmeden v2 ekler. `PRAGMA user_version = 2`; yeni tablo **budget_expenses**:

| Sütun | Kural |
| --- | --- |
| `id` | Benzersiz, boş olmayan ve kırpılmış 1–128 karakter TEXT birincil anahtar. |
| `period_id` | Mevcut bütçeye foreign key; mevcut tek dönemli mimaride `1`. |
| `amount_minor` | Pozitif INTEGER kuruş, en fazla `Number.MAX_SAFE_INTEGER`. |
| `category` | Altı sabit anahtardan biri: `market`, `food`, `transport`, `shopping`, `entertainment`, `other`. |
| `description` | Boş olabilir; en fazla 200 karakter, uç boşlukları kırpılmış TEXT. |
| `occurred_at` | Gerçekleşme anı, doğrulanmış ve kanonik UTC ISO metni. |
| `created_at` | Kayıt oluşturma anı, gerçekleşmeden önce olamaz. |
| `status` | `active` veya `cancelled`. |
| `cancelled_at` | Aktifken NULL; iptal edildiğinde oluşturulma anından önce olmayan UTC ISO anı. |

Tablo `STRICT` kullanır. Finansal REAL hesap yoktur. `(period_id, occurred_at DESC, created_at DESC, id DESC)` indeksi vardır. Aynı andaki kayıtlar oluşturulma anı ve kimlik ile deterministik sıralanır. Farklı ofsetli girişler UTC'ye çevrilir; metin sıralamasının yanlış kronoloji üretmesi önlenir. Ekran zamanları bütçenin kayıtlı saat diliminde gösterilir.

Trigger'lar ilişkisiz kayıt eklemeyi, finansal satırı sonradan değiştirmeyi, ikinci iptali, harcamayı fiziksel silmeyi ve geçmişi olan dönemi silmeyi engeller. Başlangıç/dönem kilidi SQL düzeyinde de vardır. Böylece yeni native transaction bağlantısında foreign key PRAGMA kapalı olsa da temel ilişkiler korunur. Mevcut **budget_periods**, **budget_payments** ve **budget_save_operations** tabloları silinmedi veya yeniden oluşturulmadı.

Migration ve sürüm artırma tek transaction'dadır. Hata halinde v1 kayıtları ve sürümü korunur. Bilinmeyen ileri sürüm sıfırlanmaz. Frozen [v1 şema fixture'ı](tests/expenses/v1-schema.sql), eski migration metniyle aynı olduğunu testte doğrular. Gerçek dosyaya eski bütçe, fatura ve işlem kaydı yazılıp v2'ye geçirilerek önce/sonra verileri karşılaştırıldı; eski kaydetme işlem kimliği de çalışmaya devam etti.

SQLite varsayılan olarak uygulama düzeyinde şifreli değildir. Uygulamanın bulut yedeği, cihazlar arası senkronizasyonu veya banka bağlantısı yoktur. İşletim sisteminin yedekleme davranışı ayrıca geçerlidir.

## Repository, transaction ve tekrar deneme

Ekranlar SQL çalıştırmaz. [contracts.ts](src/data/budget/contracts.ts) `AddExpenseCommand`, `CancelExpenseCommand`, `ExpenseData`, `SavedExpense` tiplerini; [expense-repository.ts](src/data/budget/expense-repository.ts) yazma kurallarını tanımlar. Ortak repository okuması kayıtları güvenilir saymadan doğrular.

Bir eklemede: güncel bütçe okunur → işlem kimliği kontrol edilir → dönem/revision/girdi doğrulanır → mevcut motorla toplam sınırı kontrol edilir → revision artırılır → harcama ve işlem makbuzu birlikte yazılır → kayıt yeniden okunup doğrulanır → commit tamamlanınca sonuç döner. İptalde durum, iptal anı, revision ve makbuz aynı transaction içinde değişir. Native tarafta mevcut `withExclusiveTransactionAsync` adaptörü korunur. [Expo 58 SQLite API belgesi](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/).

Mevcut **budget_save_operations** tablosu kullanılır. Harcama ekleme/iptal içerikleri türleriyle ayrılır; aynı işlem kimliğinin farklı içerikte kullanılması reddedilir. Tamamlanmış aynı eklemenin tekrarı yeni satır oluşturmaz. Sonradan iptal edilmiş kaydı tekrar aktif yapmaz. Aynı iptal tekrar denendiğinde ikinci finansal etki oluşmaz. Makbuz ile kayıtlı harcama alanlarının uyuşması da denetlenir.

Ekrandaki `useRef` kilidi ikinci dokunmayı render beklemeden keser. Repository kuyruğu ve SQL benzersizlikleri ek korumadır. Harcama/iptal bütçenin ortak revision değerini artırdığı için eşzamanlı bütçe düzenleme eski değerlerle yazamaz; `CONFLICT` döner. Her istek beklemeden kopyalanır; çağıranın daha sonra nesneyi değiştirmesi kaydı değiştirmez.

Yanıt belirsizse form yeni işlem üretmez: aynı değişmez işlem tekrar denenebilir veya veritabanından durum okunabilir. Bu sırada girdi düzenleme kilitlidir. Okumada aynı kimlik ve alanlarla kayıt bulunduysa başarı doğrulanır; yoksa taslak korunarak düzenleme açılır. Kayıt kesinleşmeden başarı bildirimi yoktur.

## Finansal kurallar ve başlangıç bakiyesi

Domain API'si ve `calculateBudget` değişmedi. Repository yalnızca **aktif** satırları `{ id, kind: 'expense', amountMinor, occurredAt }` hareketlerine dönüştürür. İptal satırları doğrulanır ve geçmişte gösterilir, hesaplama hareketlerine alınmaz. Bir gideri geri almak için sahte gelir veya negatif harcama üretilmez.

```text
Kalan bakiye  = başlangıç bakiyesi − başlangıç anından sonraki aktif çıkışlar
Harcanabilir = kalan bakiye − bekleyen fatura rezervleri − birikim
Açık         = max(−harcanabilir, 0)
```

Tüm tutarlar tam sayı kuruştur. Sıfır/negatif harcama, kesirli kuruş, NaN/sonsuz, yanlış kategori/tarih ve güvenli toplam sınırını aşan girdiler reddedilir. Bakiye yetmiyorsa gerçek harcama yine kaydedilir; negatif bakiye ve açık korunur. Günlük dağıtımın pozitif havuzu ve aşağı yuvarlama motorun mevcut kurallarıdır.

Gerçekleşme zamanı ile kayıt zamanı ayrıdır. Formda geçmiş tarih seçimi yoktur; ilk geçerli Kaydet denemesinin anı kullanılır. SQL, bağlantı veya revision hatasında tekrar deneme gerçekleşmeyi ileri taşımaz. Böylece arada yeni bir başlangıç bakiyesi kaydedildiyse eski bir gerçek harcama yeni snapshot sonrasına taşınıp yeniden düşülmez. Bu yarış için ayrıca test eklendi.

Motorun `occurredAt <= capturedAt` dahil kesim kuralı korunur: bu hareketler bakiyeye zaten dahildir, yeniden düşülmez. Geçmişte bu tür kayıt varsa satırda açıklama gösterilir; iptali de başlangıç bakiyesini artırmaz. Geç kaydedilen ama dün gerçekleşen hareket bugünün gideri gibi sayılmaz.

**Harcama geçmişi olan dönemde başlangıç bakiyesi, başlangıç anı, para birimi, saat dilimi ve maaş tarihi kilitlidir.** İptal edilmiş satırlar da geçmiş sayılır. Kontrol formda, repository'de ve SQL trigger'ında bulunur. Tüm satırlar iptal edilince kilit sessizce açılmaz. Aktif dönemde birikim/fatura düzenlemeleri yapılabilir; mevcut harcamalar ön izleme ve kayıtta korunur. Hiç harcama yoksa önceki bakiye düzenleme davranışı devam eder.

Bu sürüm güvenli bakiye yeniden başlangıcı veya yeni dönem açma işlemi içermez. Maaş günü bugün/geçmişse yeni harcama eklenmez; var olan hatalı kayıt iptal edilebilir. Tarih veya gelir otomatik ileri taşınmaz. Önceden tamamlanmış bir isteğin idempotent tekrarına yeni yazma yapmadan yanıt verilebilir.

Bekleyen faturalar bu özelliğin harcamalarıyla otomatik kapanmaz. Form ve bütçe ekranı bunu açıklar; fatura ödeme sistemi bu aşamaya dahil edilmedi.

## Sayısal örnek

10.000 TL başlangıç, 2.000 TL bekleyen fatura, 1.000 TL birikim ve maaşa 10 takvim günü için:

| Durum | Kalan bakiye | Harcanabilir | Güncel günlük öneri | Bugün başlangıç hedefi | Bugün kalan hedef |
| --- | --- | --- | --- | --- | --- |
| Başlangıç | 10.000 TL | 7.000 TL | 700 TL | 700 TL | 700 TL |
| Bugün 100 TL gider | 9.900 TL | 6.900 TL | 690 TL | 700 TL | 600 TL |
| Bu gider iptal | 10.000 TL | 7.000 TL | 700 TL | 700 TL | 700 TL |

İkinci satırda yarından itibaren günlük ortalama 700 TL kalır. Güncel eşit dağıtım ile bugünün hedef takibi ayrı bakışlardır; birbirine eklenmez. Testlerde 8.000 TL giderin 1.000 TL bütçe açığı oluşturması da doğrulandı. Bunlar kesin harcama güvenliği vaat etmez.

## Testler ve gerçek cihaz kapsamı

| Kontrol | Sonuç |
| --- | --- |
| `npm test` | **256/256 geçti**, 0 hata, 0 atlanan/iptal; çıkış 0. |
| `npx tsc --noEmit` | Hatasız, çıkış 0. |
| `npx expo lint` | 0 hata / 0 uyarı; çıkış 0. |
| `npx expo-doctor` | **20/20 geçti**, çıkış 0. |
| `npx expo export --platform all --output-dir /private/tmp/gunluk-butcem-expenses-final` | iOS/Android Hermes ve web paketleri üretildi; çıkış 0. APK/IPA değildir. |
| Gerçek iPhone / Expo Go / Hermes | Ayrı test dosyasında **13/13 native kontrol geçti**; SQLite **3.53.3**. |

Başlangıçtaki 190 test ve BigInt hatası için eklenen 2 test korundu; önceki rapordaki **192 test adının tamamı** yeni başarılı sonuçlarda da bulundu. Bir mevcut migration test dosyasında güncel şema beklentisi `SCHEMA_VERSION`, desteklenmeyen ileri sürüm de `SCHEMA_VERSION + 1` olarak güncellendi. Test senaryosu kaldırılmadı veya atlanmadı.

Yeni **64 test**: 3 migration, 46 repository ve 15 form/adaptör senaryosu. Bunlar geçici dizinde **gerçek SQLite dosyaları** kullanır; SQL mock'u değildir. Node sürücüsü SQLite **3.50.2** kullanır. Yeni test bağımlılığı kurulmadı. Önceki 3 native API mock testi ve 1 web destek sınırı testi ayrıca korunur. `node:sqlite` deneysel API uyarısı gizlenmedi.

Kapsam: normal/çoklu kayıt, tekrar dokunma ve kalıcı tekrar deneme, SQL hata enjeksiyonuyla rollback, yeniden açılış, negatif/sıfır bütçe, soft iptal ve ikinci iptal koruması, kaybolmuş kayıt/iptal yanıtı, UTC ofsetleri ve yaz/kış saati, başlangıç bakiyesinde çift sayım, v1→v2 veri koruması, taşma/geçersiz girdiler, sona ermiş dönem, metadata yarışları, başlangıç kilidi, parametreli SQL, bozuk aktif/iptal satırları ve makbuz-kayıt tutarsızlığı.

**Native doğrulama:** Metro inspector üzerinden cihazın kendi Hermes'inde mevcut repository, migration ve Expo SQLite API'leri çağrıldı. Kullanıcının `gunluk-butcem.db` dosyası testte açılmadı; üretilen ayrı test dosyasına sentetik v1 bütçe/fatura yazıldı. v2 geçişi, bir kuruşlu tutar ve günlük hedefler, tekrar kayıt/iptal, güvenli tam sayı üst sınırı, negatif bütçe, makbuz yazarken native rollback, dosya kapatıp açma, sona ermiş dönemde iptal ve yeni kayıt yasağı doğrulandı. Test dosyası sonunda kapatılıp temizlendi. Ham [cihaz sonucu](raporlar/harcama-iphone-sqlite.json), [çalıştırılan tanılama ifadesi](tests/expenses/native-probe.js.txt). İfade otomatik `npm test` kapsamına dahil değildir; development inspector içindir, üretim koduna alınmaz. Asenkron tamamlanmış sonuç beklendi; Promise nesnesi başarı sayılmadı.

**Yapılmayanlar:** Formu elle doldurup native düğmelere dokunma/iptal onayını kullanma ile uçtan uca arayüz testi, uygulama sürecini tamamen kapatıp yeniden başlatma, gerçek Android cihaz testi ve APK/IPA derlemesi. Gerçek iPhone testi veritabanı/repository işlemlerini doğrular; bu eksik kontrollerin yerine konmaz. Web'de kalıcı SQLite hâlâ kapalıdır; geçici kurulum ön izlemesi ve paket üretimi çalışır. Native transaction API'sinin web'de aynı olduğu varsayılmadı.

Kanıtlar: [testler](raporlar/harcama-test-sonuclari.txt), [TypeScript](raporlar/harcama-typescript.txt), [ESLint](raporlar/harcama-eslint.txt), [Doctor](raporlar/harcama-expo-doctor.txt), [paketler](raporlar/harcama-paket-uretimi.txt), [kaynak kapsamı](raporlar/harcama-kapsam-dogrulamasi.json). Sessiz TypeScript/ESLint çıktıları boştur; süreçler çıkış 0 ile bitti.

Önceki audit raporları 5 yüksek bulgu gösteriyordu. Bu aşamada bağımlılıklar değişmedi, audit yenilenmedi ve zorlayıcı yükseltme/fix uygulanmadı. Önceki güvenlik raporları tarihli kanıt olarak korunur.

## Kısa öğretici açıklama

- **useState:** `ExpenseScreen` içindeki `draft`, kullanıcının yazdığı tutar/kategori/açıklamadır; SQLite kaydı değildir. `working`, `errors`, `uncertain` ekranın hangi durumda olduğunu belirler. Başarısız yazmada taslak temizlenmez. Aynı anda ikinci işlemi kesmek için state render'ını beklemeyen `useRef` kilidi de kullanılır.
- **async/await:** `await repository.addExpense(...)` commit tamamlanana kadar sonucu bekler. Ana ekrana dönüş bundan sonra yapılır. `catch` hatayı gösterir, `finally` kilidi açar. Yanıt belirsizliğinde yeni kayıt üretmek yerine aynı komut veya doğrulama okuması kullanılır.
- **Repository:** React ekranı `addExpense/cancelExpense/load` çağırır; SQL, atomiklik, revision ve doğrulama ayrı katmanda kalır. Node gerçek SQLite ve cihaz Expo SQLite aynı sözleşmeyi kullandığı için hesaplama/kalıcılık davranışı iki ortamda test edilebilir.
- **TypeScript:** `ExpenseDraft.amount` metindir; `ExpenseData.amountMinor` doğrulanmış tam sayı kuruştur. `ExpenseCategory` altı anahtarla sınırlıdır. `SavedExpense.status` aktif/iptal ayrımını, komutun `expectedRevision` alanı hangi bütçe sürümüyle çalışıldığını belirtir. Tipler geliştirme hatalarını azaltır; SQLite'tan gelen `unknown` alanlar yine çalışma zamanında doğrulanır.

## Değişen ve eklenen dosyalar

Güncellenen kaynak/ayarlar:

- `src/app/_layout.tsx`
- `src/data/budget/contracts.ts`, `errors.ts`, `migrations.ts`, `repository.ts`, `validation.ts`
- `src/features/budget-setup/persistence.ts`, `setup-field.tsx`, `setup-screen.tsx`
- `src/features/saved-budget/home-screen.tsx`, `use-saved-budget.ts`
- `tests/storage/sqlite.integration.test.ts`
- `tsconfig.budget-tests.json`, `README.md`

Yeni kaynaklar:

- `src/app/expense-add.tsx`
- `src/data/budget/expense-repository.ts`, `expense-validation.ts`, `guards.ts`, `records.ts`
- `src/features/expenses/adapter.ts`, `expense-screen.tsx`, `history-row.tsx`
- `src/features/saved-budget/budget-summary.tsx`

Yeni testler/fixture'lar:

- `tests/expenses/fixtures.ts`, `migration.test.ts`, `repository.test.ts`, `adapter.test.ts`
- `tests/expenses/v1-schema.sql`, `native-probe.js.txt`

Yeni belge/kanıtlar:

- `HARCAMA_RAPORU.md`
- `raporlar/harcama-test-sonuclari.txt`, `harcama-typescript.txt`, `harcama-eslint.txt`
- `raporlar/harcama-expo-doctor.txt`, `harcama-paket-uretimi.txt`
- `raporlar/harcama-iphone-sqlite.json`, `harcama-kapsam-dogrulamasi.json`

Görev sırasında `src/components/app-tabs.tsx` içinde **Home → Ana Sayfa** şeklinde eşzamanlı bir dış değişiklik gözlendi. Bu dosya bu özellik kapsamında tarafımdan düzenlenmedi ve değişiklik geri alınmadı; kapsam kanıtında ayrıca işaretlendi.

Domain dosyaları, BigInt biçimlendirme düzeltmesi, paketler ve uygulama yapılandırması korunur. Laravel, üyelik, ödeme, AI servisi, fatura ödeme takibi veya yeni dönem sistemi eklenmedi. 6. aşamanın sonunda çalışma durduruldu.
