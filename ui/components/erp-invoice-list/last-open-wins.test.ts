// @vitest-environment happy-dom

// invoice#102 (pm#459) — two invoices tapped in a row: the LAST one wins.
//
// Opening an invoice waits twice: `invoice.get` + `invoice.lines` together, and then the VeriFactu
// record (`verifactu.records.by_invoice`: AEAT status, CSV and QR). Nothing tied those replies to
// the opening that asked for them, so a slow reply for the FIRST invoice could land after the
// SECOND one opened and paint its header/lines — or, worse, the FIRST invoice's QR and CSV under
// the second invoice, which is what `printDetail` then sends to paper.
//
// These tests only decide WHICH reply is painted. Series, numbering, hash, the AEAT submission and
// the QR content itself are not touched.
import { beforeEach, describe, expect, it } from 'vitest';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const invoice = (id: string, number: string) => ({
  id, invoice_type: 'F1', series: 'FACT', number, issue_date: '2026-09-26',
  customer_name: `Customer ${id}`, customer_tax_id: 'B12345678', base_amount: 10000, tax_amount: 2100,
  total_amount: 12100, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, paid_at: null, notes: '',
});
const INV1 = invoice('i1', 'FACT-0001');
const INV2 = invoice('i2', 'FACT-0002');
const linesOf = (id: string) => [{
  id: `${id}-l1`, line_number: 1, description: `Line of ${id}`, quantity: 1_000_000,
  unit_price: 10000, tax_rate: 21, base_amount: 10000, tax_amount: 2100, total_amount: 12100,
}];
const qrOf = (id: string) => `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B00000000&numserie=${id}`;
const aeatOf = (id: string, status = 'accepted') => ({ status, aeat_csv: `CSV-${id}`, qr_url: qrOf(id), record_type: 'alta' });

// One held reply per (query, invoice id). A query nobody holds answers at once.
let held: Map<string, Deferred<unknown>>;
let printed: Record<string, unknown>[];
const key = (name: string, id: unknown) => `${name}:${String(id)}`;
function hold(name: string, id: string): Deferred<unknown> {
  const d = deferred<unknown>();
  held.set(key(name, id), d);
  return d;
}
// Holds only the FIRST call of (query, id); later calls answer at once — for a reopening of the
// SAME invoice, where the first reply must be the slow one.
let heldOnce: Map<string, Deferred<unknown>>;
function holdFirst(name: string, id: string): Deferred<unknown> {
  const d = deferred<unknown>();
  heldOnce.set(key(name, id), d);
  return d;
}
const answer = (name: string, id: string): unknown =>
  name === 'invoice.get' ? (id === 'i1' ? INV1 : INV2)
  : name === 'invoice.lines' ? linesOf(id)
  : name === 'verifactu.records.by_invoice' ? aeatOf(id)
  : [];

beforeEach(() => {
  document.body.innerHTML = '';
  held = new Map();
  heldOnce = new Map();
  printed = [];
  const reply = (name: string, params: Record<string, unknown> = {}) => {
    const k = key(name, params.invoice_id);
    const once = heldOnce.get(k);
    if (once) { heldOnce.delete(k); return once.promise; }
    const d = held.get(k);
    return d ? d.promise : Promise.resolve(answer(name, String(params.invoice_id)));
  };
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params: Record<string, unknown>) => (name === 'invoice.series.list' ? [] : reply(name, params)),
    queryOptional: async (name: string, params: Record<string, unknown>) => reply(name, params),
    queryPage: async () => ({ rows: [INV1, INV2], total: 2 }),
    command: async () => ({}),
    print: async (req: Record<string, unknown>) => { printed.push(req); return { via: 'bridge' }; },
    notify: () => {},
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_c: unknown, k: string) => k,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

type El = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function settle(el: El) {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
}

