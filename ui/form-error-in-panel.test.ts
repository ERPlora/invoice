// pm#513 (out of pm#478) — on a phone, a refused «Issue invoice», «Create series», «Save» of a series
// or «Mark as paid» of an open invoice showed NOTHING the person could see: they pressed the button
// and the screen stayed as it was.
//
// The refusal did arrive; it was painted where it could not be seen. The issuing form and the series
// form live in the `create` panel of the `ok-data-table`, a full-height sheet on a phone. The notice
// was the LAST child of the form, under «Issue invoice»/«Create series» and «Cancel»: at 390 px the
// buttons sit at the bottom edge of the sheet and the notice was painted below it, behind the tab bar
// (bench: hub:stable 1.1.30 with invoice at main, ios and md × 390/820/1440 — «Issue invoice» 3 of 6
// visible, «Create series» 2 of 6, «Save» of a series 2 of 6). In the invoice detail, «Mark as paid»
// sits at the bottom of the card and its refusal was painted at the TOP of the detail, scrolled out
// of the screen on a phone (4 of 6).
//
// The rule, the same one tasks#47 / tickets#43 / cart_checkout#31 follow:
//
//   · what goes wrong while SAVING a form (or pressing an action of the open invoice) is painted
//     INSIDE that form / card, above the button that was pressed, and scrolled into view once it has
//     painted itself — not again on every keystroke (rv-reservations-73);
//   · what goes wrong OUTSIDE the save stays on the PAGE: a refused row action, a list that does not
//     load, an invoice that does not open. No panel is open then, and a notice inside a closed panel
//     is just as invisible (rv-appointments-227);
//   · an action that goes through refreshes what it changed (rv-tasks-47).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const REFUSAL = 'A manager has to approve this.';

const INVOICE = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-0001', issue_date: '2026-07-13',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 10000, tax_amount: 2100,
  total_amount: 12100, status: 'issued', source_type: 'manual',
};
const OTHER = { ...INVOICE, id: 'i2', number: 'FACT-0002' };
const detailOf = (inv: typeof INVOICE) => ({
  ...inv, issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, paid_at: null, notes: '',
});

const SERIES = [
  { id: 'sr1', code: 'FACT', name: 'Facturas', invoice_type: 'F1', year: 2026, current_number: 12, prefix: '', is_active: 1, is_default: 1 },
  { id: 'sr2', code: 'TICKET', name: 'Tickets', invoice_type: 'F2', year: 2026, current_number: 0, prefix: 'T', is_active: 1, is_default: 0 },
];

let refuse: string | null = null;
/** When set, the next command waits on it: lets a test look at the screen while a save is in flight. */
let hold: Promise<void> | null = null;
let listFails = false;
let detailFails = false;
let seriesFails = false;
/** How many times each query was asked: an action that goes through reloads what it changed. */
let reads: Record<string, number> = {};
let commands: string[] = [];
/** Every element the component scrolled into view. */
let revealed: Element[] = [];
/** Whether each revealed element had already painted itself when it was scrolled to. */
let paintedWhenRevealed: boolean[] = [];

beforeEach(() => {
  refuse = null;
  hold = null;
  listFails = false;
  detailFails = false;
  seriesFails = false;
  reads = {};
  commands = [];
  revealed = [];
  paintedWhenRevealed = [];
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    revealed.push(this);
    // ok-inline-feedback lays itself out in its own update: scrolled to before it, a phone scrolls to
    // an empty, zero-height box and the notice ends up off the sheet anyway (online_booking#33).
    paintedWhenRevealed.push((this as unknown as { hasUpdated?: boolean }).hasUpdated !== false);
  });
  const count = (name: string) => { reads[name] = (reads[name] ?? 0) + 1; };
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params?: { invoice_id?: string }) => {
      count(name);
      if (name === 'invoice.series.list') {
        if (seriesFails) throw new Error(REFUSAL);
        return SERIES;
      }
      if (name === 'invoice.series.peek_next') return [{ next_number: 'FACT-2026-000013', format_locked: 0 }];
      if (name === 'invoice.get') {
        if (detailFails) throw new Error(REFUSAL);
        return detailOf(params?.invoice_id === 'i2' ? OTHER : INVOICE);
      }
      return [];
    },
    queryOptional: async () => undefined,
    queryPage: async (name: string) => {
      count(name);
      if (listFails) throw new Error(REFUSAL);
      return { rows: [INVOICE, OTHER], total: 2 };
    },
    command: async (name: string) => {
      commands.push(name);
      const wait = hold;
      if (wait) await wait;
      if (refuse) throw new Error(refuse);
      return {};
    },
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_c: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> } & Record<string, any>;

