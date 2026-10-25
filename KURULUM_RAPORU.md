# Günlük Bütçem — Kurulum Raporu

Tarih: 25 Ekim 2026

Proje doğrudan mevcut `Günlük Bütçem` klasöründedir. İç içe proje klasörü oluşturulmadı. Başlangıçta klasör, gizli dosyalar dahil tamamen boştu.

| Araç / paket | Doğrulanan sürüm |
| --- | --- |
| Node.js | v24.4.0 |
| npm | 11.4.2 |
| create-expo-app | 5.0.0 |
| Expo | 58.0.19 — SDK 58 |
| React Native | 0.88.0 |
| React | 19.3.0 |
| TypeScript | 6.0.3 |
| Expo Router | 58.0.26 |
| ESLint | 9.39.5 — geliştirme bağımlılığı |
| eslint-config-expo | 58.0.4 — geliştirme bağımlılığı |

## Kurulum

İstenen `npx create-expo-app@latest .` komutu çalıştırıldı. Araç, mevcut klasör adındaki boşluk ve Türkçe karakterler URL uyumlu olmadığı için projeyi oluşturmayı reddetti. Klasörün adı değiştirilmedi.

Aynı klasöre `gunluk-butcem` adında geçici bir sembolik bağlantı üzerinden erişme denemesi de başarısız oldu. create-expo-app arşiv açıcı kodu, üst dizini sembolik bağlantı olan dosyaları güvenlik kontrolü nedeniyle atlıyor. Bu nedenle kök `package.json` dosyası açılmadı ve `ENOENT` hatası oluştu. Araç ayrıca bu hatanın metin olan kodunu `process.exit` çağrısına aktarırken `ERR_INVALID_ARG_TYPE` hatası verdi.

Bunun üzerine resmî şablon, çalışma klasörünün dışında geçici bir gerçek dizinde aşağıdaki komutla hazırlandı:

```sh
npx create-expo-app@latest /private/tmp/gunluk-butcem-init-XpzFKM/gunluk-butcem --template default@sdk-58 --no-install
```

Şablon dosyaları doğrudan mevcut klasöre aktarıldı. Geçici Git deposu ve Claude ayarları aktarılmadı. Bağımlılıklar mevcut klasörde `npm install` ile kuruldu ve `package-lock.json` oluşturuldu.

Kurulum aracının önerdiği SDK 58 seçildi. Araç, Expo Go ile öğrenme seçeneği için SDK 57 sundu; fiziksel cihazda açılış, kullanılan istemcinin SDK 58 desteğine veya uygun bir development build'e bağlıdır.

## Yapılandırma

- `package.json` teknik adı: `gunluk-butcem`.
- `app.json` görünen adı: `Günlük Bütçem`; slug: `gunluk-butcem`.
- Router giriş noktası: `expo-router/entry`; Expo Router eklentisi etkin.
- Dosya tabanlı rotalar: `src/app/`; ana yerleşim: `src/app/_layout.tsx`.
- `tsconfig.json`, `expo/tsconfig.base` yapılandırmasını genişletiyor ve `strict: true` kullanıyor.
- `@/*` yolu `src/*` dizinine, `@/assets/*` yolu `assets/*` dizinine bağlı.
- Expo başlatılınca `expo-env.d.ts` ve `.expo` tip dosyaları üretildi. Bu dosyalar `.gitignore` kapsamındadır.

İlk TypeScript kontrolünde CSS tip bildirimleri eksikti. Expo sunucusu tip dosyasını oluşturunca bu hatalar giderildi. Kalan hata, resmî şablondaki web sekme bileşeninin Router `ref` tipi ile React Native 0.88 `Pressable` tipi arasındaki uyumsuzluktu. `src/components/app-tabs.web.tsx` içindeki bileşen tipi, `Pressable` bileşeninin gerçek `ref` tipini kullanacak şekilde düzeltildi. Tip denetimi gevşetilmedi ve `any` kullanılmadı.

## Doğrulama sonuçları

| Kontrol | Sonuç |
| --- | --- |
| `npm install` | Başarılı; 565 paket kuruldu |
| `npm ls --depth=0` | Başarılı; eksik veya geçersiz doğrudan bağımlılık yok |
| `npx expo config --type public --json` | Başarılı |
| `npx tsc --noEmit` | Başarılı; çıkış kodu 0 |
| `npx --yes expo-doctor` | Başarılı; 20/20 kontrol geçti |
| Expo Metro sunucusunu başlatma | Başarılı |
| `http://localhost:8081/status` | HTTP 200; `packager-status:running` |
| `http://localhost:8081/` | HTTP 200; başlangıç sayfası HTML belgesi döndü |
| iOS paket üretimi | Başarılı; Hermes `.hbc` paketi üretildi |
| Android paket üretimi | Başarılı; Hermes `.hbc` paketi üretildi |
| Web paket üretimi | Başarılı; istemci ve sunucu paketleri üretildi |
| `npx expo lint` | Sonraki kullanıcı onayıyla yapılandırma tamamlandı; 0 hata, 0 uyarı |

