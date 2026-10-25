# Günlük Bütçem — ESLint ve Güvenlik İnceleme Raporu

İnceleme tarihi: 25 Ekim 2026, Europe/Istanbul.

ESLint yapılandırması tamamlandı. Son lint ve TypeScript kontrolleri hatasız, Expo Doctor 20/20 başarılıdır. Tam bağımlılık taraması ve geliştirme bağımlılıkları hariç tarama aynı 5 yüksek önem dereceli paket bulgusunu döndürdü. Bu bulgular açık kaldı; herhangi bir güvenlik düzeltmesi veya paket yükseltmesi uygulanmadı.

## ESLint sürümleri ve yapılandırma

Bu görev başında `eslint 9.39.5` ve `eslint-config-expo 58.0.4` hem `devDependencies` altında hem de `node_modules` içinde zaten mevcuttu. Yeniden kurulum veya sürüm değiştirme yapılmadı. Çalışan kurulum doğrulandı ve eksik yapılandırma tamamlandı.

| Paket | package.json aralığı | Kurulu sürüm | Expo 58 uyumluluk kanıtı |
| --- | --- | --- | --- |
| `eslint` | `^9.39.5` | `9.39.5` | Kurulu Expo CLI'nin `ESlintPrerequisite.js` dosyası `^9.0.0` istiyor. |
| `eslint-config-expo` | `~58.0.4` | `58.0.4` | `expo/bundledNativeModules.json`, `~58.0.4` tanımlıyor; paketin ESLint eş bağımlılığı `>=8.10`. |

