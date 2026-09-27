// Money on screen is painted by `<ok-money>` and nothing else (ERPlora/pm#289).
//
// The runtime keeps every amount as an INTEGER in the minor unit (ADR-0123) and `<ok-money>` is the
// one place that turns that integer into text: it cuts the digits by string, never divides. A module
// that formats money on its own — `toFixed(2)` (or `toFixed(scale)`, the same float), a
// `NumberFormat`/`toLocaleString` with a `currency`, or the SDK's `formatMoney`/`formatAmount`,
// which divide in a float — paints the same amount with its own separators and its own rounding,
// and the invoice detail stops matching the invoice paper.
//
// The same goes for the SDK's `eurosToCents`/`centsToEuros`: they pin the scale to two decimals, so
// in a JPY or KWD hub a typed price is stored 100× or 10× wrong (invoice#95) — convert with
// `majorToMinor(x, currencyDecimals())` instead.
//
// And `<ok-money>`/`formatMinor` come in by ENTRY POINT (`@erplora/outfitkit/ok-money`), never as
// a value from the barrel (`@erplora/outfitkit`): the barrel re-exports every `ok-*`, so a single
// `import { formatMinor } from '@erplora/outfitkit'` inlines the whole library into `dist/`
// (216 KB → 1.1 MB in payment_gateways#36). Type-only imports are erased and stay allowed.
//
// This guard reads the source of `ui/` (tests excluded) and fails if any of those comes back. The
// only `toFixed` allowed is on something that is NOT money, and that exact line has to be listed
// below with the reason — a line, not a file, so an exception never covers the next amount written
// next to it; a listed line that no longer exists fails too, so the list cannot rot.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** `ui/` from the module root — where the gate runs vitest from (see form-testids.test.ts). */
const UI = join(process.cwd(), 'ui');

type Rule = 'toFixed' | 'sdk-format' | 'intl-currency' | 'fixed-scale' | 'barrel';
type Violation = { rule: Rule; line: number; text: string };

/** Exact lines allowed to break a rule — `file:[rule] trimmed code line` → why it is not an amount. */
const NOT_MONEY: Record<string, string> = {
  'lib/line-tax.ts:[toFixed] const pct = (v: unknown) => `${Number(v || 0).toFixed(2)}%`;':
    'tax RATE of a line («21.00%»), a percentage, not an amount',
  "lib/currency-symbol.ts:[intl-currency] const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: iso }).formatToParts(0);":
    'reads the SYMBOL of an ISO code from formatToParts(0); no amount goes through it',
  'components/erp-invoice-list/erp-invoice-list.ts:[toFixed] const pct = (n: number) => (Number.isInteger(n) ? n.toFixed(0) : String(n));':
    'tax RATE in the label of a tax-breakdown row («IVA 21%»), a percentage, not an amount',
  'components/erp-invoice-list/erp-invoice-list.ts:[toFixed] label: `IVA ${Number.isFinite(r) ? r.toFixed(0) : rate}%`,':
    'tax RATE in the label of a legacy (object) tax breakdown, a percentage, not an amount',
};

const exceptionKey = (rel: string, v: Violation) => `${rel}:[${v.rule}] ${v.text}`;

/** Every hand-formatted money hit in `ui/`, as `exceptionKey`s with the line number kept apart. */
function uiViolations(): Array<{ key: string; line: number }> {
  return sources(UI).flatMap((f) => {
    const rel = relative(UI, f);
    return moneyViolations(readFileSync(f, 'utf8')).map((v) => ({ key: exceptionKey(rel, v), line: v.line }));
  });
}

/** The hits no NOT_MONEY line covers, ready to print. */
function unexcepted(hits: Array<{ key: string; line: number }>): string[] {
  return hits.filter((v) => !(v.key in NOT_MONEY)).map((v) => `${v.key} (line ${v.line})`);
}

/** Comments out: they explain the old bugs and would trip the rules. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The argument list of the call whose `(` is at `open`, up to its matching `)`. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** Scans the WHOLE source, not line by line: prettier splits a call over several lines and a
 *  `currency` two lines below its `NumberFormat(` must still count (HALLAZGO rv-sales-376). */
