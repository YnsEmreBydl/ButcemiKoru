# Bütçe hesaplama modülü

Bu modül React, Expo, Node API'leri, veritabanı ve ağ bağımlılığı olmadan çalışır. Hesap anı ve saat dilimi girdidir; sistem saati okunmaz. Mevcut ana ekrana bağlı değildir.

## Genel API

```ts
import { calculateBudget, simulateExpense, type BudgetInput } from './src/domain/budget';

const input: BudgetInput = {
  currency: 'TRY',
  timeZone: 'Europe/Istanbul',
  asOf: '2026-10-25T12:00:00+03:00',
  balanceSnapshot: {
    amountMinor: 1_000_000, // 10.000 TL; bu anda hesaptaki mevcut bakiye
    capturedAt: '2026-10-20T09:00:00+03:00',
  },
  nextPayday: '2026-11-04',
  savingsTargetMinor: 100_000,
  payments: [{ id: 'rent', amountMinor: 200_000, dueOn: '2026-10-28' }],
  transactions: [
    { id: 'yesterday', kind: 'expense', amountMinor: 100_000, occurredAt: '2026-10-24T10:00:00+03:00' },
    { id: 'today', kind: 'expense', amountMinor: 50_000, occurredAt: '2026-10-25T10:00:00+03:00' },
  ],
};

const result = calculateBudget(input);
const simulation = simulateExpense(input, 80_000);
```

`calculateBudget` yeni bir sonuç döndürür. `simulateExpense`, `current` ve `simulated` sonuçlarını birlikte verir. Simülasyon, aynı hesap anında ek bir harcamayı varsayar; girdi dizilerini değiştirmez, sahte tarihli hareket eklemez ve kayıt yapmaz. Bakiye görüntüsü hesap anıyla aynıysa da simülasyon hesaba katılır.

Tutarlar **tam sayı kuruştur**. Örneğin `125_000`, 1.250 TL'dir; `1.25` geçersizdir. Görüntüleme/ondalık metin ayrıştırma bu modülün sorumluluğu değildir. `currencies.ts` içindeki değiştirilemez kayıt tablosu şu an yalnızca TRY/2 basamak içerir. Diğer para birimleri için önce giriş ve görüntüleme adaptörleri ile bu tablo genişletilmelidir; hesaplama algoritması ana para birimi yerine en küçük para birimiyle çalışır.

## Bakiye ve hareket sözleşmesi

- `balanceSnapshot.amountMinor`, `capturedAt` anında mevcut bakiyedir; negatif olabilir.
- Bu bakiye, `occurredAt <= capturedAt` olan bütün hareketleri zaten içerir. Bunlar tekrar düşülmez. Sonradan girilen geçmiş bir harcama da gerçek gerçekleşme tarihiyle gönderilir; veri giriş tarihi kesim tarihi yerine kullanılmaz.
- Yalnızca `capturedAt < occurredAt <= asOf` aralığındaki hareketler bu bakiyeden düşülür. Gelecekte gerçekleşmiş görünen hareketler hata üretir.
- Kesim anı dahil kabul edilir. Aynı milisaniyedeki işlemler için başlangıç bakiyesinin bunları içerdiği sözleşmesi geçerlidir; gerçek veri entegrasyonunda bakiye/hareket anlık görüntüsü tutarlı alınmalıdır.
- `transactions` yalnızca pozitif tutarlı çıkışları içerir. `expense` sıradan harcamadır. `bill-payment`, `paymentId` ile tanımlanan faturanın **tam kapatılmasıdır**.
- Her hareketin kimliği tektir. Her fatura en fazla bir ödeme hareketiyle kapatılabilir. Tekrarlı kimlik veya ikinci kapatma sessizce sayılmaz; hata üretir.
- `payments`, ödeme referanslarını çözebilmek için kapanmış faturaların tanımlarını da saklar. Kapanma durumu ödeme hareketlerinden çıkarılır. Bilinmeyen fatura referansı reddedilir.
- Gerçek tam ödeme, tahmini fatura tutarından farklı olabilir. Gerçek tutar bakiyeden düşer; tahmini rezervin tamamı kalkar. Kısmi ödeme bu modelde desteklenmez.
- Birikim hedefi negatif olamaz. Harcama ve fatura tutarı sıfır veya negatif olamaz.

