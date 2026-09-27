// No `ion-*` of this module takes its colour from `color=` (ERPlora/pm#392, module-toolkit#273).
//
// Ionic implements `color="success"` with a GLOBAL rule of the document stylesheet
// (`.ion-color-success { --ion-color-base: … }`), which does not reach inside a shadow root. In the
// invoices that meant: the status chip of every row («Paid», «Cancelled»…) and the AEAT chip came out
// with no background (white text on nothing), the solid «Issue rectifying» and «Mark as paid» buttons
// had an invisible fill, and the outline/clear «Cancel», «Back» and «Rectify» fell back to primary blue.
//
// Two recipes, by where the element lives:
//   · the status chips of the table are rendered by column `render`s that `ok-data-table` evaluates
//     inside ITS OWN shadow root, where this component's `static styles` never arrive → the tone goes
//     INLINE, as custom properties read from the theme token (`ionTone`). The detail and AEAT chips
//     share the same map, so they use the same inline tone;
//   · the buttons live in this component's shadow root (detail, the `create` panel, which is a
//     native <slot>) → a `tone-*` class painted from `static styles`;
//   · the buttons of the rectify dialog (invoice#107) live in an `ion-modal`, which reparents itself
//     to <body> when it presents → out of `static styles` too, so their tone goes inline (`ionTone`).
//
// happy-dom neither lays out nor loads Ionic's CSS, so what is pinned here is the CONTRACT; the
// computed colours were measured in a real browser in `ios` mode.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { render, type TemplateResult } from 'lit';
import { beforeEach, describe, expect, it } from 'vitest';
import { ionTone } from './lib/ion-tone';

// The `ui/` of THIS checkout, from the test's own URL: a fixed folder name (`modules/invoice`, a
// worktree) would scan a sibling checkout and let a `color=` added HERE through.
const UI = path.dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The attribute names of every `<ion-*>` opening tag. A Lit tag does not end at the first `>`
 * (`@click=${() => …}`), so `${…}` expressions and quoted values are skipped, not read.
 */
function ionTags(source: string): { line: number; attrs: string }[] {
  const found: { line: number; attrs: string }[] = [];
  const start = /<ion-[a-z-]+(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(source))) {
    let attrs = '';
    let depth = 0;
    let quote: string | null = null;
    for (let i = m.index + m[0].length; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (depth > 0) {
        if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') { depth = 1; i += 1; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '>') break;
      attrs += ch;
    }
    found.push({ line: source.slice(0, m.index).split('\n').length, attrs: `${m[0]}${attrs}` });
  }
  return found;
}

const DECLARES_COLOR = /(?:^|\s)\.?color=/;

describe('pm#392: no ion-* delegates its colour to color=', () => {
  it('the source of ui/ carries no color= on an ion-* element', () => {
    const offenders = sources(UI).flatMap((file) =>
      ionTags(readFileSync(file, 'utf8'))
        .filter((t) => DECLARES_COLOR.test(t.attrs))
        .map((t) => `${path.relative(UI, file)}:${t.line}`),
    );
    expect(offenders, 'color= paints nothing inside a module shadow root').toEqual([]);
  });

  it('the reader sees a color= bound to an expression or behind an arrow function (control of the control)', () => {
    expect(ionTags('<ion-badge color=${STATUS_COLOR[s]}>x</ion-badge>').filter((t) => DECLARES_COLOR.test(t.attrs))).toHaveLength(1);
    expect(ionTags('<ion-button ?disabled=${a || b}\n  @click=${() => this.go()} color="success">x</ion-button>').filter((t) => DECLARES_COLOR.test(t.attrs))).toHaveLength(1);
    expect(ionTags('<ion-button @click=${() => ({ color: 1 })}>x</ion-button>').filter((t) => DECLARES_COLOR.test(t.attrs))).toHaveLength(0);
  });
});

// ── Render: every place that used to say `color=` now carries its tone ───────────────────────────

const SERIES = [
  { id: 'sr1', code: 'FACT', name: 'Facturas', invoice_type: 'F1', year: 2026, current_number: 12, prefix: '', is_active: 1, is_default: 1 },
  { id: 'sr2', code: 'TICKET', name: 'Tickets', invoice_type: 'F2', year: 2026, current_number: 340, prefix: 'T', is_active: 0, is_default: 0 },
];

