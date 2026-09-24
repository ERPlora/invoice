// @vitest-environment happy-dom

// invoice#88 — «Print» on an invoice detail said nothing about what happened: the viewer threw the
// shell's PrintResult away, so a job queued with no printer to take it, or one that failed, looked
// the same as paper coming out. Same rule as the sales viewer (sales#349): a printer or the queue
// took it → silence (the paper is the answer); queued with nobody to drain it → a warning that it
// waits for a printer; anything else → an error with the reason.
import { beforeEach, describe, expect, it } from 'vitest';

const DETAIL = {
  id: 'i1', invoice_type: 'F2', series: 'T', number: 'T-0001', issue_date: '2026-08-25',
  customer_name: '', customer_tax_id: '', base_amount: 3967, tax_amount: 833,
  total_amount: 4800, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '', description: '',
  tax_breakdown: '[{"tax":"vat","regime":"01","class":"subject","rate":21,"base":3967,"quota":833}]',
  currency: 'EUR', source_id: null, rectifies_invoice_id: null, paid_at: null, notes: '',
};
const LINES = [{ id: 'li1', line_number: 1, description: 'Corte', quantity: 1_000_000, unit_price: 4800, tax_rate: 21, base_amount: 3967, tax_amount: 833, total_amount: 4800 }];

type Result = Record<string, unknown> | Error;
let result: Result = { via: 'bridge' };
let notes: Array<{ type: string; message: string }> = [];

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = 'es';
  notes = [];
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryOptional: async () => undefined,
    queryPage: async () => ({ rows: [DETAIL], total: 1 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_c: unknown, key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
    print: async () => { if (result instanceof Error) throw result; return result; },
    notify: (n: { type: string; message: string }) => { notes.push(n); },
  };
});

async function printDetail(): Promise<void> {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as HTMLElement & { shadowRoot: ShadowRoot };
  document.body.appendChild(el);
  const wc = el as unknown as { detail: unknown; detailLines: unknown[]; aeat: unknown; updateComplete: Promise<unknown> };
  await wc.updateComplete;
  wc.detail = DETAIL;
  wc.detailLines = LINES;
  wc.aeat = null;
  await wc.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await wc.updateComplete;
  (el.shadowRoot.querySelector('header ion-button.print') as HTMLElement).click();
  await new Promise((r) => setTimeout(r, 0));
}

describe('the invoice viewer says when Print did not produce paper (invoice#88)', () => {
  it('a printer took it: silence', async () => {
    result = { via: 'bridge', role: 'receipt' };
    await printDetail();
    expect(notes).toEqual([]);
  });

  it('the queue took it and a printer drains it: silence', async () => {
    result = { via: 'queue', role: 'receipt', awaitingHost: false };
    await printDetail();
    expect(notes).toEqual([]);
  });

  it('the browser print dialog opened (A4): silence', async () => {
    result = { via: 'browser', role: 'receipt' };
    await printDetail();
    expect(notes).toEqual([]);
  });

  it('queued with no printer set up for this station: a warning that it waits for one', async () => {
    result = { via: 'queue', role: 'receipt', awaitingHost: true };
    await printDetail();
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('warning');
    expect(notes[0].message).toContain('ui.printWaitingForPrinter');
    expect(notes[0].message).toContain('T-0001');
  });

  it('printed nowhere: an error with the reason', async () => {
    result = { via: 'none', role: 'receipt', error: 'printer offline' };
    await printDetail();
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('error');
    expect(notes[0].message).toContain('ui.printFailed');
    expect(notes[0].message).toContain('printer offline');
  });

  it('the print gate threw: an error, not an unhandled rejection', async () => {
    result = new Error('runtime unreachable');
    await printDetail();
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('error');
    expect(notes[0].message).toContain('runtime unreachable');
  });
});