## Takvim sözleşmesi

`asOf`, `capturedAt` ve `occurredAt`, açık `Z` veya UTC ofseti olan ISO zamanlarıdır. Saat dilimsiz metinler, bilinmeyen ofset olan `-00:00`, geçersiz tarihler ve milisaniyeden yüksek hassasiyet reddedilir. Saat bilgisi olmayan `nextPayday` ve `dueOn`, bütçenin saat diliminde `YYYY-MM-DD` takvim tarihleridir.

Gün sınırı `timeZone` ile belirlenir. Gün sayısı Gregoryen tarihlerin sıra numaraları çıkarılarak bulunur; geçen saat veya milisaniye 24 saate bölünmez. Bugün dahil, maaş günü hariçtir. İstanbul için 25 Ekim → 4 Kasım, 10 bütçe günüdür. Yaz/kış saati geçişindeki 23 ve 25 saatlik günler de birer takvim günüdür.

Maaş tarihinden **önce** vadesi gelen, henüz kapanmamış faturalar rezerve edilir. Vadesi geçmiş ama ödenmemiş faturalar da dahildir. Maaş günü veya sonrasında vadesi gelenler bu dönemin rezervine girmez. Bunlar erken ödenirse gerçekleşen çıkış yine hesaba katılır.

Maaş günü bugünse `periodStatus = 'payday-today'`; geçmişteyse `'payday-passed'` döner. Her iki durumda `requiresNewPeriod = true` ve `daily = null` olur. Geçmiş tarih taşınmaz, gelir varsayılmaz ve sıfıra bölme yapılmaz. Gün sayısı geçmiş tarih için negatiftir. Bakiye ve rezerv sonuçları yine verilir; günlük dağıtım için yeni dönem girdisi gerekir.

## Matematik

Aşağıdaki bütün parasal değişkenler tam sayı kuruştur:

```text
B  = başlangıç bakiyesi
E  = başlangıçtan sonraki gerçekleşen çıkışlar
R  = maaştan önce vadesi gelen kapanmamış faturalar
G  = ayrılacak birikim
D  = bugünden maaş gününe takvim günü

Kalan bakiye        = B − E
Harcanabilir S      = B − E − R − G
Bütçe açığı         = max(−S, 0)
A                   = max(S, 0)       [yalnızca dağıtım havuzu]
```

Negatif kalan bakiye ve negatif `spendableMinor` korunur. Sadece yeni bir pozitif dağıtım hesaplanırken negatif para dağıtılmaz; açık ayrıca bildirilir.

Aktif dönem (`D > 0`) için:

```text
S₀ = bugünün ilk yeni hareketinden önceki harcanabilir tutar
     [bugün kurulum yapıldıysa başlangıç bakiyesi anı esas alınır]
I  = S₀ − S          [bugünün net bütçe etkisi]

Güncel eşit günlük öneri Q = floor(A / D)
Bugünün başlangıç hedefi H = floor(max(S₀, 0) / D)
Bugünkü hedefin kalanı T  = min(H − I, A)

Yarından sonraki gün sayısı F = D − 1
Gelecek gün havuzu P          = A − max(T, 0)
İleri günlük ortalama         = floor(P / F), F > 0 ise
                               null, F = 0 ise
```

`S₀`, bugünden önceki yeni hareketler ve gün başındaki fatura rezervleri ile yeniden oluşturulur. Aynı gün yeni harcama girilince `H` tekrar güncel bakiyeye bölünmez. Günlük öneri `Q` ise güncel bakiyenin bugün dahil bütün kalan günlere eşit dağılımını gösterir. Bu iki bakış farklıdır: `Q` canlı bir eşit dağıtım; `H/T` bugünün hedef takibidir. İkisi ayrı ayrı bütçeler olarak toplanmaz.

`T` negatifse bugünkü hedef aşılmıştır. Bir rezerv indirimi, daha önce açık olan bütçeyi rahatlatsa bile `T` pozitif güncel harcanabilir parayı aşamaz. Faturanın tam tahmini tutarı ödendiğinde nakit düşüşü ile rezerv kalkışı birbirini dengeler ve `I` sıfır olur; tutar farkı varsa yalnızca fark bütçe etkisine girer.