Üç platformun paket üretiminde kullanılan komut:

```sh
npx expo export --platform ios --platform android --platform web --output-dir /private/tmp/gunluk-butcem-build-20261025
```

Web istemci dosyaları çıktı dizininin `client/_expo/static/js/web/` altında, sunucu dosyaları `server/_expo/` altında bulunur. Geçici kurulum dizini ve sembolik bağlantı kaldırıldı; paket çıktıları geçici çıktı dizininde bırakıldı.

Native doğrulama JavaScript/Hermes paket üretimi seviyesindedir. Fiziksel cihazda veya simülatörde çalıştırma, APK/IPA üretimi ve mağaza dağıtımı yapılmadı. Web doğrulaması HTTP yanıtı ve paket üretimi üzerinden yapıldı; tarayıcı arayüz etkileşimleri test edilmedi.

## Karşılaşılan ortam kısıtları ve açık bulgular

- İlk ağ denemesinde npm sunucusu çözümlenemedi. Ağ izniyle indirme başarılı oldu.
- Çevrimdışı npx yardım denemesinde npm önbelleğinde uygun kayıt bulunmadı (`ENOTCACHED`); kısıtlı ortamda npm günlük dizinine de yazılamadı. Yardım bilgisi indirilen aracın yerel dosyasından okundu.
- Expo yapılandırma komutu ilk denemede kullanıcı dizinindeki telemetri durum dosyasına yazamadı (`EPERM`). Test komutları `EXPO_NO_TELEMETRY=1` ile tekrar çalıştırıldı ve başarılı oldu. Proje ayarlarına bu ortam değişkeni eklenmedi.
- Kısıtlı ortamda süreç listeleme ve localhost bağlantısı engellendi. Sunucu başlatma ve HTTP kontrolleri izinli çalıştırma ile tamamlandı. `127.0.0.1` bağlantısı reddedilirken sunucunun dinlediği `localhost` adresi başarılı yanıt verdi.
- Metro işlemleri, ortamda `NO_COLOR` ile `FORCE_COLOR` birlikte tanımlı olduğu için renk uyarısı verdi; paket üretimi başarılı tamamlandı.
- Son dosya kontrolünde web çıktısı için yanlış dizin sorgulandığından `ENOENT` oluştu. Doğru `client/` ve `server/` çıktı yolları kontrol edilerek doğrulama tamamlandı.
- `npm audit --json`, 5 yüksek önem dereceli paket bulgusu bildirdi: `node-forge`, `zod` ve bu paketlerden etkilenen `@expo/code-signing-certificates`, `@expo/cli`, `expo`. Bulgular iki temel güvenlik bildiriminden bağımlılık zincirine yayılıyor. npm'nin önerdiği zorlayıcı çözüm Expo 44.0.6 sürümüne düşürmeyi içerdiği için uygulanmadı; bu bulgular açık kaldı.
- İlk lint denemesinde otomatik onay incelemesi, ESLint kurulumu ve yapılandırmasının açıkça yetkilendirilmediğini belirterek işlemi reddetti. Kullanıcı sonraki mesajında bu işlemi onayladı. Takip incelemesinin başında `eslint 9.39.5` ve `eslint-config-expo 58.0.4` zaten geliştirme bağımlılığı olarak kurulu bulundu; yeniden kurulum yapılmadan uyumlulukları doğrulandı. Resmî Expo ESLint yapılandırması oluşturuldu ve tema kancasındaki şablon hatası düzeltildi. Son lint, TypeScript ve Expo Doctor kontrolleri başarılıdır.

## Çalıştırma

Bu klasörde:

```sh
npm start
```

Web için `npm run web`, uyumlu mobil ortam hazır olduğunda `npm run ios` veya `npm run android` kullanılabilir. Test amaçlı başlatılan sunucu kontrollerin ardından durduruldu.

Uygulama özellikleri geliştirilmedi. Resmî başlangıç ekranları korundu. Global `expo-cli` kurulmadı; yerel Expo CLI kullanıldı. Güncel durumda ESLint ve resmî Expo ESLint yapılandırma paketi geliştirme bağımlılıkları arasındadır. `expo-doctor`, projeye bağımlılık olarak kaydedilmeden npx üzerinden çalıştırıldı.

ESLint kontrolleri ve 5 yüksek önem dereceli güvenlik bulgusunun paket, sürüm, bağımlılık zinciri, risk ve çözüm değerlendirmeleri [güncel güvenlik raporunda](GUVENLIK_RAPORU.md) yer alır. `npm audit --omit=dev` aynı 5 bulguyu üretmiştir; otomatik güvenlik düzeltmesi veya paket yükseltmesi uygulanmamıştır.

Kaynaklar: [create-expo-app ve resmî şablonlar](https://docs.expo.dev/more/create-expo/), [SDK 58 belgeleri](https://docs.expo.dev/versions/v58.0.0/), [Expo TypeScript yapılandırması](https://docs.expo.dev/guides/typescript/).
