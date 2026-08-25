// invoice#66 — the invoice travels to the thermal printer in the ONLY shape the ESC/POS renderer
// reads (`hub/crates/peripherals/src/escpos.rs::render_receipt`: `items[]`, `subtotal`,
// `tax_amount`, `total` — floats in MAJOR units, `{:.2}`), not in the `<ok-invoice>` contract.
// Before this, `printDetail()` handed the `InvoiceData` object (in cents, `lines[]`) to
// `sdk.print`: on a Bridge printer the paper came out with no lines and «TOTAL 4800.00».
//
// The minor→major conversion is a NAMED boundary (ADR-0123 §4), scaled by the hub's currency
// decimals (ADR-0123 §7): never a loose `/100` — JPY has 0 decimals, KWD has 3.
import { describe, expect, it } from 'vitest';
import { invoiceToPrintDocument, toUnits } from './print-document';

const DETAIL = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-2026-000001', issue_date: '2026-08-25',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 3967, tax_amount: 833,
  total_amount: 4800, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: 'Calle 1', description: '',
  tax_breakdown: '[{"tax":"vat","regime":"01","class":"subject","rate":21,"base":3967,"quota":833}]',
  currency: 'EUR', source_id: null, rectifies_invoice_id: null, paid_at: null, notes: '',
};

const LINES = [
  { id: 'l1', line_number: 1, description: 'Corte', quantity: 1_000_000, unit_price: 2400, tax_rate: 21,
    base_amount: 1983, tax_amount: 417, total_amount: 2400, product_id: null },
  { id: 'l2', line_number: 2, description: 'Tinte', quantity: 1_000_000, unit_price: 2400, tax_rate: 21,
    base_amount: 1984, tax_amount: 416, total_amount: 2400, product_id: null },
];

describe('toUnits: the minor→major boundary is scaled by the currency, never a loose /100', () => {
  it('EUR (2 decimals): 4800 cents are 48', () => {
    expect(toUnits(4800, 2)).toBe(48);
  });
  it('JPY (0 decimals): 4800 is 4800', () => {
    expect(toUnits(4800, 0)).toBe(4800);
  });
  it('KWD (3 decimals): 4800 fils are 4.8', () => {
    expect(toUnits(4800, 3)).toBe(4.8);
  });
  it('a missing amount is 0, not NaN on the paper', () => {
    expect(toUnits(undefined, 2)).toBe(0);
  });
});

describe('invoiceToPrintDocument: what the ESC/POS renderer reads, in major units', () => {
  it('a 48,00 € invoice prints «48.00», not «4800.00» (the issue)', () => {
    const doc = invoiceToPrintDocument(DETAIL, LINES, 2, { qr: 'https://aeat/qr' });
    expect(doc.total, 'TOTAL line').toBe(48);
    expect(doc.subtotal, 'Subtotal line').toBe(39.67);
    expect(doc.tax_amount, 'IVA line').toBe(8.33);
  });

  it('the lines travel as `items[]` (name, quantity, total) — the key the renderer looks up', () => {
    const doc = invoiceToPrintDocument(DETAIL, LINES, 2, {});
    expect(doc.items.map((i) => [i.name, i.quantity, i.total])).toEqual([
      ['Corte', 1, 24],
      ['Tinte', 1, 24],
    ]);
    expect('lines' in doc, 'the ok-invoice shape must not leak into the thermal job').toBe(false);
  });

  it('identifies the paper: number, issuer, customer and the VeriFactu QR', () => {
    const doc = invoiceToPrintDocument(DETAIL, LINES, 2, { qr: 'https://aeat/qr' });
    expect(doc.receipt_id).toBe('FACT-2026-000001');
    expect(doc.business_name).toBe('Emisora SL');
    expect(doc.vat_number).toBe('B00000000');
    expect(doc.customer_name).toBe('ACME');
    expect(doc.qr_data).toBe('https://aeat/qr');
  });

  it('honours the currency scale: the same invoice in JPY keeps its integers', () => {
    const doc = invoiceToPrintDocument({ ...DETAIL, currency: 'JPY' }, LINES, 0, {});
    expect(doc.total).toBe(4800);
    expect(doc.items[0].total).toBe(2400);
  });
});