Yuvarlama aşağı doğrudur. Ara işlemler ve bölmeler `bigint` ile tam yapılır. Girdi ve çıktı `number` değerleri güvenli tam sayı aralığında olmalıdır; ara toplam sonucu bu aralığı aşarsa `AMOUNT_OVERFLOW` döner. JSON'a çıkan sonuçlarda `bigint` yoktur.

```text
Q × D + uniformRemainderMinor = A
max(T, 0) + ileriOrtalama × F + forwardRemainderMinor = A
```

İkinci eşitlik `F > 0` için geçerlidir. Son bütçe gününde ileri ortalama `null` olur. Kalan kuruşlar ayrıca raporlanır; dağıtılan toplam mevcut pozitif havuzu aşmaz.

## Sonuç alanları

| Alan | Anlamı |
| --- | --- |
| `remainingBalanceMinor` | Yeni gerçekleşen çıkışlardan sonraki hesap bakiyesi. |
| `reservedPaymentsMinor`, `reservedPaymentIds` | Açık fatura rezervi ve kimlikleri. |
| `savingsReservedMinor` | Ayrılan birikim hedefi. |
| `spendableMinor` | Rezervler sonrası işaretli harcanabilir tutar. |
| `budgetDeficitMinor` | Karşılanamayan rezerv/harcama açığı, pozitif tutar. |
| `spentSinceSnapshotMinor` | Yeni hareketlerin toplamı; eski hareketler dahil değildir. |
| `todayOutflowMinor` | Bugün gerçekleşen yeni çıkışlar; fatura dahil. |
| `todayBudgetImpactMinor` | Rezerv kalkışı da hesaba katılmış bugünkü net etki. |
| `spendableAtDayStartMinor` | Bugünün hedefini oluşturan işaretli temel tutar. |
| `daysUntilPayday`, `periodStatus`, `requiresNewPeriod` | Takvim ve dönem durumu. |
| `daily.recommendedDailyMinor` | Güncel eşit günlük öneri. |
| `daily.todayStartTargetMinor` | Bugünün başlangıç hedefi. |
| `daily.todayRemainingMinor` | Bu hedeften işaretli kalan tutar. |
| `daily.forwardDailyAverageMinor` | Bugünkü pozitif kalan ayrıldıktan sonraki yarından itibaren ortalama. |

## Hatalar ve sınırlar

Eksik alanlar, geçersiz türler, `NaN`, sonsuz değerler, kesirli kuruşlar ve güvenli tam sayı sınırını aşan girdiler reddedilir. Hatalar `BudgetInputError` tipinde, makine tarafından okunabilir `code` ve `field` alanlarıyla döner. Kullanıcıya gösterilecek açıklamaların çevrilmesi üst katmana aittir.

Bu aşamada gelir/iadeler, kısmi faturalar, faiz, kur dönüşümü, eş zamanlı kayıt, mükerrer kaydı veritabanında önleme ve otomatik dönem açma yoktur. Ayarlar gün içinde değiştirilirse gün başı hedefi yeni ayarlarla yeniden oluşturulur; önceki ayar sürümlerini saklayan bir hedef kilidi uygulanmadı.

Yerel tarihe çeviri standart `Intl` saat dilimi veritabanını kullanır. Aynı girdiler aynı saat dilimi kuralları altında aynı sonucu üretir. İşletim sistemi varsayılan saat dilimi kullanılmaz; farklı runtime saat dilimi veritabanı sürümleri veya ileride değişen resmî saat kuralları için native entegrasyon testi gerekir.

Sonuçlar planlama tahminidir. Eksik hareket, gecikmiş maaş veya başka yükümlülükler bilinmez. API, bir satın almanın kesin güvenli olduğunu söyleyen bir alan veya ifade üretmez.

## Testler

Proje kökünde `npm test`. Var olan TypeScript derleyicisi, bağımsız modül ve testleri geçici dizine derler; Node.js 24 `node:test` ve `node:assert/strict` testleri çalıştırır. Geçici çıktı sonunda silinir. Ek test paketi kurulmaz. Ayrı test derleme ayarı, Expo'nun çalışma zamanı import kurallarını değiştirmeden testlerin Node'da çalışmasını sağlar.
