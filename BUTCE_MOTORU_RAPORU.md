# Günlük Bütçem — Bütçe Hesaplama Motoru

Tarih: 25 Ekim 2026. Ortam: Node.js 24.4.0, npm 11.4.2, TypeScript 6.0.3, Expo 58.0.19.

`src/domain/budget/` altında bağımsız hesaplama modülü ve Node'un yerleşik test araçlarıyla otomatik testler oluşturuldu. Ana ekran, DEMO verileri, görsel bileşenler ve Expo Router rotaları değiştirilmedi. Veritabanı, API, üyelik, ödeme sistemi veya yeni ekran eklenmedi.

## Değişen ve eklenen dosyalar

| Dosya | İşlem ve görev |
| --- | --- |
| `src/domain/budget/index.ts` | Eklendi; genel API. |
| `src/domain/budget/types.ts` | Eklendi; salt okunur girdi, sonuç ve simülasyon tipleri. |
| `src/domain/budget/calculate-budget.ts` | Eklendi; bütçe ve değişiklik yapmayan harcama simülasyonu. |
| `src/domain/budget/calendar.ts` | Eklendi; katı tarih doğrulama, açık saat dilimi ve takvim günleri. |
| `src/domain/budget/money.ts` | Eklendi; kuruş doğrulama ve hassasiyet kaybını engelleyen tam aritmetik. |
| `src/domain/budget/currencies.ts` | Eklendi; genişletilebilir, çalışma anında da değiştirilemeyen TRY kaydı. |
| `src/domain/budget/validation.ts` | Eklendi; girdi, kimlik, kronoloji ve fatura kapatma doğrulamaları. |
| `src/domain/budget/errors.ts` | Eklendi; alan ve kod taşıyan hatalar. |
| `src/domain/budget/README.md` | Eklendi; API sözleşmesi ve ayrıntılı matematik. |
| `tests/budget/calculate-budget.test.ts` | Eklendi; finansal hesap, simülasyon, ödeme ve dağıtım testleri. |
| `tests/budget/calendar.test.ts` | Eklendi; ay sonu, artık yıl, gece yarısı ve DST testleri. |
| `tests/budget/validation.test.ts` | Eklendi; geçersiz giriş ve taşma testleri. |
| `tests/budget/fixtures.ts` | Eklendi; bağımsız test örnekleri ve dondurma yardımcısı. |
| `tests/budget/node-env.d.ts` | Eklendi; kurulu Node tip bildirimlerine açık referans. |
| `scripts/test-budget.mjs` | Eklendi; geçici derleme, Node testleri ve çıktı temizliği. |
| `tsconfig.budget-tests.json` | Eklendi; yalnızca motor ve testler için ayrı derleme ayarı. |
| `package.json` | Yalnızca `npm test` komutu eklendi; bağımlılıklar aynı. |
| `README.md` | Güncel aşama, test komutu ve modül bağlantıları eklendi. |
| `BUTCE_MOTORU_RAPORU.md` | Bu rapor eklendi. |
| `raporlar/butce-test-sonuclari.txt` | İstanbul saat diliminde tam test çıktısı. |
| `raporlar/butce-test-new-york.txt` | New York saat diliminde tam test çıktısı. |
| `raporlar/butce-test-auckland.txt` | Auckland saat diliminde tam test çıktısı. |
| `raporlar/butce-ornek-sonuclar.json` | Doğrudan motordan üretilen örnek girdiler ve sonuçlar. |

Görev başındaki dosya özetleriyle mevcut `src/` dosyaları karşılaştırıldı: arayüz ve eski yardımcı dosyalar aynı. `package-lock.json`, `app.json`, ana `tsconfig.json` ve ESLint ayarı değişmedi. Bağımlılık kurulmadı, paket yükseltilmedi ve `npm audit fix` çalıştırılmadı.

## Hesaplama kuralları

Tüm parasal girdiler ve sonuçlar güvenli tam sayı kuruştur. Toplama, çıkarma, bölme ve kalan hesapları içeride `bigint` ile yapılır. Çıktı `number` güvenli sınırını aşarsa hata üretilir; yuvarlanmış veya hassasiyeti kaybolmuş sonuç döndürülmez. Biçimlendirme motorda yapılmaz.

Kalan bakiye, başlangıç bakiyesinden yalnızca başlangıç anından sonraki gerçekleşen çıkışların düşülmesiyle bulunur. Harcanabilir tutar bu bakiyeden açık faturalar ve birikim hedefi çıkarılarak bulunur. Negatif değer korunur; bütçe açığı ayrıca pozitif tutar olarak raporlanır.

