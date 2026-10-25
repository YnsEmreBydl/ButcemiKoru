# Günlük Bütçem — 5. aşama: SQLite yerel kayıt

25 Ekim 2026. Node.js 24.4.0, Expo 58.0.19, TypeScript 6.0.3.

iOS ve Android için kalıcı bütçe kurulumu ve düzenleme akışı oluşturuldu. Ana ekran artık yerel kaydı okuyup mevcut motorla hesaplıyor. DEMO ayrı rotada kaldı. Gerçek harcama kaydı, ödeme, banka bağlantısı veya bulut sistemi geliştirilmedi.

## Kurulum ve korunan sözleşme

`npx expo install expo-sqlite` çalıştırıldı; **expo-sqlite 58.0.14** kuruldu. Tek yeni doğrudan bağımlılık budur; `await-lock` geçişli bağımlılığı da npm tarafından eklendi. Expo kurulumu `app.json` içine SQLite eklentisini ekledi. Başka arayüz/test kütüphanesi veya global CLI kurulmadı. Sürüm [resmî Expo 58 belgesiyle](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/) doğrulandı.

Görev başındaki SHA-256 karşılaştırmasında `src/domain/budget/` altındaki 9 dosya ve önceki testlerin 7 kaynak dosyası aynı kaldı. `calculateBudget`, saf form ayrıştırıcıları ve önceki 158 test değiştirilmedi. Önceki rapordaki 158 başarılı testin tamamı son çalıştırmada da bulundu. Kök TypeScript ve ESLint ayarları korundu.

## Şema ve migration

Dosya: `gunluk-butcem.db`, Expo'nun uygulamaya ait varsayılan veritabanı dizini. Şema sürümü: **1**, `PRAGMA user_version` ile tutulur. Kaynak: [migrations.ts](src/data/budget/migrations.ts).

| Tablo | Sütunlar ve amaç |
| --- | --- |
| `budget_periods` | `id`, `revision`, `currency`, `time_zone`, `balance_minor`, `balance_captured_at`, `next_payday`, `savings_minor`. Tek mevcut bütçe kaydı. |
| `budget_payments` | `period_id`, `id`, `name`, `amount_minor`, `due_on`. Bekleyen faturalar. |
| `budget_save_operations` | `operation_id`, `period_id`, `payload`, `resulting_revision`. Tekrarlanan kaydetme isteğini tanıma; harcama hareketi değildir. |

Üç tablo da `STRICT` tanımlıdır. Finansal sütunlar `INTEGER`; değerler JavaScript güvenli tam sayı sınırlarıyla kısıtlıdır. Başlangıç bakiyesi negatif olabilir, birikim negatif olamaz, fatura tutarı pozitif olmalıdır. Para birimi yalnızca TRY'dir. Takvim tarihleri `YYYY-MM-DD`, bakiye anı açık ofsetli ISO zamanıdır; IANA saat dilimi ayrıca saklanır.

`budget_periods.id = 1` ikinci başlangıç kaydını engeller. Faturalarda `(period_id, id)` bileşik anahtarı, işlemlerde `operation_id` birincil anahtarı tektir. Foreign key ve silme zinciri tanımlıdır. Native exclusive API yeni bağlantı açtığı ve foreign key ayarı bağlantıya özel olduğu için ek SQL trigger'ları üst kayıt ilişkisini ve çocukların silinmesini ayrıca uygular. Bu davranış foreign key kapalı gerçek SQLite bağlantısıyla test edildi.

Migration ve sürüm artırma aynı transaction içindedir; hata durumunda DDL dahil geri alınır. Tekrar açılışta v1 yeniden oluşturulmaz. Gelecekte ardışık `{ version: 2, sql: ... }` eklenebilir. Bilinmeyen ileri sürüm reddedilir; dosya sıfırlanmaz veya eski sürüme indirilmez. Gerekli sütunlar, `quick_check` ve `foreign_key_check` kontrol edilir. Bunlara ek olarak her okumada alanlar ve domain sözleşmesi doğrulanır.

## Veri akışı ve finansal davranış