async function settle(el: Wc): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function mountList(): Promise<Wc> {
  await import('./components/erp-invoice-list/erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

async function mountSeries(): Promise<Wc> {
  await import('./components/erp-invoice-settings/erp-invoice-settings');
  const el = document.createElement('erp-invoice-settings') as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

const submitEvent = (): Event => new Event('submit', { cancelable: true });

const CREATE = 'form[slot="create"]';
const DETAIL = '[data-testid="invoice-detail"]';

const q = (el: Wc, testid: string): HTMLElement | null =>
  el.shadowRoot.querySelector(`[data-testid="${testid}"]`);

/** Every place a notice with `text` is painted in: the panel form, the open invoice, or the page. */
function whereIs(el: Wc, text: string): string[] {
  return [...el.shadowRoot.querySelectorAll('ok-inline-feedback, p')]
    .filter((n) => n.textContent?.trim() === text)
    .map((n) => (n.closest(CREATE) ? 'panel' : n.closest(DETAIL) ? 'detail' : 'page'));
}

/** The notice sits in the same block as the buttons, right before them. */
function aboveTheButtons(notice: Element | null, button: Element | null): boolean {
  const actions = button?.closest('.row-actions');
  return !!notice && !!actions && notice.nextElementSibling === actions;
}

// ── «Issue invoice» (the manual issuing form in the table's panel) ─────────────────────────────

async function fillInvoice(el: Wc): Promise<void> {
  el.newCustomerName = 'ACME';
  el.newItems = [{ uid: 1, description: 'Corte', quantity: '1', unit_price: '10', tax_rate: '21' }];
  await settle(el);
}

async function refusedIssue(el: Wc): Promise<void> {
  await fillInvoice(el);
  refuse = REFUSAL;
  await el.create(submitEvent());
  await settle(el);
}

async function rowPaid(el: Wc, row = INVOICE): Promise<void> {
  el.onRowAction({ detail: { actionId: 'paid', row } });
  await settle(el);
}

describe('pm#513 · invoices: a refused «Issue invoice» is shown INSIDE the panel form, where it is seen', () => {
  it('lands in the form, above «Issue invoice», painted and scrolled into view — nowhere else', async () => {
    const el = await mountList();
    await refusedIssue(el);
    const notice = el.shadowRoot.querySelector(`${CREATE} [data-testid="invoice-create-error"]`);
    expect(notice?.textContent?.trim()).toBe(REFUSAL);
    expect(aboveTheButtons(notice, q(el, 'invoice-create-submit')), 'under the buttons it falls off the sheet on a phone').toBe(true);
    expect(revealed, 'and it is scrolled into view').toEqual([notice]);
    expect(paintedWhenRevealed, 'once it has painted itself').toEqual([true]);
    expect(whereIs(el, REFUSAL)).toEqual(['panel']);
  });

  it('is revealed once, not again on every keystroke while the person corrects the invoice', async () => {
    const el = await mountList();
    await refusedIssue(el);
    revealed = [];
    el.newCustomerName = 'ACME SL';
    await settle(el);
    el.newItems = [{ uid: 1, description: 'Corte', quantity: '2', unit_price: '10', tax_rate: '21' }];
    await settle(el);
    expect(q(el, 'invoice-create-error'), 'the refusal is still there').not.toBeNull();
    expect(revealed, 'but the sheet stays where the person is typing').toEqual([]);
  });

  it('a second refusal with a different reason is revealed again', async () => {
    const el = await mountList();
    await refusedIssue(el);
    revealed = [];
    refuse = 'The series is closed.';
    await el.create(submitEvent());
    await settle(el);
    expect(revealed).toEqual([q(el, 'invoice-create-error')]);
  });

  it('while the new attempt is being issued, the previous refusal is already gone', async () => {
    const el = await mountList();
    await refusedIssue(el);
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const attempt = el.create(submitEvent());
    await settle(el);
    expect(q(el, 'invoice-create-error')).toBeNull();
    release();
    await attempt;
  });

  it('an issue that goes through also clears the page notice of an earlier refused row action (staff#75)', async () => {
    const el = await mountList();
    refuse = REFUSAL;
    await rowPaid(el);
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    refuse = null;
    await fillInvoice(el);
    await el.create(submitEvent());
    await settle(el);
    expect(whereIs(el, REFUSAL)).toEqual([]);
  });
});

describe('pm#513 · invoices: a refused «Mark as paid» of the OPEN invoice is shown next to that button', () => {
  async function openAndRefuse(el: Wc): Promise<void> {
    await el.openDetail('i1');
    await settle(el);
    refuse = REFUSAL;
    q(el, 'invoice-detail-mark-paid')!.click();
    await settle(el);
  }

  it('lands in the invoice card, above its buttons, painted and scrolled into view — not at the top', async () => {
    const el = await mountList();
    await openAndRefuse(el);
    expect(commands).toEqual(['invoice.mark_paid']);
    const notice = el.shadowRoot.querySelector(`${DETAIL} [data-testid="invoice-detail-error"]`);
    expect(notice?.textContent?.trim()).toBe(REFUSAL);
    expect(aboveTheButtons(notice, q(el, 'invoice-detail-mark-paid')), 'at the top of the detail it is off-screen on a phone').toBe(true);
    expect(revealed).toEqual([notice]);
    expect(paintedWhenRevealed).toEqual([true]);
    expect(whereIs(el, REFUSAL)).toEqual(['detail']);
  });

  it('while «Mark as paid» is pressed again, the previous refusal is already gone', async () => {
    const el = await mountList();
    await openAndRefuse(el);
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    q(el, 'invoice-detail-mark-paid')!.click();
    await settle(el);
    expect(whereIs(el, REFUSAL)).toEqual([]);
    release();
    await settle(el);
  });

  it('is not revealed again when the detail repaints', async () => {
    const el = await mountList();
    await openAndRefuse(el);
    revealed = [];
    el.aeat = { status: 'accepted', csv: 'CSV1', qr: '', record_type: 'alta' };
    await settle(el);
    expect(q(el, 'invoice-detail-error')).not.toBeNull();
    expect(revealed).toEqual([]);
  });

  it('does not travel to the list when the person goes back, nor to another invoice', async () => {
    const el = await mountList();
    await openAndRefuse(el);
    q(el, 'invoice-detail-back')!.click();
    await settle(el);
    expect(whereIs(el, REFUSAL), 'the refusal of the closed invoice is painted above the table').toEqual([]);
    refuse = null;
    await openAndRefuse(el);
    refuse = null;
    await el.openDetail('i2');
    await settle(el);
    expect(whereIs(el, REFUSAL), 'the refusal of FACT-0001 is painted on FACT-0002').toEqual([]);
  });

  it('a «Mark as paid» that goes through refreshes the list and the open invoice', async () => {
    const el = await mountList();
    await el.openDetail('i1');
    await settle(el);
    const list = reads['invoice.list'] ?? 0;
    const get = reads['invoice.get'] ?? 0;
    q(el, 'invoice-detail-mark-paid')!.click();
    await settle(el);
    expect(commands).toEqual(['invoice.mark_paid']);
    expect(reads['invoice.list'], 'the list would keep it as issued').toBe(list + 1);
    expect(reads['invoice.get'], 'the open invoice would keep «Mark as paid»').toBe(get + 1);
    expect(whereIs(el, REFUSAL)).toEqual([]);
  });
});

describe('pm#513 · invoices: what goes wrong OUTSIDE the save stays on the page (rv-appointments-227)', () => {
  it('a refused «Mark as paid» from a row is shown on the page, not in the (closed) panel', async () => {
    const el = await mountList();
    refuse = REFUSAL;
    await rowPaid(el);
    expect(commands).toEqual(['invoice.mark_paid']);
    expect(el.shadowRoot.querySelector(`.page [data-testid="invoice-action-error"]`)?.textContent?.trim()).toBe(REFUSAL);
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    expect(q(el, 'invoice-create-error')).toBeNull();
  });

  it('«Mark as paid» on a row that is not issued any more is refused on the page too', async () => {
    const el = await mountList();
    await rowPaid(el, { ...INVOICE, status: 'paid' });
    expect(commands, 'nothing reaches the server').toEqual([]);
    expect(q(el, 'invoice-action-error')?.closest(CREATE)).toBeNull();
    expect(q(el, 'invoice-action-error')?.textContent?.trim()).toBe('ui.errMarkPaidStatus');
  });

  it('a row «Mark as paid» that goes through reloads the list', async () => {
    const el = await mountList();
    const before = reads['invoice.list'] ?? 0;
    await rowPaid(el);
    expect(reads['invoice.list'], 'the paid invoice would keep showing as issued').toBe(before + 1);
  });

  it('a row action does not wipe a refusal the person is still reading in the form', async () => {
    const el = await mountList();
    await refusedIssue(el);
    refuse = null;
    await rowPaid(el);
    expect(whereIs(el, REFUSAL)).toEqual(['panel']);
  });

  it('a list that does not load is shown on the page, not in the form', async () => {
    listFails = true;
    const el = await mountList();
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    expect(q(el, 'invoice-create-error')).toBeNull();
  });

  it('an invoice that does not open is shown on the page, not in the form', async () => {
    const el = await mountList();
    detailFails = true;
    await el.openDetail('i1');
    await settle(el);
    expect(q(el, 'invoice-detail-load-error')?.closest(CREATE)).toBeNull();
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
  });
});

// ── Series: «Create series» and «Save» share the table's panel ──────────────────────────────────

async function refusedSeriesCreate(el: Wc): Promise<void> {
  el.form = { ...el.form, code: 'RECT' };
  refuse = REFUSAL;
  await el.submit(submitEvent());
  await settle(el);
}

async function refusedSeriesEdit(el: Wc, row = SERIES[0]): Promise<void> {
  await el.startEdit(row);
  await settle(el);
  el.form = { ...el.form, name: 'Facturas 2026' };
  refuse = REFUSAL;
  await el.submit(submitEvent());
  await settle(el);
}

describe('pm#513 · series: a refused «Create series» / «Save» is shown INSIDE the panel form', () => {
  it('create: lands in the form, above «Create series», painted and scrolled into view — nowhere else', async () => {
    const el = await mountSeries();
    await refusedSeriesCreate(el);
    expect(commands).toEqual(['invoice.series.create']);
    const notice = el.shadowRoot.querySelector(`${CREATE} [data-testid="invoice-series-form-error"]`);
    expect(notice?.textContent?.trim()).toBe(REFUSAL);
    expect(aboveTheButtons(notice, q(el, 'invoice-series-submit'))).toBe(true);
    expect(revealed).toEqual([notice]);
    expect(paintedWhenRevealed).toEqual([true]);
    expect(whereIs(el, REFUSAL)).toEqual(['panel']);
  });

  it('edit: a refused «Save» lands in the same place and is revealed', async () => {
    const el = await mountSeries();
    await refusedSeriesEdit(el);
    expect(commands).toEqual(['invoice.series.update']);
    const notice = el.shadowRoot.querySelector(`${CREATE} [data-testid="invoice-series-form-error"]`);
    expect(notice?.textContent?.trim()).toBe(REFUSAL);
    expect(aboveTheButtons(notice, q(el, 'invoice-series-submit'))).toBe(true);
    expect(revealed).toEqual([notice]);
  });

  it('the «code is required» refusal of the form itself is revealed too', async () => {
    const el = await mountSeries();
    await el.submit(submitEvent());
    await settle(el);
    expect(commands, 'nothing reaches the server').toEqual([]);
    const notice = el.shadowRoot.querySelector(`${CREATE} [data-testid="invoice-series-form-error"]`);
    expect(notice?.textContent?.trim()).toBe('ui.errSeriesCodeRequired');
    expect(revealed).toEqual([notice]);
  });

  it('is revealed once, not again on every keystroke while the person corrects the series', async () => {
    const el = await mountSeries();
    await refusedSeriesCreate(el);
    revealed = [];
    el.form = { ...el.form, code: 'RECT2' };
    await settle(el);
    el.form = { ...el.form, prefix: 'R' };
    await settle(el);
    expect(q(el, 'invoice-series-form-error'), 'the refusal is still there').not.toBeNull();
    expect(revealed, 'but the sheet stays where the person is typing').toEqual([]);
  });

  it('while the new attempt is being saved, the previous refusal is already gone', async () => {
    const el = await mountSeries();
    await refusedSeriesCreate(el);
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const attempt = el.submit(submitEvent());
    await settle(el);
    expect(q(el, 'invoice-series-form-error')).toBeNull();
    release();
    await attempt;
  });

  it('does not travel to the next series the person opens', async () => {
    const el = await mountSeries();
    await refusedSeriesEdit(el);
    refuse = null;
    await el.startEdit(SERIES[1]);
    await settle(el);
    expect(whereIs(el, REFUSAL)).toEqual([]);
  });

  it('a list of series that does not load is shown on the page, not in the form', async () => {
    seriesFails = true;
    const el = await mountSeries();
    expect(q(el, 'invoice-series-list-error')?.textContent?.trim()).toBe(REFUSAL);
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    expect(revealed).toEqual([]);
  });
});
