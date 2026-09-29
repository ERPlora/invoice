// @vitest-environment happy-dom

// invoice#125 — with the hub in Spanish, the lines table of the invoice detail painted the quantity
// and the tax rate in the English format («1.5», «21.00%») right next to amounts that did read
// «1.234,56 €». Both are painted with the separators of the person's language, and follow it when
// the shell switches language (`erplora:locale-changed`).
import { beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

type Lang = 'en' | 'es';
const CATALOG: Record<Lang, unknown> = { en: enLocale, es: esLocale };
const ui = (lang: Lang, key: string) => (CATALOG[lang] as { ui: Record<string, string> }).ui[key];

const DETAIL = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-2026-000007', issue_date: '2026-09-26',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 6000, tax_amount: 1572,
  total_amount: 7572, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, rectifies_number: null, paid_at: null, notes: '',
};
const LINES = [
  // 1,5 units at the general rate, no surcharge.
  { id: 'li1', line_number: 1, description: 'Champú', quantity: 1_500_000, unit_price: 2000, tax_rate: 21, surcharge_rate: 0, base_amount: 3000, tax_amount: 630, total_amount: 3630, product_id: null },
  // A line under equivalence surcharge (a retailer's invoice).
  { id: 'li2', line_number: 2, description: 'Tinte', quantity: 3_000_000, unit_price: 1000, tax_rate: 21, surcharge_rate: 5.2, base_amount: 3000, tax_amount: 786, total_amount: 3786, product_id: null },
];

const erplora: Record<string, unknown> = {};

function stub(lang: Lang): void {
  Object.assign(erplora, {
    query: async (name: string) => (name === 'invoice.get' ? [DETAIL] : []),
    queryOptional: async () => undefined,
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: lang,
    t: (catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>) => {
      let node: unknown = catalog[erplora.locale as Lang];
      for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
      const text = typeof node === 'string' ? node : key;
      return text.replace(/\{(\w+)\}/g, (_, p: string) => String(params?.[p] ?? `{${p}}`));
    },
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  });
  (globalThis as Record<string, unknown>).erplora = erplora;
}

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  detailLines: unknown[];
  openDetail(id: string): Promise<void>;
  updateComplete: Promise<unknown>;
};

async function settle(wc: Wc) {
  await wc.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await wc.updateComplete;
}

async function openDetail(lang: Lang): Promise<Wc> {
  stub(lang);
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Wc;
  document.body.appendChild(el);
  await settle(el);
  await el.openDetail(DETAIL.id);
  el.detailLines = LINES;
  await settle(el);
  return el;
}

/** The text of the cell of line `n` (1-based) under the column labelled `key` in `lang`. */
function cell(el: Wc, lang: Lang, n: number, key: string): string {
  const rows = el.shadowRoot.querySelectorAll('[data-testid="invoice-detail"] tbody tr');
  const td = rows[n - 1]?.querySelector(`td[data-label="${ui(lang, key)}"]`);
  expect(td, `line ${n} has a «${ui(lang, key)}» cell`).toBeTruthy();
  return td!.textContent!.trim();
}

const NBSP = ' ';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the lines of the invoice detail speak the numbers of the language (invoice#125)', () => {
  it('es: quantity «1,5» and rate «21 %», with the surcharge «21 % + RE 5,2 %»', async () => {
    const el = await openDetail('es');
    expect(cell(el, 'es', 1, 'lineQty')).toBe('1,5');
    expect(cell(el, 'es', 1, 'lineTaxPct')).toBe(`21${NBSP}%`);
    expect(cell(el, 'es', 2, 'lineQty')).toBe('3');
    expect(cell(el, 'es', 2, 'lineTaxPct')).toBe(`21${NBSP}% + ${ui('es', 'taxSurcharge')} 5,2${NBSP}%`);
  });

  it('en: quantity «1.5» and rate «21%», with the surcharge «21% + … 5.2%»', async () => {
    const el = await openDetail('en');
    expect(cell(el, 'en', 1, 'lineQty')).toBe('1.5');
    expect(cell(el, 'en', 1, 'lineTaxPct')).toBe('21%');
    expect(cell(el, 'en', 2, 'lineTaxPct')).toBe(`21% + ${ui('en', 'taxSurcharge')} 5.2%`);
  });

  it('switching the language of the shell repaints the numbers of the open detail', async () => {
    const el = await openDetail('en');
    expect(cell(el, 'en', 1, 'lineQty')).toBe('1.5');
    erplora.locale = 'es';
    window.dispatchEvent(new CustomEvent('erplora:locale-changed'));
    await settle(el);
    expect(cell(el, 'es', 1, 'lineQty')).toBe('1,5');
    expect(cell(el, 'es', 1, 'lineTaxPct')).toBe(`21${NBSP}%`);
  });
});
