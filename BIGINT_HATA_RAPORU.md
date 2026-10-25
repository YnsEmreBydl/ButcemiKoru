# iPhone / Hermes: Cannot convert BigInt to number

İnceleme: 25–26 Ekim 2026. Düzeltme yalnızca para biçimlendirme katmanındadır.

## Kesin kaynak ve kanıt

Hata, düzeltme öncesindeki `src/features/budget-setup/format.ts:10:37` çağrısındaydı:

```ts
const whole = wholeFormatter.format(absolute / 100n);
```

`absolute / 100n`, `bigint` döndürür. Bağlı iPhone'un Hermes çalışma zamanında `Intl.NumberFormat.format(123n)` çağrısı `TypeError: Cannot convert BigInt to number` üretti. Ardından uygulamanın gerçekten yüklenmiş `formatMinorTRY` fonksiyonu yalnızca sentetik `12345` kuruş ile çağrıldı; aynı hata oluştu. Metro symbolication cevabı doğrudan `format.ts`, satır **10**, sütun **37** olarak eşlendi. [Cihazdan alınan, kişisel veri içermeyen kanıt](raporlar/bigint-hermes-oncesi.json).

Mevcut Metro süreçleri incelendi: log çıkışları dosyaya değil terminallere bağlıydı; geçmiş terminal çıktısına erişilemedi. LogBox'ta ilk kullanıcı etkileşiminin render stack'i bulunamadı. Bunun yerine bağlı iPhone'da aynı yüklü fonksiyonla hata yeniden üretildi ve yeni stack kaynak satırına eşlendi. Rapordaki stack, bu kontrollü tekrarın stack'idir.

Tanılama uygulamaya kalıcı kod eklemeden Metro'nun inspector/CDP bağlantısından yapıldı. `HermesInternal` ve React Native platform modülüyle **Hermes + iOS** doğrulandı. Form state'ine ve SQLite kayıtlarına erişilmedi. Tanılama sonuçlarına gerçek tutarlar veya cihaz adı dahil edilmedi. Yalnızca sentetik örnekler, hata türü ve ilgili kaynak stack'i raporlandı; debugger bağlantıları kapatıldı. Bu yöntem JavaScript'i Node/Chrome'a taşımadan cihazdaki Hermes üzerinde çalıştırır. [Expo Hermes debugger açıklaması](https://docs.expo.dev/guides/using-hermes/).

## Node testleri neden geçiyordu?