async function mount(): Promise<El> {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as El;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

// The REAL door: the table's `rowClick` (the whole row opens the invoice, pm#155).
function tapRow(el: El, row: Record<string, unknown>) {
  const table = el.shadowRoot.querySelector('ok-data-table');
  expect(table, 'the list must be on screen to tap a row').toBeTruthy();
  table!.dispatchEvent(new CustomEvent('rowClick', { detail: { row } }));
}

const q = (el: El, testid: string) => el.shadowRoot.querySelector(`[data-testid="${testid}"]`);

/** What the open invoice sheet shows: number, lines, and the VeriFactu block (CSV + QR). */
function sheet(el: El) {
  const wc = el as unknown as { detail: { id: string } | null; detailLines: { description: string }[] };
  return {
    id: wc.detail?.id ?? null,
    lines: wc.detailLines.map((l) => l.description),
    csv: q(el, 'invoice-aeat-csv')?.textContent ?? null,
    qr: el.shadowRoot.querySelector('[data-testid="invoice-aeat"] ok-qr')?.getAttribute('value') ?? null,
  };
}

async function printQr(el: El): Promise<unknown> {
  (q(el, 'invoice-detail-print') as HTMLElement).click();
  await settle(el);
  const job = printed.at(-1) as { data?: { qr_data?: unknown } } | undefined;
  return job?.data?.qr_data;
}

describe('two invoices opened in a row: the last one wins (invoice#102, pm#459)', () => {
  it('when the FIRST invoice header/lines settle last, the sheet stays on the SECOND invoice', async () => {
    const el = await mount();
    const get1 = hold('invoice.get', 'i1');
    const lines1 = hold('invoice.lines', 'i1');
    tapRow(el, INV1);
    tapRow(el, INV2);
    await settle(el);
    expect(sheet(el).id, 'the second invoice opened').toBe('i2');

    get1.resolve(INV1);
    lines1.resolve(linesOf('i1'));
    await settle(el);

    expect(sheet(el)).toEqual({ id: 'i2', lines: ['Line of i2'], csv: 'CSV-i2', qr: qrOf('i2') });
  });

  it('when the FIRST invoice AEAT record settles last, the QR and CSV are the SECOND invoice\'s — on screen and on paper', async () => {
    const el = await mount();
    const aeat1 = hold('verifactu.records.by_invoice', 'i1');
    tapRow(el, INV1);
    tapRow(el, INV2);
    await settle(el);
    expect(sheet(el).qr, 'the second invoice painted its own QR').toBe(qrOf('i2'));

    aeat1.resolve(aeatOf('i1'));
    await settle(el);

    expect(sheet(el)).toEqual({ id: 'i2', lines: ['Line of i2'], csv: 'CSV-i2', qr: qrOf('i2') });
    expect(await printQr(el), 'the paper carries the QR of ANOTHER invoice').toBe(qrOf('i2'));
  });

  it('the AEAT status badge is the SECOND invoice\'s when the first record settles last', async () => {
    const el = await mount();
    const get1 = hold('invoice.get', 'i1');
    const aeat1 = hold('verifactu.records.by_invoice', 'i1');
    const aeat2 = hold('verifactu.records.by_invoice', 'i2');
    tapRow(el, INV1);
    tapRow(el, INV2);
    get1.resolve(INV1);
    await settle(el);
    aeat2.resolve(aeatOf('i2', 'pending'));
    await settle(el);
    aeat1.resolve(aeatOf('i1', 'accepted'));
    await settle(el);

    const wc = el as unknown as { aeat: { status?: string } | null };
    expect(sheet(el).id).toBe('i2');
    expect(wc.aeat?.status, 'the AEAT status of the first invoice is painted under the second').toBe('pending');
    expect(sheet(el).qr).toBe(qrOf('i2'));
  });

  it('«Back» then another invoice: a late AEAT record of the closed invoice never shows under the new one', async () => {
    const el = await mount();
    const aeat1 = hold('verifactu.records.by_invoice', 'i1');
    tapRow(el, INV1);
    await settle(el);
    expect(sheet(el).id).toBe('i1');
    (q(el, 'invoice-detail-back') as HTMLElement).click();
    await settle(el);
    aeat1.resolve(aeatOf('i1'));
    await settle(el);

    const aeat2 = hold('verifactu.records.by_invoice', 'i2');
    tapRow(el, INV2);
    await settle(el);

    expect(sheet(el), 'while the second record loads, no QR of the first invoice').toEqual({
      id: 'i2', lines: ['Line of i2'], csv: null, qr: null,
    });
    expect(await printQr(el), 'printing now must not carry the closed invoice\'s QR').toBeUndefined();
    aeat2.resolve(aeatOf('i2'));
    await settle(el);
    expect(sheet(el).qr).toBe(qrOf('i2'));
  });

  it('a late FAILURE of the first invoice does not paint an error while the second is loading', async () => {
    const el = await mount();
    const get1 = hold('invoice.get', 'i1');
    const get2 = hold('invoice.get', 'i2');
    tapRow(el, INV1);
    tapRow(el, INV2);
    get1.reject(new Error('boom-i1'));
    await settle(el);

    expect(q(el, 'invoice-detail-load-error'), 'the error of the abandoned invoice is painted').toBeNull();
    get2.resolve(INV2);
    await settle(el);
    expect(sheet(el).id).toBe('i2');
  });

  it('a late NOT FOUND of the first invoice does not paint an error while the second is loading', async () => {
    const el = await mount();
    const get1 = hold('invoice.get', 'i1');
    const get2 = hold('invoice.get', 'i2');
    tapRow(el, INV1);
    tapRow(el, INV2);
    get1.resolve([]);
    await settle(el);

    expect(q(el, 'invoice-detail-load-error'), '«not found» of the abandoned invoice is painted').toBeNull();
    get2.resolve(INV2);
    await settle(el);
    expect(sheet(el).id).toBe('i2');
  });

  // rv-staff-69: a guard by invoice ID (instead of by opening generation) survives a reopening of
  // the SAME invoice — the late reply carries the same id as the sheet on screen. With the sheet
  // open the list is gone, so the real door is «Mark paid», which reloads the open invoice (and
  // reads its AEAT record again). A late load FAILURE is not observable here: the load error only
  // renders in the list view, and «Back» clears it.
  it('«Mark paid» on the open invoice: a late AEAT record of the first reading does not overwrite the fresh one', async () => {
    const el = await mount();
    const firstAeat = holdFirst('verifactu.records.by_invoice', 'i1');
    tapRow(el, INV1);
    await settle(el);
    expect(sheet(el)).toEqual({ id: 'i1', lines: ['Line of i1'], csv: null, qr: null });

    (q(el, 'invoice-detail-mark-paid') as HTMLElement).click();
    await settle(el);
    const wc = el as unknown as { aeat: { status?: string } | null };
    expect(wc.aeat?.status, 'the reload painted the fresh record').toBe('accepted');

    firstAeat.resolve(aeatOf('i1', 'pending'));
    await settle(el);

    expect(wc.aeat?.status, 'the stale record of the first reading is painted over the fresh one').toBe('accepted');
    expect(sheet(el).qr).toBe(qrOf('i1'));
  });

  it('control: a single invoice still opens with its lines, CSV and QR', async () => {
    const el = await mount();
    tapRow(el, INV1);
    await settle(el);
    expect(sheet(el)).toEqual({ id: 'i1', lines: ['Line of i1'], csv: 'CSV-i1', qr: qrOf('i1') });
    expect(await printQr(el)).toBe(qrOf('i1'));
  });
});
