// @vitest-environment happy-dom

// invoice#128 — the A4 printed from Facturación came out in English («INVOICE», «No.», «Bill to»,
// «Description», «Qty», «Tax base»…) for a Spanish business: the module handed `<ok-invoice>` no
// `.labels`, so OutfitKit painted its English defaults. A rectificativa was titled «INVOICE» too,
// and its thermal ticket never named the invoice it rectifies.
//
// The catalog here is the REAL one (`locales/*.json`), resolved like the SDK does, so a missing
// `es` string or a hard-coded English one fails.
import { beforeEach, describe, expect, it } from 'vitest';
import es from '../../../locales/es.json';
import en from '../../../locales/en.json';

const ORIGINAL = 'FACT-2026-000002';
const REASON = 'Error en el precio';

const INVOICE = {
  id: 'f1', invoice_type: 'F1', series: 'FACT', number: 'FACT-2026-000003', issue_date: '2026-09-28',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 4000, tax_amount: 840,
  total_amount: 4840, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, rectifies_number: null, paid_at: null, notes: '',
};
const RECTIFICATION = {
  ...INVOICE, id: 'r1', invoice_type: 'R1', series: 'RECT', number: 'RECT-2026-000001',
  base_amount: -4000, tax_amount: -840, total_amount: -4840, source_type: 'rectification',
  description: REASON, rectifies_invoice_id: 'o1', rectifies_number: ORIGINAL,
};
const LINES = [{ id: 'li1', line_number: 1, description: 'Corte', quantity: 1_000_000, unit_price: 4000, tax_rate: 21, base_amount: 4000, tax_amount: 840, total_amount: 4840 }];

/** Every rótulo `<ok-invoice>` paints (OutfitKit `OkInvoiceLabels`), in the business language. The
 *  same words the sales module prints on its invoice (`sales` `invoiceLabels`), so the customer gets
 *  one vocabulary whichever module issued the paper. */
const ES_LABELS = {
  empty: 'Sin datos de factura.', invoice: 'Factura', number: 'Nº', date: 'Fecha', dueDate: 'Vencimiento',
  billTo: 'Facturar a', description: 'Descripción', qty: 'Cant.', price: 'Precio', discount: 'Dto.',
  tax: 'Impuesto', amount: 'Importe', noLines: '— Sin líneas —', taxBase: 'Base imponible',
  discountTotal: 'Descuento', total: 'TOTAL', paymentMethod: 'Forma de pago',
};
const EN_LABELS = {
  empty: 'No invoice data.', invoice: 'Invoice', number: 'No.', date: 'Date', dueDate: 'Due date',
  billTo: 'Bill to', description: 'Description', qty: 'Qty', price: 'Price', discount: 'Disc.',
  tax: 'Tax', amount: 'Amount', noLines: '— No lines —', taxBase: 'Tax base',
  discountTotal: 'Discount', total: 'TOTAL', paymentMethod: 'Payment method',
};

type El = HTMLElement & { shadowRoot: ShadowRoot };
let printed: Array<Record<string, unknown>> = [];

function resolve(lang: string, key: string, params?: Record<string, unknown>): string {
  const dict = (lang === 'en' ? en : es) as Record<string, unknown>;
  const found = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
  const text = typeof found === 'string' ? found : key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (params && name in params ? String(params[name]) : m));
}

function install(lang: string): void {
  document.body.innerHTML = '';
  document.documentElement.lang = lang;
  printed = [];
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryOptional: async () => undefined,
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: lang,
    t: (_c: unknown, key: string, params?: Record<string, unknown>) => resolve(lang, key, params),
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
    print: async (req: Record<string, unknown>) => { printed.push(req); return { via: 'bridge' }; },
  };
}

beforeEach(() => install('es'));

async function mountDetail(detail: Record<string, unknown>): Promise<El> {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list');
  document.body.appendChild(el);
  const wc = el as unknown as { detail: unknown; detailLines: unknown[]; aeat: unknown; updateComplete: Promise<unknown> };
  await wc.updateComplete;
  wc.detail = detail;
  wc.detailLines = LINES;
  wc.aeat = null;
  await wc.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await wc.updateComplete;
  return el as El;
}

type OkInvoiceEl = HTMLElement & { labels?: Record<string, string>; updateComplete: Promise<unknown>; shadowRoot: ShadowRoot };

function doc(el: El): OkInvoiceEl {
  const d = el.shadowRoot.querySelector('ok-invoice') as OkInvoiceEl | null;
  expect(d, 'the print-only <ok-invoice> is rendered').toBeTruthy();
  return d!;
}

function labels(el: El): Record<string, string> {
  return doc(el).labels ?? {};
}

