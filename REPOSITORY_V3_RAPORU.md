# Günlük Bütçem — 7B çok dönemli repository teslimatı

26 Ekim 2026. Çok dönemli repository, ayrı `startPeriod` komutu, dönem kapsamlı kayıt işlemleri ve otomatik testler tamamlandı. **Çalışan uygulama hâlâ v2 kullanıyor.** Gerçek iPhone'a veya kullanıcı veritabanına erişilmedi. Bütün yeni repository işlemleri bağımsız geçici test dosyalarında çalıştırıldı.

7A'nın şema ve migration dosyaları değiştirilmedi. İncelenen akışı engelleyen bir şema sorunu bulunmadı. `platform.native.ts`, eski repository, domain motoru, mevcut testler ve paket/yapılandırma dosyaları dahil görev başındaki 99 dosyanın SHA-256 değeri aynıdır. Gereksiz bağımlılık, ekran, banka/maaş bağlantısı, Firebase veya Laravel eklenmedi. 7C başlatılmadı.

## 1. Dosyalar ve v2/v3 ayrımı

| Eklenen dosya | Sorumluluk |
| --- | --- |
| `src/data/budget/repository-v3.ts` | `createBudgetRepositoryV3(database)` fabrikası; açılış veya migration yapmaz. |
| `src/data/budget/v3-contracts.ts` | Defter/dönem/harcama/fatura tipleri, açık komut sözleşmeleri, aktif/kapalı dönem ayrımı. |
| `src/data/budget/v3-records.ts` | Defter, aktif dönem ve arşiv okumaları; yalnız istenen dönemin faturaları/harcamaları; kayıt doğrulama. |
| `src/data/budget/v3-validation.ts` | Kimlik/sayı/tarih doğrulaması, canonical işlem içeriği ve sürümlü kapanış sonucu doğrulaması. |
| `src/data/budget/v3-operations.ts` | Bağlantı kuyruğu, işlem makbuzları, revision CAS ve SQLite meşgul hatalarının `CONFLICT` karşılığı. |
| `src/data/budget/v3-start-period.ts` | Atomik dönem geçişi ve eski komut tekrarında kayıtlı hedefi okuma. |
| `src/data/budget/v3-save.ts` | İlk dönem kurulumu ve mevcut açık dönemi düzenleme. Dönem geçişi yapmaz. |
| `src/data/budget/v3-expenses.ts` | Gerçek dönem kimliğiyle harcama/iptal, revision kontrolü ve idempotency. |
| `tests/periods-v3/fixtures.ts` | Sentetik komutlar ve gerçek SQLite hata enjeksiyonu yardımcıları. |
| `tests/periods-v3/start-period.test.ts` | Geçiş, tekrar, arşiv, bakiye/fatura rezervi, girdi ve taşma testleri. |
| `tests/periods-v3/mutations.test.ts` | İlk kayıt/düzenleme, harcama/iptal, dönem izolasyonu, bozuk kayıt ve saat dilimi testleri. |
| `tests/periods-v3/atomic.test.ts` | Yazma hataları, rollback, commit sınırı, kayıp yanıt ve çakışmalar. |
| `tests/periods-v3/race.test.ts` | Ayrı worker thread ve bağlantılarda gerçek IMMEDIATE/DEFERRED SQLite yarışları. |
| `REPOSITORY_V3_RAPORU.md` | Bu rapor. |
| `raporlar/v3-repository-test-sonuclari.txt` | Son tam test çıktısı. |
| `raporlar/v3-repository-dogrulama.json` | Komut sonuçları, paket kanıtları ve eski/yeni dosya SHA-256 değerleri. |
| `raporlar/v3-repository-export.txt` | iOS/Android/web export çıktısı. |
| `raporlar/v3-repository-audit-tam.json` | Güncel tam güvenlik taraması. |
| `raporlar/v3-repository-audit-uretim.json` | Güncel `--omit=dev` güvenlik taraması. |

Eski `createBudgetRepository` ve `migrateDatabase` olduğu gibi kaldı. Yeni fabrika yalnız dışarıdan verilen `AtomicDatabase` arayüzünü kullanır; dosya adı, Expo import'u veya otomatik migration içermez. Her transaction başlangıcında şema sürümünün tam 3 olduğunu doğrular. v2 dosya verilirse `MIGRATION` hatası döner; dosya yükseltilmez/sıfırlanmaz. Uygulamadaki import zincirine yeni v3 kodu eklenmedi.

