// The other half of `form-testids.test.ts`: the hooks that are WRITTEN are also the hooks that are
// PAINTED (invoice#76).
//
// The guard next door reads the source, which is what lets it freeze a contract — but a contract
// over source text is worth nothing if Lit does not turn it into an attribute. The two ways it
// would not: `data-testid="${expr}"` is an attribute BINDING, not a string, and a hook written on a
// block that never renders is a hook QA cannot reach. Both leave that guard perfectly green.
//
// So this file mounts the two screens and reads the DOM, `getByTestId` style. It is also where the
// reason for `DraftItem.uid` is pinned: deleting a line must not rename the lines below it.
import { beforeEach, describe, expect, it } from 'vitest';

const SERIES = [
  { id: 'sr1', code: 'FACT', name: 'Facturas', invoice_type: 'F1', year: 2026, current_number: 12, prefix: '', is_active: 1, is_default: 1 },
];

const INVOICE = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-2026-000002', issue_date: '2026-08-21',
  customer_name: 'ACME', customer_tax_id: 'B12345678', customer_address: 'Calle 1', base_amount: 10000,
  tax_amount: 2100, total_amount: 12100, status: 'issued', source_type: 'manual', currency: 'EUR',
  notes: '', issuer_name: 'ERPlora', issuer_nif: 'B00000000', source_id: null,
  rectifies_invoice_id: null, paid_at: null,
};

beforeEach(() => {
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) => {
      if (name === 'invoice.series.list') return SERIES;
      if (name === 'invoice.series.peek_next') return [{ next_number: 'FACT-2026-000013', format_locked: 0 }];
      return [];
    },
    queryPage: async () => ({ rows: [INVOICE], total: 1 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

type Mounted = HTMLElement & { shadowRoot: ShadowRoot };

async function settle(el: HTMLElement) {
  const wc = el as unknown as { updateComplete: Promise<unknown> };
  await wc.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await wc.updateComplete;
}

async function mount(tag: 'erp-invoice-list' | 'erp-invoice-settings'): Promise<Mounted> {
  if (tag === 'erp-invoice-list') await import('./components/erp-invoice-list/erp-invoice-list');
  else await import('./components/erp-invoice-settings/erp-invoice-settings');
  const el = document.createElement(tag);
  document.body.appendChild(el);
  await settle(el);
  return el as Mounted;
}

/** What `page.getByTestId(name)` resolves to inside the component's shadow root. */
const byTestId = (el: Mounted, name: string): Element | null =>
  el.shadowRoot.querySelector(`[data-testid="${name}"]`);

const testidsOf = (el: Mounted): string[] =>
  [...el.shadowRoot.querySelectorAll('[data-testid]')].map((n) => n.getAttribute('data-testid')!);

describe('the invoice screen paints the hooks it declares (invoice#76)', () => {
  it('the issuing form and its fields are addressable by name', async () => {
    const el = await mount('erp-invoice-list');
    for (const name of [
      'invoice-create-form',
      'invoice-create-series',
      'invoice-create-customer',
      'invoice-create-customer-tax-id',
      'invoice-create-address',
      'invoice-create-notes',
      'invoice-create-add-line',
      'invoice-create-submit',
      'invoice-create-cancel',
    ]) {
      expect(byTestId(el, name), `getByTestId("${name}") finds nothing on the screen`).not.toBeNull();
    }
  });

  it('a freshly opened form opens on line 1, so QA can predict the name', async () => {
    const el = await mount('erp-invoice-list');
    for (const field of ['description', 'quantity', 'price', 'tax-rate']) {
      expect(byTestId(el, `invoice-line-1-${field}`), `the first line has no ${field} hook`).not.toBeNull();
    }
  });

  it('the interpolated hook is an ATTRIBUTE, not the literal template text', async () => {
    // The failure this pins: `data-testid="invoice-line-${it.uid}-price"` rendered as the string
    // it is written with would leave the guard next door green and QA with nothing to click.
    const el = await mount('erp-invoice-list');
    expect(testidsOf(el).filter((v) => v.includes('${'))).toEqual([]);
  });

  it('deleting a line does NOT rename the lines below it', async () => {
    const el = await mount('erp-invoice-list');
    const wc = el as unknown as { newItems: unknown[]; addItem: () => void };
    (el as unknown as { addItem: () => void }).addItem?.();
    await settle(el);
    expect(byTestId(el, 'invoice-line-2-description'), 'the second line was not added').not.toBeNull();

    // Drop the FIRST line — by index the second would become `…-1-…` and every spec addressing it
    // would silently move to another line. With its own identity it stays `…-2-…`.
    wc.newItems = wc.newItems.slice(1);
    await settle(el);
    expect(byTestId(el, 'invoice-line-2-description')).not.toBeNull();
    expect(byTestId(el, 'invoice-line-1-description')).toBeNull();
  });

  it('the table is handed the namespace its chrome derives from', async () => {
    const el = await mount('erp-invoice-list');
    expect(el.shadowRoot.querySelector('ok-data-table')?.getAttribute('testid')).toBe('invoice-table');
  });

  it('the detail, its state and its actions are addressable by name', async () => {
    const el = await mount('erp-invoice-list');
    const wc = el as unknown as { detail: unknown; detailLines: unknown[]; aeat: unknown };
    wc.detail = INVOICE;
    wc.detailLines = [];
    wc.aeat = { status: 'accepted', csv: 'A1B2C3', qr: 'https://sede.example/validar' };
    await settle(el);
    for (const name of [
      'invoice-detail',
      'invoice-detail-status',
      'invoice-detail-print',
      'invoice-detail-back',
      'invoice-detail-no-lines',
      'invoice-detail-base',
      'invoice-detail-taxes',
      'invoice-detail-total',
      'invoice-aeat',
      'invoice-aeat-status',
      'invoice-aeat-csv',
    ]) {
      expect(byTestId(el, name), `getByTestId("${name}") finds nothing on the detail`).not.toBeNull();
    }
  });

  it('the rectification panel is addressable by name', async () => {
    const el = await mount('erp-invoice-list');
    (el as unknown as { startRectify: (i: unknown) => void }).startRectify(INVOICE);
    await settle(el);
    for (const name of ['invoice-rectify', 'invoice-rectify-reason', 'invoice-rectify-submit', 'invoice-rectify-cancel']) {
      expect(byTestId(el, name), `getByTestId("${name}") finds nothing on the rectify panel`).not.toBeNull();
    }
  });
});

describe('the series screen paints the hooks it declares (invoice#76)', () => {
  it('the series form and its fields are addressable by name', async () => {
    const el = await mount('erp-invoice-settings');
    for (const name of [
      'invoice-series-form',
      'invoice-series-code',
      'invoice-series-name',
      'invoice-series-type',
      'invoice-series-year',
      'invoice-series-prefix',
      'invoice-series-format',
      'invoice-series-active',
      'invoice-series-default',
      'invoice-series-submit',
      'invoice-series-cancel',
    ]) {
      expect(byTestId(el, name), `getByTestId("${name}") finds nothing on the screen`).not.toBeNull();
    }
  });

  it('the series table is handed the namespace its chrome derives from', async () => {
    const el = await mount('erp-invoice-settings');
    expect(el.shadowRoot.querySelector('ok-data-table')?.getAttribute('testid')).toBe('invoice-series-table');
  });
});
