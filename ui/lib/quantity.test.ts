import { describe, it, expect } from 'vitest';
import {
  QUANTITY_SCALE,
  toMicro,
  fromMicro,
  parseQuantity,
  formatQuantity,
} from './quantity';

// ADR-0147: a quantity is a fixed-point integer on the GLOBAL 10⁶ scale across the whole wire
// (commands, rows, events). The exponent only exists at the TWO boundaries: when a person types
// (parseQuantity → µ) and when it is painted (formatQuantity ← µ). Local copy of the boundary in
// `sales/ui/lib/quantity.ts` (modules do not import each other).

describe('quantity — la frontera de la escala 10⁶ (ADR-0147)', () => {
  it('toMicro/fromMicro: 0,5 es 500000, y vuelve exacto', () => {
    expect(QUANTITY_SCALE).toBe(1_000_000);
    expect(toMicro(0.5)).toBe(500_000);
    expect(toMicro(3)).toBe(3_000_000);
    expect(fromMicro(500_000)).toBe(0.5);
    expect(fromMicro(3_000_000)).toBe(3);
  });

  it('parseQuantity: lo que teclea el humano → µ; coma o punto', () => {
    expect(parseQuantity('0.5')).toBe(500_000);
    expect(parseQuantity('0,5')).toBe(500_000);
    expect(parseQuantity(' 2 ')).toBe(2_000_000);
  });

  it('parseQuantity RECHAZA lo irrepresentable en vez de truncarlo', () => {
    expect(parseQuantity('0.1234567')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
  });

  it('formatQuantity: no padding zeros — 2, not 2.000000', () => {
    expect(formatQuantity(2_000_000, 'en')).toBe('2');
    expect(formatQuantity(500_000, 'en')).toBe('0.5');
    expect(formatQuantity(1_250_000, 'en')).toBe('1.25');
  });

  // invoice#125 — the invoice detail painted «1.5» with the hub in Spanish, next to amounts that
  // did say «1.234,56 €». The quantity is painted with the separators of the person's language.
  it('formatQuantity: separators of the language — «1,5» in es, «1.5» in en', () => {
    expect(formatQuantity(1_500_000, 'es')).toBe('1,5');
    expect(formatQuantity(1_500_000, 'en')).toBe('1.5');
    expect(formatQuantity(12_345_000_000, 'es')).toBe('12.345');
    expect(formatQuantity(1_234_500_000, 'en')).toBe('1,234.5');
  });

  // rv-invoice-139 — CLDR leaves four-digit numbers ungrouped in es («1234,5»), while the amounts
  // of the same line are always grouped («1.234,56 €», hub#1090). The quantity reads like them.
  it('formatQuantity: four digits are grouped like the amounts next to them — «1.234,5» in es', () => {
    expect(formatQuantity(1_234_500_000, 'es')).toBe('1.234,5');
    expect(formatQuantity(1_000_000_000, 'es')).toBe('1.000');
    expect(formatQuantity(999_000_000, 'es')).toBe('999');
  });

  it('formatQuantity: the six decimals of the scale are painted, never rounded away', () => {
    expect(formatQuantity(1, 'es')).toBe('0,000001');
    expect(formatQuantity(2_123_456, 'en')).toBe('2.123456');
  });

  it('formatQuantity: an unreadable language (es_ES) or none falls back to the runtime default instead of throwing', () => {
    const fallback = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(1.5);
    for (const locale of ['es_ES', '', undefined]) {
      expect(formatQuantity(1_500_000, locale), `locale=${String(locale)}`).toBe(fallback);
    }
  });
});