Başlangıç bakiyesinin anı dahil olmak üzere eski harcamalar zaten bakiyeye dahildir. Geriye dönük girilen hareketlerde veri giriş anı yerine gerçek gerçekleşme anı kullanılır. Eski bir fatura ödemesi de yeniden düşülmez ama faturanın kapalı olduğunu belirlemeye devam eder.

Fatura kapatılırken gerçek ödeme çıkışı bakiyeden düşer ve o faturanın rezervi kaldırılır. Tam tahmini tutarda ödeme harcanabilir parayı ikinci kez azaltmaz. Tahminle gerçek ödeme arasındaki fark günlük hedefi etkiler. Aynı fatura ikinci kez kapatılırsa veya hareket kimliği tekrarlanırsa girdi hata ile reddedilir.

Takvim, açık `asOf` ve `timeZone` girdileriyle çalışır. Gün farkı saat farkına bölünmez. Bugün dahil, maaş günü hariçtir. Maaş bugün veya geçmişteyse yeni dönem gereksinimi açıkça döner; günlük alanlar `null` olur, tarih kaydırılmaz ve maaş geliri varsayılmaz.

Aktif dönemde günlük değerler:

1. **Güncel eşit öneri:** Pozitif harcanabilir para / bugün dahil kalan gün; aşağı yuvarlanır.
2. **Bugünün başlangıç hedefi:** Bugünün yeni hareketleri olmadan oluşturulan harcanabilir tutar / aynı gün sayısı; aşağı yuvarlanır.
3. **Bugünkü kalan:** Başlangıç hedefi − bugünkü net bütçe etkisi. Negatif hedef aşımı korunur; pozitif tutar mevcut pozitif harcanabilir parayı aşamaz.
4. **İleri günlük ortalama:** Bugünkü pozitif kalan ayrıldıktan sonra kalan para / yarından itibaren kalan günler. Son bütçe gününde bu alan `null` olur.

İlk ve ikinci öneri farklı amaçlıdır; birbirine eklenerek kullanılmaz. Bölmeden kalan kuruşlar ayrıca döner. Örneğin 100 TL / 3 gün = günde 33,33 TL ve dağıtılmamış 1 kuruş; üç güne toplam 100,02 TL dağıtılmaz.

Tam formüller, hata kodları, parametreler ve sözleşme: [modül dokümantasyonu](src/domain/budget/README.md).

## Gerçek test sonuçları

| Çalıştırma | Sonuç |
| --- | --- |
| `TZ=Europe/Istanbul npm test` | 82/82 geçti; 0 başarısız, 0 atlanan, 0 iptal. |
| `TZ=America/New_York npm test` | 82/82 geçti; 0 başarısız, 0 atlanan, 0 iptal. |
| `TZ=Pacific/Auckland npm test` | 82/82 geçti; 0 başarısız, 0 atlanan, 0 iptal. |
| `npx tsc --noEmit` | Son çalışma başarılı; çıkış kodu 0. |
| `npx expo lint` | Başarılı; 0 hata, 0 uyarı. |
| `npx expo-doctor` | Başarılı; 20/20 kontrol. |

82 benzersiz test üç işletim sistemi saat diliminde çalıştırıldı; bu üç son çalışmada toplam 246 test geçişi vardır. Testlerde kullanılan bütçe saat dilimleri ayrıca İstanbul, New York, Kathmandu ve UTC gibi açık değerlerdir. İşletim sistemi saat dilimi değiştirilince sonuçların bozulmadığı doğrulandı.

Node V8 kapsam raporu, derlenmiş domain JavaScript kodunda **%99,45 satır**, **%98,55 dal**, **%96,55 fonksiyon** kapsamı bildirdi. Hesaplama çekirdeğinin satır ve dal kapsamı %100'dür. Bu oran bütün olası finansal davranışların ispatı değildir; özellikle yerleşik `Intl`/saat dilimi veritabanı kodunu veya UI davranışlarını kapsamaz.

İlk ana TypeScript kontrolü, Expo'nun tip kapsamında `node:test` ve `node:assert/strict` otomatik görünmediğinden başarısız oldu. Zaten kurulu Node tiplerini referanslayan `tests/budget/node-env.d.ts` eklenince bu hata ve buna bağlı tip daraltma hataları giderildi. Yeni paket yüklenmedi. Ayrı test derlemesi de testler çalışmadan önce tip denetimi yapar.

İstenen 14 senaryonun tamamı kapsandı: normal bütçe, gider olmaması, bütçe aşımı, sıfır bakiye, bugün/geçmiş maaş tarihi, ay sonları, şubat/artık yıl, DST, çoklu günlük harcama, mükerrer fatura, kuruş dağıtımı, başlangıç bakiyesinde çift sayım ve simülasyonun girdiyi değiştirmemesi. Ek olarak bilinmeyen fatura, vadesi geçmiş fatura, rezerv/tutar farkı, UTC ile yerel gün ayrımı, tekrar eden DST saati, taşma, geçersiz ve eksik girişler test edildi.

