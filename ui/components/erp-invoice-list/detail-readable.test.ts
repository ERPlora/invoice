// @vitest-environment happy-dom

// invoice#108 — the invoice detail painted internal data verbatim:
//   · «Paid on» was the raw timestamp the runtime stores («2026-09-26T17:37:51.346777882+00:00»);
//   · «Source» was the technical code plus the sale's internal id («sale · 3f0c…»);
//   · «Rectifies» was the internal id of the original invoice, not its number.
// The moment is read on the BUSINESS clock (`erplora.timezone`, hub#1212; UTC when the shell sends
// none or an unreadable one) — never the device's: a tablet in another zone must not move the hour.
//
// invoice#110 — on a phone the lines table ran off the right edge: Base, Tax and Total were cut.
// happy-dom does no layout, so what is pinned here is the CONTRACT that makes the stacked layout
// possible (every cell names its column; the narrow rule turns rows into blocks). That it really
// fits at 390 px is measured in a real browser on the bench (PR evidence).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

type Lang = 'en' | 'es';
const CATALOG: Record<Lang, unknown> = { en: enLocale, es: esLocale };
const ui = (lang: Lang, key: string) => (CATALOG[lang] as { ui: Record<string, string> }).ui[key];

const DETAIL = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-2026-000007', issue_date: '2026-09-26',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 4000, tax_amount: 840,
  total_amount: 4840, status: 'paid', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null as string | null,
  rectifies_invoice_id: null as string | null, paid_at: null as string | null, notes: '',
};
const LINES = [
  { id: 'li1', line_number: 1, description: 'Corte y peinado', quantity: 1_000_000, unit_price: 4000, tax_rate: 21, base_amount: 4000, tax_amount: 840, total_amount: 4840, product_id: null },
];
const SALE_ID = '3f0c1e2a-9b7d-4c1e-8a55-0d6f3b2a91c4';
const ORIGINAL_ID = '7d2b4a10-5c3e-4f8a-9e21-6b0c8d4f2e17';

interface Env { lang?: Lang; timezone?: string; originals?: Record<string, unknown> }
const queries: { name: string; params?: Record<string, unknown> }[] = [];
const deviceTz = process.env.TZ;

function stub({ lang = 'es', timezone, originals = {} }: Env = {}): void {
  queries.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params?: Record<string, unknown>) => {
      queries.push({ name, params });
      if (name === 'invoice.get') {
        const row = originals[String(params?.invoice_id)];
        return row ? [row] : [];
      }
      return [];
    },
    queryOptional: async () => undefined,
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: lang,
    timezone,
    t: (catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>) => {
      let node: unknown = catalog[lang];
      for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
      const text = typeof node === 'string' ? node : key;
      return text.replace(/\{(\w+)\}/g, (_, p: string) => String(params?.[p] ?? `{${p}}`));
    },
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
}

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  detail: unknown; detailLines: unknown[];
  openDetail(id: string): Promise<void>;
  updateComplete: Promise<unknown>;
};

async function settle(wc: Wc) {
  await wc.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await wc.updateComplete;
}

/** Mounts the list and opens `detail` the way a click does (invoice.get + invoice.lines). */
async function openDetail(detail: typeof DETAIL, env: Env = {}): Promise<Wc> {
  stub({ ...env, originals: { [detail.id]: detail, ...(env.originals ?? {}) } });
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Wc;
  document.body.appendChild(el);
  await settle(el);
  await el.openDetail(detail.id);
  el.detailLines = LINES;
  await settle(el);
  return el;
}

/** The `<dd>` whose `<dt>` reads `label`, or null when the field is not painted. */
function field(el: Wc, label: string): HTMLElement | null {
  for (const dt of el.shadowRoot.querySelectorAll('[data-testid="invoice-detail"] dl dt')) {
    if (dt.textContent?.trim() === label) return dt.nextElementSibling as HTMLElement | null;
  }
  return null;
}
const text = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();

beforeEach(() => {
  document.body.innerHTML = '';
  // The DEVICE sits far from the business: a formatter that forgets `timeZone` shows it.
  process.env.TZ = 'America/Los_Angeles';
});
afterEach(() => {
  if (deviceTz === undefined) delete process.env.TZ;
  else process.env.TZ = deviceTz;
});

