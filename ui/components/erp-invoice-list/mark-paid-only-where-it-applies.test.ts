// invoice#109 — the invoice list offered «Mark as paid» on every row, whatever its state: an invoice
// already paid still showed the green tick next to «View», while its own card had dropped the
// button the moment it was paid. The same with «Refund» on a rectifying invoice or a cancelled one.
// `rowActions` looked at permissions only, never at the row. And «Mark as paid» changed the invoice
// on the first tap — no question, stamped with the current time, and no visible way back.
//
// What every invoicing back office does (Stripe, Square, Odoo, QuickBooks, Holded): an action that
// does not apply to a document is not offered on it, and «Mark as paid» asks before recording the
// payment. So:
//
//   · the row offers exactly what the card offers, by the SAME rule: «Mark as paid» only on an
//     issued invoice; «Refund» on neither a rectifying invoice nor a cancelled one;
//   · «Mark as paid» — from the row or from the card — opens a confirmation naming the invoice, a
//     GLOBAL Ionic overlay on document.body (hub#2162: an inline <ion-alert> in this shadow root
//     loses its styles when Ionic teleports it); nothing is written until it is confirmed;
//   · a row that is stale (paid in another tab, still «issued» here) reaches the server, which now
//     refuses it with `invoice.cannot_mark_paid`: the refusal is painted in the person's language,
//     not the handler's English sentence, and the list catches up.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import es from '../../../locales/es.json';

const base = {
  series: 'FACT', issue_date: '2026-07-13', customer_name: 'ACME', customer_tax_id: 'B12345678',
  base_amount: 10000, tax_amount: 2100, total_amount: 12100, source_type: 'manual',
};
const ISSUED = { ...base, id: 'i1', invoice_type: 'F1', number: 'FACT-2026-000001', status: 'issued' };
const PAID = { ...base, id: 'i2', invoice_type: 'F2', number: 'TICKET-2026-000001', status: 'paid' };
const CANCELLED = { ...base, id: 'i3', invoice_type: 'F1', number: 'FACT-2026-000002', status: 'cancelled' };
const RECTIFYING = { ...base, id: 'i4', invoice_type: 'R1', number: 'RECT-2026-000001', status: 'issued' };
const ROWS = [ISSUED, PAID, CANCELLED, RECTIFYING];

const detailOf = (id: string) => ({
  ...ROWS.find((r) => r.id === id)!, issuer_nif: 'B00000000', issuer_name: 'Emisora SL',
  customer_address: '', description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, paid_at: null, notes: '',
});

const CODE = 'invoice.cannot_mark_paid';
const FALLBACK = 'This invoice cannot be marked as paid.';

let refuseWith: Error | null = null;
let commands: Array<{ name: string; payload: unknown }> = [];
let listReads = 0;

beforeEach(() => {
  refuseWith = null;
  commands = [];
  listReads = 0;
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params?: { invoice_id?: string }) => {
      if (name === 'invoice.get') return [detailOf(String(params?.invoice_id))];
      return [];
    },
    queryOptional: async () => undefined,
    queryPage: async () => {
      listReads++;
      return { rows: ROWS, total: ROWS.length };
    },
    command: async (name: string, payload: unknown) => {
      commands.push({ name, payload });
      if (refuseWith) throw refuseWith;
      return {};
    },
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    // The real `es` catalogue, interpolated: the dialog is checked in the words the person reads.
    t: (_c: unknown, key: string, p?: Record<string, unknown>) => {
      let cur: unknown = es;
      for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
      const text = typeof cur === 'string' ? cur : key;
      return text.replace(/\{(\w+)\}/g, (m, k: string) => (p && k in p ? String(p[k]) : m));
    },
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> } & Record<string, any>;
type AlertButton = { text: string; role?: string; handler?: () => unknown };
type AlertEl = HTMLElement & { header: string; message: string; buttons: AlertButton[]; isOpen?: boolean };