async function printJob(el: El): Promise<Record<string, unknown>> {
  (el.shadowRoot.querySelector('header ion-button.print') as HTMLElement).click();
  await new Promise((r) => setTimeout(r, 0));
  expect(printed.length, 'the print button went through sdk.print').toBe(1);
  return printed[0].data as Record<string, unknown>;
}

describe('the A4 speaks the business language (invoice#128)', () => {
  it('in Spanish, every rótulo of the document is the Spanish one', async () => {
    expect(labels(await mountDetail(INVOICE))).toEqual(ES_LABELS);
  });

  it('in English, every rótulo is the English one', async () => {
    install('en');
    expect(labels(await mountDetail(INVOICE))).toEqual(EN_LABELS);
  });

  it('the sheet itself paints them: title and column headers come out in Spanish', async () => {
    const d = doc(await mountDetail(INVOICE));
    await d.updateComplete;
    const text = d.shadowRoot.textContent ?? '';
    expect(d.shadowRoot.querySelector('.doc-title')?.textContent?.trim()).toBe('Factura');
    for (const word of ['Nº', 'Facturar a', 'Descripción', 'Cant.', 'Base imponible']) expect(text).toContain(word);
    for (const word of ['Bill to', 'Description', 'Tax base']) expect(text).not.toContain(word);
  });
});

describe('a rectificativa says it is one in its title (invoice#128)', () => {
  it.each(['R1', 'R2', 'R3', 'R4', 'R5'])('%s is titled «Factura rectificativa»', async (invoice_type) => {
    expect(labels(await mountDetail({ ...RECTIFICATION, invoice_type })).invoice).toBe('Factura rectificativa');
  });

  it('in English: «Corrective invoice»', async () => {
    install('en');
    expect(labels(await mountDetail(RECTIFICATION)).invoice).toBe('Corrective invoice');
  });

  it('a simplified invoice (F2) is titled «Factura simplificada»; in English «Simplified invoice»', async () => {
    expect(labels(await mountDetail({ ...INVOICE, invoice_type: 'F2' })).invoice).toBe('Factura simplificada');
    install('en');
    expect(labels(await mountDetail({ ...INVOICE, invoice_type: 'F2' })).invoice).toBe('Simplified invoice');
  });

  it('F1 and F3 are plain invoices: «Factura»', async () => {
    expect(labels(await mountDetail(INVOICE)).invoice).toBe('Factura');
    expect(labels(await mountDetail({ ...INVOICE, invoice_type: 'F3' })).invoice).toBe('Factura');
  });

  it('the rest of the rótulos of a rectificativa stay the ordinary ones', async () => {
    expect(labels(await mountDetail(RECTIFICATION))).toEqual({ ...ES_LABELS, invoice: 'Factura rectificativa' });
  });
});

describe('the thermal ticket of a rectificativa names the invoice it rectifies (invoice#128)', () => {
  it('prints «Rectifica la factura … Motivo: …» at its foot, in Spanish', async () => {
    const data = await printJob(await mountDetail(RECTIFICATION));
    expect(data.receipt_footer).toBe(`Rectifica la factura ${ORIGINAL}. Motivo: ${REASON}`);
  });

  it('in English', async () => {
    install('en');
    const data = await printJob(await mountDetail(RECTIFICATION));
    expect(data.receipt_footer).toBe(`Rectifies invoice ${ORIGINAL}. Reason: ${REASON}`);
  });

  it('a simplified rectificativa (R5, printed as a ticket) names it too', async () => {
    const data = await printJob(await mountDetail({ ...RECTIFICATION, invoice_type: 'R5' }));
    expect(data.receipt_footer).toBe(`Rectifica la factura ${ORIGINAL}. Motivo: ${REASON}`);
  });

  it('the roll carries the same note as the sheet: an invoice\'s own notes, and nothing without notes', async () => {
    expect((await printJob(await mountDetail({ ...INVOICE, notes: 'Pago a 30 días' }))).receipt_footer).toBe('Pago a 30 días');
    install('es');
    expect('receipt_footer' in (await printJob(await mountDetail(INVOICE)))).toBe(false);
  });
});

// invoice#131 — the roll of a full rectificativa is titled «FACTURA RECTIFICATIVA» by the hub only
// when the job says so (`rectifying: true`, ERPlora/hub#2381), the same way the A4 already is.
describe('the thermal roll of a full rectificativa is titled as such (invoice#131)', () => {
  it.each(['R1', 'R2', 'R3', 'R4'])('%s: the print job tells the renderer it is a rectificativa', async (invoice_type) => {
    const data = await printJob(await mountDetail({ ...RECTIFICATION, invoice_type }));
    expect(printed[0].documentType).toBe('invoice');
    expect(data.rectifying).toBe(true);
  });

  it('a plain invoice (F1) does not say it', async () => {
    expect('rectifying' in (await printJob(await mountDetail(INVOICE)))).toBe(false);
  });
});
