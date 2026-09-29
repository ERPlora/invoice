// @vitest-environment happy-dom

// invoice#138 — the detail of an invoice painted «Fecha de emisión» as the database writes it
// («2026-09-29») while «Pagada el», right below, already read «29/9/26, 22:33». The issue date is
// painted in the date format of the person's language now, on the screen and on the printed A4.
//
// It is a CALENDAR date, not a moment: `new Date('2026-09-29')` reads it as UTC midnight, and a
// business west of Greenwich would see the day before. The process and the business clock are put
// in Los Angeles here so that a formatter that goes through a moment fails.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

type Lang = 'en' | 'es';
const CATALOG: Record<Lang, unknown> = { en: enLocale, es: esLocale };

const DETAIL = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-2026-000010', issue_date: '2026-09-29',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 1000, tax_amount: 210,
  total_amount: 1210, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, rectifies_number: null, paid_at: null, notes: '',
};

const erplora: Record<string, unknown> = {};
const WEST = 'America/Los_Angeles';
let previousTz: string | undefined;

beforeAll(() => {
  previousTz = process.env.TZ;
  process.env.TZ = WEST;
});
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

function stub(lang: string): void {
  Object.assign(erplora, {
    query: async () => [],
    queryOptional: async () => undefined,
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: lang,
    timezone: WEST,
    t: (catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>) => {
      let node: unknown = catalog[erplora.locale as Lang] ?? catalog.en;
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

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function settle(el: Wc) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

async function mount(lang: string, detail: Record<string, unknown> = DETAIL): Promise<Wc> {
  stub(lang);
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  const wc = el as unknown as { detail: unknown; detailLines: unknown[]; aeat: unknown };
  wc.detail = detail;
  wc.detailLines = [];
  wc.aeat = null;
  await settle(el);
  return el;
}

function issueDate(el: Wc): string {
  const dd = el.shadowRoot.querySelector('[data-testid="invoice-detail-issue-date"]');
  expect(dd, 'the issue date of the detail carries its hook').toBeTruthy();
  return dd!.textContent!.trim();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the issue date of the invoice detail reads in the date format of the language (invoice#138)', () => {
  it('es: «29/9/2026», the same calendar day west of Greenwich', async () => {
    expect(issueDate(await mount('es'))).toBe('29/9/2026');
  });

  it('en: «9/29/2026»', async () => {
    expect(issueDate(await mount('en'))).toBe('9/29/2026');
  });

  for (const zone of ['Europe/Madrid', 'Pacific/Kiritimati']) {
    it(`es: still «29/9/2026» with the device and the business east of Greenwich (${zone})`, async () => {
      process.env.TZ = zone;
      try {
        const el = await mount('es');
        erplora.timezone = zone;
        expect(issueDate(el)).toBe('29/9/2026');
      } finally {
        process.env.TZ = WEST;
      }
    });
  }

  it('a day that does not exist in the calendar («2026-02-30») is shown as stored, not rolled over', async () => {
    expect(issueDate(await mount('es', { ...DETAIL, issue_date: '2026-02-30' }))).toBe('2026-02-30');
  });

  it('the first day of a month does not slip back to the previous month', async () => {
    expect(issueDate(await mount('es', { ...DETAIL, issue_date: '2026-10-01' }))).toBe('1/10/2026');
  });

  // <ok-invoice> paints `issue_date` verbatim: the printed A4 said «2026-09-29» on a Spanish paper.
  for (const [lang, expected] of [['es', '29/9/2026'], ['en', '9/29/2026']] as const) {
    it(`${lang}: the printed A4 dates the invoice «${expected}» too`, async () => {
      const el = await mount(lang);
      const doc = el.shadowRoot.querySelector('ok-invoice') as unknown as { invoice: { issue_date: string } };
      expect(doc, 'the A4 <ok-invoice> is rendered').toBeTruthy();
      expect(doc.invoice.issue_date).toBe(expected);
    });
  }

  it('switching the language of the shell repaints the date of the open detail', async () => {
    const el = await mount('en');
    expect(issueDate(el)).toBe('9/29/2026');
    erplora.locale = 'es';
    window.dispatchEvent(new CustomEvent('erplora:locale-changed'));
    await settle(el);
    expect(issueDate(el)).toBe('29/9/2026');
  });

  it('a language tag Intl cannot read («es_ES») still paints the date instead of an empty screen', async () => {
    expect(issueDate(await mount('es_ES'))).toMatch(/2026/);
  });

  it('a value that is not a calendar date is shown as stored, never as «Invalid Date»', async () => {
    expect(issueDate(await mount('es', { ...DETAIL, issue_date: 'pendiente' }))).toBe('pendiente');
  });
});