async function settle(el: Wc): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function mount(): Promise<Wc> {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

type Table = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function table(el: Wc): Promise<Table> {
  const t = el.shadowRoot.querySelector('ok-data-table') as Table;
  await t.updateComplete;
  return t;
}

/** The row buttons the REAL table paints for an invoice (not what the component's getter returns). */
async function rowButtons(el: Wc, id: string): Promise<string[]> {
  const t = await table(el);
  const prefix = `invoice-table-row-${id}-`;
  return [...t.shadowRoot.querySelectorAll(`[data-testid^="${prefix}"]`)]
    .map((b) => b.getAttribute('data-testid')!.slice(prefix.length))
    .filter((a) => ['view', 'paid', 'rectify'].includes(a))
    .sort();
}

/** The person taps the REAL «Mark as paid» of the row, in the table (not a synthetic rowAction). */
async function tapRowPaid(el: Wc, id = 'i1'): Promise<void> {
  const t = await table(el);
  const btn = t.shadowRoot.querySelector(`[data-testid="invoice-table-row-${id}-paid"]`) as HTMLElement | null;
  expect(btn, `the real «Mark as paid» button of row ${id}`).toBeTruthy();
  btn?.click();
  await settle(el);
}

/** The buttons the open invoice's card shows, named like the row actions. */
function detailButtons(el: Wc): string[] {
  const acts: string[] = [];
  if (el.shadowRoot.querySelector('[data-testid="invoice-detail-mark-paid"]')) acts.push('paid');
  if (el.shadowRoot.querySelector('[data-testid="invoice-detail-rectify"]')) acts.push('rectify');
  return acts.sort();
}

const confirmAlert = (): AlertEl | null =>
  document.body.querySelector('ion-alert[data-testid="invoice-mark-paid-confirm"]') as AlertEl | null;

async function press(el: Wc, role: 'cancel' | 'confirm'): Promise<void> {
  const alert = confirmAlert();
  expect(alert, 'the «Mark as paid» confirmation is open').toBeTruthy();
  const btn = alert?.buttons.find((b) => b.role === role);
  expect(btn, `the «${role}» button of the confirmation`).toBeTruthy();
  await btn?.handler?.();
  alert?.dispatchEvent(new CustomEvent('ionAlertDidDismiss', { detail: { role } }));
  await settle(el);
}

const markPaids = () => commands.filter((c) => c.name === 'invoice.mark_paid');
const pageNotice = (el: Wc): string | undefined =>
  el.shadowRoot.querySelector('[data-testid="invoice-action-error"]')?.textContent?.trim();

describe('invoice#109 · a row offers only the actions that apply to THAT invoice', () => {
  it('«Mark as paid» only on an issued invoice; «Refund» neither on a rectifying nor on a cancelled one', async () => {
    const el = await mount();
    expect(await rowButtons(el, 'i1'), 'issued').toEqual(['paid', 'rectify', 'view']);
    expect(await rowButtons(el, 'i2'), 'paid: already paid, it can still be refunded').toEqual(['rectify', 'view']);
    expect(await rowButtons(el, 'i3'), 'cancelled: nothing left to do but look').toEqual(['view']);
    expect(await rowButtons(el, 'i4'), 'rectifying: it can be paid, not refunded again').toEqual(['paid', 'view']);
  });

  it('every row offers exactly what its own card offers', async () => {
    const el = await mount();
    const rows: Record<string, string[]> = {};
    for (const r of ROWS) rows[r.id] = (await rowButtons(el, r.id)).filter((a) => a !== 'view');
    for (const r of ROWS) {
      await el.openDetail(r.id);
      await settle(el);
      expect(rows[r.id], `${r.number} (${r.status}, ${r.invoice_type}): the row and the card disagree`).toEqual(detailButtons(el));
      (el.shadowRoot.querySelector('[data-testid="invoice-detail-back"]') as HTMLElement).click();
      await settle(el);
    }
  });
});

describe('invoice#109 · «Mark as paid» asks first', () => {
  it('the row button writes nothing: it opens a confirmation on document.body naming the invoice, in Spanish', async () => {
    const el = await mount();
    await tapRowPaid(el);
    expect(markPaids(), 'nothing is marked on the first tap').toEqual([]);
    const alert = confirmAlert();
    expect(alert, 'a GLOBAL overlay, not an inline alert inside the shadow root (hub#2162)').toBeTruthy();
    expect(el.shadowRoot.querySelector('ion-alert'), 'no inline alert in the shadow root').toBeNull();
    expect(alert?.isOpen, 'the confirmation is actually shown').toBe(true);
    expect(alert?.header).toBe(es.ui.markPaidConfirmTitle.replace('{number}', 'FACT-2026-000001'));
    expect(alert?.message).toBe(es.ui.markPaidConfirmMessage);
    expect(alert?.buttons.map((b) => [b.role, b.text])).toEqual([
      ['cancel', es.ui.cancel],
      ['confirm', es.ui.actionMarkPaid],
    ]);
  });

  it('«Cancel» leaves the invoice as it was', async () => {
    const el = await mount();
    await tapRowPaid(el);
    await press(el, 'cancel');
    expect(markPaids()).toEqual([]);
    expect(pageNotice(el)).toBeUndefined();
  });

  it('confirming marks THAT invoice paid and refreshes the list', async () => {
    const el = await mount();
    const before = listReads;
    await tapRowPaid(el);
    await press(el, 'confirm');
    expect(markPaids()).toEqual([{ name: 'invoice.mark_paid', payload: { invoice_id: 'i1' } }]);
    expect(listReads, 'the paid invoice would keep its «Mark as paid»').toBe(before + 1);
  });

  it('the card button asks too', async () => {
    const el = await mount();
    await el.openDetail('i1');
    await settle(el);
    (el.shadowRoot.querySelector('[data-testid="invoice-detail-mark-paid"]') as HTMLElement).click();
    await settle(el);
    expect(markPaids(), 'nothing is marked on the first tap').toEqual([]);
    await press(el, 'confirm');
    expect(markPaids()).toEqual([{ name: 'invoice.mark_paid', payload: { invoice_id: 'i1' } }]);
  });

  it('the confirmation leaves nothing behind on document.body once dismissed', async () => {
    const el = await mount();
    await tapRowPaid(el);
    await press(el, 'cancel');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.querySelectorAll('ion-alert').length, 'a hidden alert left on every tap').toBe(0);
  });
});

describe('invoice#109 · the server refuses a row that is stale, and says so in the person’s language', () => {
  it('a row still «issued» here but paid elsewhere: the refusal code is painted translated, and the list catches up', async () => {
    const el = await mount();
    refuseWith = Object.assign(new Error(FALLBACK), { code: CODE });
    const before = listReads;
    await tapRowPaid(el);
    await press(el, 'confirm');
    expect(markPaids()).toHaveLength(1);
    expect(pageNotice(el), 'the handler’s English sentence instead of the translation').toBe(
      (es.errors as Record<string, string>)[CODE],
    );
    expect(listReads, 'the stale row keeps offering «Mark as paid»').toBe(before + 1);
  });
});
