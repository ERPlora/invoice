// @vitest-environment happy-dom

// invoice#141 — the printed A4 is painted by the `<ok-invoice>` BAKED into `dist/invoice.esm.js`
// (the hub shell does not define it, so the bundle's copy is the one that paints). The tax summary
// rows are written by the module in the language of the hub («IVA 21 %», «5,2 %» in es); the lines
// table is written by that baked `<ok-invoice>`. Baked with an OutfitKit older than outfitkit#253
// the lines kept «21%», «5.2%» — the same Spanish paper mixing two ways of writing a rate.
//
// This loads the artifact that ships (not the sources, not the OutfitKit in node_modules), so a
// re-bake against an older OutfitKit fails here.
import { beforeAll, describe, expect, it } from 'vitest';

const NBSP = ' ';

type OkInvoice = HTMLElement & { invoice: unknown; updateComplete: Promise<unknown>; shadowRoot: ShadowRoot };

beforeAll(async () => {
  (globalThis as Record<string, unknown>).erplora = { locale: 'es', on: () => () => {}, t: (_c: unknown, k: string) => k };
  // @ts-expect-error — the built bundle has no type declarations; it is loaded for its side effects.
  await import('../../../dist/invoice.esm.js');
});

async function paint(lang: string): Promise<string[]> {
  document.documentElement.lang = lang;
  document.body.innerHTML = '';
  const el = document.createElement('ok-invoice') as OkInvoice;
  el.invoice = {
    number: 'FACT-2026-000001',
    currency: 'EUR',
    decimals: 2,
    lines: [
      { description: 'Champú', qty: 2, unit_price: 1895, tax_rate: 21, total: 3790 },
      { description: 'Aceite', qty: 1.5, unit_price: 1000, tax_rate: 5.2, total: 1500 },
    ],
    taxes: [],
    subtotal: 5290,
    tax_total: 874,
    total: 6164,
  };
  document.body.appendChild(el);
  await el.updateComplete;
  return [...el.shadowRoot.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td.num')].map((td) => td.textContent?.trim() ?? '').join(' | '),
  );
}

describe('the lines of the printed A4 write rates and quantities in the language of the paper (invoice#141)', () => {
  it('the bundle defines the <ok-invoice> that paints the A4', () => {
    expect(customElements.get('ok-invoice')).toBeTruthy();
  });

  it('es: the line rate reads «21 %» and «5,2 %», like the tax summary rows', async () => {
    const rows = await paint('es');
    expect(rows[0]).toContain(`21${NBSP}%`);
    expect(rows[1]).toContain(`5,2${NBSP}%`);
    expect(rows[1]).toContain('1,5');
  });

  it('en: the line rate reads «21%» and «5.2%»', async () => {
    const rows = await paint('en');
    expect(rows[0]).toContain('21%');
    expect(rows[1]).toContain('5.2%');
    expect(rows[1]).toContain('1.5');
  });
});
