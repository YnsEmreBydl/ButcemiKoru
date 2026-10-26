**Günlük Bütçem — 7D-1 doğrulama raporu**

Tarih: 26 Ekim 2026. Native cihaz bölümü gerçek iPhone/Hermes sonucuyla güncellenmiştir. Ana uygulamanın açılışı ve kayıt akışı v2 olarak korunmuştur. Gerçek kullanıcı veritabanı açılmamış, kopyalanmamış, değiştirilmemiş ve silinmemiştir. Yeni bağımlılık kurulmamıştır.

**Mevcut karar**

Node kontrolleri ve gerçek iPhone/Hermes üzerinde **19/19 bağımsız SQLite senaryosu başarılıdır**. Kullanıcının Expo Go'yu kapatıp lab'ı yeniden açmasının ardından yeni JS çalışma zamanında kalıcılık da doğrulanmıştır. iOS tarafındaki bu kanıt v3 için önemli bir doğrulamadır. Android, COMMIT sırasında native süreç kaybı ve gerçek veritabanını güvenle yükseltecek yedek/kurtarma akışı henüz kanıtlanmadığı için v3'ün gerçek kullanıcı verilerine uygulanmasını bu aşamada önermiyorum. 7D-2 etkinleştirmesi yapılmamıştır.

**Ortam ve izolasyon**

- Node.js 24.4.0, npm 11.4.2; Node SQLite 3.50.2.
- Fiziksel iPhone: `development:true`, `independentApp:true`, `physicalDevice:true`, `platform:ios`, `hermes:true`; cihazdaki SQLite **3.53.3**. Kimlikler inspector üzerinden lab runtime'ından alınmıştır.
- Mevcut Expo 58.0.19, React Native 0.88.0, expo-sqlite 58.0.14 korunmuştur.
- Test girişi Expo Router'a yeni bir üretim rotası eklemez. Ayrı bir geçici Expo projesidir; aynı kurulu paketleri kullanır.
- Geliştirme modu, `gb-v3-native-lab` slug'ı, native platform ve Hermes kontrol edilmeden SQLite bağlantısı açılamaz.
- Yalnız `gb-v3lab-<32 haneli rastgele oturum kimliği>-<izinli anahtar>.db` adları kullanılabilir. Dizin sürücü içinde sabittir: Expo SQLite dizini altında `gb-v3-native-lab`.
- Ana uygulamanın `platform.native.ts` açıcı fonksiyonu test girişine aktarılmaz. Gerçek `gunluk-butcem.db` adı hiçbir test bağlantısına verilmez.
- Lab'ın iOS development source map'indeki 811 kaynak da denetlendi: ana uygulama ekranları ve gerçek veritabanı açıcısı bulunmadı. Bu bir derleme/izolasyon kanıtıdır; cihazda çalıştırma kanıtı değildir. [Lab kaynak denetimi](raporlar/7d1-lab-izolasyon.json).
- Yeni dosya açılırken boş şema ve sürüm 0 doğrulanır. Mevcut test dosyasını yeniden kullanarak baştan test çalıştırmak reddedilir. Tam yeni tur için yeni oturum gerekir. Native test dosyaları otomatik silinmez.
- Yedekleme ve geri yükleme yalnız sürücünün sahip olduğu test bağlantıları arasında yapılabilir. Kullanıcıdan dosya yolu alınmaz.
- Hata çıktılarında SQL, satır içerikleri, dosya yolları veya kullanıcı tutarları loglanmaz. Kontrollü test kimlikleri, hata kodları ve çalışma ortamı bilgileri raporlanır.

Expo 58'in `withExclusiveTransactionAsync` API'si kullanılmış; sorgular işlemin callback bağlantısında çalıştırılmıştır. Sonuç ancak API'nin commit sonrasında tamamlanmasıyla döner. Bu API'nin web'de eşdeğer çalıştığı varsayılmamıştır. [Expo 58 SQLite belgesi](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/).

**Çalıştırılan kontrollerin ayrımı**