Oluşturulan `eslint.config.js`, kurulu Expo CLI'nin `static/template/eslint.config.js` şablonuyla birebir aynıdır. `eslint-config-expo/flat` yapılandırmasını genişletir. Kural kapatma veya güvenlik denetimini azaltan istisna eklenmedi. Bu, [Expo'nun resmî ESLint kurulum yaklaşımıdır](https://docs.expo.dev/guides/using-eslint/).

İlk lint çalıştırması, `src/hooks/use-color-scheme.web.ts` içinde `react-hooks/set-state-in-effect` hatası buldu. Şablon, `useEffect` içinde eşzamanlı `setState` çağırıyordu. Bu kısım `useSyncExternalStore` ile düzeltildi: sunucuda ve ilk hidrasyonda açık tema, istemci hazır olduğunda sistem teması kullanılmaya devam eder. React'in [sunucu görüntüsü ve hidrasyon davranışı](https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering) esas alındı. Uygulama özelliği eklenmedi.

## Çalıştırılan kontroller

| Komut | Çıkış kodu | Sonuç |
| --- | --- | --- |
| `npx expo lint` — ilk çalışma | 1 | Şablondaki tema kancasında 1 hata bulundu. |
| `npx expo lint` — düzeltme sonrası | 0 | 0 hata, 0 uyarı. |
| `npx tsc --noEmit` — düzeltme sonrası | 0 | TypeScript hatası yok. |
| `npx expo-doctor` | 0 | 20/20 kontrol başarılı. |
| `npx expo export --platform web --output-dir /private/tmp/gunluk-butcem-eslint-web-check` | 0 | Web istemci ve sunucu paketleri üretildi. |
| `npm audit --json` | 1 | 5 yüksek; 0 kritik, orta veya düşük. |
| `npm audit --omit=dev --json` | 1 | Aynı 5 yüksek; 0 kritik, orta veya düşük. |

Expo komutlarında yalnızca süreç bazında `EXPO_NO_TELEMETRY=1` kullanıldı. Bu ayar proje dosyalarına eklenmedi. Audit komutlarının 1 koduyla bitmesi taramanın bulgu üretmesinden kaynaklanır; ağ veya JSON okuma hatası oluşmadı. npm'nin [audit davranışı ve çıkış kodları](https://docs.npmjs.com/cli/v11/commands/npm-audit/) bunu açıklar.

Ham kanıtlar:

- [Tam audit JSON raporu](raporlar/npm-audit-tam.json)
- [Üretim audit JSON raporu](raporlar/npm-audit-uretim.json)
- [Güncel npm paket metadata sorguları](raporlar/npm-paket-metadata.json)

## Bulguların bağımlılık zinciri

Kurulu sürümler ve bildirilen bağımlılık aralıkları `package-lock.json` ile yerel paket dosyalarından doğrulandı:

```text
gunluk-butcem@1.0.0
└── expo@58.0.19
    └── @expo/cli@58.1.15                 [expo'nun isteği: ^58.1.15]
        ├── node-forge@1.4.0             [^1.4.0]
        ├── @expo/code-signing-certificates@0.0.7 [^0.0.7]
        │   └── node-forge@1.4.0         [^1.4.0; aynı kurulu paket]
        └── zod@3.25.76                  [^3.25.76]
```

Audit'in 5 sayısı, 5 ayrı kök güvenlik açığı anlamına gelmiyor. İki temel güvenlik bildirimi var: `node-forge` ve `zod`. Bunlara bağımlı `@expo/code-signing-certificates`, `@expo/cli` ve `expo` da etkilenmiş paket olarak sayılıyor. npm bu yayılımı [meta-vulnerability hesaplaması](https://docs.npmjs.com/cli/v11/commands/npm-audit/#calculating-meta-vulnerabilities-and-remediations) olarak açıklıyor.

### 1. node-forge — 1.4.0

**Zincir:** `gunluk-butcem → expo@58.0.19 → @expo/cli@58.1.15 → node-forge@1.4.0`. İkinci yol: aynı CLI → `@expo/code-signing-certificates@0.0.7 → node-forge@1.4.0`.

**Güvenlik bildirimi:** [GHSA-86w9-cpqp-85rv / CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Etkilenen aralık `<=1.4.0`; npm audit CVSS v3.1 puanı 7.5, önem derecesi yüksek.

**Risk:** RSA PKCS#1 v1.5 imza doğrulamasında iç içe `DigestAlgorithm` öğelerinin sayısı yeterince doğrulanmıyor. Düşük üs değerli RSA anahtarları ve saldırganın hazırladığı imzalar gibi gerekli koşullar sağlandığında sahte imzaların kabul edilmesi, dolayısıyla bütünlük kaybı mümkün.

**Bu projedeki kullanım:** Yerel kod incelemesinde `@expo/code-signing-certificates/build/main.js`, sertifika doğrulamak için `certificate.verify(...)` ve imza doğrulamak için `certificate.publicKey.verify(...)` kullanıyor. Bu, ilgili API ailesinin araç zincirinde bulunduğunu gösteriyor; mevcut projede istismarın gerçekleştirilebildiği kanıtlanmış değil.

**Önerilen çözüm:** İnceleme sırasında npm'de en güncel kararlı sürüm hâlâ `1.4.0`; güvenlik kaydı yayımlanmış düzeltilmiş sürüm göstermiyor. [Bakımcı deposunda düzeltme çalışması](https://github.com/digitalbazaar/forge/pull/1152) bulunuyor, ancak PR'ı bir yayımlanmış sürüm gibi kullanmak uygun değil. Resmî düzeltme yayımlandıktan sonra Expo 58 ile uyumlu, hedefli bağımlılık güncellemesi değerlendirilmelidir. O zamana kadar imza doğrulama işlemlerine güvenilmeyen sertifika/anahtar girdileri vermemek geçici bir risk azaltma adımıdır; açığı ortadan kaldırmaz.

### 2. zod — 3.25.76

**Zincir:** `gunluk-butcem → expo@58.0.19 → @expo/cli@58.1.15 → zod@3.25.76`.

**Güvenlik bildirimi:** [GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Audit aralığı `<4.6.6`; bu nedenle kurulu `3.25.76` da bildirilen kapsama giriyor. npm audit CVSS v3.1 puanı 7.5, önem derecesi yüksek.

**Risk:** Büyük, hatalı koleksiyonlar doğrulanırken çok fazla hata nesnesi biriktirilebilir. Saldırganın denetimindeki yeterince büyük veri bu işleme ulaşırsa bellek tükenmesi ve hizmetin durması mümkün.

**Bu projedeki kullanım:** Expo CLI'nin `DevToolsPlugin.schema.js` dosyasında dizi şemaları bulunuyor. `DevToolsPluginCliExtensionResults.js` ve `MCPDevToolsPluginCLIExtensions.js`, eklenti çıktısını `safeParse` ile doğruluyor. Bu kullanım, DevTools/MCP süreçlerinde olası bir kaynak tüketimi yüzeyi gösterir; dışarıdan bir saldırganın bu girdilere ulaşabildiği bu incelemede kanıtlanmadı.

**Önerilen çözüm:** Güvenlik kaydı `4.6.6` sürümünü düzeltme olarak gösteriyor; sorgu tarihinde en güncel kararlı sürüm `4.6.7`. [Bakımcının v4 düzeltmesi](https://github.com/colinhacks/zod/pull/6652) koleksiyon boyutlarını öğeleri işlemeden önce kontrol ediyor. Fakat kurulu CLI `^3.25.76` istediğinden v4 bu aralığın dışında kalıyor. CLI'nin düzeltilmiş Zod sürümünü destekleyen resmî bir sürümü veya v3 için doğrulanmış bir geri taşıma çözümü gereklidir. Zod'u köke eklemek, CLI'nin iç bağımlılığını mutlaka değiştirmez; zorlayıcı override da uyumluluk kanıtı olmadan uygulanmamalıdır.

### 3. @expo/code-signing-certificates — 0.0.7

**Zincir:** `gunluk-butcem → expo@58.0.19 → @expo/cli@58.1.15 → @expo/code-signing-certificates@0.0.7 → node-forge@1.4.0`.

**Risk:** Bu pakete özgü üçüncü bir güvenlik bildirimi yok. Bulgu, yukarıdaki `node-forge` imza doğrulama riskinden geliyor. Paket, kod imzalama için sertifika ve anahtar doğrulama işlevleri sağlıyor; Expo CLI'nin `utils/codesigning.js` dosyası `validateSelfSignedCertificate` işlevini çağırıyor. Etkilenen işlemler, gerekli saldırı koşulları sağlanırsa sertifika/imza bütünlüğünü riske atabilir.

**Önerilen çözüm:** `node-forge` düzeltmesini içeren resmî bir sertifika paketi/CLI güncellemesini Expo 58 uyumluluğu ve kod imzalama kontrolleriyle birlikte değerlendirmek. Güncel npm sorgusunda sertifika paketinin son kararlı sürümü de `0.0.7`. Audit'teki `fixAvailable: true`, tek başına mevcut ağaç için güvenli ve sürüm koruyan bir çözümün kanıtı değildir; belirli bir hedef sürüm belirtmiyor.

### 4. @expo/cli — 58.1.15

**Zincir:** `gunluk-butcem → expo@58.0.19 → @expo/cli@58.1.15`. Alt yollar `node-forge`, `@expo/code-signing-certificates → node-forge` ve `zod` şeklindedir.

**Risk:** CLI, iki temel bildirimin etkisini birlikte taşıyor: kod imzalama doğrulamasında bütünlük riski ve DevTools doğrulamasında bellek tükenmesi riski. Bu satır CLI'ye ait bağımsız yeni bir CVE anlamına gelmiyor. Araçların bulunması, bu iki açığın mobil uygulama kullanıcılarına otomatik olarak açık olduğu anlamına da gelmiyor; saldırı girdisinin ilgili çalıştırılan yola ulaşması gerekir.

**Önerilen çözüm:** Her iki alt bağımlılığı düzelten, Expo 58 ile uyumlu resmî CLI sürümüne hedefli geçiş. Sorgu tarihinde son kararlı CLI `58.1.15`; kurulu sürümle aynı. Audit kök çözüm olarak `expo@44.0.6` ve ana sürüm değişikliği öneriyor. Bu öneri mevcut Expo 58/React Native 0.88 kurulumu için uygun bir düzeltme olarak kabul edilmedi ve uygulanmadı.

### 5. expo — 58.0.19

**Zincir:** `gunluk-butcem → expo@58.0.19 → @expo/cli@58.1.15 → yukarıdaki etkilenen alt bağımlılıklar`.

**Risk:** Doğrudan proje bağımlılığı olan Expo, CLI üzerinden iki temel bildirimin etkisini devralıyor. Bu satır Expo'nun mobil çalışma zamanında ayrı bir güvenlik açığı tespit edildiğini göstermez. Yine de bağımlılık ağacının güvenlik açısından temiz olduğunu söylemek mümkün değil.

**Önerilen çözüm:** İlgili alt bağımlılıkları düzelten bir Expo 58 bakım sürümünü veya resmî olarak desteklenen hedefli çözümü izlemek ve kullanıcı onayıyla değerlendirmek. Güncel npm sorgusunda son kararlı Expo `58.0.19`; bu inceleme kapsamında hazır bir kararlı Expo güncellemesiyle iki bildirimin kaldırılabildiği doğrulanamadı. Audit'in `44.0.6` önerisi gereksinim olan SDK 58'i korumaz.

## Üretim bağımlılıkları sonucu

**Evet, `npm audit --omit=dev` üretim bağımlılık ağacında da aynı 5 yüksek önem dereceli bulguyu bildiriyor.** Beş paketin de kilit dosyasındaki `dev` işareti yok/false. Bunun nedeni, `expo` paketinin normal bir bağımlılık olarak CLI'yi, CLI'nin de bu alt paketleri getirmesi. Dolayısıyla ESLint'i geliştirme bağımlılığı olarak tutmak bu bulguları kaldırmıyor; ESLint ekosisteminde bu taramada ek bir güvenlik bulgusu raporlanmadı.

Bu sonuç npm bağımlılık sınıflandırmasıyla ilgilidir. Native APK/IPA içine hangi modüllerin girdiği ve saldırgan girdilerinin bu kodlara ulaşıp ulaşmadığı ayrı bir inceleme konusudur. Bu çalışma native ikili üzerinde erişilebilirlik analizi, sızma testi veya istismar denemesi içermiyor. Yerel kod incelemesinde görülen kullanım yolları yukarıda açıkça belirtildi.

## Korunan proje durumu

Görev başındaki anlık görüntüyle karşılaştırmada `package.json` ve `package-lock.json` içerikleri değişmedi. Mevcut uygulama yapılandırması, TypeScript yapılandırması ve diğer `src/` dosyaları korundu. Kaynak kodundaki tek değişiklik web tema kancasının lint düzeltmesidir; yeni `eslint.config.js` ve rapor dosyaları eklendi.

`npm audit fix`, `npm audit fix --force`, toplu yükseltme, bağımlılık override'ı veya global Expo CLI kurulumu yapılmadı. Güvenlik bulgularını gizlemek için önem eşiği değiştirilmedi. Audit'in ham çıktıları aynen saklandı. Güvenlik düzeltmesi için gelecekte yapılacak paket değişiklikleri bu rapordaki önerilerdir; bu görevde uygulanmış işlemler değildir.
