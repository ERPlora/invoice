// invoice#111 — the series table is read WHOLE, at every size.
//
// Every column fell back to ok-data-table's default track, `minmax(5.5rem,1fr)`: nine equal columns.
// At 1440 px «Facturas simplificadas» and «PREFIX-YYYY-NNNNNN» were cut to «Facturas simplif…» and
// «PREFIX-YYYY-N…» while «Tipo» and «Año» sat half empty; at 820 px the grid overflowed sideways and
// «Predet.» hid behind the pinned edit column. The fix has two halves:
//   1. each column asks for the room its content needs (no more, so the nine fit at 1280 px);
//   2. below 1280 px the nine columns cannot fit, so the screen opens in cards, where every field of
//      a series is a line of its own (the person can still switch to the list).
import { beforeEach, describe, expect, it } from 'vitest';

type Column = { key: string; width?: string };
type Table = HTMLElement & { columns: Column[]; defaultView?: string };
type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

beforeEach(() => {
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

async function mount(viewportWidth = 1440): Promise<Wc> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
  await import('./erp-invoice-settings');
  const el = document.createElement('erp-invoice-settings') as unknown as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const table = (el: Wc) => el.shadowRoot.querySelector('ok-data-table') as Table;

const REM_PX = 16;
function lengthPx(len: string): number {
  const v = len.trim();
  if (v.endsWith('rem')) return parseFloat(v) * REM_PX;
  if (v.endsWith('px')) return parseFloat(v);
  throw new Error(`unsupported track length: ${len}`);
}
/** The narrowest a column can get: the `min` of a `minmax(min, max)` track, or the fixed length. */
function minTrackPx(width: string): number {
  const m = /^minmax\(\s*([^,]+),/.exec(width.trim());
  return lengthPx(m ? m[1] : width);
}

// The widest thing each column shows, measured on the bench (hub:dev shell, es and en, ios and md):
// the header with its sort arrow, or the widest cell — «Facturas simplificadas», «Rectificativa
// (R1)», the «PREFIX-YYYY-NNNNNN» shown when a series has no template, «CURRENT NO.», «DEFAULT».
const CONTENT_PX: Record<string, number> = {
  code: 62,
  name: 144,
  invoice_type: 109,
  year: 46,
  prefix: 64,
  format: 154,
  current_number: 97,
  is_active: 58,
  is_default: 67,
};

// At 1280 px, with the shell's side menu, the table box is 1008 px; its paddings and column gaps
// take 88 px and the edit column 48 px. What is left is the room of the nine data columns.
const TRACKS_BUDGET_PX = 1008 - 88 - 48;

describe('the series table is read whole (invoice#111)', () => {
  it('every column asks for at least the width of what it shows — nothing is cut to «…»', async () => {
    const el = await mount();
    const cols = table(el).columns;
    expect(cols.map((c) => c.key).sort()).toEqual(Object.keys(CONTENT_PX).sort());
    for (const c of cols) {
      expect(c.width, `${c.key}: without a width it falls back to the 88 px floor and is cut`).toBeTruthy();
      expect(minTrackPx(c.width!), `${c.key}: its narrowest track is under its content`).toBeGreaterThanOrEqual(CONTENT_PX[c.key]);
    }
  });

  it('the nine columns fit side by side at 1280 px, with no sideways scroll', async () => {
    const el = await mount();
    const total = table(el).columns.reduce((sum, c) => sum + minTrackPx(c.width ?? '5.5rem'), 0);
    expect(total).toBeLessThanOrEqual(TRACKS_BUDGET_PX);
  });

  it.each([
    [390, 'cards'],
    [820, 'cards'],
    [1024, 'cards'],
    [1279, 'cards'],
    [1280, 'table'],
    [1440, 'table'],
    [1920, 'table'],
  ])('at %i px it opens in %s', async (width, view) => {
    const el = await mount(width);
    expect(table(el).defaultView).toBe(view);
  });
});