## Motordan üretilen örnek sonuçlar

Aşağıdaki tutarlar yalnızca rapor için TL biçiminde gösterilmiştir. Ham motor sonuçlarının birimi kuruştur. Örnekler [JSON çıktısında](raporlar/butce-ornek-sonuclar.json) girdi ve sonuçlarıyla saklanır.

**Normal senaryo:** Başlangıç bakiyesi 10.000 TL; eski güne ait yeni harcama 1.000 TL, bugünkü harcama 500 TL; bekleyen fatura 2.000 TL; birikim 1.000 TL; maaşa 10 gün.

| Çıktı | Sonuç |
| --- | --- |
| Harcamalardan sonraki hesap bakiyesi | ₺8.500,00 |
| Fatura rezervi | ₺2.000,00 |
| Birikim rezervi | ₺1.000,00 |
| Harcanabilir tutar | ₺5.500,00 |
| Güncel eşit günlük öneri | ₺550,00 |
| Bugünün başlangıç hedefi | ₺600,00 |
| Bugünkü hedeften kalan | ₺100,00 |
| Yarından itibaren 9 gün için ortalama | ₺600,00 |

**Aynı faturanın ödenmesi:** Normal senaryodaki 2.000 TL fatura bugün ödenirse hesap bakiyesi 6.500 TL, fatura rezervi sıfır olur. Harcanabilir tutar **5.500 TL** kalır. Fatura ikinci kez harcanabilir tutardan düşülmez.

**Harcama simülasyonu:** Normal senaryoda ek 800 TL harcama varsayılırsa bakiye 7.700 TL, harcanabilir tutar 4.700 TL, bugünkü hedefin kalanı −700 TL ve yarından itibaren ortalama 522,22 TL olur. Bugünkü başlangıç hedefi 600 TL olarak korunur. İlk girdi ve mevcut sonuç değişmez. Bu çıktı bir satın alma güvenliği onayı değildir.

**Bütçe aşımı:** Başlangıç 1.000 TL, yeni harcama 1.500 TL, başka rezerv yok ve maaşa 10 gün ise kalan bakiye −500 TL ve bütçe açığı 500 TL'dir. Güncel pozitif günlük öneri sıfırdır. Bugünün başlangıç hedefi 100 TL olduğu için bugünkü hedefin kalanı −1.400 TL'dir; bu değer hesap bakiyesiyle aynı kavram değildir.

**Gider olmaması:** 10.000 TL bakiye, rezerv/birikim/harcama yok ve maaşa 10 gün olduğunda öneri, başlangıç hedefi ve ileri ortalama 1.000 TL'dir.

**Maaş bugün/geçmişte:** Maaş bugünse gün sayısı 0 ve `payday-today`; bir gün önceyse −1 ve `payday-passed` döner. Her iki durumda `requiresNewPeriod: true`, `daily: null` olur. Bir sonraki aya sessiz tarih taşıma yapılmaz.

## Çalıştırılmayanlar ve kalan sınırlar

Hesaplama motoru bu aşamada özellikle UI'ye bağlanmadı. Native cihaz/simülatör üstünde motor entegrasyonu, uygulama uçtan uca testi, veritabanı eş zamanlılık/idempotency testi ve API entegrasyon testi yapılmadı. Bunlara ait bir altyapı kurulmadı. Mevcut ekranın byte düzeyinde korunduğu doğrulandı; yeni görsel test gerektiren tasarım değişikliği yoktur.

Başlangıç bakiyesi ile hareketlerin zaman kesiminin doğru alınması ve hareketlerin eksiksiz gelmesi üst katmanın sorumluluğudur. Gelir, iade, kısmi ödeme, gecikmiş maaş, ayar değişikliği geçmişi, otomatik dönem açma ve döviz hesabı bu sürümde yoktur. `bill-payment` tam kapatma anlamındadır. Saat dilimi kurallarının farklı runtime sürümlerindeki eşleşmesi native entegrasyonda ayrıca doğrulanmalıdır.

Hesap sonuçları bütçe planlaması içindir; kesin harcama güvenliği vaat eden bir alan veya ifade üretilmez. Önceki npm güvenlik bulgularına müdahale edilmedi.

Test yaklaşımı, Node'un [yerleşik test çalıştırıcısını](https://nodejs.org/docs/latest-v24.x/api/test.html) kullanır. Test tipleri mevcut dolaylı `@types/node` paketinden gelir; ileride bağımlılık ağacı değişirse bu tip gereksinimi tekrar doğrulanmalıdır. Ek test çerçevesi veya çalıştırıcı bağımlılığı eklenmedi.