Yeni API: `loadBook`, `loadActivePeriod`, `loadClosedPeriod`, `newPublicId`, `saveBudget`, `startPeriod`, `addExpense`, `cancelExpense`. Yerel `id` ile kalıcı `publicId` ayrı alanlardır. Yazma komutları defter/dönem kapsamını açıkça taşır; dönem yerel ID'si ve public ID'si birlikte doğrulanır. Repository'de sabit `period_id=1` yoktur. SQL'deki sabit `revision=1`, yalnız yeni kaydın ilk revision değeridir.

`saveBudget` hedefi bir union tiptir: `initial` yalnız geçmişi olmayan defterde ilk kök dönemi kurar; `existing` mevcut açık dönemi düzenler. Sona ermiş dönemin maaş tarihini değiştirerek uzatılması reddedilir. Yeni dönem yalnız `startPeriod` ile açılır. Mevcut faturanın adı/tutarı/vadesi düzenlenirken public ID ve taşıma kaynağı korunur; kalan faturalar silinip yeniden üretilmez.

## 2. startPeriod sözleşmesi ve kuralları

`StartPeriodCommandV3` şu alanları içerir:

- `operationId`, `bookId`, `sourcePeriodId`, `sourcePeriodPublicId`.
- `expectedSourceRevision`, `expectedActivationRevision`, önceden belirlenmiş `newPeriodPublicId`.
- `availableBalanceConfirmed: true`, `availableBalanceMinor`, `balanceCapturedAt`.
- `nextPayday`, `savingsTargetMinor`, `carryPayments`, açık doğrulama saati `asOf`.

`availableBalanceMinor`, kullanıcının gerçekten kullanılabilir olduğunu açıkça onayladığı INTEGER kuruş bakiyesidir. Negatif veya sıfır olabilir; eksik, NaN, sonsuz, kesirli kuruş ve güvenli tam sayı aralığı dışındaki değerler reddedilir. Eski bakiye, eski kalan bütçe veya maaş geliri otomatik eklenmez. Para birimi/saat dilimi kaynak dönemden alınır; şimdilik TRY kullanılır.

Bu aşamadaki iş kuralı: kaynak dönemin maaş günü, **yeni bakiye başlangıç anının kaynak saat dilimindeki takvim gününde** gelmiş veya geçmiş olmalıdır. Erken geçiş `CONFLICT` verir. Yeni maaş tarihi `asOf` gününden ileride olmalıdır. Bakiye anı gelecekte olamaz. Kaynakta yeni bakiye anından sonra oluşturulmuş/iptal edilmiş bir harcama varsa eski bakiye anıyla kapanış yapılmaz; kullanıcı güncel an/bakiyeyle tekrar başlamalıdır. Tarih farkı 24 saatlik milisaniye bölmesiyle hesaplanmaz.

Her fatura seçimi `sourcePaymentId`, `sourcePaymentPublicId`, `newId`, `newPublicId`, `dueOn` taşır. İsim ve tutar doğrulanmış kaynak faturadan alınır. Kaynak fatura yerinde kalır; yeni dönemde yeni kimliklerle ve kaynak bağlantısıyla kopyalanır. Tarih açıkça belirtilir; aylık tekrarlama tahmini yapılmaz. Ödenmemiş eski vade bilinçli biçimde seçilebilir; vade yeni maaş tarihinden önce olmalıdır. Aynı kaynak iki kez seçilemez.

Komut ve içindeki diziler kuyruğa girmeden önce kopyalanır. Canonical makbuz içeriğinde bakiye, bakiye anı, revision beklentileri, kaynak/hedef kimlikleri ve sıralanmış fatura seçimleri bulunur. Eşdeğer saat farkı gösterimleri normalize edilir. `asOf`, ekonomik komut içeriği değildir; daha sonraki bir okuma saatiyle aynı işlem yeniden sorulabilir. Bakiye anı ise içeriktedir, değişirse aynı işlem kabul edilmez.

## 3. Atomik veri akışı

`v3-start-period.ts` içindeki akış tek `AtomicDatabase.transaction` kapsamındadır:

