// The «Total» range filter of Invoices filters in the unit the column shows (invoice#113, pm#498).
//
// `invoice.total_amount` is an INTEGER in the minor unit (cents in EUR, ADR-0123) and the
// dispatcher compares the `range` filter against that integer. The column paints it as money of
// the hub («121,00 €»), so the person types «12» meaning twelve euros — and the screen sent `12` as
// is: «Total from 12» let a 0,12 € invoice through and «to 50» hid a 1,00 € one.
//
// What the table types (major unit) is scaled to the minor unit with the hub's currency decimals
// before the list is asked for; the edges of every other column travel untouched.
import { beforeEach, describe, expect, it } from 'vitest';
import './erp-invoice-list';

/** The `filters` of every page the screen asked the hub for, in call order. */
const asked: Array<Record<string, unknown>> = [];
let decimals = 2;

beforeEach(() => {
  document.body.replaceChildren();
  asked.length = 0;
  decimals = 2;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async (name: string, params: { filters?: Record<string, unknown> }) => {
      if (name === 'invoice.list') asked.push(structuredClone(params.filters ?? {}));
      return { rows: [], total: 0, limit: 50, offset: 0 };
    },
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    formatMoney: (minor: number) => `MONEY(${minor})`,
    formatAmount: (units: number) => `AMOUNT(${units})`,
    get currencyDecimals() {
      return decimals;
    },
  };
});

type Mounted = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function settle(el: Mounted): Promise<void> {
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(): Promise<Mounted> {
  const el = document.createElement('erp-invoice-list') as Mounted;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

/** Fires what `ok-data-table` emits when one edge of a filter is typed. */
async function type(el: Mounted, col: string, value: unknown): Promise<Record<string, unknown>> {
  el.shadowRoot
    .querySelector('ok-data-table')!
    .dispatchEvent(new CustomEvent('filterChange', { detail: { col, value } }));
  await settle(el);
  return asked[asked.length - 1];
}

describe('«Total» range filter compares in the unit the column shows (invoice#113)', () => {
  it('«from 12» asks for 12,00 € (1200 cents), not 12 cents', async () => {
    const el = await mount();
    expect(await type(el, 'total_amount', { from: 12 })).toEqual({ total_amount: { from: 1200 } });
  });

  it('«to 50» keeps the other edge and asks for 5000 cents, so a 1 € invoice is not hidden', async () => {
    const el = await mount();
    await type(el, 'total_amount', { from: 12 });
    expect(await type(el, 'total_amount', { to: 50 })).toEqual({ total_amount: { from: 1200, to: 5000 } });
  });

  it('a decimal amount is rounded to the minor unit (12.10 → 1210, never 1209)', async () => {
    const el = await mount();
    expect(await type(el, 'total_amount', { from: 12.1 })).toEqual({ total_amount: { from: 1210 } });
    expect(await type(el, 'total_amount', { to: 0.29 })).toEqual({ total_amount: { from: 1210, to: 29 } });
  });

  it('the inline control emits text: «12.5» and «12,5» both mean 12,50 €', async () => {
    const el = await mount();
    expect(await type(el, 'total_amount', { from: '12.5' })).toEqual({ total_amount: { from: 1250 } });
    expect(await type(el, 'total_amount', { from: '12,5' })).toEqual({ total_amount: { from: 1250 } });
  });

  it('uses the scale of the hub currency: 0 decimals (JPY) sends the amount as is, 3 (KWD) ×1000', async () => {
    decimals = 0;
    const jpy = await mount();
    expect(await type(jpy, 'total_amount', { from: 1999 })).toEqual({ total_amount: { from: 1999 } });
    jpy.remove();
    decimals = 3;
    const kwd = await mount();
    expect(await type(kwd, 'total_amount', { from: 1.5 })).toEqual({ total_amount: { from: 1500 } });
  });

  it('clearing an edge drops it instead of filtering «from 0»', async () => {
    const el = await mount();
    await type(el, 'total_amount', { from: 12 });
    await type(el, 'total_amount', { to: 50 });
    expect(await type(el, 'total_amount', { from: '' })).toEqual({ total_amount: { to: 5000 } });
    expect(await type(el, 'total_amount', { to: '' })).toEqual({});
  });

  it('text that is not a number is not turned into «from 0»', async () => {
    const el = await mount();
    expect(await type(el, 'total_amount', { from: 'abc' })).toEqual({});
    expect(await type(el, 'total_amount', { to: '   ' })).toEqual({});
  });

  it('a cleared filter (null) clears it, never a crash', async () => {
    const el = await mount();
    await type(el, 'total_amount', { from: 12 });
    expect(await type(el, 'total_amount', null)).toEqual({});
  });

  it('typed in the real Filters panel: asks for cents and the field still shows what was typed', async () => {
    const el = await mount();
    type Table = HTMLElement & { open(panel: 'filters'): void; shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };
    const table = el.shadowRoot.querySelector('ok-data-table') as Table;
    table.open('filters');
    await table.updateComplete;
    const fromOfTotal = (): HTMLInputElement => {
      const label = [...table.shadowRoot.querySelectorAll('.flabel')].find((l) => l.textContent === 'ui.colTotal');
      return label!.parentElement!.querySelector('ion-input') as unknown as HTMLInputElement;
    };
    fromOfTotal().value = '12';
    fromOfTotal().dispatchEvent(new CustomEvent('ionInput', { bubbles: true, composed: true }));
    await settle(el);
    await table.updateComplete;
    expect(asked[asked.length - 1]).toEqual({ total_amount: { from: 1200 } });
    // The cents only travel to the hub: the field keeps «12», never «1200».
    expect(String(fromOfTotal().value)).toBe('12');
  });

  it('other columns travel untouched: dates stay ISO and the number stays the text typed', async () => {
    const el = await mount();
    expect(await type(el, 'issue_date', { from: '2026-09-01' })).toEqual({ issue_date: { from: '2026-09-01' } });
    expect(await type(el, 'number', '12')).toEqual({ issue_date: { from: '2026-09-01' }, number: '12' });
  });
});