Node 24.4.0 / V8 13.6, `Intl.NumberFormat.format(123n)` girdisini kabul ederek `123` döndürüyor. Mevcut testler standart Node `Intl` uygulamasıyla çalıştığından bu uyumsuzluğu yakalamadı. Aynı çağrı bağlı iPhone/Hermes'te hata verdi. Hermes'in [Intl kaynak kodunda](https://github.com/facebook/hermes/blob/static_h/lib/VM/JSLib/Intl.cpp#L1260-L1279) da NumberFormat'ın `toNumber_RJS` kullandığı ve Intl BigInt sınırı açıkça görülüyor. Genel BigInt aritmetiği ile Intl'in BigInt kabul etmesi ayrı yeteneklerdir.

İlgili akış da incelendi:

- `calculateBudget` iç işlemlerde `bigint` kullanır; sonuçlar `money.ts / checkedMinor` üzerinden sınır kontrolüyle güvenli tam sayı `number` olarak çıkar. Buradaki kontrollü `Number()` dönüşümü hata kaynağı değildir.
- `preview.ts` mevcut motorun sonucunu taşır. `preview-result.tsx` bu sayıları görüntülemek için `formatMinorTRY` çağırır; erişilebilirlik etiketi de aynı yardımcıyı kullanır.
- Eski formatter güvenli `number` girdisini tekrar BigInt'e çevirip lira kısmını Intl'e BigInt olarak veriyordu. Hata render aşamasında bundan çıkıyordu.
- Bu akışta BigInt'i `Math` fonksiyonuna veya React Native köprüsüne veren başka bir çağrı saptanmadı. Motor, form adaptörü ve render bileşeni değiştirilmedi.

## Değişiklik ve hassasiyet

[format.ts](src/features/budget-setup/format.ts) artık sabit Türkçe para görünümü için lira basamaklarını doğrudan grupluyor:

```ts
const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fraction = (absolute % 100n).toString().padStart(2, '0');
```

`Number.isSafeInteger` giriş kontrolü korunur. Bölüm ve kalan tam BigInt aritmetiğidir; basamaklar metne çevrilir. BigInt → Number dönüşümü, ondalıklı lira hesabı veya yuvarlama eklenmedi. Eksi işareti, ₺, binlik nokta ve iki haneli kuruş görünümü korunur. Ortak yardımcı kullanıldığı için ön izleme, kayıtlı ana ekran ve düzenleme formu da bu düzeltmeyi alır.

Örnek hassasiyet kontrolü: `9.007.199.254.740.991` kuruş → `₺90.071.992.547.409,91`. Hem pozitif hem negatif güvenli tam sayı sınırında görüntülenen metin yeniden ayrıştırıldığında özgün kuruşla eşit çıktı. Kontrol, bir kuruş ve binlik geçişlerini de kapsadı.

`calculateBudget`, `money.ts`, takvim, SQLite şeması/repository'si, bağımlılıklar ve Expo/React Native/Hermes sürümleri değişmedi. Veritabanı sıfırlanmadı; kayıtlar okunarak değiştirilmedi veya silinmedi.

## Test sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Yeni testler, düzeltme öncesi | Önceki **190 geçti**, yeni **2 test aynı TypeError ile başarısız**; çıkış 1. |
| `npm test`, düzeltme sonrası | **192/192 geçti**, 0 hata, 0 atlanan/iptal; çıkış 0. |
| `npx tsc --noEmit` | Hatasız, çıkış 0. |
| `npx expo lint` | 0 hata, 0 uyarı; çıkış 0. |
| `npx expo-doctor` | **20/20 geçti**, çıkış 0. |
| Bağlı iPhone / Expo Go / Hermes | Gerçek yüklü formatter ile **9/9 sentetik gösterim ve kuruş dönüşü** hatasız; sentetik bütçe ön izlemesi de başarılı. |

Yeni `format-hermes.test.ts`, gerçek derlenmiş formatter'ı BigInt reddeden bir Intl sınırıyla izole Node VM'de çalıştırır. Bu bir **uyumluluk mock'udur**, Hermes emülatörü değildir. İlk test, motorla oluşturulan örnek ön izlemenin gösterilecek para alanlarını doğrular; ikinci test kuruş/binlik sınırlarını ve güvenli tam sayı uçlarını kontrol eder. Önce kırmızı, sonra yeşil sonuç alınması regresyonun yakalandığını gösterir. Önceki 190 testin kaynakları değişmedi; eski rapordaki 190 test adı yeni başarılı sonuçlarda da bulundu.

Gerçek iPhone'da yüklü uygulama modülleri ayrıca çağrıldı; bu kontrol Node mock'undan bağımsızdır. Sentetik örnekte 25 Ekim → 4 Kasım, 10 gün; 10.000 TL bakiye − 2.000 TL fatura − 1.000 TL birikim = 7.000 TL harcanabilir, günlük 700 TL çıktı. Bu tarih sabit test girdisidir; güncel tarih varsayılmaz.

**Kapsam sınırı:** Cihaz doğrulaması formatter ve saf ön izleme fonksiyonlarına aittir. Formu elle doldurup düğmeye dokunmayı, SQLite kaydını, uygulama yeniden açılışını veya tüm iOS arayüzünü uçtan uca test ettiğimiz anlamına gelmez. Android'de gerçek runtime testi yapılmadı. Yeni web/native export veya APK/IPA derlemesi bu küçük düzeltme için çalıştırılmadı.

Kanıtlar: [kırmızı regresyon](raporlar/bigint-regresyon-oncesi.txt), [son testler](raporlar/bigint-test-sonuclari.txt), [iPhone önce](raporlar/bigint-hermes-oncesi.json), [iPhone sonra](raporlar/bigint-hermes-sonrasi.json), [TypeScript](raporlar/bigint-typescript.txt), [ESLint](raporlar/bigint-eslint.txt), [Doctor](raporlar/bigint-expo-doctor.txt). Sessiz TypeScript/ESLint çıktı dosyaları boştur; komutlar çıkış 0 ile bitti. Node SQLite testlerinin deneysel API uyarısı devam eder.

Önceki audit'teki 5 yüksek bulgu bu değişiklikle giderilmiş sayılmıyor. Bağımlılıklar değişmedi; bu görevde audit veya audit fix yeniden çalıştırılmadı.

## iPhone'da tekrar test

1. Mevcut Metro sunucusunu kullanın. Expo Go içinde açık projede geliştirici menüsünden **Reload** seçin; uygulama verilerini temizlemeyin ve uygulamayı kaldırmayın. Gerekirse Metro terminalinde `r` ile yenileyin. Yenileme, kaydedilmemiş form taslağını kaybettirebilir; kayıtlı SQLite bütçesini silmez.
2. Bütçe kurulumunu/düzenlemeyi açın. Gerçek bütçenizi değiştirmemek için sentetik kontrolü **kaydetmeden** yapın.
3. Bakiye `10.000,00`, birikim `1.000,00`, sonraki maaş tarihi bugünden **10 takvim günü sonrası**, fatura `2.000,00` ve tarihi bugünden **2 gün sonrası** olsun.
4. **Ön izlemeyi hesapla** düğmesine dokunun. Render Error çıkmamalı; günlük `₺700,00`, toplam harcanabilir `₺7.000,00`, kalan süre `10 gün` görünmeli.
5. `0,01` gibi kuruşlu ve negatif bakiye girdileriyle de ön izleyin; kuruşlar ve bütçe açığı korunmalı. Tam güvenli sınır testini isterseniz faturaları kaldırıp birikimi boş bırakarak `90.071.992.547.409,91` bakiyesiyle ön izleyin; rezervler eklendiğinde motorun toplam sınır denetimi ayrı bir hata üretebilir.
6. Kontrol sonunda **kaydetmeden** çıkın. Bu işlem mevcut kayıtlı bütçenizi değiştirmez. Yeni hata olursa yalnızca hata mesajı, fonksiyon/dosya/satır bilgisi paylaşın; finansal girdiler gerekli değildir.

## Dosyalar

- Güncellenen uygulama kodu: `src/features/budget-setup/format.ts`.
- Yeni test: `tests/budget-setup/format-hermes.test.ts`.
- Belgeler: `README.md`, `BIGINT_HATA_RAPORU.md`.
- Yeni kanıtlar: `raporlar/bigint-regresyon-oncesi.txt`, `raporlar/bigint-test-sonuclari.txt`, `raporlar/bigint-hermes-oncesi.json`, `raporlar/bigint-hermes-sonrasi.json`, `raporlar/bigint-typescript.txt`, `raporlar/bigint-eslint.txt`, `raporlar/bigint-expo-doctor.txt`.
