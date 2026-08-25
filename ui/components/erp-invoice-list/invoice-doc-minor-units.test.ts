// @vitest-environment happy-dom

// invoice#66 — the printed / PDF invoice got the row's CENTS with no scale.
//
// `invoiceDocData()` handed `<ok-invoice>` `total_amount`/`unit_price` straight from the row
// (minor units, ADR-0123) while the component's contract was euros: a 48,00 € invoice printed
// «4800.00 EUR». Since outfitkit 0.1.48 (ADR-0400) `<ok-invoice>` takes INTEGERS in minor units
// plus `decimals` — so the row's cents are right, and the only thing missing was the scale.
import { beforeEach, describe, expect, it } from 'vitest';

const DETAIL = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-0001', issue_date: '2026-08-25',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 4000, tax_amount: 800,
  total_amount: 4800, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, paid_at: null, notes: '',
};
const LINES = [{ id: 'li1', line_number: 1, description: 'Corte', quantity: 1_000_000, unit_price: 4000, tax_rate: 20, base_amount: 4000, tax_amount: 800, total_amount: 4800 }];

type Doc = { invoice?: { total: number; decimals?: number; lines: Array<{ unit_price: number; total: number }> }; shadowRoot: ShadowRoot | null; updateComplete: Promise<unknown> };

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = 'es';
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async () => ({ rows: [DETAIL], total: 1 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_c: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

async function mountDetail(): Promise<HTMLElement & { shadowRoot: ShadowRoot }> {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list');
  document.body.appendChild(el);
  const wc = el as unknown as { detail: unknown; detailLines: unknown[]; updateComplete: Promise<unknown> };
  await wc.updateComplete;
  wc.detail = DETAIL;
  wc.detailLines = LINES;
  await wc.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await wc.updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

describe('the invoice document is minor units + decimals (invoice#66, ADR-0400)', () => {
  it('hands <ok-invoice> the row cents and the hub scale', async () => {
    const el = await mountDetail();
    const doc = el.shadowRoot.querySelector('ok-invoice') as unknown as Doc | null;
    expect(doc, 'the print-only <ok-invoice> is rendered').toBeTruthy();
    expect(doc!.invoice!.decimals, 'without the scale the component cannot cut the integer').toBe(2);
    expect(doc!.invoice!.total).toBe(4800);
    expect(doc!.invoice!.lines[0]).toMatchObject({ unit_price: 4000, total: 4800 });
  });

  it('PAINTS «48,00 EUR», never «4800.00 EUR»', async () => {
    const el = await mountDetail();
    const doc = el.shadowRoot.querySelector('ok-invoice') as unknown as Doc;
    await doc.updateComplete;
    const text = doc.shadowRoot!.textContent || '';
    expect(text).toContain('48,00 EUR');
    expect(text).not.toContain('4800.00');
    expect(text, 'a float would paint the not-an-amount mark').not.toContain('— EUR');
  });

  it('the scale follows the hub currency (JPY: 0 → 4800 ¥ stays 4.800)', async () => {
    (globalThis.erplora as Record<string, unknown>).currencyDecimals = 0;
    const el = await mountDetail();
    const doc = el.shadowRoot.querySelector('ok-invoice') as unknown as Doc;
    expect(doc.invoice!.decimals).toBe(0);
  });

  // invoice#66 (verified against `hub/crates/peripherals/src/escpos.rs`): the thermal job does NOT
  // carry this document. `DocumentType::Invoice` goes through `render_receipt`, which reads
  // `items[]`/`subtotal`/`total` as floats in MAJOR units (`{:.2}`); handing it cents printed
  // «TOTAL 4800.00» and no lines. The job is built by `lib/print-document.ts` (tests there).
  it('the print job carries the ESC/POS shape in major units, not this document', async () => {
    const printed: Array<{ data?: unknown }> = [];
    (globalThis.erplora as Record<string, unknown>).print = async (req: { data?: unknown }) => { printed.push(req); return { via: 'bridge' }; };
    const el = await mountDetail();
    (el.shadowRoot!.querySelector('header ion-button.print') as HTMLElement).click();
    const data = printed[0]?.data as { total: number; items: Array<{ total: number }> };
    expect(data.total).toBe(48);
    expect(data.items[0].total).toBe(48);
  });
});
