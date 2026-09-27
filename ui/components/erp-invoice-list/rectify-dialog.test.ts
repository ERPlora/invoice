// invoice#107 — «Refund» on an invoice did nothing the user could see.
//
// `startRectify()` did fill `rectifyTarget`, but the card that asks for the reason was painted at
// the TOP of the detail (above the AEAT card and the data), while the button lives at the BOTTOM,
// after the lines and the totals. Scrolled down to the button, the card appeared off-screen; on a
// phone, always. From the list's row action it was the same: the card went above the table.
//
// The fix is the convention of every ERP/POS (Odoo's credit-note wizard, Square's refund sheet):
// «Refund» opens a DIALOG that asks for the reason, shows the refusal or the error inside it, and
// ends showing the result — wherever the page is scrolled. happy-dom does no layout, so what is
// pinned here is that contract: the reason field, the error and the result live INSIDE an open
// `ion-modal`, and nothing about the rectification is painted in the page flow any more.
import { beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const FACTURA = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-0001', issue_date: '2026-07-13',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 10000, tax_amount: 2100,
  total_amount: 12100, status: 'issued', source_type: 'manual',
};
const DETAIL = {
  ...FACTURA, issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, paid_at: null, notes: '',
};

type WC = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  detail: unknown;
  detailLines: unknown[];
  rectifyTarget: unknown;
};

const comandos: { name: string; payload: Record<string, unknown> }[] = [];
let commandImpl: (name: string, payload: Record<string, unknown>) => Promise<unknown>;