```text
Form state'i → prepareBudgetSave → mevcut giriş adaptörleri ve calculateBudget
  → repository.save → native exclusive transaction → SQL → COMMIT
  → ancak bundan sonra ana ekrana yönlendirme

Açılış / ana ekrana dönüş / uygulamanın öne gelmesi / yeniden hesapla
  → repository.load(güncel ISO anı) → DB alanlarının doğrulanması
  → değişmeyen calculateBudget → gerçek bütçe ana ekranı
```

Başarılı okuma `null` döndürürse kurulum açılır. Okuma hatası boş kurulum sayılmaz; hata ve tekrar deneme gösterilir. Bozuk kayıt otomatik silinmez veya DEMO ile değiştirilmez.

Bakiye gelecekteki maaş değildir; gelir ekleyen sorgu/hareket yoktur. Bu aşamada motor girdisi `transactions: []` taşır; repository hareket içeren kaydetme isteklerini reddeder. Önceki harcamalar yeniden düşülmez. Bakiye değişmeden fatura/birikim/tarih düzenlenirse özgün bakiye anı korunur; bakiye değiştirilirse yeni başlangıç anı alınır. Kayıtlı saat dilimi düzenlemede korunur.

Fatura kaldırmak ödeme hareketi üretmez. Gerçekten ödeme yapıldıysa kullanıcı bekleyen faturayı ve kullanılabilir bakiyeyi birlikte güncellemelidir; formda açıklanır. Bu sürüm gerçek banka bakiyesini veya harcamaları otomatik takip etmez.

Negatif harcanabilir tutar ve bütçe açığı görünür. Maaş tarihi bugün/geçmişse günlük öneri verilmez, yeni dönem uyarısı çıkar; gelir eklenmez. Yeni kayıt/güncelleme için sonraki maaş tarihi düzeltilmelidir. Önceden tamamlanmış aynı işlemin tekrar denemesi ise yeni yazma yapmadan mevcut kaydı döndürebilir.

## Atomiklik ve mükerrer işlem

[platform.native.ts](src/data/budget/platform.native.ts) WAL ayarını yapar, migration'ı çalıştırır ve tek repository açılışını paylaşır. SQL, React bileşenlerinde bulunmaz. [exclusive-adapter.ts](src/data/budget/exclusive-adapter.ts), sorguları `withExclusiveTransactionAsync` callback'inin kendi bağlantısında yürütür. Sonuç callback bitince değil native transaction tamamlanınca döner.

Dönem, bütün faturalar ve işlem kimliği birlikte yazılır. İkinci fatura yazılırken hata verilen testte ilk fatura ve dönem dahil tümü geri alındı. Başarısız güncellemede eski dönem, sürüm ve faturalar korundu.

- Ekrandaki `savingRef` kilidi aynı anda iki dokunmayı React render'ını beklemeden engeller; kaydetme sırasında düğmeler kapanır.
- Repository istekleri sıraya alır ve beklemeden özel kopyasını oluşturur. Aynı `operationId` ve içerik ikinci yazma yapmaz. Kaybolmuş başarı yanıtı sonrası tekrar aynı kimliği kullanır; form değişirse yeni işlem hazırlanır.
- SQL benzersizlik kısıtlarına ek `expectedRevision`, eski formun yeni kaydı ezmesini önler. Aynı işlem kimliğinin farklı içerikle kullanılması hata verir.

Başarı bildirimi ve yönlendirme yalnızca `await repository.save(...)` tamamlanınca gerçekleşir. Hata formu temizlemez. Normal görünümden çıkış kayıtları silmez; uygulama kaldırma/verilerini temizleme için kalıcılık garantisi verilmez.

## Web ve gizlilik

**Uygulamanın bu web sürümünde kalıcı kayıt desteklenmiyor.** [platform.ts](src/data/budget/platform.ts) açık `UNSUPPORTED` hatası döndürür; ana ekran bunu açıklar, kurulum geçici ön izlemeyi sunar ve kaydetmeyi kapatır. Bellek adaptörü kalıcı kayıt gibi sunulmaz.

