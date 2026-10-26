# Günlük Bütçem — 7A SQLite v3 teslimatı

26 Ekim 2026. Yalnızca migration ve SQL veri bütünlüğü katmanı geliştirildi. Yeni dönem açma iş mantığı, ekran veya domain hesaplama değişikliği yapılmadı. Paket eklenmedi.

**v3 henüz çalışan uygulamada etkin değil.** `platform.native.ts`, `migrations.ts` ve mevcut repository dosyaları değiştirilmedi; uygulamanın açılışı hâlâ v2 migrator'ını kullanıyor. `migrateDatabaseV3` yalnızca yeni testler tarafından çağrılıyor. Gerçek iPhone'a bağlanılmadı, uygulama/cihaz veritabanı açılmadı ve kullanıcı verileri okunmadı. Testler işletim sisteminin geçici klasöründe oluşturulan bağımsız SQLite dosyalarında çalıştı.

## Eklenen dosyalar

| Dosya | Sorumluluk |
| --- | --- |
| `src/data/budget/schema-v3.ts` | Yeni tablo ailesi, kopyalama ifadeleri, indeksler ve koruma tetikleyicileri. |
| `src/data/budget/migrations-v3.ts` | Açıkça çağrılan, tek atomik transaction içinde v0/v1/v2 → v3 migrator'ı. |
| `src/data/budget/integrity-v3.ts` | Eski kayıtların domain doğrulaması, kopyaların birebir karşılaştırılması ve SQLite bütünlük denetimleri. |
| `tests/migrations-v3/fixtures/v2-schema.sql` | Mevcut v1+v2 SQL'inin dondurulmuş kopyası. Eski v1 fixture'ı aynen korundu. |
| `tests/migrations-v3/fixtures.ts` | Sentetik eski kayıtlar, gerçek dosya anlık görüntüleri ve hata enjeksiyonu yardımcıları. |
| `tests/migrations-v3/migration.test.ts` | Taşıma, yeniden açılış, tekrar çalıştırma ve rollback testleri. |
| `tests/migrations-v3/constraints.test.ts` | Dönem ilişkileri, kapanmış kayıtlar, kimlikler ve eşzamanlı bağlantı testleri. |
| `MIGRATION_V3_RAPORU.md` | Bu teslimat, sınırlar ve sonraki aşama gereksinimleri. |
| `raporlar/v3-test-sonuclari.txt` | Son tam test çalışmasının çıktısı. |
| `raporlar/v3-dogrulama.json` | Kontrol sonuçları, çalışma zamanı sürümleri ve önceki dosyaların SHA-256 değişmezlik kanıtı. |

Mevcut kaynak/test/yapılandırma dosyalarının görev başında alınan 91 dosyalık SHA-256 görüntüsüyle karşılaştırmasında değişiklik yoktur. Mevcut 256 testin hiçbiri değiştirilmedi veya devre dışı bırakılmadı. Domain, uygulama açılışı, repository, paket kilidi ve ekranlar korunmuştur.

## Veri modeli

Tek SQLite dosyası kullanılmaya devam eder. `book_id`, gelecekte aynı dosyada bağımsız bütçe defterlerini ayırabilecek ilişki kapsamıdır; uygulamada defter yönetimi eklenmedi.

| Tablo | Anahtarlar ve yeni alanlar | Korunan finansal alanlar |
| --- | --- | --- |
| `budget_books` | `id` yerel INTEGER PK; `public_id`; `activation_revision` | Defterin aktif dönem değişimleri için gelecekte CAS kontrolünde kullanılacak sürüm. |
| `budget_periods` | Mevcut `id` korunur; `public_id`, `book_id`, `previous_period_id`, `status`, `opened_at`, `created_at`, `closed_at`, `closing_result_json`, `calculation_version` eklenir. | `revision`, `currency`, `time_zone`, `balance_minor`, `balance_captured_at`, `next_payday`, `savings_minor` aynen taşınır. |
| `budget_payments` | Mevcut `(period_id,id)` PK korunur; `public_id`, `carried_from_period_id`, `carried_from_payment_id` eklenir. | İsim, INTEGER kuruş tutarı ve takvim tarihi aynen kalır. |
| `budget_expenses` | Mevcut `id` korunur; gerçek `period_id` ilişkisi ve yeni `public_id`. | Tutar, kategori, açıklama, gerçekleşme/kayıt zamanları, aktif/iptal durumu ve iptal zamanı aynen kalır. |
| `budget_save_operations` | Mevcut `operation_id` korunur; `public_id`, `book_id`, `source_period_id`, `kind`, `command_version` eklenir. | Eski `period_id`, `payload` ve `resulting_revision` aynen kalır. |