1. Komut alanları doğrulanır, canonical içerik oluşturulur ve önce `operationId` makbuzu aranır.
2. Aynı tür/sürüm/kapsam ve aynı içerikte makbuz varsa onun **kayıtlı hedef dönemi** okunur. Güncel aktif döneme yazılmaz. Farklı içerik veya legacy makbuz çakışması `CONFLICT` olur.
3. Defter activation revision'ı, kaynak yerel/public kimlikleri, aktiflik ve kaynak revision'ı doğrulanır.
4. Yeni bütçe girdileri ve seçilen faturalar doğrulanır. Yeni dönem domain girdisinin `transactions` listesi boştur.
5. Kaynak dönem mevcut `calculateBudget` ile `balanceCapturedAt` anında hesaplanır. Bu, kapanış hesabının sabit `asOf` anıdır.
6. Sonuç `closing_result_json`, `calculation_version='budget-engine-v1'` ve `closed_at=balanceCapturedAt` olarak saklanır; kaynak revision bir artırılıp dönem kapatılır. Finansal kaynak girdileri değiştirilmez.
7. Önceden belirlenen public ID ile yeni dönem eklenir; yerel INTEGER ID SQLite'tan okunur. `opened_at` yeni bakiye anı, `created_at` ilk komutun `asOf` anıdır.
8. Seçilen faturalar yeni yerel/public kimlikler ve kaynak ilişkileriyle eklenir. Harcamalar kopyalanmaz.
9. Defter activation revision'ı koşullu UPDATE ile artırılır ve sürümlü işlem makbuzu hedef dönem ID'siyle yazılır.
10. 7A bütünlük kontrolleri ve yeni hedef/kapanmış kaynak domain doğrulamaları tamamlanır. Sonuç ancak dış transaction COMMIT'i tamamlandığında döner.

İşlem ortasında kaynak kapalı, hedef yarım kalmış bir durum dışarıya kesinleşmez. Yazma/bütünlük/commit öncesi hata bütün değişiklikleri geri alır. COMMIT başarılı olup yanıt kaybolursa ilk çağrı hata verir; aynı komut tekrarlandığında kalıcı makbuz bulunur ve ikinci dönem oluşturulmaz. Bilinmeyen hata başarıya çevrilmez.

`StartPeriodResultV3`, `source`, `target`, `replayed` ve geçiş sırasında oluşan `transitionActivationRevision` döndürür. Daha sonra B düzenlenmiş veya kapanmış olabilir: eski A → B tekrarı B'nin kayıtlı güncel durumunu döndürür; B'nin ilk oluşturulduğu andaki response kopyası tutulmuyor. `transitionActivationRevision`, defterin bugünkü revision'ı gibi sunulmaz. Defterin güncel revision'ı `loadBook` ile ayrı okunur.

## 4. Arşiv ve SQL korumaları

`loadActivePeriod(bookId, asOf)` veritabanındaki `status='active'` satırını seçip verilen saatle hesaplar. `loadClosedPeriod(scope)` saat istemez; kapanıştaki `closed_at` anını ve kayıtlı sonucu kullanır. Arşiv verileri, aynı hesaplama sürümündeki domain çıktısıyla **bütün alanları bakımından** karşılaştırılır. JSON, kontrolsüz şekilde `BudgetResult` tipine dönüştürülmez. Eksik/ek/değişmiş alanlar reddedilir; bilinmeyen hesaplama sürümü `UNSUPPORTED` verir. Gelecekte motor sürümü değişirse eski sürümün okuyucusu korunmalı veya ayrıca uyumlu bir doğrulayıcı sağlanmalıdır. Arşiv bugünün saatiyle yeniden yazılmaz.

7A'dan gelen SQL korumaları değiştirilmeden kullanılır:

- Defter başına en fazla bir aktif dönem ve bir kök dönem; kaynak başına en fazla bir doğrudan devam dönemi.
- Aynı defterde kapalı öncül ve eşleşen kapanış/açılış anı; yerel/public kimliklerin değişmezliği.
- Dönem/fatura/harcama/makbuz yabancı anahtarları ve FK denetimi kapalı bağlantılar için ek ilişki tetikleyicileri.
- Kapalı dönemde UPDATE/DELETE, yeni finansal satır ekleme veya harcama iptalini reddeden tetikleyiciler.
- Makbuzları değiştirilemez tutma; `INSERT OR REPLACE` ile kimlik/aktiflik/kopya kaynağı üzerinden geçmişi silmeyi önleme.
- INTEGER kuruş, güvenli sayı sınırları, pozitif harcama/fatura, geçerli iptal durumu ve bir kez iptal kısıtları.
- İptal edilmiş kayıt dahil harcama geçmişi bulunan dönemde başlangıç bakiyesi/anı, saat dilimi, para birimi ve maaş tarihini kilitleme.