| Kategori | Sonuç ve sınırı |
| --- | --- |
| Bütün Node testleri | `npm test`: **426/426 başarılı**, 0 başarısız, 0 atlanan. Önceki 420 test korunmuştur. |
| Gerçek Node SQLite dosyaları | Ortak native-lab senaryo kodunun **19/19 kontrolü** geçmiştir; bu kontroller tek Node testinin içindedir ve 426'ya tekrar eklenmez. Mevcut migration/repository SQLite testleri de npm test kapsamındadır. |
| Node süreç sonlandırma | Ayrı Node alt süreci COMMIT öncesinde SIGKILL ile sonlandırıldı; bağımsız WAL dosyası yeniden açıldığında eski kayıtlar değişmemişti. Bu bir iPhone süreç sonlandırma testi değildir. |
| Mock kontrolleri | Form controller, gezinme, commit bekleme ve native transaction adaptörü testleri geçti. Yeni CONFLICT/retry testleri aşağıda açıklanmıştır. |
| Gerçek iOS SQLite/Hermes | Fiziksel iPhone, SQLite 3.53.3: **19/19 senaryo başarılı**. Aynı JS oturumunda dosyaları kapatıp açma ve uygulama yeniden açıldıktan sonra kalıcılık kontrolü ayrıca geçti. |
| Gerçek Android SQLite | Çalıştırılmadı; bağlı Android cihazı ve `adb` yok. |
| Manuel arayüz | Kullanıcı bağımsız Lab ekranını Expo Go'da açtı; kapanıp yeniden açılmasını da bildirdi. Yeni dönem/arşiv ürün ekranlarında gerçek iPhone etkileşim testi yapılmadı. Önceki aşamanın web ekranı onayı bu kapsama sayılmaz. |
| TypeScript | `npx tsc --noEmit`: başarılı. |
| ESLint | `npx expo lint`: başarılı. |
| Expo Doctor | **20/20 başarılı**. |
| Paket üretimi | Ana uygulama için iOS, Android ve web export başarılı; native SQLite çalışma zamanı testi veya imzalı IPA/APK kurulumu değildir. |
| Bağımsız test girişi derlemesi | Metro iOS development bundle HTTP 200 ile üretildi; yaklaşık 4,7 MB/804 modül. Cihazda çalıştırıldığı anlamına gelmez. |

Kanıtlar: [test çıktısı](raporlar/7d1-test-sonuclari.txt), [Node SQLite senaryoları](raporlar/7d1-node-sqlite.json), [ilk iPhone turu](raporlar/7d1-ios-native.json), [aynı JS oturumunda yeniden açma](raporlar/7d1-ios-same-runtime-resume.json), [uygulama yeniden açıldıktan sonra kalıcılık](raporlar/7d1-ios-resume.json), [TypeScript](raporlar/7d1-typescript.txt), [ESLint](raporlar/7d1-eslint.txt), [Doctor](raporlar/7d1-expo-doctor.txt), [export](raporlar/7d1-paket-uretimi.txt).

İlk native tur `58dd44b0ddcbbdb95870c6f298f5100c` oturumunda 19 başarılı / 0 başarısız sonucuyla kaydedildi. Yeniden açılıştan sonra aynı dosyalarla tam test turu tekrar tetiklenmişti: 18 senaryo açılışta **`LAB_FILE_ALREADY_EXISTS` ile reddedildi**, yalnız bağlantıları kapatma kontrolü geçti. Bu ikinci turun 1/18 çıktısı gizlenmedi; [ayrı kanıt dosyasında](raporlar/7d1-ios-reused-files-rejected.json) ve yeniden açılış durumunda korunuyor. Bunlar migration'ın çalışıp başarısız olması değildir; sürücü dosyaların boş olmadığını saptayıp migration'a geçmeden durmuştur. İlk 19/19 sonuçla birleştirilip yeni başarı sayısı üretilmez. Kalıcılık kontrolünün sonucu JSON içindeki ayrı `resume.passed:true` alanıdır.