Tüm tablolar `STRICT` kullanır. Parasal sütunlar INTEGER kuruştur; güvenli JavaScript tam sayı aralığı `±9.007.199.254.740.991` ile sınırlıdır. Fatura/harcama tutarı pozitif, birikim sıfır veya pozitif; başlangıç bakiyesi negatif olabilir. Migration finansal tutarları yuvarlamaz, dönüştürmez veya REAL ile hesaplamaz.

Her tabloda `public_id`, 16 rastgele bayttan üretilen 32 karakterli küçük harf hexadecimal kimliktir. SQL uzunluk/alfabe ve tablo içi benzersizliği doğrular. Kimlikler ilk başarılı taşıma sırasında üretilir; tekrar açılışta veya mükerrer migration'da değişmez. Mevcut yerel kimlikler yerinde kalır. Bu kimlikler gelecekteki senkronizasyon için temel sağlar; tek başına senkronizasyon, kullanıcı sahipliği veya bulut yedeği oluşturmaz.

Eski dönem `id=1`, `book_id=1`, `status=active` olarak taşınır. Maaş tarihi geçmiş olsa bile kapatılmış gibi işaretlenmez; kapanış anı ve sonuç uydurulmaz. `opened_at`, orijinal bakiye anının mevcut domain doğrulamasına dayanan UTC gösterimidir. `balance_captured_at` metni, saat farkı ve hassasiyetiyle birebir korunur. Eski gerçek oluşturulma zamanı bilinmediğinden `created_at=NULL` bırakılır. Boş veritabanında yalnızca defter oluşturulur; dönem veya sahte finansal işlem eklenmez.

Eski makbuzlar `kind=legacy`, `command_version=0` olarak işaretlenir. İçerikleri JSON olarak yeniden yazılmaz; boş veya eski biçimdeki metinler de aynen korunur. v3 korumaları kurulduktan sonra yeni `legacy` makbuzu eklemek yasaktır. Yeni makbuz çeşitleri `budget-save`, `expense-add`, `expense-cancel`, `period-open`; sözleşme sürümü 1'dir. Bunların iş mantığı bu aşamada uygulanmadı.

## SQL'in engellediği hatalar

- `WHERE status='active'` koşullu benzersiz indeks, defter başına en fazla bir aktif dönem sağlar. En fazla bir kök dönem ve `(book_id,previous_period_id)` benzersizliği dallanmış dönem zincirini önler.
- Önceki dönem aynı defterde ve kapalı olmalıdır; kendi kendine devam dönemi oluşturulamaz. Yeni dönemin açılış anı kaynağın kapanış anıyla eşleşir. Yerel kimlik, dış kimlik ve dönem sahipliği sonradan değiştirilemez.
- Fatura, harcama ve makbuzlar gerçek ebeveyn dönemlerine bağlanır. Defter/dönem eşleşmesi bileşik yabancı anahtarlarla ve ek tetikleyicilerle korunur.
- Taşınan faturanın kaynak faturası hemen önceki kapalı dönemde ve aynı defterde bulunmalıdır. Yarım kaynak ilişkisi veya aynı faturanın hedefe iki kez taşınması reddedilir. Taşıma işlemi henüz geliştirilmedi; yalnızca ilişkiler hazırlandı.
- Kapalı dönem tekrar açılamaz, güncellenemez veya silinemez. Faturası değiştirilemez/silinemez; yeni fatura/harcama/makbuz eklenemez, mevcut harcaması iptal edilemez. Makbuzlar tüm dönemlerde değiştirilemez ve silinemez.
- Kapanış güncellemesi finansal girdileri aynı anda yeniden yazamaz ve kayıtlı harcamaların/iptallerin sonrasını dışarıda bırakan bir kapanış anı kullanamaz.
- Harcamalar finansal alanları değişmez kayıtlardır. Yalnızca açık dönemde bir kez iptal edilebilir. İptal edilmiş kayıt dahil herhangi bir harcama varsa başlangıç bakiyesi, bakiye anı, para birimi, saat dilimi ve maaş tarihi kilitlenir.
- Yeni harcama, dönemin açılış anından sonra olmalıdır. Geçmişten taşınan başlangıç öncesi/tam başlangıç anındaki kayıtlar silinmez; kopyalama koruma tetikleyicileri kurulmadan yapılır. Domain'in mevcut kapsayıcı bakiye sınırı korunur.
- `INSERT OR REPLACE`, yabancı anahtarlar ve `recursive_triggers` kapalı olsa bile kimlik, aktif dönem, devam dönemi veya fatura kaynağı benzersizliği üzerinden eski satırları sessizce silemez. INSERT tetikleyicileri bu çakışmaları silme aşamasından önce reddeder.
- Kapanışta geçerli bir JSON nesnesi, hesaplama sürümü ve kapanış zamanı gerekir. Snapshot'ın parasal alanları JSON integer ve güvenli aralıkla denetlenir; kesirli para reddedilir. SQL, domain hesaplama motorunu yeniden uygulamaz. Snapshot'ın tüm `BudgetResult` sözleşmesi ve matematiksel tutarlılığı 7B'de domain ile doğrulanmalıdır.

