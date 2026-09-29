import { describe, expect, it } from 'vitest';
import { numberFormat } from './number-format';

// invoice#125 — a number on screen (a quantity, a tax rate) is written with the separators of the
// person's language. `erplora.locale` comes from the shell; an unreadable tag («es_ES») makes
// `Intl.NumberFormat` throw a RangeError, which would leave the whole detail unpainted
// (rv-outfitkit-245). It falls back to the runtime default instead.
describe('numberFormat — Intl.NumberFormat that never throws on the language', () => {
  it('uses the language it is given', () => {
    expect(numberFormat('es', { maximumFractionDigits: 6 }).format(1.5)).toBe('1,5');
    expect(numberFormat('en', { maximumFractionDigits: 6 }).format(1.5)).toBe('1.5');
  });

  it('an unreadable, empty or missing language falls back to the runtime default', () => {
    const fallback = new Intl.NumberFormat(undefined, { style: 'percent' }).format(0.21);
    for (const locale of ['es_ES', '', undefined]) {
      expect(numberFormat(locale, { style: 'percent' }).format(0.21), `locale=${String(locale)}`).toBe(fallback);
    }
  });
});
