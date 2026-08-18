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
    expect(lineTaxLabel({ tax_rate: 21, surcharge_rate: 5.2 }, t)).toBe('21.00% + RE 5.20%');
  });

  it('a new-generation line without surcharge (0) shows only the main rate', () => {
    expect(lineTaxLabel({ tax_rate: 10, surcharge_rate: 0 }, t)).toBe('10.00%');
  });

  it('a legacy line (surcharge_rate NULL) is shown as it was frozen — even if it is a sum', () => {
    expect(lineTaxLabel({ tax_rate: 26.2, surcharge_rate: null }, t)).toBe('26.20%');
    expect(lineTaxLabel({ tax_rate: 21 }, t)).toBe('21.00%');
  });

  it('a surcharge that arrives as a string from the wire is still a number on screen', () => {
    expect(lineTaxLabel({ tax_rate: '21', surcharge_rate: '5.2' }, t)).toBe('21.00% + RE 5.20%');
  });
});