beforeEach(() => {
  comandos.length = 0;
  commandImpl = async () => ({});
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) =>
      name === 'invoice.get' ? { ...DETAIL, status: 'cancelled' }
      : name === 'invoice.lines' ? []
      : [],
    queryPage: async () => ({ rows: [FACTURA], total: 1 }),
    command: async (name: string, payload: Record<string, unknown>) => {
      comandos.push({ name, payload });
      return commandImpl(name, payload);
    },
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

const settle = async (el: WC) => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

async function mount(): Promise<WC> {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as WC;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

async function mountDetail(detail: Record<string, unknown> = DETAIL): Promise<WC> {
  const el = await mount();
  el.detail = detail;
  el.detailLines = [];
  await el.updateComplete;
  return el;
}

const q = (el: WC, testid: string) => el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
const dialog = (el: WC) => q(el, 'invoice-rectify') as (HTMLElement & { isOpen: boolean }) | null;
/** Is `node` painted inside the OPEN rectify dialog? */
const inOpenDialog = (el: WC, node: Element | null) => {
  const d = dialog(el);
  return !!node && !!d && d.isOpen === true && d.contains(node);
};

async function typeReason(el: WC, text: string) {
  const ta = q(el, 'invoice-rectify-reason') as HTMLElement & { value: string };
  ta.value = text;
  ta.dispatchEvent(new CustomEvent('ionInput', { detail: { value: text } }));
  await el.updateComplete;
}

describe('«Refund» opens a dialog next to what the user is looking at (invoice#107)', () => {
  it('from the detail: the reason field shows inside an OPEN dialog, not at the top of the page', async () => {
    const el = await mountDetail();
    expect(dialog(el)?.isOpen ?? false, 'the dialog must be closed before pressing «Refund»').toBe(false);

    q(el, 'invoice-detail-rectify')!.click();
    await el.updateComplete;

    const reason = q(el, 'invoice-rectify-reason');
    expect(reason, 'pressing «Refund» painted no reason field at all').toBeTruthy();
    expect(inOpenDialog(el, reason), 'the reason field is in the page flow (off-screen), not in an open dialog').toBe(true);
    expect(dialog(el)!.textContent).toContain('ui.rectifyTitle');
    expect(dialog(el)!.textContent).toContain('FACT-0001');
    // The declared hook `invoice-rectify` (invoice#76) now names the dialog itself.
    expect(dialog(el)!.tagName.toLowerCase(), 'the rectify panel is a card in the page flow').toBe('ion-modal');
  });

  it('from the list row action: the same dialog opens (no card above the table)', async () => {
    const el = await mount();
    const table = el.shadowRoot.querySelector('ok-data-table')!;
    table.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'rectify', row: FACTURA } }));
    await el.updateComplete;

    expect(inOpenDialog(el, q(el, 'invoice-rectify-reason'))).toBe(true);
    expect(dialog(el)!.tagName.toLowerCase()).toBe('ion-modal');
  });

  it('issuing: the command goes out and the dialog shows the RESULT until the user closes it', async () => {
    const el = await mountDetail();
    q(el, 'invoice-detail-rectify')!.click();
    await el.updateComplete;

    // `ion-button` is not defined under happy-dom: the boolean binding lands as the attribute.
    const submit = q(el, 'invoice-rectify-submit')!;
    expect(submit.hasAttribute('disabled'), 'with no reason the issue button must be disabled').toBe(true);
    await typeReason(el, '  Wrong amount  ');
    expect(submit.hasAttribute('disabled')).toBe(false);

    submit.click();
    await settle(el);

    expect(comandos.find((c) => c.name === 'invoice.rectify')?.payload).toEqual({ original_id: 'i1', reason: 'Wrong amount' });
    const done = q(el, 'invoice-rectify-done');
    expect(inOpenDialog(el, done), 'after issuing, the dialog closed (or never showed) with no result').toBe(true);
    expect(done!.textContent).toContain('ui.rectifyDone');
    expect(done!.textContent).toContain('FACT-0001');
    expect(q(el, 'invoice-rectify-submit'), 'a second «Issue» after success would try to rectify twice').toBeNull();
    // Behind the dialog the detail was reloaded: the original now reads cancelled.
    expect(q(el, 'invoice-detail-status')?.textContent).toBeTruthy();
    expect((el as unknown as { detail: { status: string } }).detail.status).toBe('cancelled');

    q(el, 'invoice-rectify-close')!.click();
    await el.updateComplete;
    expect(dialog(el)?.isOpen ?? false, '«Close» did not close the dialog').toBe(false);
  });

  it('a refused rectification is read INSIDE the dialog, translated, and nothing is painted at the top', async () => {
    commandImpl = async () => {
      throw Object.assign(new Error('A rectifying invoice is dated the day it is issued'), {
        code: 'invoice.rectify_date_not_allowed',
      });
    };
    const el = await mountDetail();
    q(el, 'invoice-detail-rectify')!.click();
    await el.updateComplete;
    await typeReason(el, 'Wrong amount');
    q(el, 'invoice-rectify-submit')!.click();
    await settle(el);

    const err = q(el, 'invoice-rectify-error');
    expect(inOpenDialog(el, err), 'the error was painted outside the dialog (or not at all)').toBe(true);
    expect(err!.textContent).toContain((esLocale as { errors: Record<string, string> }).errors['invoice.rectify_date_not_allowed']);
    expect(q(el, 'invoice-detail-error'), 'the error went to the top of the detail, off-screen').toBeNull();
    expect(q(el, 'invoice-rectify-submit'), 'after a refusal the user can correct and retry').toBeTruthy();
  });

  it('a document that cannot be rectified says why in the dialog, with no issue button', async () => {
    const el = await mount();
    const table = el.shadowRoot.querySelector('ok-data-table')!;
    table.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'rectify', row: { ...FACTURA, invoice_type: 'R1' } } }));
    await el.updateComplete;

    const err = q(el, 'invoice-rectify-error');
    expect(inOpenDialog(el, err)).toBe(true);
    expect(err!.textContent).toContain('ui.errRectifyRectifying');
    expect(q(el, 'invoice-rectify-submit')).toBeNull();
    expect(q(el, 'invoice-rectify-reason')).toBeNull();
    expect(q(el, 'invoice-action-error'), 'the refusal went above the table').toBeNull();

    table.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'rectify', row: { ...FACTURA, status: 'cancelled' } } }));
    await el.updateComplete;
    expect(q(el, 'invoice-rectify-error')!.textContent).toContain('ui.errAlreadyCancelled');
  });

  it('dismissing the dialog (backdrop, Esc, Cancel) forgets the half-typed rectification', async () => {
    const el = await mountDetail();
    q(el, 'invoice-detail-rectify')!.click();
    await el.updateComplete;
    await typeReason(el, 'half typed');

    dialog(el)!.dispatchEvent(new CustomEvent('ionModalDidDismiss'));
    await el.updateComplete;
    expect(dialog(el)?.isOpen ?? false).toBe(false);
    expect(el.rectifyTarget).toBeNull();

    q(el, 'invoice-detail-rectify')!.click();
    await el.updateComplete;
    expect((q(el, 'invoice-rectify-reason') as HTMLElement & { value: string }).value, 'the old reason came back').toBe('');

    q(el, 'invoice-rectify-cancel')!.click();
    await el.updateComplete;
    expect(dialog(el)?.isOpen ?? false, '«Cancel» did not close the dialog').toBe(false);
  });

  it('a fiscal document is issued ONCE: a double press, or a press after the result, sends one command', async () => {
    const pending: (() => void)[] = [];
    commandImpl = () => new Promise((r) => { pending.push(() => r({})); });
    const el = await mountDetail();
    q(el, 'invoice-detail-rectify')!.click();
    await el.updateComplete;
    await typeReason(el, 'Wrong amount');
    const wc = el as unknown as { confirmRectify: () => Promise<void> };
    // Two presses before the first answer comes back (a double tap on a slow network).
    const first = wc.confirmRectify();
    const second = wc.confirmRectify();
    await new Promise((r) => setTimeout(r, 0));
    pending.forEach((release) => release());
    await Promise.all([first, second]);
    await settle(el);
    // And once issued, whatever calls it again (a stale Enter, a retry) is ignored.
    await wc.confirmRectify();
    expect(comandos.filter((c) => c.name === 'invoice.rectify').length, 'two rectifying invoices for one refund').toBe(1);
  });

  it('the answer of a dismissed rectification never paints on the dialog of ANOTHER invoice', async () => {
    const pending: ((ok: boolean) => void)[] = [];
    commandImpl = () => new Promise((resolve, reject) => {
      pending.push((ok) => (ok ? resolve({}) : reject(Object.assign(new Error('late'), { code: 'late' }))));
    });
    for (const ok of [true, false]) {
      pending.length = 0;
      const el = await mount();
      const table = el.shadowRoot.querySelector('ok-data-table')!;
      table.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'rectify', row: FACTURA } }));
      await el.updateComplete;
      await typeReason(el, 'Wrong amount');
      q(el, 'invoice-rectify-submit')!.click();
      await el.updateComplete;
      // Backdrop/Esc while FACT-0001 is in flight, then «Refund» on FACT-0002.
      dialog(el)!.dispatchEvent(new CustomEvent('ionModalDidDismiss'));
      table.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'rectify', row: { ...FACTURA, id: 'i2', number: 'FACT-0002' } } }));
      await el.updateComplete;
      pending.forEach((settleIt) => settleIt(ok));
      await settle(el);

      expect(dialog(el)!.textContent).toContain('FACT-0002');
      expect(q(el, 'invoice-rectify-done'), `FACT-0001's result told the user FACT-0002 is cancelled (ok=${ok})`).toBeNull();
      expect(q(el, 'invoice-rectify-error'), `FACT-0001's answer painted on FACT-0002 (ok=${ok})`).toBeNull();
      expect(q(el, 'invoice-rectify-reason'), `FACT-0002 can no longer be rectified (ok=${ok})`).toBeTruthy();
      el.remove();
    }
  });

  it('opening it again for another invoice starts clean, even if the dialog was never dismissed', async () => {
    const el = await mount();
    const table = el.shadowRoot.querySelector('ok-data-table')!;
    table.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'rectify', row: FACTURA } }));
    await el.updateComplete;
    await typeReason(el, 'meant for FACT-0001');
    table.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'rectify', row: { ...FACTURA, id: 'i2', number: 'FACT-0002' } } }));
    await el.updateComplete;
    expect(dialog(el)!.textContent).toContain('FACT-0002');
    expect((q(el, 'invoice-rectify-reason') as HTMLElement & { value: string }).value, 'the reason typed for another invoice came along').toBe('');
  });

  it('every string the dialog paints exists in en AND es', () => {
    for (const key of ['rectifyTitle', 'rectifyNote', 'lblReason', 'rectifyReasonPlaceholder', 'rectifying',
      'issueRectifying', 'cancel', 'close', 'rectifyDone', 'errRectifyRectifying', 'errAlreadyCancelled', 'errRectify']) {
      expect((enLocale as { ui: Record<string, string> }).ui[key], `en.ui.${key}`).toBeTruthy();
      expect((esLocale as { ui: Record<string, string> }).ui[key], `es.ui.${key}`).toBeTruthy();
    }
  });
});
