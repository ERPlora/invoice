// @vitest-environment happy-dom

// invoice#143 — the manual-invoice panel is ~327 px wide on a desktop (and 343 px on a 375 px phone):
// «+ Línea», «Emitir factura» and «Cancelar» shared ONE flex row that could not wrap, so the
// buttons were squeezed and their labels broke into two lines («+» over «Línea», «Emitir» over
// «factura»). The convention (Odoo, Shopify side panels) is that a label never breaks: when the
// row runs out of room the next WHOLE button drops to a new row.
//
// happy-dom does no layout, so what is pinned here is the CONTRACT that makes the real-browser
// geometry true: the footer buttons live in `.row-actions`; that row wraps; its buttons keep their
// label on one line and never shrink. That it really fits at 1440, 820 and 375 px (ios and md) is
// measured on the bench.
import { describe, expect, it } from 'vitest';

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

function stub(): void {
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryOptional: async () => undefined,
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_c: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
}

async function mount(): Promise<Wc> {
  stub();
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

// Reads the WHOLE static sheet: the last declaration of a property for exactly that selector wins
// (@media/@container blocks included, print excluded), `!important` beats plain, and a rival
// shorthand/longhand shows up as `<rival: value>` so no assertion passes by luck.
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
  'white-space': ['text-wrap', 'text-wrap-mode', 'white-space-collapse'],
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

describe('the footer buttons of the manual invoice keep their label on one line (invoice#143)', () => {
  it('«+ Line», «Issue invoice» and «Cancel» are the buttons of the create form row', async () => {
    const el = await mount();
    const row = el.shadowRoot.querySelector('[data-testid="invoice-create-form"] > .row-actions');
    expect(row, 'the create form has its button row').toBeTruthy();
    const ids = [...row!.querySelectorAll(':scope > ion-button')].map((b) => b.getAttribute('data-testid'));
    expect(ids).toEqual(['invoice-create-add-line', 'invoice-create-submit', 'invoice-create-cancel']);
  });

  it('the button row wraps, so a button that does not fit drops whole to the next row', async () => {
    expect(await effective('.row-actions', 'display')).toBe('flex');
    expect(await effective('.row-actions', 'flex-wrap')).toBe('wrap');
  });

  it('a button never breaks its label into two lines', async () => {
    // Inherited through ion-button's shadow boundary down to its label.
    expect(await effective('.row-actions ion-button', 'white-space')).toBe('nowrap');
  });

  it('a button never shrinks below its label, so the row wraps before squeezing it', async () => {
    expect(await effective('.row-actions ion-button', 'flex')).toBe('none');
  });
});
