// @vitest-environment happy-dom

// invoice#124 — a rectificativa printed «Rectifies FACT-2026-000002. Reason: Error en el precio» at
// the foot of the document handed to a Spanish customer: the SQL baked an English sentence into
// `notes`, and `notes` is the footer of the printable `<ok-invoice>` and the «Notes» row of the
// detail. The chain now stores no sentence (the reason lives in `description`, the original in
// `rectifies_invoice_id`, and `invoice.get` answers `rectifies_number`); the screen composes it
// through the catalog, in the business language.
//
// The catalog here is the REAL one (`locales/*.json`), resolved like the SDK does, so a missing
// `es` string or a hard-coded English one fails.
import { beforeEach, describe, expect, it } from 'vitest';
import es from '../../../locales/es.json';
import en from '../../../locales/en.json';

const ORIGINAL = 'FACT-2026-000002';
const REASON = 'Error en el precio';

const RECTIFICATION = {
  id: 'r1', invoice_type: 'R1', series: 'RECT', number: 'RECT-2026-000001', issue_date: '2026-09-28',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: -4000, tax_amount: -840,
  total_amount: -4840, status: 'issued', source_type: 'rectification',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: REASON, tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: 'o1', rectifies_number: ORIGINAL, paid_at: null, notes: '',
};
const LINES = [{ id: 'li1', line_number: 1, description: 'Corte', quantity: -1_000_000, unit_price: 4000, tax_rate: 21, base_amount: -4000, tax_amount: -840, total_amount: -4840 }];

type Detail = Record<string, unknown>;
type El = HTMLElement & { shadowRoot: ShadowRoot };

function resolve(lang: string, key: string, params?: Record<string, unknown>): string {
  const dict = (lang === 'en' ? en : es) as Record<string, unknown>;
  const found = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
  const text = typeof found === 'string' ? found : key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (params && name in params ? String(params[name]) : m));
}

function install(lang: string): void {
  document.body.innerHTML = '';
  document.documentElement.lang = lang;
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
  };
}

beforeEach(() => install('es'));

async function mountDetail(detail: Detail): Promise<El> {
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

function footer(el: El): string | undefined {
  const doc = el.shadowRoot.querySelector('ok-invoice') as unknown as { invoice?: { footer?: string } } | null;
  expect(doc, 'the print-only <ok-invoice> is rendered').toBeTruthy();
  return doc!.invoice!.footer;
}

function notesRow(el: El): string | undefined {
  const dd = el.shadowRoot.querySelector('[data-testid="invoice-detail-notes"]');
  return dd?.textContent?.trim();
}

describe('a rectificativa is explained in the business language (invoice#124)', () => {
  it('prints «Rectifica la factura … Motivo: …» in Spanish at the foot of the document', async () => {
    const el = await mountDetail(RECTIFICATION);
    expect(footer(el)).toBe(`Rectifica la factura ${ORIGINAL}. Motivo: ${REASON}`);
  });

  it('shows the same sentence in the Notes row of the detail, so the reason is not lost on screen', async () => {
    const el = await mountDetail(RECTIFICATION);
    expect(notesRow(el)).toBe(`Rectifica la factura ${ORIGINAL}. Motivo: ${REASON}`);
  });

  it('follows the language: the same document in English', async () => {
    install('en');
    const el = await mountDetail(RECTIFICATION);
    expect(footer(el)).toBe(`Rectifies invoice ${ORIGINAL}. Reason: ${REASON}`);
  });

  it('with no reason written, it still names the original and says nothing about a reason', async () => {
    const el = await mountDetail({ ...RECTIFICATION, description: '' });
    expect(footer(el)).toBe(`Rectifica la factura ${ORIGINAL}.`);
  });

  it('a reason of only blanks counts as none: no dangling «Motivo:» on the paper', async () => {
    const el = await mountDetail({ ...RECTIFICATION, description: '   ' });
    expect(footer(el)).toBe(`Rectifica la factura ${ORIGINAL}.`);
  });

  it('a rectificativa issued before the fix (English sentence stored) is shown translated too', async () => {
    const el = await mountDetail({ ...RECTIFICATION, notes: `Rectifies ${ORIGINAL}. Reason: ${REASON}` });
    expect(footer(el)).toBe(`Rectifica la factura ${ORIGINAL}. Motivo: ${REASON}`);
    expect(notesRow(el)).toBe(`Rectifica la factura ${ORIGINAL}. Motivo: ${REASON}`);
  });

  it('a note that is not that stored sentence is printed verbatim', async () => {
    const el = await mountDetail({ ...RECTIFICATION, notes: 'Entregar en tienda' });
    expect(footer(el)).toBe('Entregar en tienda');
  });

  it('an ordinary invoice keeps its own notes verbatim, and no notes means no footer', async () => {
    const ordinary = { ...RECTIFICATION, invoice_type: 'F1', rectifies_invoice_id: null, rectifies_number: null, description: '' };
    expect(footer(await mountDetail({ ...ordinary, notes: 'Pago a 30 días' }))).toBe('Pago a 30 días');
    expect(footer(await mountDetail({ ...ordinary, notes: '' }))).toBeUndefined();
  });

  it('when the original cannot be named, it prints no sentence rather than a half one', async () => {
    const el = await mountDetail({ ...RECTIFICATION, rectifies_number: null });
    expect(footer(el)).toBeUndefined();
  });
});
