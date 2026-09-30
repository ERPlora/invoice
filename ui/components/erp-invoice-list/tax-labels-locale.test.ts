// @vitest-environment happy-dom

// invoice#132 — with the hub in English the printed invoice already titled its rótulos in English
// (invoice#128), but the rows of the tax summary were still written by hand in Spanish: «IVA 21%»,
// «Exento», «No sujeto», «Inversión del sujeto pasivo». The paper mixed two languages. Those rows
// are named from the module catalog now, the way the equivalence surcharge already was, and in
// Spanish the paper reads exactly as it did.
//
// The catalog is the REAL one (`locales/*.json`) resolved like the SDK does, so a missing `es`
// string or a hard-coded literal fails. Both papers are checked: the A4 (`<ok-invoice>`
// `taxes[].label`) and the thermal job (`tax_breakdown[].label`).
import { beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

type Lang = 'en' | 'es';
const CATALOG: Record<Lang, unknown> = { en: enLocale, es: esLocale };

/** One row per fiscal class the breakdown can carry, plus a surcharge and a non-VAT tax. */
const BREAKDOWN = [
  { tax: 'vat', class: 'subject', rate: 21, base: 1000, quota: 210, surcharge_rate: 5.2, surcharge_quota: 52 },
  { tax: 'vat', class: 'exempt', exempt_reason: 'E1', rate: 0, base: 1000, quota: 0 },
  { tax: 'vat', class: 'exempt', rate: 0, base: 1000, quota: 0 },
  { tax: 'vat', class: 'not_subject', rate: 0, base: 1000, quota: 0 },
  { tax: 'vat', class: 'not_subject_location', rate: 0, base: 1000, quota: 0 },
  { tax: 'vat', class: 'subject_reverse', rate: 0, base: 1000, quota: 0 },
  { tax: 'igic', class: 'subject', rate: 7, base: 1000, quota: 70 },
];

const EXPECTED: Record<Lang, string[]> = {
  en: ['VAT 21%', 'Equivalence surcharge 5.2%', 'Exempt (E1)', 'Exempt', 'Not subject', 'Not subject', 'Reverse charge', 'IGIC 7%'],
  // Exactly what the Spanish paper printed before the fix.
  es: ['IVA 21%', 'Recargo de equivalencia 5.2%', 'Exento (E1)', 'Exento', 'No sujeto', 'No sujeto', 'Inversión del sujeto pasivo', 'IGIC 7%'],
};

const DETAIL = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-2026-000009', issue_date: '2026-09-29',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 7000, tax_amount: 332,
  total_amount: 7332, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: 'Calle 1',
  description: '', tax_breakdown: JSON.stringify(BREAKDOWN), currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, rectifies_number: null, paid_at: null, notes: '',
};
const LINES = [{ id: 'li1', line_number: 1, description: 'Corte', quantity: 1_000_000, unit_price: 7000, tax_rate: 21, base_amount: 7000, tax_amount: 332, total_amount: 7332 }];

const erplora: Record<string, unknown> = {};
let printed: Array<Record<string, unknown>> = [];

function stub(lang: Lang): void {
  printed = [];
  Object.assign(erplora, {
    query: async () => [],
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
    print: async (req: Record<string, unknown>) => { printed.push(req); return { via: 'bridge' }; },
  });
  (globalThis as Record<string, unknown>).erplora = erplora;
}

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function mount(lang: Lang, detail: Record<string, unknown> = DETAIL): Promise<Wc> {
  stub(lang);
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Wc;
  document.body.appendChild(el);
  const wc = el as unknown as { detail: unknown; detailLines: unknown[]; aeat: unknown };
  await el.updateComplete;
  wc.detail = detail;
  wc.detailLines = LINES;
  wc.aeat = null;
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

function a4Labels(el: Wc): string[] {
  const doc = el.shadowRoot.querySelector('ok-invoice') as unknown as { invoice: { taxes: Array<{ label: string }> } };
  expect(doc, 'the A4 <ok-invoice> is rendered').toBeTruthy();
  return doc.invoice.taxes.map((t) => t.label);
}

function thermalLabels(el: Wc): string[] {
  (el.shadowRoot.querySelector('header ion-button.print') as HTMLElement).click();
  expect(printed.length, 'the print button went through sdk.print').toBe(1);
  return ((printed[0].data as Record<string, unknown>).tax_breakdown as Array<{ label: string }>).map((r) => r.label);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the tax rows of the printed invoice speak the language of the hub (invoice#132)', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`${lang}: every fiscal class is named in ${lang} on the A4`, async () => {
      expect(a4Labels(await mount(lang))).toEqual(EXPECTED[lang]);
    });

    it(`${lang}: the thermal job carries the same names`, async () => {
      expect(thermalLabels(await mount(lang))).toEqual(EXPECTED[lang]);
    });
  }

  it('en: an invoice issued with the legacy breakdown ({ rate: { base, tax } }) says «VAT 21%»', async () => {
    const el = await mount('en', { ...DETAIL, tax_breakdown: '{"21":{"base":1000,"tax":210}}' });
    expect(a4Labels(el)).toEqual(['VAT 21%']);
  });

  it('en: an invoice with no breakdown at all says «VAT» on its header row', async () => {
    const el = await mount('en', { ...DETAIL, tax_breakdown: '' });
    expect(a4Labels(el)).toEqual(['VAT']);
  });

  it('es: the legacy and header-only rows keep reading «IVA 21%» and «IVA»', async () => {
    expect(a4Labels(await mount('es', { ...DETAIL, tax_breakdown: '{"21":{"base":1000,"tax":210}}' }))).toEqual(['IVA 21%']);
    document.body.innerHTML = '';
    expect(a4Labels(await mount('es', { ...DETAIL, tax_breakdown: '' }))).toEqual(['IVA']);
  });

  it('switching the language of the shell renames the rows of the open invoice', async () => {
    const el = await mount('es');
    expect(a4Labels(el)[0]).toBe('IVA 21%');
    erplora.locale = 'en';
    window.dispatchEvent(new CustomEvent('erplora:locale-changed'));
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(a4Labels(el)).toEqual(EXPECTED.en);
  });
});