**Migration ve yaşam döngüsü testlerinin kapsamı**

Aynı senaryo fonksiyonu Node dosya sürücüsü ve gerçek Expo native sürücüsüyle çalıştırılmıştır. Aşağıdaki kontroller **Node SQLite ve gerçek iPhone SQLite/Hermes üzerinde** başarılıdır. İki farklı SQLite sürümünün sonuçları ayrı kanıt dosyalarında tutulur.

| Senaryo | Denetlenen kanıt |
| --- | --- |
| Boş → v3 | Sürüm 3, ikinci migration ile değişmeyen veri/şema, bağlantıyı kapatıp yeniden açma. |
| v1 → v2 → v3; v2 → v3 | Dondurulmuş eski fixture şemaları kullanılır; bütün eski sütunlar, dönem/fatura/harcama kimlikleri ve eski işlem makbuzunun metni karşılaştırılır. |
| Aktif/iptal/geçmiş harcamalar | İptal bilgisi ve eski tarihler korunur. Başlangıçtan önce ve tam başlangıç anında gerçekleşen harcamalar yeniden düşülmez; yalnız sonraki aktif 101 kuruş düşülür. |
| Sekiz migration hatası | v1 ve v2 için kopyalama, tablo değiştirme, koruyucu SQL ve `user_version=3` yazımı sonrasında hata enjekte edilir. Eski şema, bütün satırlar ve sürüm aynı kalır; yeniden açılıştan sonra migration başarılı denenir. |
| A → B → C | A ve B kapanır, C tek aktif dönemdir; eski harcamalar yeni açıkça girilen bakiyeden düşülmez. |
| Eski A → B komutu | C aktifken eski işlem makbuzu B'yi döndürür; B'nin sonradan kapanmış olması korunur ve C değişmez. |
| Fatura taşıma | Yalnız seçilen fatura yeni kimlik ve kaynak bağlantısıyla kopyalanır; kaynak faturalar korunur. |
| Kapalı dönem yazımı | A'ya yeni harcama `CONFLICT` ile reddedilir; veriler değişmez. |
| Revision ve transaction hatası | Eski revision reddedilir; işlem makbuzu yazılırken hata bütün geçişi geri alır; aynı komut daha sonra başarılı olabilir. |
| İki bağlantıdan yarış | Aynı kaynak döneme iki ayrı komut gönderilir; yalnız biri kazanır. Tek aktif dönem ve tek yeni dönem makbuzu kalır. |
| SQLite bağlantısını kapatma | COMMIT edilmemiş revision güncellemesi bağlantı kapatıldığında geri alınır; eski bağlantı sorgusu reddedilir; yeniden açılan dosya değişmemiştir. |

Karşılaştırmalar yalnız satır sayısını kontrol etmez: eski sütunlar ve hata senaryolarında bütün tablo verileri, SQL şeması ve `user_version` karşılaştırılır. Mevcut domain motoru, migration v1/v2/v3 ve v3 repository uygulaması bu aşamada değiştirilmemiştir.

**Hata, yedekleme ve kurtarma sınırları**

`PRAGMA query_only=ON` işlem bağlantısında gerçek SQLite yazma reddi oluşturur. Hatanın READONLY olduğu denetlenir; bütçe değişmemeli ve sonra aynı komut başarılı olmalıdır. Bu fiziksel depolama arızası veya bütün `SQLITE_IOERR` alt türlerinin testi değildir.

