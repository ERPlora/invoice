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

// invoice#86 — the hub prints a `documentType: 'invoice'` as a FULL invoice on the 80 mm roll and
// refuses one without the customer's tax id or the VAT broken down per rate (ERPlora/hub#2005,
// `escpos::check_full_invoice`). Same shape sales#350 sends: `customer_tax_id`, optional
// `customer_address`, and `tax_breakdown` rows `{ rate, base, tax, label? }` in MAJOR units.
describe('invoiceToPrintDocument: the full invoice the thermal renderer demands (invoice#86)', () => {
  const TAXES = [
    { label: 'IVA 21%', rate: 21, base: 3967, amount: 833 },
    { label: 'Recargo de equivalencia 5.2%', rate: 5.2, base: 3967, amount: 206 },
  ];

  it('carries the customer tax id and address', () => {
    const doc = invoiceToPrintDocument(DETAIL, LINES, 2, {}, TAXES);
    expect(doc.customer_tax_id).toBe('B12345678');
    expect(doc.customer_address).toBe('Calle 1');
  });

  it('breaks the VAT down per row, in major units, keeping the label the A4 prints', () => {
    const doc = invoiceToPrintDocument(DETAIL, LINES, 2, {}, TAXES);
    expect(doc.tax_breakdown).toEqual([
      { rate: 21, base: 39.67, tax: 8.33, label: 'IVA 21%' },
      { rate: 5.2, base: 39.67, tax: 2.06, label: 'Recargo de equivalencia 5.2%' },
    ]);
  });

  it('scales the breakdown by the currency, like every other amount', () => {
    const doc = invoiceToPrintDocument(DETAIL, LINES, 0, {}, [{ label: 'VAT 10%', rate: 10, base: 4000, amount: 400 }]);
    expect(doc.tax_breakdown).toEqual([{ rate: 10, base: 4000, tax: 400, label: 'VAT 10%' }]);
  });

  it('a row without a numeric rate keeps a numeric `rate` (0) and is named by its label', () => {
    const doc = invoiceToPrintDocument(DETAIL, LINES, 2, {}, [{ label: 'Exento (E1)', base: 4800, amount: 0 }]);
    expect(doc.tax_breakdown).toEqual([{ rate: 0, base: 48, tax: 0, label: 'Exento (E1)' }]);
  });

  it('a missing tax id or address is left out, never sent blank (the hub names what is missing)', () => {
    const doc = invoiceToPrintDocument({ ...DETAIL, customer_tax_id: '  ', customer_address: '' }, LINES, 2, {}, TAXES);
    expect('customer_tax_id' in doc).toBe(false);
    expect('customer_address' in doc).toBe(false);
  });
});

// invoice#90 — the REPRINT key is unique per attempt (same fix as sales#92). An invoice is
// immutable (fiscal record), and the queue deduplicates by (hub_id, job_id): a fixed
// `invoice-<id>` let the first copy out and swallowed every later one as a silent «Duplicate»
// reported as queued. Each press of Print is an explicit request for another copy.
describe('reprintJobId — one key per print attempt (invoice#90)', () => {
  it('every call returns a DIFFERENT key, even in the same millisecond', async () => {
    const { reprintJobId } = await import('./print-document');
    const first = reprintJobId('i1')!;
    const second = reprintJobId('i1')!;
    expect(first).not.toBe(second);
    expect(reprintJobId('i1')).not.toBe(second);
  });

  it('correlates with the invoice (`invoice-<id>-…`) and is never the old fixed key', async () => {
    const { reprintJobId } = await import('./print-document');
    const key = reprintJobId('i1')!;
    expect(key.startsWith('invoice-i1-')).toBe(true);
    expect(key).not.toBe('invoice-i1');
  });

  it('without an invoice there is no job', async () => {
    const { reprintJobId } = await import('./print-document');
    expect(reprintJobId(undefined)).toBeUndefined();
  });
});

// invoice#128 — the renderer's invoice branch prints no field of ours about the original invoice;
// the one free text it prints on both papers (full invoice and ticket) is `receipt_footer`. The
// note of the document (the rectificativa sentence, composed in the business language) goes there.
describe('invoiceToPrintDocument: the note of the document rides in `receipt_footer` (invoice#128)', () => {
  it('a note is printed at the foot of the roll', () => {
    const doc = invoiceToPrintDocument(DETAIL, LINES, 2, { note: 'Rectifica la factura FACT-2026-000002.' });
    expect(doc.receipt_footer).toBe('Rectifica la factura FACT-2026-000002.');
  });

  it('no note, or only blanks, sends no key at all (the renderer would print an empty line)', () => {
    expect('receipt_footer' in invoiceToPrintDocument(DETAIL, LINES, 2)).toBe(false);
    expect('receipt_footer' in invoiceToPrintDocument(DETAIL, LINES, 2, { note: '   ' })).toBe(false);
  });
});