SQL'in aktif/kapalı ayrımı takvimde maaş gününün geçmesiyle aynı şey değildir. IANA saat dilimine göre sona ermiş aktif döneme harcama yazmayı önleyen mevcut repository/domain kontrolleri korunmalı; 7B'de gerçek dönem kimlikleriyle uygulanmalıdır. SQLite'ta farklı bir takvim motoru yazılmadı.

## Atomik taşıma ve bütünlük kanıtı

`migrateDatabaseV3` bir `AtomicDatabase.transaction` çağrısı içinde çalışır. v1 kaynağında v2 DDL'si de aynı transaction'a dahildir; v3 hatası durumunda v2 ara sürümü kalmaz.

1. `user_version` okunur. 3'ten büyük veya geçersiz sürüm reddedilir; sıfırlama yapılmaz. Eski tablo yeniden adlandırma modu açıksa işlem kayıtları değiştirmeden reddedilir.
2. Gerekli eski migration'lar uygulanır; mevcut kayıtlar domain doğrulamalarıyla kontrol edilir. Doğrulama saati sistem saati yerine kayıtlardaki son andan türetilir. Eski bozuk veri sessizce düzeltilmez veya atılmaz.
3. Birbirine bağlı ayrı `v3_*` tabloları kurulur. Eski dönem/fatura/harcama/makbuzlar kopyalanır. Tek veri bağlayan dönem kopyalama sorgusu `?` parametreleri kullanır; diğer `INSERT ... SELECT` sorgularında dışarıdan SQL metni birleştirilmez.
4. Her eski tablonun bütün eski sütunları iki yönde `EXCEPT` ve satır sayısıyla karşılaştırılır. Tutar toplamlarının eşitliği yeterli kabul edilmez: kimlik, açıklama, iptal durumu, saat bilgileri ve makbuz metni de aynı olmalıdır.
5. Eski çocuk tablolar önce, ebeveyn dönem tablosu sonra kaldırılır. Yeni tablo ailesi gerçek isimlerine alınır; indeksler ve tetikleyiciler kurulur.
6. Beklenen sütun/indeks/tetikleyiciler, `PRAGMA integrity_check`, `PRAGMA foreign_key_check` ve dönem/kaynak ilişkisi sorguları doğrulanır.
7. Yalnızca bunlardan sonra `PRAGMA user_version=3` yazılır. Başarı ancak dış transaction COMMIT'i tamamlandığında döner. Herhangi bir hata üst katmana iletilir.

Transaction içinde `PRAGMA foreign_keys` açıp kapatmaya güvenilmez; böyle bir değişiklik yapılmaz. Yeni tablolardaki yabancı anahtarlar eski tablolara değil yeni aileye baktığından, eski çocukları önce kaldıran işlem hem FK açıkken hem kapalıyken çalışır. Expo'nun ayrı exclusive transaction bağlantısında FK varsayılanının farklı olabilmesi ek ilişki tetikleyicileriyle karşılanır. Girişteki bağlantı ayarları değiştirilmez.

