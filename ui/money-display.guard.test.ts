import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkMoneyDisplay, moduleRootFrom, stripComments } from '@erplora/module-toolkit/money-display-guard';

// GUARD (pm#289, shared since pm#505/pm#508): money on screen is painted by `<ok-money>` and nothing
// else, and OutfitKit comes in by entry point, never as a value from the barrel.
//
// The runtime keeps every amount as an INTEGER in the minor unit (ADR-0123) and `<ok-money>` is the
// one place that turns that integer into text: it cuts the digits by string, never divides. The
// common rules (`toFixed`, `Intl` with a `currency`, the barrel by its five doors) live in
// `@erplora/module-toolkit/money-display-guard` — one piece for every module, tested there against
// its own positives. This test only says what is specific to Facturación:
//
// * witnesses — each counts the CALL, not the name, so a scan over empty or over-stripped content
//   cannot stay green (rv-combos-22):
//   - the invoice list: the eight call sites of its `money(` helper (the Total column, the unit
//     price/base/tax/total of each detail line, and the base/taxes/total of the detail). They are
//     the sites, not the helper: a witness on the helper would not notice a site painting the raw
//     integer (rv-customers-103). The helper itself is pinned below, by the `<ok-money>` rule;
//   - the thermal paper (`lib/print-document.ts`): the six `: toUnits(` fields, the one boundary
//     where this module turns minor units into the major units the printer contract asks for;
//   - `lib/quantity.ts` and `lib/ion-tone.ts`: their exported helpers, so `lib/` provably stays in
//     the scan.
// * notDisplay — the four triaged in pm#289: a tax RATE in `pct` of `lib/line-tax.ts`, the currency
//   SYMBOL in `currencySymbol`, and the two tax-RATE labels of the list's breakdown rows. They are
//   also the witnesses on the detector's OUTPUT: fed empty or cut content, or without `lib/`, the
//   scan would report them as `stale_exception` (rv-taxes-78). The `Intl` key is the call collapsed
//   to one line (rv-mt-377). Add an entry (`'file: exact code line'` → why) only with the reason it
//   is not a screen amount.
// * outfitkitImporters — the two screens, both of which import OutfitKit by entry point, so the
//   barrel scan provably read each of them (rv-pricing-53).
it('money on screen goes through <ok-money> and OutfitKit by entry point (pm#289)', () => {
  expect(
    checkMoneyDisplay({
      from: import.meta.url,
      witnesses: {
        'components/erp-invoice-list/erp-invoice-list.ts': { text: 'money(', atLeast: 8 },
        'lib/print-document.ts': { text: ': toUnits(', atLeast: 6 },
        'lib/quantity.ts': 'export function formatQuantity(',
        'lib/ion-tone.ts': 'export function ionTone(',
      },
      notDisplay: {
        'lib/line-tax.ts: const pct = (v: unknown) => `${Number(v || 0).toFixed(2)}%`;':
          'tax RATE of a line («21.00%»), a percentage, not an amount',
        "lib/currency-symbol.ts: NumberFormat(locale, { style: 'currency', currency: iso })":
          'reads the SYMBOL of an ISO code from formatToParts(0); no amount goes through it',
        'components/erp-invoice-list/erp-invoice-list.ts: const pct = (n: number) => (Number.isInteger(n) ? n.toFixed(0) : String(n));':
          'tax RATE in the label of a tax-breakdown row («IVA 21%»), a percentage, not an amount',
        'components/erp-invoice-list/erp-invoice-list.ts: label: `IVA ${Number.isFinite(r) ? r.toFixed(0) : rate}%`,':
          'tax RATE in the label of a legacy (object) tax breakdown, a percentage, not an amount',
      },
      outfitkitImporters: [
        'components/erp-invoice-list/erp-invoice-list.ts',
        'components/erp-invoice-settings/erp-invoice-settings.ts',
      ],
    }),
  ).toEqual([]);
});

// Two rules of this module the shared piece does not carry (rv-mt-377):
//
// * sdk-format — Facturación paints every amount with `<ok-money>`, so the SDK's
//   `formatMoney`/`formatAmount` (which divide in a float) have no place here: they would paint the
//   invoice detail with other separators and other rounding than the invoice paper.
// * fixed-scale — the SDK's `eurosToCents`/`centsToEuros` pin the scale to two decimals, so in a
//   JPY or KWD hub a typed price is stored 100× or 10× wrong (invoice#95); read a typed price with
//   `parseMoneyInput(x, currencyDecimals(), …)` of `@erplora/module-toolkit/money-input` instead
//   (pm#521), which also reads what is pasted.