describe('«Paid on» is a date and time on the business clock (invoice#108)', () => {
  const PAID = '2026-09-26T17:37:51.346777882+00:00'; // verbatim what the runtime stores

  it('es: day/month/year and hour in the business zone, never the raw timestamp', async () => {
    const el = await openDetail({ ...DETAIL, paid_at: PAID }, { lang: 'es', timezone: 'Pacific/Kiritimati' });
    const dd = field(el, ui('es', 'fieldPaidAt'));
    expect(dd, '«Pagada el» is painted for a paid invoice').toBeTruthy();
    // Kiritimati is UTC+14: 17:37 UTC on the 26th is 07:37 on the 27th there. Los Angeles (the
    // device) would say 10:37 on the 26th.
    expect(text(dd)).toBe('27/9/26, 7:37');
  });

  it('en: the same moment in the English format', async () => {
    const el = await openDetail({ ...DETAIL, paid_at: PAID }, { lang: 'en', timezone: 'Pacific/Kiritimati' });
    expect(text(field(el, ui('en', 'fieldPaidAt')))).toBe('9/27/26, 7:37 AM');
  });

  it('a shell that publishes no zone, or an unreadable one, reads the moment in UTC (the runtime clock)', async () => {
    for (const timezone of [undefined, '', 'Not/AZone']) {
      const el = await openDetail({ ...DETAIL, paid_at: PAID }, { lang: 'es', timezone });
      expect(text(field(el, ui('es', 'fieldPaidAt'))), `timezone=${String(timezone)}`).toBe('26/9/26, 17:37');
    }
  });

  it('something that is not a moment paints «—», never «Invalid Date» nor the raw value', async () => {
    const el = await openDetail({ ...DETAIL, paid_at: 'yesterday-ish' }, { lang: 'es', timezone: 'Europe/Madrid' });
    expect(text(field(el, ui('es', 'fieldPaidAt')))).toBe('—');
  });

  it('an unpaid invoice has no «Paid on» field at all', async () => {
    const el = await openDetail({ ...DETAIL, status: 'issued', paid_at: null }, { lang: 'es' });
    expect(field(el, ui('es', 'fieldPaidAt'))).toBeNull();
  });
});

describe('«Source» says where the invoice came from, in words, without internal ids (invoice#108)', () => {
  // Every source_type the module writes (handler: manual/sale/substitution; rectify_insert:
  // rectification) plus the two the column comment documents for integrations (pos, order).
  const KNOWN: Record<string, string> = {
    sale: 'sourceSale', pos: 'sourceSale', order: 'sourceOrder', manual: 'sourceManual',
    substitution: 'sourceSubstitution', rectification: 'sourceRectification',
  };

  for (const lang of ['en', 'es'] as Lang[]) {
    it(`${lang}: each known origin is its translated label, and the sale id is not shown`, async () => {
      for (const [code, key] of Object.entries(KNOWN)) {
        const label = ui(lang, key);
        expect(label, `${lang}.ui.${key} exists`).toBeTruthy();
        const el = await openDetail({ ...DETAIL, source_type: code, source_id: code === 'manual' ? null : SALE_ID }, { lang });
        const shown = text(field(el, ui(lang, 'fieldSource')));
        expect(shown, `source_type=${code}`).toBe(label);
        expect(shown).not.toContain(SALE_ID);
      }
    });

    it(`${lang}: an origin this module does not know is «Other», not the raw code`, async () => {
      const el = await openDetail({ ...DETAIL, source_type: 'woo_import', source_id: 'x-1' }, { lang });
      expect(text(field(el, ui(lang, 'fieldSource')))).toBe(ui(lang, 'sourceOther'));
    });
  }

  it('the labels are real translations: es differs from en for every origin', () => {
    for (const key of ['sourceSale', 'sourceOrder', 'sourceManual', 'sourceSubstitution', 'sourceRectification', 'sourceOther']) {
      expect(ui('es', key), key).toBeTruthy();
      expect(ui('en', key), key).toBeTruthy();
    }
    expect(ui('es', 'sourceSale')).not.toBe(ui('en', 'sourceSale'));
  });
});