Expo SQLite'ın web desteği vardır; WASM ve `SharedArrayBuffer` için Metro/HTTP başlık ayarları gerektirir. Ancak kullandığımız `withExclusiveTransactionAsync` web'de desteklenmez. Fark [SDK 58 belgesi](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/) ve kurulu `SQLiteDatabase.ts` içindeki web hata dalıyla doğrulandı. Native transaction davranışı web'e genellenmedi. Web paket üretimi ve destek dışı adaptör kontrol edildi; tarayıcı içinde SQLite dosyası oluşturma testi yapılmadı.

SQLCipher etkinleştirilmedi; **veritabanı uygulama düzeyinde şifreli değildir**. Uygulama otomatik bulut yedeği/cihazlar arası senkronizasyon sağlamaz. İşletim sisteminin kendi yedekleme ayarları ayrıca geçerlidir. Arayüzde kayıt öncesinde de açıklama gösterilir.

## Testler ve kanıtlar

| Kontrol | Sonuç |
| --- | --- |
| `npm test` | **190/190 geçti**, 0 hata, 0 atlanan/iptal edilen test; çıkış 0. |
| `npx tsc --noEmit` | Hatasız, çıkış 0. |
| `npx expo lint` | 0 hata, 0 uyarı; çıkış 0. |
| `npx expo-doctor` | **20/20 geçti**, çıkış 0. |
| `npx expo export --platform all --output-dir /private/tmp/gunluk-butcem-sqlite-final` | iOS/Android Hermes ve web istemci/sunucu paketleri üretildi; çıkış 0. |
| `npm audit --json` | 5 yüksek bulgu, çıkış 1. |
| `npm audit --omit=dev --json` | Aynı 5 yüksek bulgu, çıkış 1. |

| Test grubu | Sayı | Gerçekte çalıştırılan |
| --- | --- | --- |
| Önceki motor testleri | 82 | Değişmeyen domain. |
| Önceki giriş/form testleri | 76 | Değişmeyen giriş/doğrulama/biçim adaptörleri. |
| Yeni SQLite entegrasyon testleri | 26 | Node `node:sqlite`, SQLite **3.50.2**, geçici dizinde gerçek `.db` dosyası, SQL, kısıtlar, commit/rollback ve yeniden açılış. |
| Yeni düzenleme eşleme testleri | 2 | Gerçek SQLite kaydıyla form/snapshot/saat dilimi eşlemesi. |
| Native API mock testleri | 3 | Transaction bağlantısı, commit bekleme ve commit hatası; native sürücüyü çalıştırmaz. |
| Web destek sınırı testi | 1 | Gerçek fallback'in `UNSUPPORTED` döndürmesi; tarayıcı SQLite entegrasyonu değildir. |

Yeni SQLite testleri migration tekrarı/hatası, ileri sürüm, kesin kuruş, kayıt/yeniden açılış, güncel günle hesaplama, düzenleme, işlem kimliği üretimi, paralel dokunma, kalıcı mükerrer istek koruması, eski sürüm/çakışan içerik, kaybolmuş başarı yanıtı, SQL injection metni, finansal kısıtlar, ilişkiler, bozuk takvim/para birimi, SQLite olmayan dosya, ilişkisiz kayıt, eksik şema ve negatif bütçeyi kapsar. Hata enjeksiyonu gerçek SQL üzerinde çalışır; native mock testlerinden ayrı değerlendirilir.

**Yapılmayanlar:** Gerçek cihazda kayıt ve uygulama kapatıp açma, simülatör/emülatör arayüz testi, APK/IPA native ikili derlemesi, tarayıcıda WASM SQLite ve uçtan uca düğme testi. `xcrun simctl` bulunamadı, Android `adb` aracı yok. Paket üretimi bunların yerine konmadı. Dosya kapatıp açma testi masaüstündeki gerçek SQLite sürücüsüne aittir; Expo native sürücüsü ayrıca cihazda doğrulanmalıdır.

Node 24.4.0, `node:sqlite` için `ExperimentalWarning` verdi; uyarı gizlenmedi. Paket üretiminde ortamın `NO_COLOR`/`FORCE_COLOR` çakışması uyarıları görüldü; işlem başarıyla bitti.

