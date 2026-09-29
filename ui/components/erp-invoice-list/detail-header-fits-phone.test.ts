// @vitest-environment happy-dom

// invoice#134 — on a phone (375 px) the header of the invoice detail did not fit: title, status
// badge, «Print / PDF» and «Back» shared ONE flex row that could not wrap, so the buttons squeezed
// the title until the number broke into «RECT- / 2026- / 000001» and the badge was cut to «Emi…».
// The convention (Shopify, Square order detail on a phone) is that the actions drop to their own
// row and the number and the status keep the full width.
//
// happy-dom does no layout, so what is pinned here is the CONTRACT that makes the real-browser
// geometry true: title+status and actions are two groups; the row wraps; the title group asks for
// its whole content before anything shrinks it; the badge and the buttons never shrink. That it
// really fits at 375 px (number on one line, badge whole, ios and md) is measured on the bench.
import { describe, expect, it } from 'vitest';

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  openDetail(id: string): Promise<void>;
  updateComplete: Promise<unknown>;
};

const DETAIL = {
  id: 'r1', invoice_type: 'R1', series: 'RECT', number: 'RECT-2026-000001', issue_date: '2026-09-29',
  customer_name: 'Cliente Rectificado SA', customer_tax_id: 'A58818501', base_amount: -4500, tax_amount: -945,
  total_amount: -5445, status: 'issued', source_type: 'rectification', issuer_nif: 'B12345674',
  issuer_name: 'Salón Demo SL', customer_address: '', description: '', tax_breakdown: '', currency: 'EUR',
  source_id: null, rectifies_invoice_id: null, rectifies_number: null, paid_at: null, notes: '',
};

function stub(): void {
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) => (name === 'invoice.get' ? [DETAIL] : []),
    queryOptional: async () => undefined,
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_c: unknown, key: string, params?: Record<string, unknown>) => (key === 'ui.detailTitle' ? `Factura ${String(params?.number)}` : key),
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
}

async function settle(wc: Wc) {
  await wc.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await wc.updateComplete;
}

async function openDetail(): Promise<Wc> {
  stub();
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Wc;
  document.body.appendChild(el);
  await settle(el);
  await el.openDetail(DETAIL.id);
  await settle(el);
  return el;
}

// ── A reader of the WHOLE static sheet (the rv-flows-147 lesson): the last declaration of a
// property for exactly that selector wins, @media/@container blocks included, and a rival
// shorthand/longhand declared later shows up as `<rival: value>` so no assertion passes by luck.
type Rule = { selectors: string[]; decls: [string, string][] };

const rules = async (): Promise<Rule[]> => {
  const { ErpInvoiceList } = await import('./erp-invoice-list');
  const css = (ErpInvoiceList as unknown as { styles: { cssText: string } }).styles.cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const read = (body: string): void => {
    let i = 0;
    while (i < body.length) {
      const open = body.indexOf('{', i);
      if (open < 0) return;
      const head = body.slice(i, open).trim();
      if (head.startsWith('@')) {
        let depth = 1;
        let j = open + 1;
        for (; j < body.length && depth > 0; j += 1) {
          if (body[j] === '{') depth += 1;
          else if (body[j] === '}') depth -= 1;
        }
        // Print rules never paint on screen; container/media blocks do and are read.
        if (!/^@media print/.test(head)) read(body.slice(open + 1, j - 1));
        i = j;
        continue;
      }
      const close = body.indexOf('}', open);
      const decls = body.slice(open + 1, close).split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const at = d.indexOf(':');
        return [d.slice(0, at).trim(), d.slice(at + 1).trim().replace(/\s+/g, ' ')] as [string, string];
      });
      out.push({ selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
      i = close + 1;
    }
  };
  read(css);
  return out;
};

const RIVALS: Record<string, string[]> = {
  'flex-wrap': ['flex-flow'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'min-width': [],
};

const effective = async (selector: string, prop: string): Promise<string | undefined> => {
  let plain: string | undefined;
  let important: string | undefined;
  for (const r of await rules()) {
    if (!r.selectors.includes(selector)) continue;
    for (const [name, raw] of r.decls) {
      if (name !== prop && !(RIVALS[prop] ?? []).includes(name)) continue;
      const imp = /!important$/.test(raw);
      const v = raw.replace(/\s*!important$/, '');
      const shown = name === prop ? v : `<${name}: ${v}>`;
      if (imp) important = shown;
      else plain = shown;
    }
  }
  return important ?? plain;
};

describe('the invoice detail header fits a phone: number whole, status whole (invoice#134)', () => {
  it('title and status sit in one group, the two buttons in another', async () => {
    const el = await openDetail();
    const header = el.shadowRoot.querySelector('[data-testid="invoice-detail"] > header')!;
    expect(header, 'the detail has its header').toBeTruthy();
    const title = header.querySelector(':scope > .detail-title');
    const actions = header.querySelector(':scope > .detail-actions');
    expect(title, 'title group').toBeTruthy();
    expect(actions, 'actions group').toBeTruthy();
    expect(title!.querySelector('h2')?.textContent).toContain(DETAIL.number);
    expect(title!.querySelector('[data-testid="invoice-detail-status"]'), 'the status travels with the number').toBeTruthy();
    expect(actions!.querySelector('[data-testid="invoice-detail-print"]'), 'print is an action').toBeTruthy();
    expect(actions!.querySelector('[data-testid="invoice-detail-back"]'), 'back is an action').toBeTruthy();
    expect(title!.querySelector('ion-button'), 'no button competes with the number for its row').toBeNull();
  });

  it('the header row wraps, so the actions drop below instead of squeezing the title', async () => {
    expect(await effective('header', 'flex-wrap')).toBe('wrap');
  });

  it('the title group grows and asks for its whole content before anything shrinks it', async () => {
    // flex-basis auto with width auto = max-content: the buttons wrap before the title narrows.
    expect(await effective('.detail-title', 'flex')).toBe('1 1 auto');
    expect(await effective('.detail-title', 'display')).toBe('flex');
    expect(await effective('.detail-title', 'flex-wrap'), 'if even alone it does not fit, the badge goes under the number').toBe('wrap');
    expect(await effective('.detail-title', 'min-width'), 'a very narrow pane may still shrink it (no overflow)').toBe('0');
  });

  it('the heading keeps its content size: no zero flex-basis that lets the badge squeeze it', async () => {
    // `flex:1` (basis 0) was what made the h2 give way to anything next to it.
    for (const sel of ['h2', '.detail-title h2']) {
      const v = await effective(sel, 'flex');
      expect(v === undefined || !/(^|\s)0(%|px)?$/.test(v) && v !== '1', `${sel} flex = ${v}`).toBe(true);
    }
  });

  it('the status badge and the actions never shrink, so «Emitida» and the buttons stay whole', async () => {
    expect(await effective('.detail-title ion-badge', 'flex')).toBe('none');
    expect(await effective('.detail-actions', 'flex')).toBe('none');
    expect(await effective('.detail-actions', 'display')).toBe('flex');
  });
});