SQL finansal formülleri veya IANA takvimini yeniden uygulamaz. Repository, hem aktif hem iptal edilmiş kayıtları doğrular; hesaplama için yalnız aktif harcamaları **kendi dönemi kapsamında** domaine verir. Yeni kaydedilen harcama hem dönem açılışından hem bakiye anından sonra olmalıdır. Yeni yazma sona ermiş veya kapalı döneme otomatik yönlendirilmez. Henüz kapatılmamış ama takvimde sona ermiş aktif dönemin yanlış harcaması iptal edilebilir; kapandıktan sonra iptal de reddedilir.

## 5. CONFLICT ne zaman oluşur?

| Durum | Sonuç |
| --- | --- |
| Beklenen kaynak/dönem revision'ı veya defter activation revision'ı eski | `CONFLICT`; hiçbir değişiklik kesinleşmez. |
| Yerel dönem/harcama ID'sinin public ID'si uyuşmuyor | `CONFLICT`; başka kayda yönlendirme yok. |
| Aynı makbuz kimliği farklı komut içeriği, türü, sürümü, defteri veya legacy kaydıyla çakışıyor | `CONFLICT`; makbuz yeniden yazılmaz. |
| Eski form kapalı döneme yeni harcama, iptal veya düzenleme yolluyor | `CONFLICT`; yeni aktif döneme aktarılmaz. |
| Kaynak maaş günü gelmeden geçiş veya yeni döneme geçersiz/geçmiş maaş tarihi | `CONFLICT`. |
| Yeni dönem/fatura kopyası public ID'si başka satırda kullanılmış | `CONFLICT`. |
| İki bağlantı arasında `SQLITE_BUSY`, `SQLITE_BUSY_SNAPSHOT` veya `SQLITE_LOCKED` | `CONFLICT`; aynı işlem kimliğiyle daha sonra yeniden kontrol edilebilir. Otomatik sınırsız tekrar yok. |
| Revision güvenli tam sayı sınırına ulaşmış | `CONFLICT`; taşmış revision yazılmaz. |

Diğer hatalar ayrıdır: olmayan dönem/defter `NOT_FOUND`, geçersiz alanlar `INVALID_DATA`, toplam para taşması `AMOUNT_OVERFLOW`, harcamalı dönemin başlangıcını düzenleme `BALANCE_LOCKED`, mükerrer yeni harcama `ALREADY_EXISTS`, yeniden iptal `ALREADY_CANCELLED`, aktif ama takvimde bitmiş döneme harcama `NEW_PERIOD_REQUIRED`. Bozuk veri silinmez, yeni kurulum gibi gösterilmez.

## 6. Çalıştırılan testler ve kanıtlar

| Kontrol | Sonuç |
| --- | --- |
| `npm test` | **376/376 geçti:** mevcut 310 + yeni 66; 0 hata, 0 atlanan. |
| Yeni 66 test | Hepsi bağımsız gerçek SQLite dosyası kullanır. SQL mock'u eklenmedi. |
| Önceki native API mock testleri | Mevcut 3 bağlantı/commit mock testi korundu ve geçti; native cihaz kanıtı sayılmaz. |
| `npx tsc --noEmit` | Geçti. Testler ayrıca mevcut test TypeScript yapılandırmasıyla derlendi. |
| `npx expo lint` | Son çalışmada 0 hata/uyarı. İlk çalışmadaki yeni bir kullanılmayan import uyarısı kaldırıldı; kural kapatılmadı. |
| `npx expo-doctor` | 20/20 geçti. |
| `npx expo export --platform all --max-workers 2 --output-dir /private/tmp/gunluk-butcem-7b-export` | iOS/Android Hermes `.hbc` paketleri, web istemci ve sunucu dosyaları üretildi. |
| `npm audit --json` | Çıkış 1; 5 yüksek, 0 kritik/orta/düşük. |
| `npm audit --omit=dev --json` | Çıkış 1; aynı 5 yüksek bulgu. |