Ham çıktılar: [test](raporlar/sqlite-test-sonuclari.txt), [TypeScript](raporlar/sqlite-typescript.txt), [ESLint](raporlar/sqlite-eslint.txt), [Doctor](raporlar/sqlite-expo-doctor.txt), [paket üretimi](raporlar/sqlite-paket-uretimi.txt). TypeScript/ESLint dosyaları sessiz ve çıkış 0 ile tamamlandıkları için boştur.

## Devam eden güvenlik bulguları

Yeni [tam audit](raporlar/sqlite-guvenlik-denetimi.json) ve [üretim audit](raporlar/sqlite-guvenlik-uretim.json) aynı **5 yüksek** etkilenen paketi bildiriyor. Beş bağımsız kök açık değil, iki bildirimin üst paketlere yansımasıdır. Bu taramada `expo-sqlite` için ek bulgu bildirilmedi.

| Paket / sürüm | Zincir ve risk | Önerilen çözüm yaklaşımı |
| --- | --- | --- |
| `node-forge 1.4.0` | `expo → @expo/cli → node-forge`; ayrıca CLI → sertifika paketi → aynı paket. RSA imza doğrulamasında bütünlük riski: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). | Resmî düzeltmeyi içeren Expo 58 uyumlu hedefli güncellemeyi doğrulamak. |
| `zod 3.25.76` | `expo → @expo/cli → zod`. Büyük koleksiyon doğrulamasında bellek tükenmesi: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). | Audit `<4.6.6` bildiriyor; CLI'nin Zod 3 sözleşmesini koruyan destekli CLI/geri taşıma çözümünü değerlendirmek. |
| `@expo/code-signing-certificates 0.0.7` | `expo → @expo/cli → sertifika paketi → node-forge`; alttaki imza doğrulama riski. | Düzeltilmiş forge'u destekleyen resmî sertifika/CLI güncellemesi. |
| `@expo/cli 58.1.15` | `expo → @expo/cli`; forge ve zod etkisi. | İki alt bağımlılığı düzelten SDK 58 uyumlu CLI sürümü. |
| `expo 58.0.19` | Doğrudan bağımlılık → CLI → yukarıdaki paketler. | Uyumlu bakım güncellemesi; SDK 58'i bozan audit önerisini uygulamamak. |

Üretim taramasında görünmeleri npm üretim bağımlılık ağacında bulunmalarındandır; native uygulamada istismarı kanıtlamaz. Önceki ayrıntılı kullanım yolu incelemesi [güvenlik raporunda](GUVENLIK_RAPORU.md). Mevcut audit'in `expo 44.0.6` ana sürüm değişikliği önerisi uygulanmadı. `npm audit fix`, `--force`, toplu yükseltme veya zorlayıcı override kullanılmadı.

## Kendi kodumuzla kavramlar

**SQLite nedir?** Tabloları cihazdaki dosyada tutan veritabanı motorudur; ayrıca Laravel/veritabanı sunucusu gerektirmez. Bizde `openDatabaseAsync('gunluk-butcem.db')` dosyayı açar. `budget_periods` dönemi, `budget_payments` faturaları tutar. Görünüm kapansa da dosya durur.

**React state ve veritabanı farkı:** `setup-screen.tsx` içindeki `useState<SetupDraft>(emptySetupDraft)`, henüz onaylanmamış metinleri tutar. Böylece `1.234,` gibi tamamlanmamış girişler de formda kalabilir. State değişikliği SQLite'ı değiştirmez. `prepareBudgetSave` tamamlanmış girdiyi doğrular; yalnızca kaydetme kalıcı veriyi değiştirir. Form tekrar açıldığında veritabanındaki son başarılı kayıt yüklenir.

**async/await neden gerekiyor?** Dosya açma, migration, SQL ve commit hemen bitmez; native API `Promise` döndürür. Ekrandaki sıra şöyledir:

```ts
await repository.save({ ...command, input: { ...command.input, asOf } });
// Başarı bildirimi ve router.replace('/') bundan sonra çalışır.
```

