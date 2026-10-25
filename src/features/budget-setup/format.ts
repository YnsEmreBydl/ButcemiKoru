/** Formats integer kuruş without an intermediate floating-point TRY amount. */
export function formatMinorTRY(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Expected safe integer kuruş.');
  }
  const value = BigInt(amountMinor);
  const absolute = value < 0n ? -value : value;
  // Hermes Intl.NumberFormat rejects bigint. Group exact digits for fixed tr-TR display.
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${value < 0n ? '-' : ''}₺${whole},${fraction}`;
}

export function formatCalendarDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}`;
}
