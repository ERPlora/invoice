// Money on screen is painted by `<ok-money>` and nothing else (ERPlora/pm#289).
//
// The runtime keeps every amount as an INTEGER in the minor unit (ADR-0123) and `<ok-money>` is the
// one place that turns that integer into text: it cuts the digits by string, never divides. A module
// that formats money on its own — `toFixed(2)`, `Intl.NumberFormat({ style: 'currency' })`, or the
// SDK's `formatMoney`/`formatAmount`, which divide in a float — paints the same amount with its own
// separators and its own rounding, and the invoice detail stops matching the invoice paper.
//
// The same goes for the SDK's `eurosToCents`/`centsToEuros`: they pin the scale to two decimals, so
// in a JPY or KWD hub a typed price is stored 100× or 10× wrong (invoice#95) — convert with
// `majorToMinor(x, currencyDecimals())` instead.
//
// This guard reads the source of `ui/` (tests excluded) and fails if any of those comes back. The
// only `toFixed(2)` allowed is on something that is NOT money, and it has to be listed below with
// the reason; a listed file that no longer needs it fails too, so the list cannot rot.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** `ui/` from the module root — where the gate runs vitest from (see form-testids.test.ts). */
const UI = join(process.cwd(), 'ui');

type Rule = 'toFixed' | 'sdk-format' | 'intl-currency' | 'fixed-scale';
type Violation = { rule: Rule; line: number; text: string };

/** Files allowed to break ONE rule, and why what they format is not an amount. */
const NOT_MONEY: Record<string, { rule: Rule; why: string }> = {
  'lib/line-tax.ts': { rule: 'toFixed', why: 'tax RATE of a line («21.00%»), a percentage, not an amount' },
  'lib/currency-symbol.ts': { rule: 'intl-currency', why: 'reads the SYMBOL of an ISO code from formatToParts(0); no amount goes through it' },
};

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
  for (const m of code.matchAll(/\.toFixed\(\s*2\s*,?\s*\)/g)) add('toFixed', m.index!);
  for (const m of code.matchAll(/\bformat(Money|Amount)\s*\(/g)) add('sdk-format', m.index!);
  for (const m of code.matchAll(/\b(eurosToCents|centsToEuros)\s*\(/g)) add('fixed-scale', m.index!);
  for (const m of code.matchAll(/NumberFormat\s*\(/g)) {
    if (/\bcurrency\b/.test(callArgs(code, m.index! + m[0].length - 1))) add('intl-currency', m.index!);
  }
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

  it('a NumberFormat without a currency is not money', () => {
    expect(moneyViolations("const n = new Intl.NumberFormat('es', {\n  maximumFractionDigits: 3,\n});\nconst c = 'currency';")).toEqual([]);
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
    const found = files.flatMap((f) => {
      const rel = relative(UI, f);
      return moneyViolations(readFileSync(f, 'utf8'))
        .filter((v) => NOT_MONEY[rel]?.rule !== v.rule)
        .map((v) => `${rel}:${v.line} [${v.rule}] ${v.text}`);
    });
    expect(found, 'money must be painted with <ok-money value="<minor units>">').toEqual([]);
  });

  it('every NOT_MONEY exception is still needed', () => {
    const stale = Object.entries(NOT_MONEY).filter(
      ([rel, { rule }]) => !moneyViolations(readFileSync(join(UI, rel), 'utf8')).some((v) => v.rule === rule),
    );
    expect(stale, 'remove these from NOT_MONEY').toEqual([]);
  });
});