describe('«Rectifies» names the original invoice by its number and opens it (invoice#108)', () => {
  const ORIGINAL = { ...DETAIL, id: ORIGINAL_ID, number: 'FACT-2026-000003', status: 'issued' };
  const RECTIFYING = { ...DETAIL, id: 'r1', invoice_type: 'R1', number: 'R-2026-000001', status: 'issued', source_type: 'rectification', rectifies_invoice_id: ORIGINAL_ID };

  it('shows the number of the original, never its internal id', async () => {
    const el = await openDetail(RECTIFYING, { lang: 'es', originals: { [ORIGINAL_ID]: ORIGINAL } });
    const dd = field(el, ui('es', 'fieldRectifies'));
    expect(text(dd)).toBe('FACT-2026-000003');
    expect(text(dd)).not.toContain(ORIGINAL_ID);
    expect(queries.some((q) => q.name === 'invoice.get' && q.params?.invoice_id === ORIGINAL_ID),
      'the number is read through the dispatcher (invoice.get, hub-scoped), not guessed').toBe(true);
  });

  it('the number is a link that opens the original invoice', async () => {
    const el = await openDetail(RECTIFYING, { lang: 'es', originals: { [ORIGINAL_ID]: ORIGINAL } });
    const link = el.shadowRoot.querySelector('[data-testid="invoice-detail-rectifies-link"]') as HTMLElement | null;
    expect(link, 'the original is reachable from the rectifying one').toBeTruthy();
    link!.click();
    await settle(el);
    await settle(el);
    expect((el.detail as { id?: string } | null)?.id).toBe(ORIGINAL_ID);
    expect(text(el.shadowRoot.querySelector('[data-testid="invoice-detail"] h2'))).toContain('FACT-2026-000003');
  });

  it('an original it cannot read (another hub, no permission) paints «—», never the id', async () => {
    const el = await openDetail(RECTIFYING, { lang: 'es', originals: {} });
    const dd = field(el, ui('es', 'fieldRectifies'));
    expect(text(dd)).toBe('—');
    expect(el.shadowRoot.querySelector('[data-testid="invoice-detail-rectifies-link"]')).toBeNull();
  });

  it('a refused read of the original (permission, network) still opens the rectifying one, with «—»', async () => {
    stub({ lang: 'es', originals: { r1: RECTIFYING } });
    const erp = (globalThis as { erplora: { query: (n: string, p?: Record<string, unknown>) => Promise<unknown> } }).erplora;
    const base = erp.query;
    erp.query = async (name, params) => {
      if (name === 'invoice.get' && params?.invoice_id === ORIGINAL_ID) throw Object.assign(new Error('refused'), { code: 'permission_denied' });
      return base(name, params);
    };
    await import('./erp-invoice-list');
    const el = document.createElement('erp-invoice-list') as Wc;
    document.body.appendChild(el);
    await settle(el);
    await el.openDetail('r1');
    await settle(el);
    expect((el.detail as { id?: string } | null)?.id, 'the rectifying invoice is open').toBe('r1');
    expect(text(field(el, ui('es', 'fieldRectifies')))).toBe('—');
    expect(el.shadowRoot.querySelector('[data-testid="invoice-detail-rectifies-link"]')).toBeNull();
  });

  it('a late reply for the original never paints over another invoice opened meanwhile', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const el = await openDetail({ ...DETAIL }, { lang: 'es' });
    const other = { ...DETAIL, id: 'i2', number: 'FACT-2026-000009' };
    const erp = (globalThis as { erplora: { query: (n: string, p?: Record<string, unknown>) => Promise<unknown> } }).erplora;
    erp.query = async (name, params) => {
      if (name === 'invoice.get' && params?.invoice_id === ORIGINAL_ID) { await gate; return [ORIGINAL]; }
      if (name === 'invoice.get' && params?.invoice_id === 'r1') return [RECTIFYING];
      if (name === 'invoice.get' && params?.invoice_id === 'i2') return [other];
      return [];
    };
    const first = el.openDetail('r1');
    await new Promise((r) => setTimeout(r, 0));
    await el.openDetail('i2');
    release();
    await first;
    await settle(el);
    expect((el.detail as { id?: string }).id).toBe('i2');
    expect(field(el, ui('es', 'fieldRectifies')), 'the plain invoice opened last has no «Rectifies»').toBeNull();
  });
});

describe('the lines table fits a phone without losing the money columns (invoice#110)', () => {
  const HEADS = ['lineDescription', 'lineQty', 'linePrice', 'lineTaxPct', 'lineBase', 'lineTax', 'lineTotal'];

  for (const lang of ['en', 'es'] as Lang[]) {
    it(`${lang}: every cell carries its column name, so a stacked row still says what each amount is`, async () => {
      const el = await openDetail({ ...DETAIL }, { lang });
      const table = el.shadowRoot.querySelector('[data-testid="invoice-detail-lines"]');
      expect(table).toBeTruthy();
      const heads = [...table!.querySelectorAll('thead th')].map((th) => text(th));
      const cells = [...table!.querySelectorAll('tbody tr:first-child td')];
      expect(cells.length).toBe(heads.length);
      cells.forEach((td, i) => expect(td.getAttribute('data-label'), `column ${heads[i]}`).toBe(heads[i]));
      for (const key of HEADS) expect(heads, `${lang}: ${key} is a column`).toContain(ui(lang, key));
    });
  }

  it('the table sits in a size container and, when narrow, each line becomes a block that labels its amounts', async () => {
    const { ErpInvoiceList } = await import('./erp-invoice-list');
    const css = (ErpInvoiceList as unknown as { styles: { cssText: string } }).styles.cssText.replace(/\s+/g, ' ');
    expect(css, 'the card that holds the table is an inline-size container').toMatch(/\.card \{[^}]*container-type: ?inline-size/);
    const narrow = css.match(/@container \(max-width: ?(\d+(?:\.\d+)?)rem\) \{(.*?)\} \}/);
    expect(narrow, 'a narrow-container rule exists').toBeTruthy();
    const [, width, body] = narrow!;
    // 390 px phone minus the page and card padding is ~340 px ≈ 21rem; the eight columns need
    // about 38rem. The rule must switch before the table overflows.
    expect(Number(width)).toBeGreaterThanOrEqual(36);
    expect(body).toMatch(/table\.lines thead \{[^}]*display: ?none/);
    expect(body).toMatch(/table\.lines tr \{[^}]*display: ?grid/);
    expect(body).toMatch(/table\.lines td::before \{[^}]*content: ?attr\(data-label\)/);
  });
});
