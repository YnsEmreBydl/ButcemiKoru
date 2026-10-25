const tryFormatter = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const spokenTryFormatter = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  currencyDisplay: 'name',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatTRY = (amount: number) => tryFormatter.format(amount);
export const formatSpokenTRY = (amount: number) => spokenTryFormatter.format(amount);
