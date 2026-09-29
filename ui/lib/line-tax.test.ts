import { describe, expect, it } from 'vitest';
import { lineTaxLabel } from './line-tax';

// invoice#21: the invoice line freezes the MAIN rate (`tax_rate`) and the equivalence surcharge
// (`surcharge_rate`) apart. Two generations coexist in `invoice_invoiceitem`:
//   * legacy rows (issued before migration 006): `surcharge_rate` is NULL and `tax_rate` MAY be the
//     combined sum the sale sent (26.2). Nothing is backfilled (frozen fiscal row) → shown as it is.
//   * new rows: `surcharge_rate` is always present (0 = none) and `tax_rate` is the main rate.
// The lines table paints the two components so the same document no longer says «26.2 %» in the
// lines and «21 % + RE 5.2 %» in the tax block.
const t = (key: string) => (key === 'ui.taxSurcharge' ? 'RE' : key);

describe('lineTaxLabel — the tax column of an invoice line', () => {
  it('a new-generation line under equivalence surcharge shows both components', () => {
    expect(lineTaxLabel({ tax_rate: 21, surcharge_rate: 5.2 }, t, 'en')).toBe('21% + RE 5.2%');
  });

  it('a new-generation line without surcharge (0) shows only the main rate', () => {
    expect(lineTaxLabel({ tax_rate: 10, surcharge_rate: 0 }, t, 'en')).toBe('10%');
  });

  it('a legacy line (surcharge_rate NULL) is shown as it was frozen — even if it is a sum', () => {
    expect(lineTaxLabel({ tax_rate: 26.2, surcharge_rate: null }, t, 'en')).toBe('26.2%');
    expect(lineTaxLabel({ tax_rate: 21 }, t, 'en')).toBe('21%');
  });

  it('a surcharge that arrives as a string from the wire is still a number on screen', () => {
    expect(lineTaxLabel({ tax_rate: '21', surcharge_rate: '5.2' }, t, 'en')).toBe('21% + RE 5.2%');
  });
});

// invoice#125 — with the hub in Spanish the column read «21.00%»: English separators and padding
// zeros. A rate is written the way the language writes a percentage: «21 %», «5,2 %» (es, with the
// no-break space Intl puts before the sign), «21%», «5.2%» (en). No padding zeros.
describe('lineTaxLabel — in the language of the person (invoice#125)', () => {
  const NBSP = '\u00a0';

  it('es: comma decimal and the Spanish percent sign, no padding zeros', () => {
    expect(lineTaxLabel({ tax_rate: 21, surcharge_rate: 0 }, t, 'es')).toBe(`21${NBSP}%`);
    expect(lineTaxLabel({ tax_rate: 21, surcharge_rate: 5.2 }, t, 'es')).toBe(`21${NBSP}% + RE 5,2${NBSP}%`);
    expect(lineTaxLabel({ tax_rate: 26.2, surcharge_rate: null }, t, 'es')).toBe(`26,2${NBSP}%`);
    expect(lineTaxLabel({ tax_rate: 9.5 }, t, 'es')).toBe(`9,5${NBSP}%`);
  });

  it('a rate of 0 or a missing one reads 0 %, never NaN', () => {
    expect(lineTaxLabel({ tax_rate: 0, surcharge_rate: 0 }, t, 'es')).toBe(`0${NBSP}%`);
    expect(lineTaxLabel({ tax_rate: '' }, t, 'en')).toBe('0%');
  });

  it('an unreadable language (es_ES) or none falls back to the runtime default instead of throwing', () => {
    const fallback = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(0.21);
    for (const locale of ['es_ES', '', undefined]) {
      expect(lineTaxLabel({ tax_rate: 21, surcharge_rate: 0 }, t, locale), `locale=${String(locale)}`).toBe(fallback);
    }
  });
});
