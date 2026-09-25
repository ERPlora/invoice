// currency-symbol — the text `<ok-money>` paints after the number.
//
// The invoice row keeps the ISO-4217 code (`EUR`). `Intl` only gives the SYMBOL of that code here;
// it never touches the amount, which `<ok-money>` cuts by string from the minor-unit integer.

/** `EUR` → `€`, `USD` (en) → `$`. A code `Intl` rejects comes back as written; none → ''. */
export function currencySymbol(code: string | undefined, locale: string): string {
  const iso = (code ?? '').trim();
  if (!iso) return '';
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: iso }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? iso;
  } catch {
    return iso;
  }
}