Dolu disk denemesinde yalnız bağımsız test dosyasının `max_page_count` sınırı mevcut sayfa sayısının bir fazlasına indirilir; sınırlı 1 MB `zeroblob` eklemesi gerçek `SQLITE_FULL` üretir. Hata dönem kapatma yazımından sonra meydana gelir. Eski bütçe ve makbuzlar karşılaştırılır, sınır geri alınır, komut tekrar denenir. Cihazın fiziksel diski doldurulmaz. [SQLite sayfa sınırı belgesi](https://sqlite.org/pragma.html#pragma_max_page_count).

WAL açıktır; otomatik checkpoint test kaynağında kapatılır. `backupDatabaseAsync` ile kaynak → bağımsız yedek → üçüncü bağımsız geri yükleme dosyası akışı kullanılır. Veri/şema eşitliği, bütünlük ve yeniden açılış denetlenir. WAL açıkken yalnız `.db` dosyasını kopyalayan bir yöntem kullanılmaz. Bu test uygulamaya kullanıcı yedekleme özelliği eklemez. [SQLite online backup belgesi](https://sqlite.org/backup.html).

Henüz doğrulanmayanlar:

- Fiziksel cihaz diskinin tamamen dolması, donanım I/O arızası ve güç kesintisi.
- Shared Expo Go sandbox'ında native uygulama sürecinin COMMIT sırasında zorla öldürülmesi. Kullanıcı verilerini de barındırabilen Expo Go sürecinde bu deney yapılmadı.
- Süreç kimliğiyle izlenen native cold restart. Kullanıcı tamamlanmış testlerden sonra Expo Go'yu kapatıp yeniden açmıştır; yeni JS çalışma zamanı ve korunmuş kayıtlar doğrulanmıştır. Native PID ölçülmediğinden yalnız JS işaretine dayanarak OS süreç kimliği değiştiği iddia edilmez.
- Android sürücü davranışı, imzalı development/release build ve gerçek cihazdaki yeni dönem/arşiv ekranları.

Bağımsız test girişinin kalıcılık düğmesi önceki test oturumunun yalnız `lifecycle` ve `wal-restored` dosyalarını açar. iPhone'da A/B/C geçmişi, aktif C'nin 450.000 kuruş bakiyesi ve geri yüklenmiş B dönemi doğrulandı. İlk kontrol aynı JS oturumunda geçti (`freshJavaScriptRuntime:false`). Kullanıcının kapatıp yeniden açmasının ardından ikinci kontrol de geçti (`freshJavaScriptRuntime:true`). `nativeProcessRestartVerified:false` alanı native PID ölçülmediği için korundu. İlk 19 senaryolu turun `notRun` alanı, o turun ardından yapılan bu ek kalıcılık testini içermez; orijinal kanıt değiştirilmedi.

**7C işlem kimliği denetimi ve gerekli düzeltme**

Ekonomik komut kimliği, hedef dönem kimliği, taşınacak fatura kimlikleri ve bakiye anı ilk denemede yakalanır. Aynı denemenin retry işleminde bunlar korunur. Yalnız okuma saati `asOf` ilerleyebilir; repository'nin `startPayload` sözleşmesinde bu alan ekonomik payload'a dahil değildir.

Önceden CONFLICT sonrasında aynı komutu açıkça yeniden sorgulama yolu yoktu; kullanıcı yalnız yeni inceleme/onay akışına geçebiliyordu. `retrySameAttempt()` eklendi; arayüzde “Aynı işlemin sonucunu tekrar kontrol et” seçeneği vardır. Bu yol güncel verileri eski komuta eklemez. Kullanıcı güncel bilgileri kabul edip formu değiştirir ve tekrar onaylarsa önceki intent temizlenir, yeni işlem kimliği oluşturulur.

Bu retry sırasında ayrıca gecikmiş inceleme yanıtının başarı ekranını eski `review` durumuna çevirebildiği görüldü. Kaydetme başladığında eski inceleme isteklerini geçersiz kılan sayaç eklendi; kaydetme sürerken inceleme kabulü reddedilir. Finansal kayıt mantığına müdahale edilmedi.

Üç yeni mock regresyon testi şu davranışları doğrular:

1. Geçici CONFLICT → aynı kimlik/aynı canonical payload ile retry; hızlı çift dokunma aynı Promise'i paylaşır.
2. Açık yeniden inceleme + değiştirilen 4.000,50 TL bakiye + tekrar onay → yeni işlem kimliği; aynı kimlik iki farklı payload için kullanılmaz.
3. Retry commit edildikten sonra gelen eski inceleme yanıtı başarıyı bozamaz.

İlk regresyon düzeltme öncesinde başarısızdı: [kanıt](raporlar/7d1-retry-regresyon-oncesi.txt). Gecikmiş inceleme regresyonu da `review` / `success` farkıyla önce başarısız oldu: [kanıt](raporlar/7d1-gecikmis-inceleme-oncesi.txt). Mevcut mock testleri zaten commit bekleme, commit yanıtı kaybı, ID üretim hatası, çift dokunma ve ekran ayrılıp geri gelme davranışlarını kapsar; silinmediler.

Bu kimlikler mevcut 7C workspace içinde saklanır. Uygulama sürecinin kapanmasında tamamlanmamış form intent'i kalıcı değildir; mevcut 7C sınırı budur. Onaylanmış bir kaydın kalıcılığını SQLite makbuzu sağlar; gelecekte cold restart sonrasında belirsiz komutu otomatik devam ettirmek gerekirse intent depolama tasarımı ayrıca yapılmalıdır.

**Güvenlik: beş yüksek bulgu**

`npm audit` ve `npm audit --omit=dev` ikisi de **5 high**, 0 critical bildirir; her iki komut bu nedenle 1 çıkış koduyla biter. Beş ayrı kök zafiyet yoktur: iki advisory bağımlılık zincirinde beş paketi işaretler. Paketler değiştirilmemiş, `audit fix`, `--force` veya override çalıştırılmamıştır.

| Etkilenen paket/sürüm | İlişki ve risk | Önerilen yaklaşım |
| --- | --- | --- |
| `node-forge` 1.4.0 | Transitif: Expo → CLI → forge; ayrıca CLI → code-signing-certificates → forge. RSA PKCS#1 v1.5 imza doğrulamasında sahte imza kabulü riski. | Yama yayımlandığında Expo tarafından desteklenen sürüme geçmek; bugün doğrulanmış yama yok. |
| `zod` 3.25.76 | Transitif: Expo → CLI → zod. Çok büyük ve geçersiz dizilerde doğrulama hatalarının birikmesiyle bellek tükenmesi/işlem çökmesi riski. | Düzeltilmiş 4.6.6+ kullanabilen desteklenen CLI gerekir; 3→4 override uygulanmamalı. |
| `@expo/code-signing-certificates` 0.0.7 | Transitif: Expo → CLI → certificates → forge. Aynı forge advisory'sinin sertifika/imza araçlarına yansıması; bağımsız üçüncü advisory değildir. | Düzeltilmiş forge kullanan desteklenen sertifika/CLI sürümünü beklemek. |
| `@expo/cli` 58.1.15 | Transitif: Expo → CLI. forge/zod/certificates etkilerinin üst paketi; bağımsız ek bir açık değildir. | Kök paketleri düzelten Expo 58 uyumlu CLI sürümüyle yeniden audit ve paket testi. |
| `expo` 58.0.19 | Doğrudan dependency. CLI nedeniyle işaretlenen üst paket; finansal hesaplama motoruna özgü bir açık değildir. | Yukarıdaki düzeltmeleri içeren desteklenen SDK 58 patch'i doğrulanmalı; SDK 44'e düşürülmemeli. |

forge advisory'si düşük üs kullanan RSA anahtarlarıyla ve saldırganın doğrulanan imza/ASN.1 girdisini etkileyebilmesiyle ilgilidir. 1.4.0 dahil sürümler etkilenir; advisory henüz yama belirtmiyor. Yerel sertifika paketinde `certificate.verify` ve public-key `verify` çağrıları vardır, bu nedenle araç zinciri riski göz ardı edilemez. Güncel düzeltilmiş sürüm/Expo desteği takip edilmelidir. [forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

Zod için advisory'nin düzeltilmiş sürümü 4.6.6'dır; güncel npm latest 4.6.7'dir. Ancak mevcut CLI `^3.25.76` ister; 4'e zorlamak uyumlu patch değildir. CLI'nin DevTools eklenti çıktı şeması üst sınırı olmayan diziler doğrular; `safeParse(JSON.parse(txt))` çağrısı vardır. Çıktı sınırı V8'in azami string boyutudur ve küçük bir güvenlik limiti değildir. Güvenilmeyen eklenti çıktısı veya çok büyük doğrulama verisi CLI sürecini etkileyebilir. Finansal formlarımız Zod kullanmıyor; bu projede uzaktan gerçek exploit gösterilmedi. İlgili Expo CLI'nin desteklenen düzeltilmiş sürümü gerekir. [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

`@expo/code-signing-certificates`, CLI ve Expo satırlarının çözümü yukarıdaki kök paket düzeltmelerinin desteklenen Expo sürümüne gelmesidir. İnceleme anında npm metadata'sındaki en yeni Expo 58.0.19 ve CLI 58.1.15 zaten kurulu sürümlerdir. forge latest 1.4.0 hâlâ etkilenir. Bu yüzden mevcut Expo 58 sözleşmesini koruyarak beş bulgunun tamamını giderecek doğrulanmış bir güncelleme yolu bulunamadı. Audit'in Expo 44.0.6 önerisi SDK 58 için güvenli çözüm değildir.

Yayınlanan kod ayrımı: son iOS (1.595 kaynak), Android (1.691 kaynak), web istemci (1.259 kaynak) ve web sunucu (1.292 kaynak) source map'leri alt bölümleriyle tarandı. Etkilenen forge/Zod/sertifika modülleri bulunmadı. **CLI'nin `build/metro-require/require.js` modül yükleyicisi paketlerde vardır**; bu yüzden bütün CLI'yi “yalnız geliştirmede” diye sınıflandırmak yanlış olur. İncelenen native JS grafiğinde advisory'lerin etkilenen yollarına ulaşılabilirlik kanıtı bulunmadı. Bu kaynak grafiği incelemesidir; exploit testi, imzalı native binary denetimi veya gelecekteki bütün yapılandırmalar için güvenlik garantisi değildir. Sunucu export'unda dışarıda bırakılan Node modülleri varsa bunlar ayrıca denetlenmelidir.

Kod imzalama sertifikası app config'de etkin değil; ancak Expo Go geliştirme sertifikası araçları CLI'de mevcut olduğundan bu tek başına “risk yok” kanıtı sayılmaz. Güvenilmeyen DevTools eklentisi/sertifika girdisi kullanmamak ve geliştirme sunucusunu güvenilen ağa sınırlamak mevcut araç zinciri riskini azaltır. Bulgu kapanmış sayılmaz.

Kanıtlar: [tam audit](raporlar/7d1-audit-tam.json), [dev hariç audit](raporlar/7d1-audit-uretim.json), [sürümler](raporlar/7d1-guvenlik-surumleri.json), [paket kaynak denetimi](raporlar/7d1-paket-kaynak-denetimi.json).

**Dosyalar ve veri akışı**

Mevcut dosyalarda yalnız iki değişiklik vardır:

- `src/features/periods/form-controller.ts`: aynı deneme retry API'si; eski inceleme yanıtı koruması.
- `src/app/dev-periods/new.tsx`: geliştirme ön izlemesinde aynı denemenin sonucunu sorgulama düğmesi.

Yeni kaynak/test dosyaları:

- `src/devtools/native-v3/types.ts`: test sözleşmeleri, dosya adı ve güvenli tanılama kuralları.
- `src/devtools/native-v3/fixtures.ts`: eski fixture kurulumu, sentetik komutlar, veri/şema karşılaştırması ve kontrollü hata enjeksiyonu.
- `src/devtools/native-v3/suite.ts`: iki gerçek sürücüde kullanılabilen 19 mantıksal kontrol.
- `src/devtools/native-v3/driver.native.ts`: Expo SQLite bağlantıları, exclusive transaction, yedekleme ve sahiplik sınırı.
- `src/devtools/native-v3/runtime.native.ts`: tek test turu kilidi, durum raporu ve bağımsız kalıcılık kontrolü.
- `src/devtools/native-v3/lab-app.tsx`: yalnız bağımsız native test girişinin ekranı; render/mount test başlatmaz.
- `scripts/prepare-native-v3-lab.mjs`: yeni oturum kimliğiyle geçici bağımsız Expo projesi hazırlar.
- `scripts/run-native-v3-lab.mjs`: yalnız port 8097 üzerindeki doğrulanmış lab Hermes hedefiyle konuşur; gerçek platform sonucunu raporlar.
- `tests/native-v3/node-driver.ts`: Node'un gerçek SQLite dosya sürücüsü.
- `tests/native-v3/shared-suite.test.ts`: ortak senaryolar ve dosya izolasyonu denetimi.
- `tests/native-v3/crash.test.ts`, `crash-child.cjs`: bağımsız Node süreç sonlandırma deneyi.
- `tests/period-ui/retry-conflict.mock.test.ts`: üç yeni UI durum/kimlik regresyon testi.
- Bu rapor ve `raporlar/7d1-*` kanıt dosyaları.

Akış: bağımsız Lab ekranı/inspector → tek-tur runtime → ortak test senaryosu → yalnız lab dosyalarını açan sürücü → mevcut exclusive transaction adaptörü → mevcut migration/repository/domain. Ana uygulamanın açılış akışına bağlantı eklenmez. Üretim export kaynak grafiğinde `src/devtools/native-v3/` yoktur.

Başlangıçta özetlenen 134 mevcut kaynak/test/config dosyasının SHA-256 karşılaştırmasında yalnız yukarıdaki iki UI dosyası değişmiştir. Eski testler, dondurulmuş v1/v2 fixture'ları, domain, şema/migration/repository, `package.json`, kilit dosyası ve ana uygulama açılışı korunmuştur.

**Native testi sürdürme ve 7D-2 öncesi kalan işler**

`node scripts/prepare-native-v3-lab.mjs` yeni geçici proje yolunu ve LAN adresini verir. O geçici projede `EXPO_NO_TELEMETRY=1 npx expo start --host lan --port 8097` çalıştırılır. Aynı Wi‑Fi'deki Expo Go'da yalnız bu bağlantı açılır; başlık **SQLite v3 Native Lab** olmalıdır. Testler kullanıcı düğmesi veya doğrulanmış inspector komutuyla başlar:

```sh
node scripts/run-native-v3-lab.mjs status
node scripts/run-native-v3-lab.mjs run
node scripts/run-native-v3-lab.mjs resume
```

İlk turdan sonra dosyalar korunur. Aynı oturumda tam tur ikinci kez çalıştırılmaz. SQLite dosyalarını ve eski kullanıcı verilerini temizleme adımı yoktur.

Gerçek veriye geçmeden önce Android'de bu senaryoların native sonuçları alınmalı; ayrı development build/sandbox'ta süreç kimliğiyle izlenen cold restart ve COMMIT sırasında kontrollü süreç kaybı denenmeli; yeni dönem/arşiv ekranları ve kayıt sonrası yeniden açılış cihazda kontrol edilmelidir. iOS'taki 19/19 sonuç ve yeniden açılış kalıcılığı bu işlerin yerine geçirilmemelidir. Gerçek veritabanını yükseltecek akış için WAL uyumlu yedekleme, yedek doğrulama, hata sonrası v2'yi koruma/geri yükleme ve bilinmeyen sürüm davranışı ayrıca tasarlanıp izole native kopyalarda kanıtlanmalıdır. Şema v3'e yükseldikten sonra yalnız eski v2 uygulamayı açmak bir rollback yöntemi değildir.

Bu rapor gerçek kullanıcı verilerine migration izni veya üretim etkinleştirmesi vermez. 7D-2 için ayrıca onay beklenir.