Node.js 24.4.0'ın yerleşik SQLite 3.50.2 sürücüsü kullanıldı. Gerçek dosyalarda iki/üç ardışık dönem, seçilen fatura kopyaları, negatif/MAX_SAFE_INTEGER tutarlar, taşma, eski makbuzların korunması, yeniden açılış, bozuk kayıt/snapshot, yerel maaş günü ve DST kontrol edildi.

Kaynak kapatma, yeni dönem ekleme, fatura ekleme, defter revision artırma ve makbuz yazma sonrasında hata enjekte edildi; şema/finansal satırlar/revision/makbuzlar birebir geri geldi ve bağlantı yeniden açıldıktan sonra da doğrulandı. Son bütünlük kontrolünün ve commit öncesinin hatası da kapsandı. Bunlar gerçek SQL/rollback testleridir; hata enjeksiyonu fiziksel disk dolması, güç kaybı veya gerçek native COMMIT arızası üretmez.

Ayrı Node worker thread'leri aynı WAL dosyasını farklı bağlantılarla açar. IMMEDIATE yarışında farklı komutlardan yalnız biri kazanır; aynı komutlar aynı makbuzdan döner. DEFERRED yarışında iki bağlantı A'yı okuduktan sonra birinci geçişi commit eder; ikinci eski snapshot'tan yazarken `CONFLICT` alır. Bu, yalnız JavaScript kuyruğuna güvenilmediğini doğrular. SQLite'ın [eşzamanlı tek yazıcı ve eski okuma snapshot'ı davranışı](https://www.sqlite.org/lang_transaction.html#read_transactions_versus_write_transactions) dikkate alınmıştır.

Sayısal örnek: A'da 1.000.000 kuruş başlangıçtan 101 kuruş gerçek harcama düşülüp 999.899 kuruş kalır. Kullanıcı B için **300.000 kuruş** girerse B tam bu bakiye ile başlar. Seçilen 200.000 kuruş fatura ve 50.000 kuruş birikim ayrıldığında 50.000 kuruş harcanabilir tutar, 30 takvim gününe 1.666 kuruş günlük öneri çıkar. Eski A harcamaları B'ye düşülmez; otomatik maaş geliri eklenmez. B'de 10.000 kuruş harcama sonrası bakiye 290.000 kuruş olur; iptal edilirse 300.000'e döner. C açıldıktan sonraki eski A → B tekrarında C'nin tek bir satırı bile değişmez.

Export işlemi yeni v3 modülleri henüz uygulamanın import zincirine bağlı olmadığı için mevcut v2 uygulamanın paketlenebilirliğini doğrular. Yeni repository'nin doğrulaması TypeScript ve gerçek SQLite testleridir. `.hbc` üretimi gerçek iOS/Hermes veya native SQLite çalıştırması değildir. İmzalı IPA/APK üretilmedi; gerçek iPhone/Android sürücüsü, ekran ve native uçtan uca test yapılmadı. Web'de mevcut `UNSUPPORTED` depolama davranışı değiştirilmedi.

## 7. Güvenlik bulguları

Güncel tam ve üretim taramalarında önceki aynı 5 yüksek paket bulgusu kaldı: `node-forge@1.4.0`, `zod@3.25.76`, `@expo/code-signing-certificates@0.0.7`, `@expo/cli@58.1.15`, `expo@58.0.19`. İki kök bildirim ve bunların bağımlılık zincirine etkileri vardır: node-forge imza doğrulama riski ve Zod büyük koleksiyon doğrulamasında bellek tüketimi. Detaylar `GUVENLIK_RAPORU.md` ve yeni ham audit dosyalarındadır.

Audit'in Expo 44'e ana sürüm değişikliği önerisi uygulanmadı. `npm audit fix`, `--force`, toplu yükseltme veya paket override'ı çalıştırılmadı. Bu sonuçlar native uygulamada istismar kanıtı değildir; bağımlılık ağacında açık bulgular bulunduğunu gösterir. Yerel veritabanına şifreleme, otomatik bulut yedeği veya senkronizasyon eklenmedi.

## 8. Öğretici örnekler

**Repository Pattern:** Ekran SQL bilmeden bir iş komutu çağırır. `createBudgetRepositoryV3(database)` veritabanını parametre olarak alır. Aynı repository Node test sürücüsüyle test edilir; daha sonra [Expo'nun exclusive transaction adaptörüyle](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/#withexclusivetransactionasynctask) kullanılabilir. İşlev doğrudan bir SQLite dosyası açmadığından test dosyası ile kullanıcı dosyası birbirine karışmaz.

```ts
const repo = createBudgetRepositoryV3(testDatabase);
const active = await repo.loadActivePeriod(bookId, asOf);
const result = await repo.startPeriod(command);
```

**Transaction ve rollback:** `startPeriodOperationV3`, kapatma ve oluşturmayı aynı `atomic(async tx => ...)` çağrısı içinde yapar. Fatura kopyası yazılırken hata çıkarsa kaynak kapatma da geri alınır. `await` işin tamamlanmasını bekler; yalnız callback'in bitmesi commit'in bittiği anlamına gelmez. `atomicV3`, dış `database.transaction` Promise'ini beklediği için commit öncesinde sonuç kullanıcıya ulaşmaz.

**Idempotency:** Aynı ekonomik komutun tekrar gönderilmesi ikinci ekonomik etkiyi oluşturmaz. Kodda makbuz önce okunur:

```ts
const previous = await readOperationV3(tx, operationId, bookId, 'period-open', payload);
if (previous) return resultForReceipt(tx, command, previous, true);
```

Makbuz hedef B'yi gösterir. Güncel aktif dönem C olsa da bu dal B'yi okur ve C'yi kapatmaz. Aynı ID ile farklı `payload` başarı sayılmaz; `CONFLICT` olur.

**Optimistic locking:** Formun açıldığı revision komutta taşınır. Örneğin form `expectedSourceRevision=5` ile açıldıktan sonra bir harcama revision'ı 6 yaptıysa eski form reddedilir. SQL de kontrol eder:

```sql
UPDATE budget_periods SET status='closed', ... , revision=?
WHERE id=? AND book_id=? AND revision=? AND status='active';
```

`changes !== 1` ise `CONFLICT` oluşur. Ayrıca defterin `activation_revision` alanı, formun dönem değişiminden önce mi sonra mı açıldığını denetler. Parasal hesap sonucu revision yerine kullanılamaz.

**Race condition:** İki ekran veya bağlantı aynı anda aynı kaynakla yeni dönem açmak isteyebilir. `atomicV3` tek bağlantıdaki işleri sıraya koyar; bu kuyruk diğer bağlantıyı kontrol etmez. Diğer bağlantılar için transaction, revision CAS, tek aktif/tek devam kısıtları ve kalıcı makbuz birlikte çalışır. Gerçek worker testleri iki bağlantıda tek geçiş oluştuğunu doğrular. Firebase eklenirse bu yerel mekanizmalar farklı cihazları tek başına koordine edemez; sunucu tarafı sahiplik/CAS, işlem kuyruğu ve çatışma protokolü ayrıca gerekir.

## 9. v3'ü etkinleştirmeden önce gerekenler

1. Ayrı isimli sentetik v1/v2 dosyalarında gerçek iOS/Android `expo-sqlite` migration ve repository testleri yapılmalı. Exclusive bağlantıların FK, lock/snapshot ve commit davranışı doğrulanmalı.
2. Arka plana geçiş, zorla kapatma, WAL kurtarma, yetersiz disk/yazma hatası, büyük geçmiş ve kayıp yanıt tekrarları native sürücüde sınanmalı. Node testleri bunların yerine geçmez.
3. UI/state adaptörleri gerçek `bookId`, dönem local/public kimlikleri ve iki revision değerini taşımalı. Eski açık form otomatik yeni döneme bağlanmamalı; fatura seçimleri ve kullanılabilir bakiye onayı açıkça alınmalı. Yeni dönem/arşiv ekranları henüz yoktur.
4. Önceki uygulama sürümünün v3 dosyasını okuyamayacağı dikkate alınarak sürüm dağıtımı ve geri dönüş planlanmalı. Başarılı v3 dosyasına otomatik v2 downgrade yapılmamalı.
5. Gerçek kullanıcı dosyasına geçmeden önce kullanıcının onayı ve WAL ile tutarlı yedek/geri yükleme kanıtı alınmalı. Bundan sonra kontrollü biçimde açılış v3 migration ve repository'ye bağlanabilir.

Bu teslimatta bu adımlar uygulanmadı; gerçek cihaz migration'ı ve 7C kapsamı başlatılmadı.