const INVOICE = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-0001', issue_date: '2026-07-13',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 10000, tax_amount: 2100,
  total_amount: 12100, status: 'issued', source_type: 'manual', issuer_nif: 'B00000000',
  issuer_name: 'Emisora SL', customer_address: '', description: '', tax_breakdown: '', currency: 'EUR',
  source_id: null, rectifies_invoice_id: null, paid_at: null, notes: '',
};

beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) => (name === 'invoice.series.list' ? SERIES : []),
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

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> } & Record<string, unknown>;
type Column = { key: string; render?: (row: Record<string, unknown>) => TemplateResult };

async function mount(tag: 'erp-invoice-list' | 'erp-invoice-settings'): Promise<Wc> {
  if (tag === 'erp-invoice-list') await import('./components/erp-invoice-list/erp-invoice-list');
  else await import('./components/erp-invoice-settings/erp-invoice-settings');
  const el = document.createElement(tag) as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

/** What a column `render` paints for `row` — the way `ok-data-table` evaluates it in its own cell. */
function cell(el: Wc, key: string, row: Record<string, unknown>): HTMLElement {
  const table = el.shadowRoot.querySelector('ok-data-table') as unknown as { columns: Column[] };
  const column = table.columns.find((c) => c.key === key);
  expect(column?.render, `the «${key}» column has no render`).toBeTypeOf('function');
  const host = document.createElement('div');
  render(column!.render!(row), host);
  return host;
}

const styleOf = (n: Element | null | undefined) => n?.getAttribute('style') ?? '';
const byTestId = (el: Wc, id: string) => el.shadowRoot.querySelector(`[data-testid="${id}"]`);

/** The CSS text of the component's `static styles`, where the `tone-*` classes are painted. */
function componentCss(el: Wc): string {
  const styles = (el.constructor as unknown as { elementStyles: { cssText: string }[] }).elementStyles;
  return styles.map((s) => s.cssText).join('\n').replace(/\s+/g, ' ');
}

/** A button painted by a class: no `color=`, the expected `fill`, the class and its rule. */
function expectToneButton(el: Wc, btn: Element | null, fill: string | null, tone: string) {
  expect(btn, 'the button is rendered').not.toBeNull();
  expect(btn!.hasAttribute('color'), 'it still delegates to color=').toBe(false);
  expect(btn!.getAttribute('fill')).toBe(fill);
  expect(btn!.classList.contains(`tone-${tone}`), `missing class tone-${tone}`).toBe(true);
  const css = componentCss(el);
  if (fill === null) {
    expect(css).toContain(`ion-button.tone-${tone}:not([fill]) {`);
    expect(css).toContain(`--background: var(--ion-color-${tone},`);
    expect(css).toContain(`--color: var(--ion-color-${tone}-contrast,`);
  } else {
    expect(css).toContain(`ion-button.tone-${tone}[fill] {`);
    expect(css).toContain(`--color: var(--ion-color-${tone},`);
    expect(css).toContain(`--border-color: var(--ion-color-${tone},`);
  }
}

describe('pm#392: the invoice list paints its chips without color=', () => {
  it('the status chip of every row carries its solid tone inline (it lives in the table\'s shadow root)', async () => {
    const el = await mount('erp-invoice-list');
    const expected: Record<string, Parameters<typeof ionTone>[1]> = { draft: 'medium', issued: 'primary', paid: 'success', cancelled: 'danger' };
    for (const [status, tone] of Object.entries(expected)) {
      const chip = cell(el, 'status', { ...INVOICE, status }).querySelector('ion-badge');
      expect(chip, `«${status}» is not a chip`).not.toBeNull();
      expect(chip!.hasAttribute('color')).toBe(false);
      expect(styleOf(chip), `«${status}» → ${tone}`).toContain(ionTone('solid', tone));
    }
  });

  it('the status chip of the detail header and the AEAT chip carry their tone inline', async () => {
    const el = await mount('erp-invoice-list');
    el.detail = { ...INVOICE, status: 'paid' };
    el.detailLines = [];
    el.aeat = { status: 'rejected' };
    await el.updateComplete;
    const status = byTestId(el, 'invoice-detail-status');
    expect(status!.hasAttribute('color')).toBe(false);
    expect(styleOf(status)).toContain(ionTone('solid', 'success'));
    const aeat = byTestId(el, 'invoice-aeat-status');
    expect(aeat!.hasAttribute('color')).toBe(false);
    expect(styleOf(aeat)).toContain(ionTone('solid', 'danger'));
    el.aeat = { status: 'pending' };
    await el.updateComplete;
    expect(styleOf(byTestId(el, 'invoice-aeat-status'))).toContain(ionTone('solid', 'warning'));
  });
});

describe('pm#392: the invoice list paints its buttons from a tone class', () => {
  it('detail: «Back» outline medium, «Mark as paid» solid success, «Rectify» outline danger', async () => {
    const el = await mount('erp-invoice-list');
    el.detail = { ...INVOICE, status: 'issued' };
    el.detailLines = [];
    await el.updateComplete;
    expectToneButton(el, byTestId(el, 'invoice-detail-back'), 'outline', 'medium');
    expectToneButton(el, byTestId(el, 'invoice-detail-mark-paid'), null, 'success');
    expectToneButton(el, byTestId(el, 'invoice-detail-rectify'), 'outline', 'danger');
  });

  // invoice#107 — the rectification moved into an `ion-modal`, which reparents itself to <body>
  // when it presents: out of this shadow root, a `tone-*` class from `static styles` paints nothing
  // there. So its buttons take the third recipe: the tone INLINE, like the chips of the table.
  it('rectify dialog: «Issue rectifying» solid danger, «Cancel»/«Close» outline medium, all inline', async () => {
    const el = await mount('erp-invoice-list');
    (el as unknown as { startRectify: (i: unknown) => void }).startRectify(INVOICE);
    await el.updateComplete;
    const submit = byTestId(el, 'invoice-rectify-submit');
    expect(submit!.hasAttribute('color')).toBe(false);
    expect(submit!.hasAttribute('fill')).toBe(false);
    expect(styleOf(submit)).toContain(ionTone('solid', 'danger'));
    const cancel = byTestId(el, 'invoice-rectify-cancel');
    expect(cancel!.hasAttribute('color')).toBe(false);
    expect(cancel!.getAttribute('fill')).toBe('outline');
    expect(styleOf(cancel)).toContain(ionTone('outline', 'medium'));

    (el as unknown as { startRectify: (i: unknown) => void }).startRectify({ ...INVOICE, invoice_type: 'R1' });
    await el.updateComplete;
    const close = byTestId(el, 'invoice-rectify-close');
    expect(close!.hasAttribute('color')).toBe(false);
    expect(styleOf(close)).toContain(ionTone('outline', 'medium'));
  });

  it('create panel: the line ✕ clear danger, «Cancel» clear medium', async () => {
    const el = await mount('erp-invoice-list');
    el.newItems = [...(el.newItems as unknown[]), { uid: 2, description: '', quantity: '1', unit_price: '0', tax_rate: '21' }];
    await el.updateComplete;
    expectToneButton(el, byTestId(el, 'invoice-line-2-remove'), 'clear', 'danger');
    expectToneButton(el, byTestId(el, 'invoice-create-cancel'), 'clear', 'medium');
  });
});

describe('pm#392: the invoice series settings paint without color=', () => {
  it('the «Active» and «Default» chips carry their solid tone inline', async () => {
    const el = await mount('erp-invoice-settings');
    const active = cell(el, 'is_active', SERIES[0]).querySelector('ion-badge');
    expect(active!.hasAttribute('color')).toBe(false);
    expect(styleOf(active)).toContain(ionTone('solid', 'success'));
    expect(styleOf(cell(el, 'is_active', SERIES[1]).querySelector('ion-badge'))).toContain(ionTone('solid', 'medium'));
    const byDefault = cell(el, 'is_default', SERIES[0]).querySelector('ion-badge');
    expect(byDefault!.hasAttribute('color')).toBe(false);
    expect(styleOf(byDefault)).toContain(ionTone('solid', 'primary'));
  });

  it('the form «Cancel» is clear medium, painted by the tone-medium class', async () => {
    const el = await mount('erp-invoice-settings');
    expectToneButton(el, byTestId(el, 'invoice-series-cancel'), 'clear', 'medium');
  });
});