type ModuleRule = 'sdk-format' | 'fixed-scale';

/** Production sources of the UI, the same set the shared piece scans: tests, the `ui/test/`
 *  doubles and type declarations reach no screen. */
function uiSources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'test' || n === 'node_modules' ? [] : uiSources(p);
    return /\.(ts|js|vue)$/.test(n) && !/\.test\.(ts|js)$/.test(n) && !n.endsWith('.d.ts') ? [p] : [];
  });
}

/** What the module rules find in code already stripped of comments: each call to the SDK formatters
 *  or to the two-decimal conversions, as `[rule] trimmed line`, and how many times the same code
 *  does it right — paints with `<ok-money>`, reads a typed amount with `parseMoneyInput(` and a
 *  minor-unit one with `toUnits(` (both at the hub scale). Those counts are the witness on the
 *  detector's OUTPUT (rv-taxes-78): fed empty or cut content, it reports zero of them. The
 *  WHOLE source is scanned, not line by line: prettier splits a call over several lines
 *  (`centsToEuros(\n  row.price,\n)`). */
export function moduleMoneyScan(code: string): { hits: string[]; okMoney: number; parseMoneyInput: number; toUnits: number } {
  const lines = code.split('\n');
  const at = (rule: ModuleRule, i: number) => `[${rule}] ${lines[code.slice(0, i).split('\n').length - 1].trim()}`;
  return {
    hits: [
      ...[...code.matchAll(/\bformat(?:Money|Amount)\s*\(/g)].map((m) => at('sdk-format', m.index!)),
      ...[...code.matchAll(/\b(?:eurosToCents|centsToEuros)\s*\(/g)].map((m) => at('fixed-scale', m.index!)),
    ],
    okMoney: [...code.matchAll(/html`<ok-money\b/g)].length,
    parseMoneyInput: [...code.matchAll(/\bparseMoneyInput\s*\(/g)].length,
    toUnits: [...code.matchAll(/\btoUnits\s*\(/g)].length,
  };
}

describe('amounts go through <ok-money> and the hub scale, not the SDK helpers (pm#289, invoice#95)', () => {
  it('no SDK formatter and no two-decimal conversion in ui/', () => {
    const uiRoot = join(moduleRootFrom(import.meta.url), 'ui');
    const found: string[] = [];
    const seen = new Map<string, ReturnType<typeof moduleMoneyScan>>();
    for (const f of uiSources(uiRoot)) {
      const rel = f.slice(uiRoot.length + 1);
      const scan = moduleMoneyScan(stripComments(readFileSync(f, 'utf8')));
      seen.set(rel, scan);
      for (const h of scan.hits) found.push(`${rel}: ${h}`);
    }
    // The control that keeps this from passing vacuously, read from what the detector RETURNED, in
    // `components/` and in `lib/`: the list's `money(` helper built on `<ok-money>` and its typed
    // unit price read with `parseMoneyInput(typed, currencyDecimals(), …)` (pm#521), and the thermal
    // paper's `toUnits(` (its declaration and the six fields).
    const list = seen.get('components/erp-invoice-list/erp-invoice-list.ts');
    expect(list?.okMoney).toBeGreaterThanOrEqual(1);
    expect(list?.parseMoneyInput).toBeGreaterThanOrEqual(1);
    expect(seen.get('lib/print-document.ts')?.toUnits).toBeGreaterThanOrEqual(7);
    expect(found, 'paint with <ok-money>, read a typed amount with parseMoneyInput(x, currencyDecimals())').toEqual([]);
  });

  it('the detector catches the SDK formatters and the two-decimal conversions, across lines too', () => {
    const src = [
      'const a = erplora().formatMoney(Number(v || 0));',
      'const b = formatAmount(12);',
      'const c = eurosToCents(it.unit_price);',
      'const d = sdk.centsToEuros(',
      '  row.price,',
      ');',
    ].join('\n');
    expect(moduleMoneyScan(src).hits).toEqual([
      '[sdk-format] const a = erplora().formatMoney(Number(v || 0));',
      '[sdk-format] const b = formatAmount(12);',
      '[fixed-scale] const c = eurosToCents(it.unit_price);',
      '[fixed-scale] const d = sdk.centsToEuros(',
    ]);
  });

  it('ignores the same words inside comments and in other names', () => {
    expect(moduleMoneyScan(stripComments('// was formatMoney(x)\n/* eurosToCents( */\nconst c = majorToMinor(x, 2);')).hits).toEqual([]);
    expect(moduleMoneyScan('const f = formatMoneyInput;\nconst g = reformatAmount(1);').hits).toEqual([]);
  });
});