Bu yaklaşım [SQLite tablo yeniden oluşturma sırasını](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes) ve [transaction içindeki foreign_keys sınırlamasını](https://www.sqlite.org/foreignkeys.html#fk_enable) dikkate alır. Yeniden adlandırmada FK güncellemeleri için modern, `legacy_alter_table=OFF` davranışı gerekir. Native transaction'ın bağlantı kapsamı için [Expo 58 SQLite belgesi](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/#withexclusivetransactionasynctask) esas alınmıştır.

## Gerçekten çalıştırılan kontroller

| Kontrol | Sonuç |
| --- | --- |
| `npm test` | 310/310 geçti; 0 başarısız, 0 atlanan. Önceki 256 + yeni 54. |
| Yeni v3 testleri | 53 senaryo gerçek SQLite dosyası kullanır; 1 test dondurulmuş SQL fixture'larını karşılaştırır. SQLite sorguları mock değildir. |
| Önceki native adaptör mock testleri | Bağlantı seçimi, COMMIT'i bekleme ve COMMIT reddinde başarı dönmeme için mevcut 3 mock test korundu ve geçti. Gerçek iPhone kanıtı sayılmaz. |
| `npx tsc --noEmit` | Geçti. Testler ayrıca test TypeScript yapılandırmasıyla derlendi. |
| `npx expo lint` | Geçti; kural kapatılmadı. |
| `npx expo-doctor` | 20/20 geçti. İlk sandbox denemesi npm registry DNS hatası (`ENOTFOUND`) verdi; ağ erişimli tekrar başarılı oldu. |
| Çalışma zamanı | Node.js 24.4.0, yerleşik SQLite 3.50.2. Yeni test bağımlılığı yok. |

Gerçek dosya senaryoları boş → v3, v1 → v2 → v3 ve v2 → v3 yollarını FK açık/kapalı bağlantılarda kapsar. Aktif, iptal edilmiş, başlangıç öncesi ve tam başlangıç anındaki harcamalar; fatura kimlikleri; orijinal ofsetli bakiye zamanı; makbuzların boş/eski/boşluklu içerikleri birebir korunur. Domain'in kabul ettiği sıra dışı saat farkları ve milisaniye hassasiyeti ayrıca kontrol edilir.

Oluşturma, defter kopyalama, veri kopyalama, tablo değiştirme, tetikleyici kurma ve `user_version=3` yazımından sonra hatalar enjekte edilir. Yarıda kesilmiş SQL blokları, aynı sayıda satırla değiştirilmiş bir kopya tutarı, son bütünlük kontrolü hatası ve COMMIT öncesi hata da kapsanır. Eski şema metinleri, bütün eski satırlar ve sürüm karşılaştırılır; aşama hata testlerinde bağlantı kapatılıp yeniden açıldığında da aynı eski durum görülür. Bunlar gerçek SQLite rollback testleridir; hata üretmek için kullanılan wrapper, disk dolması veya işletim sistemi çökmesini fiziksel olarak üretmez.

İki dosya bağlantısında ilk `BEGIN IMMEDIATE` yazıcısı ikinciyi kilitler; ilk işlem tamamlandıktan sonra ikinci devam dönemi kısıtlar tarafından reddedilir. Bu test future `startPeriod` API'sinin idempotency/CAS iş akışının tamamını doğrulamaz; o API bu aşamada yoktur.

Sayısal regresyon örneği: sentetik 1.000.000 kuruş başlangıç bakiyesinde, 101 kuruş güncel aktif harcama düşülür; iptal edilmiş 101 kuruş ile başlangıç öncesi ve tam başlangıç anındaki 101'er kuruş tekrar düşülmez. Migration öncesi ve sonrası `spentSinceSnapshotMinor=101`, `remainingBalanceMinor=999899` ve diğer tüm domain sonuçları aynıdır. Maaş geliri eklenmez.

## Teslimat sorularının cevapları

**1. v2'den hangi kayıtlar kaybolabilirdi?** Çocuk tabloları CASCADE ile bağlayan eski dönemi erken kaldırmak faturaları ve makbuzları silebilirdi. Yalnızca aktif harcamaları kopyalamak iptalleri; tarih filtresi kullanmak başlangıç öncesi kayıtları silebilirdi. Kimlikleri yeniden üretmek eski makbuz/harcama/fatura ilişkilerini koparabilirdi. Makbuz JSON'unu yeniden yazmak aynı işlemin tekrar tanınmasını bozabilirdi. Yeni kuralların reddettiği kayıtları atlayarak taşımak da sessiz kayıp yaratabilirdi. Ayrı tablo ailesi, çocukları önce kaldırma, eski kimlikleri koruma, iki yönlü karşılaştırma ve tek transaction bu risklere karşı uygulanmıştır. Geçersiz veri varsa migration bütün eski durumu koruyarak başarısız olur.

**2. SQL kısıtları hangi hataları engelliyor?** Aynı defterde çift aktif dönem, aynı kaynaktan iki devam dönemi, kendi kendine/başka deftere devam, olmayan döneme yazma, yanlış fatura kaynağı, mükerrer fatura taşıma, yanlış makbuz hedefi/kaynağı/sürümü, değiştirilen kimlikler, güvensiz veya kesirli kuruş, kapalı geçmişe yazma ve geçmişi `REPLACE` ile silme girişimleri engellenir. Finansal formüllerin doğruluğu ve yerel takvimde dönem bitişi ayrıca domain/repository sorumluluğudur.

**3. Repository'de 7B için ne gerekiyor?** `WHERE id=1`/`period_id=1` varsayımları kaldırılmalı; aktif dönem defter üzerinden seçilmeli ve bütün okuma/yazmalar açık dönem kimliği taşımalıdır. `SavedBudget` ve komut tipleri dönem/defter kimlikleriyle genişlemelidir. `activation_revision` ile defter CAS'i ve dönem `revision` kontrolü birlikte kullanılmalıdır. `startPeriod` kapatma snapshot'ı, yeni dönem, isteğe bağlı fatura kopyaları, aktif dönem değişimi ve sürümlü makbuzu tek exclusive transaction'da kesinleştirmelidir. Aynı işlem kimliği tekrarlandığında kayıtlı hedef dönem dönmeli; farklı yük reddedilmelidir. Eski makbuzların biçimi korunarak ayrı legacy okuma yolu tasarlanmalıdır. Geçmiş ekranı donmuş sonuçları sürümüyle okumalı; kapalı kayıtları güncel saatle yeniden yazmamalıdır. Yeni bakiye kullanıcıdan açıkça alınmalı; önceki dönemin harcamaları yeni dönemin domain girdisine aktarılmamalıdır. Bu değişiklikler tamamlanmadan v3, `platform.native.ts` açılışına bağlanmamalıdır. Eski v2 uygulaması v3 dosyasını reddeder; otomatik downgrade yoktur.

**4. Gerçek iPhone yükseltmesinden önce ne gerekiyor?** Önce Expo Go/iOS ve Android üzerinde ayrı isimli sentetik v1/v2 test dosyalarıyla aynı migration, FK açık/kapalı exclusive bağlantılar, rollback, yeniden açılış ve COMMIT davranışı doğrulanmalıdır. Arka plana geçiş, uygulamanın zorla kapanması, WAL kurtarma, yetersiz disk/yazma hataları ve büyük kayıt hacmi test edilmelidir. 7B repository/idempotency/CAS testleri ve eski/yeni uygulama sürümü uyumluluğu tamamlanmalıdır. Ardından kullanıcının açık onayıyla, uygulama kapalıyken veya SQLite'ın tutarlı yedekleme API'siyle alınmış WAL uyumlu yedeğin bağımsız kopyasında taşıma ve geri yükleme kanıtlanmalıdır. Açık WAL veritabanının yalnız `.db` dosyasını kopyalamak yeterli kabul edilmemelidir. Bunlar yapılmadan gerçek kullanıcı dosyasında v3 çalıştırılmamalıdır.

## Sınırlar ve kalan işler

Bu aşamada gerçek iPhone/Android native migration veya uçtan uca uygulama testi yapılmadı. Node SQLite testleri Hermes, Expo native bağlantıları veya cihazın güç kaybı davranışını garanti etmez. Native paket üretimi bu veri katmanı aşamasında çalıştırılmadı. Web SQLite desteği genişletilmedi.

SQLite varsayılan şifreleme, otomatik bulut yedeği veya cihazlar arası senkronizasyon eklenmedi. Bilinen önceki güvenlik bulguları için `GUVENLIK_RAPORU.md` geçerlidir; paketler değiştirilmedi, bu aşamada yeni audit taraması veya `npm audit fix` çalıştırılmadı.

v3 tamamlandıktan sonra v2'ye veri kaybettiren bir geri migration hazırlanmadı. Buradaki rollback, başarısız yükseltmenin tek transaction içinde eski sürüme dönmesidir. Başarıyla yükseltilmiş bir dosyanın eski uygulamayla çalıştırılması ayrı bir sürüm dağıtım problemidir. 7A bu noktada biter; 7B veya başka özellik başlatılmadı.
