// @vitest-environment happy-dom

// invoice#86 — «Imprimir» on an invoice from the Invoices list. On an installed app with a thermal
// printer the hub prints a `documentType: 'invoice'` as a FULL invoice and refuses one without the
// customer's tax id or the VAT per rate (ERPlora/hub#2005): no paper, a failed job. So the viewer
// sends both, taken from the same breakdown the A4 paints, and warns on screen when the tax id is
// missing. A simplified invoice (F2, R5) is a ticket, not a full invoice: it goes as `receipt`,
// the way sales prints its tickets, and needs no customer tax id.
import { beforeEach, describe, expect, it } from 'vitest';

const DETAIL = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-0001', issue_date: '2026-08-25',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 3967, tax_amount: 833,
  total_amount: 4800, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: 'Calle 1', description: '',
  tax_breakdown: '[{"tax":"vat","regime":"01","class":"subject","rate":21,"base":3967,"quota":833}]',
  currency: 'EUR', source_id: null, rectifies_invoice_id: null, paid_at: null, notes: '',
};
const LINES = [{ id: 'li1', line_number: 1, description: 'Corte', quantity: 1_000_000, unit_price: 4800, tax_rate: 21, base_amount: 3967, tax_amount: 833, total_amount: 4800 }];

let printed: Array<Record<string, unknown>> = [];

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = 'es';
  printed = [];
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryOptional: async () => undefined,
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
    print: async (req: Record<string, unknown>) => { printed.push(req); return { via: 'bridge' }; },
  };
});

async function mountDetail(detail: Record<string, unknown>): Promise<HTMLElement & { shadowRoot: ShadowRoot }> {
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
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

function print(el: HTMLElement & { shadowRoot: ShadowRoot }): Record<string, unknown> {
  (el.shadowRoot.querySelector('header ion-button.print') as HTMLElement).click();
  expect(printed.length, 'the print button went through sdk.print').toBe(1);
  return printed[0];
}

describe('the thermal job of a full invoice carries what the hub demands (invoice#86)', () => {
  it('F1: customer tax id, address and the VAT per rate, in major units', async () => {
    const req = print(await mountDetail(DETAIL));
    expect(req).toMatchObject({ documentType: 'invoice', role: 'receipt' });
    expect(req.data).toMatchObject({
      customer_tax_id: 'B12345678',
      customer_address: 'Calle 1',
      tax_breakdown: [{ rate: 21, base: 39.67, tax: 8.33, label: 'IVA 21%' }],
    });
  });

  it('the legacy object breakdown ({ rate: { base, tax } }) prints too', async () => {
    const req = print(await mountDetail({ ...DETAIL, tax_breakdown: '{"21":{"base":3967,"tax":833}}' }));
    expect((req.data as Record<string, unknown>).tax_breakdown).toEqual([{ rate: 21, base: 39.67, tax: 8.33, label: 'IVA 21%' }]);
  });

  it('no stored breakdown (a rectifying invoice): one row from the header amounts, never an empty array', async () => {
    const req = print(await mountDetail({ ...DETAIL, invoice_type: 'R1', tax_breakdown: '' }));
    expect((req.data as Record<string, unknown>).tax_breakdown).toEqual([{ rate: 0, base: 39.67, tax: 8.33, label: 'IVA' }]);
  });

  it('a simplified invoice (F2, R5) goes as a ticket (`receipt`), which needs no customer tax id', async () => {
    for (const invoice_type of ['F2', 'R5']) {
      printed = [];
      const req = print(await mountDetail({ ...DETAIL, invoice_type, customer_tax_id: '' }));
      expect(req.documentType, invoice_type).toBe('receipt');
    }
  });
});

describe('the viewer warns before printing a full invoice without the customer tax id (invoice#86)', () => {
  const warning = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
    el.shadowRoot.querySelector('[data-testid="invoice-missing-tax-id"]');

  it('F1 without tax id: warning shown', async () => {
    const el = await mountDetail({ ...DETAIL, customer_tax_id: '' });
    expect(warning(el)?.textContent?.trim()).toBe('ui.invoiceMissingCustomerTaxId');
  });

  it('F1 with tax id: no warning', async () => {
    expect(warning(await mountDetail(DETAIL))).toBeNull();
  });

  it('F2 without tax id: no warning (a simplified invoice has no customer to identify)', async () => {
    expect(warning(await mountDetail({ ...DETAIL, invoice_type: 'F2', customer_tax_id: '' }))).toBeNull();
  });
});