function moneyViolations(src: string): Violation[] {
  const code = stripComments(src);
  const lineAt = (i: number) => code.slice(0, i).split('\n').length;
  const textAt = (i: number) => code.split('\n')[lineAt(i) - 1].trim();
  const out: Violation[] = [];
  const add = (rule: Rule, i: number) => out.push({ rule, line: lineAt(i), text: textAt(i) });
  // Any digits: `toFixed(scale)` on an amount is the same float path as `toFixed(2)`.
  for (const m of code.matchAll(/\.toFixed\s*\(/g)) add('toFixed', m.index!);
  for (const m of code.matchAll(/\bformat(Money|Amount)\s*\(/g)) add('sdk-format', m.index!);
  for (const m of code.matchAll(/\b(eurosToCents|centsToEuros)\s*\(/g)) add('fixed-scale', m.index!);
  for (const m of code.matchAll(/NumberFormat\s*\(/g)) {
    if (/\bcurrency\b/.test(callArgs(code, m.index! + m[0].length - 1))) add('intl-currency', m.index!);
  }
  for (const m of code.matchAll(/\.toLocaleString\s*\(/g)) {
    if (/\bcurrency\b/.test(callArgs(code, m.index! + m[0].length - 1))) add('intl-currency', m.index!);
  }
  // A bare `import '@erplora/outfitkit'` or an `export … from` it inlines the barrel just the same.
  for (const m of code.matchAll(/\b(?:import|export)\s+(?!type\b)(?:[^;'"]*?\bfrom\s+)?['"]@erplora\/outfitkit['"]/g)) add('barrel', m.index!);
  return out.sort((a, b) => a.line - b.line);
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('the scanner catches hand-formatted money (positive control)', () => {
  it('flags toFixed(2), the SDK formatters and Intl currency', () => {
    const rules = moneyViolations(
      [
        'const a = (v: unknown) => Number(v || 0).toFixed(2);',
        'const b = (v: unknown) => erplora().formatMoney(Number(v || 0));',
        'const c = erplora().formatAmount(12);',
        "const d = new Intl.NumberFormat('es', { style: 'currency', currency: 'EUR' });",
      ].join('\n'),
    ).map((v) => v.rule);
    expect(rules).toEqual(['toFixed', 'sdk-format', 'sdk-format', 'intl-currency']);
  });

  it('follows a call across lines (the prettier shape), not just one line', () => {
    const src = ['export const f = new Intl.NumberFormat("es-ES", {', '  style: "currency",', '  currency: "EUR",', '});', 'const g = (v: number) => v', '  .toFixed(', '    2,', '  );'].join('\n');
    expect(moneyViolations(src).map((v) => [v.rule, v.line])).toEqual([['intl-currency', 1], ['toFixed', 6]]);
  });

  it('flags the SDK conversions that pin the scale to two decimals (invoice#95)', () => {
    const src = ['const a = eurosToCents(it.unit_price);', 'const b = centsToEuros(', '  row.price,', ');'].join('\n');
    expect(moneyViolations(src).map((v) => [v.rule, v.line])).toEqual([['fixed-scale', 1], ['fixed-scale', 2]]);
  });

  it('flags toFixed with ANY digits: toFixed(scale) is the same float path as toFixed(2)', () => {
    const src = ['const a = (v: number) => (v / 100).toFixed(currencyDecimals());', 'const b = (v: number) => (v / 1000).toFixed(3);'].join('\n');
    expect(moneyViolations(src).map((v) => [v.rule, v.line])).toEqual([['toFixed', 1], ['toFixed', 2]]);
  });

  it('flags toLocaleString with a currency, across lines too (HALLAZGO rv-verifactu-136)', () => {
    const src = ["const a = (v / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });", 'const b = x.toLocaleString(locale, {', '  currency: iso,', '});', 'const c = when.toLocaleString(locale);'].join('\n');
    expect(moneyViolations(src).map((v) => [v.rule, v.line])).toEqual([['intl-currency', 1], ['intl-currency', 2]]);
  });

  it('flags a VALUE import from the OutfitKit barrel, lets type-only and entry-point imports through', () => {
    const src = [
      "import { formatMinor } from '@erplora/outfitkit';",
      'import {',
      '  formatMinor as fm,',
      "} from '@erplora/outfitkit';",
      "import type { DataTableColumn } from '@erplora/outfitkit';",
      "import { formatMinor } from '@erplora/outfitkit/ok-money';",
      "import '@erplora/outfitkit/ok-money';",
      "import '@erplora/outfitkit';",
      "export { formatMinor } from '@erplora/outfitkit';",
      "export type { DataTableColumn } from '@erplora/outfitkit';",
      "export const pkg = '@erplora/outfitkit';",
    ].join('\n');
    expect(moneyViolations(src).map((v) => [v.rule, v.line])).toEqual([['barrel', 1], ['barrel', 2], ['barrel', 8], ['barrel', 9]]);
  });

  it('a NumberFormat without a currency is not money', () => {
    expect(moneyViolations("const n = new Intl.NumberFormat('es', {\n  maximumFractionDigits: 3,\n});\nconst c = 'currency';")).toEqual([]);
  });

  it('an exception covers its exact line only, never a new amount in the same file', () => {
    const excepted = Object.keys(NOT_MONEY).find((k) => k.startsWith('lib/line-tax.ts:'))!;
    const sameFile = 'lib/line-tax.ts:[toFixed] const amt = (v: number) => `${(v / 100).toFixed(2)} €`;';
    expect(unexcepted([{ key: excepted, line: 14 }, { key: sameFile, line: 15 }])).toEqual([`${sameFile} (line 15)`]);
  });

  it('ignores the same words inside comments', () => {
    expect(moneyViolations('// used to be toFixed(2) and formatMoney(x)\n/* NumberFormat( currency */')).toEqual([]);
  });
});

describe('ui/ paints money only through <ok-money>', () => {
  const files = sources(UI);

  it('finds the module sources (the guard is not scanning an empty folder)', () => {
    expect(files.map((f) => relative(UI, f))).toContain('components/erp-invoice-list/erp-invoice-list.ts');
  });

  it('no file formats money by hand', () => {
    const found = unexcepted(uiViolations());
    expect(found, 'money must be painted with <ok-money value="<minor units>">').toEqual([]);
  });

  it('every NOT_MONEY exception is still needed', () => {
    const found = new Set(uiViolations().map((v) => v.key));
    expect(Object.keys(NOT_MONEY).filter((k) => !found.has(k)), 'remove these from NOT_MONEY').toEqual([]);
  });
});