`await` kaldırılırsa yazma tamamlanmadan başarı gösterilebilir. Depolama hatası sonradan gelebilir. `catch` hatayı gösterir ve girdileri korur; `finally` kilidi kaldırır. `await`, tüm ekranı senkron olarak kilitlemek anlamına gelmez.

**Repository ne işe yarıyor?** Ekran yalnızca `load`, `save`, `newOperationId` sözleşmesini bilir. [repository.ts](src/data/budget/repository.ts) okuma/yazma, doğrulama, mükerrer istek ve sürüm çakışmalarını yönetir. SQL ekranlara yayılmaz. Aynı repository testte Node, uygulamada Expo SQLite adaptörüyle çalışabilir.

**Transaction neden önemli?** Bütçe; bakiye, faturalar ve işlem kimliğiyle bir bütündür. İkinci fatura başarısızken dönemin tek başına kaydedilmesi yanlış günlük öneri üretebilir. Hepsi tamamlanınca commit, biri başarısızsa rollback yapılır. Native adaptör sonucu commit sonrasında verir. İkinci fatura SQL hatası testi tüm başlangıç kaydının geri alındığını doğrular.

## Değişen ve eklenen bütün dosyalar

Güncellenen mevcut dosyalar:

- `package.json`, `package-lock.json`: SQLite bağımlılığı ve kilit dosyası.
- `app.json`: SQLite config plugin.
- `tsconfig.budget-tests.json`: storage/persistence test derlemesi; native dosyayı Node test kümesinden ayırma. Kök TypeScript kontrolü native dosyayı da kontrol eder.
- `src/app/index.tsx`: gerçek ana ekran.
- `src/app/_layout.tsx`: DEMO rotası ve başlıklar.
- `src/features/budget-setup/setup-screen.tsx`: yükleme, düzenleme, kayıt, kilit/hata/destek durumu.
- `src/features/budget-setup/preview-result.tsx`: kayıt açıklaması ve düzenleme kilidi.
- `README.md`: güncel akış ve sınırlar.

Yeni kaynaklar:

- `src/data/budget/contracts.ts`: repository/SQL tipleri.
- `src/data/budget/errors.ts`: depolama hataları.
- `src/data/budget/migrations.ts`: şema v1 ve migration.
- `src/data/budget/validation.ts`: DB/domain doğrulaması ve istek içeriği.
- `src/data/budget/repository.ts`: atomik kayıt/okuma ve mükerrer istek yönetimi.
- `src/data/budget/exclusive-adapter.ts`: native transaction adaptörü.
- `src/data/budget/platform.native.ts`: Expo SQLite açılışı.
- `src/data/budget/platform.ts`: web/SSR destek dışı durumu.
- `src/features/budget-setup/persistence.ts`: kayıt/form, bakiye anı ve düzenleme eşlemesi.
- `src/features/saved-budget/use-saved-budget.ts`: odak/öne gelişte yükleme.
- `src/features/saved-budget/home-screen.tsx`: gerçek bütçe ana ekranı.
- `src/features/demo/demo-screen.tsx`: önceki DEMO'nun ayrı konumu, gerçek kurulum bağlantısı.
- `src/app/demo.tsx`: DEMO rotası.

Yeni testler:

- `tests/storage/sqlite-helper.ts`
- `tests/storage/sqlite.integration.test.ts`
- `tests/storage/editing.test.ts`
- `tests/storage/exclusive.mock.test.ts`

Yeni belge ve kanıt dosyaları:

- `SQLITE_RAPORU.md`
- `raporlar/sqlite-test-sonuclari.txt`
- `raporlar/sqlite-typescript.txt`
- `raporlar/sqlite-eslint.txt`
- `raporlar/sqlite-expo-doctor.txt`
- `raporlar/sqlite-paket-uretimi.txt`
- `raporlar/sqlite-guvenlik-denetimi.json`
- `raporlar/sqlite-guvenlik-uretim.json`

Paket çıktıları kaynak ağacına eklenmedi; geçici dizindedir. Kalan doğrulama ihtiyacı Expo native sürücüsüyle gerçek cihazda uçtan uca kayıt, kapatıp açma ve hata akışlarıdır. Bu aşamadan sonra gerçek harcama/ödeme geliştirmesine geçilmedi.
