// A screen the QA robot cannot name is a screen nobody drives (invoice#76).
//
// The hub's QA walks the invoicing screens with Playwright, and Playwright addresses by
// `data-testid`: it is the only hook that survives a copy change, the `en`↔`es` translation and the
// Shadow DOM these Web Components live in. With no hook a spec falls back to text or to `nth`,
// which is how 6 points of this module were left unverified in the restaurant walkthrough of
// 2026-09-09.
//
// This is the guard of the PATTERN, not a patch on one screen. It is the module's mirror of
// `hub/apps/web/src/form-testids.test.ts`, translated from Vue single-file components to the Lit
// templates this repo is written in, and it enforces five things:
//
//   · COVERAGE — on a registered surface no form control is left without a hook, so the field
//     somebody adds next month is born addressable.
//   · CONTRACT — the names QA writes in its specs are declared here, and the declared set is
//     EXACTLY the one in the file. A `data-testid` is a contract with whoever reads it from
//     outside: renaming it in silence breaks the QA suite in ANOTHER repo, days later, so renaming
//     it has to break THIS test first, here, where it is visible.
//   · ATTRIBUTE — `data-test` and its look-alikes are denied. `getByTestId` resolves `data-testid`
//     and nothing else, so a `data-test` hook is one the robot can never reach.
//   · SPELLING — one single way of writing the hook. Every rule below reads `data-testid="…"`, so
//     any other way of writing the SAME attribute is a hook Lit renders, QA can address, and this
//     file never sees.
//   · RATCHET — every screen with a form is classified: covered, or pending with a REAL issue, and
//     the pending count only goes down.
//
// The convention is `architecture/hub/apps/testids.md`: `<surface>-<field|action|state>`,
// kebab-case, screen prefix always, and a repeated row carries its identity as its own segment.
//
// 🔴 ONE ADAPTATION, AND IT MATTERS. The hub spells a computed hook `:data-testid="…"`, which is
// Vue's binding shorthand. Lit has no such shorthand: `:data-testid` there is an attribute LITERALLY
// named `:data-testid`, which `getByTestId` never resolves. So this repo writes both halves the same
// way — `data-testid="fixed"` and `data-testid="${expr}"`, always double-quoted — and the spelling
// rule denies the rest, the Vue shorthand included.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * `ui/` of the module, from the module root — which is where the gate always runs vitest from
 * (`include: ['ui/**\/*.test.ts']` in the toolkit's config is relative to it). `import.meta.url`,
 * which the hub's guard uses, is not a `file:` URL under that config: vitest serves the test
 * through Vite and `fileURLToPath` throws before a single rule is read.
 */
const UI = join(process.cwd(), 'ui');

/** This file: the only one the attribute rule cannot read, because it has to spell it out to deny it. */
const GUARD = 'form-testids.test.ts';

/**
 * A covered surface: `prefix` is the namespace that belongs to it, `contract` is the EXACT set of
 * literal `data-testid` it writes today, `computed` the same for the ones Lit builds at render time
 * (declared by their SHAPE, with `*` where the interpolation goes), `tables` the `testid` handed to
 * each `<ok-data-table>`, and `controlCount` how many controls the file holds — fields, actions and
 * the form itself, everything `CONTROL_TAGS` sweeps.
 *
 * To get in here a screen needs every half: every control hooked, its names written down, and the
 * count declared. Adding a field to one of these screens forces this list to move — on purpose:
 * that is the moment somebody decides what the field is called for the rest of the world.
 */
const COVERED: Record<
  string,
  { prefix: string; contract: string[]; computed?: string[]; tables?: string[]; controlCount: number }
> = {
  // `/m/invoice/invoice` — the list, the manual issuing form that lives in the table's side panel,
  // the invoice detail (with its VeriFactu card) and the rectification panel. It is the door the QA
  // walks to issue an invoice, collect it and rectify it without touching a selector by text.
  'components/erp-invoice-list/erp-invoice-list.ts': {
    prefix: 'invoice-',
    controlCount: 21,
    tables: ['invoice-table'],
    contract: [
      'invoice-action-error',
      'invoice-aeat',
      'invoice-aeat-csv',
      'invoice-aeat-status',
      'invoice-create-add-line',
      'invoice-create-address',
      'invoice-create-cancel',
      'invoice-create-customer',
      'invoice-create-customer-tax-id',
      'invoice-create-error',
      'invoice-create-form',
      'invoice-create-notes',
      'invoice-create-series',
      'invoice-create-submit',
      'invoice-detail',
      'invoice-detail-back',
      'invoice-detail-base',
      'invoice-detail-error',
      'invoice-detail-lines',
      'invoice-detail-load-error',
      'invoice-detail-mark-paid',
      'invoice-detail-no-lines',
      'invoice-detail-print',
      'invoice-detail-rectify',
      'invoice-detail-status',
      'invoice-detail-taxes',
      'invoice-detail-total',
      'invoice-list-error',
      'invoice-rectify',
      'invoice-rectify-cancel',
      'invoice-rectify-reason',
      'invoice-rectify-submit',
    ],
    // The draft lines of the issuing form. They carry the line's own identity (`DraftItem.uid`),
    // never its index: deleting the first line renumbers every index below it, so a spec that
    // filled `…-0-…` would silently be filling another line from then on.
    computed: [
      'invoice-line-*-description',
      'invoice-line-*-price',
      'invoice-line-*-quantity',
      'invoice-line-*-remove',
      'invoice-line-*-tax-rate',
    ],
  },
  // `/m/invoice/settings` — the invoice SERIES: the table and the create/edit form that shares its
  // side panel. `invoice-series-` and not `invoice-settings-`: the hub names a surface by its domain
  // noun (`employee-`, `api-key-`), not by the menu entry that leads to it.
  'components/erp-invoice-settings/erp-invoice-settings.ts': {
    prefix: 'invoice-series-',
    controlCount: 11,
    tables: ['invoice-series-table'],
    contract: [
      'invoice-series-active',
      'invoice-series-cancel',
      'invoice-series-code',
      'invoice-series-default',
      'invoice-series-form',
      'invoice-series-form-error',
      'invoice-series-format',
      'invoice-series-format-locked',
      'invoice-series-list-error',
      'invoice-series-name',
      'invoice-series-preview',
      'invoice-series-prefix',
      'invoice-series-submit',
      'invoice-series-type',
      'invoice-series-year',
    ],
  },
};

/**
 * Screens with a form that carry no hooks yet, each with the issue that asks for them.
 *
 * The list can only SHRINK: when one is finished it leaves here and enters above (the stale-entry
 * rule fails if it stays). A new component is not born in this list — it is born covered.
 */
const NOT_YET_COVERED: Record<string, string> = {};

/**
 * How many screens are pending TODAY. This number ONLY GOES DOWN. Without it the pending list is a
 * list of exceptions: a new screen with a form walks in with a decorative issue number and the
 * guard stays green. Pinned, parking a screen forces raising this by hand, on a line whose comment
 * says it is not raised.
 */
const PENDING_TODAY = 0;

/**
 * What a person TOUCHES: what they fill in, the actions they press and the form that holds them.
 *
 * 🔴 The hub's own list stops at the fields and leaves the buttons to the contract, "one by one".
 * Copied here as-is that is a hole, and a measured one: the contract only knows the hooks that ARE
 * written, so an action button added WITHOUT one changes neither the literal set nor the field
 * count, and the whole guard stays green while the most pressed control on the screen is
 * unreachable. Sweeping the buttons and the form is what makes the "a control with no hook" mutant
 * die instead of survive.
 */
const CONTROL_TAGS = [
  'ion-button',
  'button',
  'form',
  'ion-input',
  'ion-select',
  'ion-textarea',
  'ion-toggle',
  'ion-checkbox',
  'ion-searchbar',
  'ion-radio-group',
  'ion-datetime',
  'ion-range',
  'input',
  'select',
  'textarea',
] as const;

/**
 * The opening tag of a control. The lookahead is what keeps `<ion-select-option>` out of
 * `<ion-select>` and `<input-something>` out of `<input>`.
 */
const CONTROL_OPEN = new RegExp(`<(${CONTROL_TAGS.join('|')})(?=[\\s/>])`, 'g');

/**
 * Any `data-testid="…"`, literal or interpolated. The lookbehind is what tells the hook from the
 * spellings that merely look like it (`:data-testid`, `.data-testid`, `my-data-testid`), which the
 * spelling rule then denies outright.
 */
const TESTID_VALUE = /(?<![\w.:?@-])data-testid="([^"]*)"/g;

/**
 * The `testid` an `<ok-data-table>` receives: the whole namespace of the chrome it paints.
 *
 * The `:` in the lookbehind is doing work. `:testid="x"` is not a binding in Lit — it paints an
 * attribute literally called `:testid`, which `ok-data-table` never reads, so the table paints no
 * chrome at all. Without the `:` this reader accepts that dead spelling as the declared namespace
 * and the static rule goes green on a table nobody can address.
 */
const TABLE_TESTID = /(?<![:\w-])testid="([^"]*)"/;

/**
 * Any `data-test…` attribute, so the guard can tell the hook from the variants that look like one
 * and are not. Playwright resolves `getByTestId` against `data-testid` and nothing else, so
 * `data-test="x"` is a hook the robot cannot reach — and the spec reading it asserts on nothing for
 * ever.
 */
const TEST_ATTR = /(?<![\w-])(data-test[\w-]*)\s*=/g;

/**
 * How a hook is WRITTEN. The rules above read ONE spelling, so every other way of writing the same
 * attribute has to be denied here or the guard fails open on the next person who types it. The four
 * that Lit renders and this file would not see: the Vue shorthand (`:data-testid`), its longhand
 * (`v-bind:data-testid`), Lit's own property and boolean bindings (`.data-testid`, `?data-testid`)
 * and — the realistic one in a Lit repo — an UNQUOTED binding, `data-testid=${expr}`, which is how
 * `ok-data-table` writes its own and which no regex here can read the shape of.
 *
 * The SEPARATOR is captured, not skipped, and that is the fifth: HTML allows `data-testid = "x"`,
 * and the two readers of this file disagree about it — the coverage one takes it, the contract one
 * does not. So the control counts as hooked while its name is never frozen, and a later rename of
 * it breaks nothing. One spelling means one spelling: no space around the `=` either.
 */
const TESTID_SPELLING = /(?<![\w-])(v-bind:data-testid|[.:?@]?data-testid)(\s*=\s*)("|'|[^\s"'>])/g;

/** Kebab-case: lowercase and digits joined by single hyphens. */
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The same, with `*` allowed as a whole segment: the shape of a computed hook. */
const KEBAB_SHAPE = /^[a-z][a-z0-9]*(-([a-z0-9]+|\*))*$/;

/**
 * The `>` that closes an opening tag, skipping the ones that live inside quotes AND inside a Lit
 * `${…}` binding.
 *
 * The binding half is not decoration: every handler in these templates is an arrow function, and
 * `=>` carries a `>`. Reading up to the first bare `>` would cut the tag at the first handler and
 * leave any attribute written after it invisible — a hook that exists and a guard that says it does
 * not, which is the fail-open this whole file exists to prevent.
 */
function openTag(source: string, start: number): string {
  let quote: string | null = null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '$' && source[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (depth > 0) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '"' || c === "'" || c === '`') quote = c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '>') return source.slice(start, i + 1);
  }
  return source.slice(start);
}

function uiFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) uiFiles(full, found);
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

/** Every component and helper of `ui/`, which is all the markup this module ships. */
const SURFACES: Array<{ name: string; source: string }> = uiFiles(UI)
  .map((full) => relative(UI, full))
  .filter((name) => !name.endsWith('.test.ts'))
  .map((name) => ({ name, source: readFileSync(join(UI, name), 'utf8') }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The same plus the batteries: a spec still reading a hook the screen dropped is a dead assertion. */
const UI_SOURCES: Array<{ name: string; source: string }> = uiFiles(UI)
  .map((full) => relative(UI, full))
  .filter((name) => name !== GUARD)
  .map((name) => ({ name, source: readFileSync(join(UI, name), 'utf8') }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * The form controls of a surface, with the text of their opening tag.
 *
 * The whole file is swept, not just the `html` templates: a Lit component builds its markup with
 * tagged templates that nest inside each other and inside `${…}` blocks, so any attempt to carve
 * "the template" out of the source is an attempt at a parser — and every corner it got wrong would
 * be a control the guard stops seeing. Sweeping everything can only ever ask for a hook on
 * something that is not a control, which is loud and harmless.
 */
function controls(source: string): Array<{ tag: string; line: number; open: string }> {
  const found: Array<{ tag: string; line: number; open: string }> = [];
  CONTROL_OPEN.lastIndex = 0;
  for (let m = CONTROL_OPEN.exec(source); m; m = CONTROL_OPEN.exec(source)) {
    found.push({
      tag: m[1],
      line: source.slice(0, m.index).split('\n').length,
      open: openTag(source, m.index),
    });
  }
  return found;
}

/** Carries a hook, in the one spelling the rules read. */
const hasTestid = (openTagText: string): boolean => /(?:^|\s)data-testid="/.test(openTagText);

/**
 * The spellings of the hook a chunk of markup writes that are NOT the one spelling. One reader, so
 * the rule below and the fixtures that pin it can never answer differently.
 */
function badSpellings(source: string): string[] {
  const out: string[] = [];
  TESTID_SPELLING.lastIndex = 0;
  for (let m = TESTID_SPELLING.exec(source); m; m = TESTID_SPELLING.exec(source)) {
    if (m[1] !== 'data-testid' || m[2] !== '=' || m[3] !== '"') out.push(`${m[1]}${m[2]}${m[3]}`);
  }
  return out;
}

function testidValues(source: string): string[] {
  const found: string[] = [];
  TESTID_VALUE.lastIndex = 0;
  for (let m = TESTID_VALUE.exec(source); m; m = TESTID_VALUE.exec(source)) found.push(m[1]);
  return found;
}

const isComputed = (value: string): boolean => value.includes('${');

/** `invoice-line-${it.uid}-price` → `invoice-line-*-price`: what QA can predict, spelled out. */
const shapeOf = (value: string): string => value.replace(/\$\{[^}]*\}/g, '*');

const literalTestids = (source: string): string[] => testidValues(source).filter((v) => !isComputed(v));

/**
 * The shapes a screen writes today, deduplicated — every row of a repeated block shares one.
 *
 * Declaring the SHAPE and not just the fixed head is deliberate: the five hooks of an invoice line
 * all begin `invoice-line-`, so a head-only contract would let `…-description` be renamed to
 * `…-desc` and stay green — exactly the silent rename this guard is for.
 */
const computedShapes = (source: string): string[] => [
  ...new Set(testidValues(source).filter(isComputed).map(shapeOf)),
];

/** The `testid` each `<ok-data-table>` of a surface receives, in source order. */
function tableTestids(source: string): Array<string | null> {
  const found: Array<string | null> = [];
  const open = /<ok-data-table(?=[\s/>])/g;
  for (let m = open.exec(source); m; m = open.exec(source)) {
    found.push(openTag(source, m.index).match(TABLE_TESTID)?.[1] ?? null);
  }
  return found;
}

const uncoveredControls = (source: string): string[] =>
  controls(source)
    .filter((c) => !hasTestid(c.open))
    .map((c) => `<${c.tag}> line ${c.line}`);

const surfaceOf = (name: string): string => SURFACES.find((s) => s.name === name)?.source ?? '';

describe('data-testid — the module UI convention (invoice#76)', () => {
  it('every covered surface exists', () => {
    const ghosts = [...Object.keys(COVERED), ...Object.keys(NOT_YET_COVERED)].filter(
      (name) => !SURFACES.some((s) => s.name === name),
    );
    expect(ghosts, 'a register that names a file nobody ships checks nothing').toEqual([]);
  });

  it('a covered surface leaves no control without a hook', () => {
    const offenders: string[] = [];
    for (const name of Object.keys(COVERED)) {
      for (const control of uncoveredControls(surfaceOf(name))) offenders.push(`${name}: ${control}`);
    }
    expect(offenders, 'Playwright cannot fill a control with no data-testid').toEqual([]);
  });

  it('the declared control count is EXACTLY the one on the screen', () => {
    // The belt for the rule above: a control added with no hook has to break something even if the
    // opening-tag reader ever grew a blind spot, and a control added WITH one has to be named here.
    const drift: string[] = [];
    for (const [name, spec] of Object.entries(COVERED)) {
      const found = controls(surfaceOf(name)).length;
      if (found !== spec.controlCount) {
        drift.push(`${name}: ${found} controls, the register declares ${spec.controlCount}`);
      }
    }
    expect(drift, 'a new control is named here, in the same change that adds it').toEqual([]);
  });

  it('the literal contract is EXACTLY the one on the screen', () => {
    const drift: string[] = [];
    for (const [name, spec] of Object.entries(COVERED)) {
      const found = [...new Set(literalTestids(surfaceOf(name)))].sort();
      const declared = [...spec.contract].sort();
      for (const missing of declared.filter((v) => !found.includes(v))) {
        drift.push(`${name}: the contract declares "${missing}" and the screen no longer has it`);
      }
      for (const extra of found.filter((v) => !declared.includes(v))) {
        drift.push(`${name}: the screen has "${extra}" and the contract does not declare it`);
      }
    }
    expect(drift, 'renaming a data-testid breaks the QA suite: declare it here').toEqual([]);
  });

  it('the computed contract is EXACTLY the one on the screen', () => {
    const drift: string[] = [];
    for (const [name, spec] of Object.entries(COVERED)) {
      const found = computedShapes(surfaceOf(name)).sort();
      const declared = [...(spec.computed ?? [])].sort();
      for (const missing of declared.filter((v) => !found.includes(v))) {
        drift.push(`${name}: the contract declares "${missing}" and the screen no longer has it`);
      }
      for (const extra of found.filter((v) => !declared.includes(v))) {
        drift.push(`${name}: the screen has "${extra}" and the contract does not declare it`);
      }
    }
    expect(drift, 'renaming a computed data-testid breaks the QA suite: declare it here').toEqual([]);
  });

  it('every ok-data-table is handed the testid its chrome derives from', () => {
    // `<ok-data-table>` paints the add button, the searchbar, the rows, the row actions and the
    // pager, and it names NONE of them without a `testid` (outfitkit#143). Dropping the attribute
    // takes a dozen hooks off the screen without touching a single one of them.
    const drift: string[] = [];
    for (const [name, spec] of Object.entries(COVERED)) {
      const found = tableTestids(surfaceOf(name));
      const declared = spec.tables ?? [];
      if (found.length !== declared.length) {
        drift.push(`${name}: ${found.length} <ok-data-table>, the register declares ${declared.length}`);
        continue;
      }
      found.forEach((value, i) => {
        if (value !== declared[i]) {
          drift.push(`${name}: <ok-data-table> #${i + 1} has testid=${JSON.stringify(value)}, declared ${JSON.stringify(declared[i])}`);
        }
      });
    }
    expect(drift, 'without its testid the table paints no hook at all').toEqual([]);
  });

  it('every literal name is kebab-case', () => {
    const offenders: string[] = [];
    for (const { name, source } of SURFACES) {
      for (const value of literalTestids(source)) {
        if (!KEBAB.test(value)) offenders.push(`${name}: "${value}"`);
      }
    }
    expect(offenders, 'a name that is not kebab-case breaks what QA predicts').toEqual([]);
  });

  it('every computed shape is kebab-case with the identity as its own segment', () => {
    const offenders: string[] = [];
    for (const { name, source } of SURFACES) {
      for (const shape of computedShapes(source)) {
        if (!KEBAB_SHAPE.test(shape)) offenders.push(`${name}: "${shape}"`);
      }
    }
    expect(
      offenders,
      'glue the identity to a word and QA cannot tell where the name ends and the id starts',
    ).toEqual([]);
  });

  it('a computed hook spells out a fixed head', () => {
    const offenders: string[] = [];
    for (const { name, source } of SURFACES) {
      for (const shape of computedShapes(source)) {
        if (shape.startsWith('*')) offenders.push(`${name}: "${shape}"`);
      }
    }
    expect(offenders, 'QA cannot predict a name the screen does not spell out').toEqual([]);
  });

  it('every hook lives in the namespace of its screen', () => {
    const offenders: string[] = [];
    for (const [name, spec] of Object.entries(COVERED)) {
      const source = surfaceOf(name);
      const names = [...new Set(literalTestids(source)), ...computedShapes(source), ...(spec.tables ?? [])];
      for (const value of names) {
        if (!value.startsWith(spec.prefix)) offenders.push(`${name}: "${value}" ≠ ${spec.prefix}*`);
      }
    }
    expect(offenders, 'the screen prefix is what keeps two screens from colliding').toEqual([]);
  });

  it('no literal name is written by two surfaces', () => {
    const owners = new Map<string, string[]>();
    for (const { name, source } of SURFACES) {
      for (const value of new Set(literalTestids(source))) {
        owners.set(value, [...(owners.get(value) ?? []), name]);
      }
    }
    const shared = [...owners]
      .filter(([, files]) => files.length > 1)
      .map(([value, files]) => `"${value}" in ${files.join(' + ')}`);
    expect(shared, 'getByTestId would return two elements and the spec would pick at random').toEqual([]);
  });

  it('nothing in ui/ writes data-test: Playwright only resolves data-testid', () => {
    const offenders: string[] = [];
    for (const { name, source } of UI_SOURCES) {
      TEST_ATTR.lastIndex = 0;
      for (let m = TEST_ATTR.exec(source); m; m = TEST_ATTR.exec(source)) {
        if (m[1] !== 'data-testid') offenders.push(`${name}: ${m[1]}=`);
      }
    }
    expect(offenders, 'getByTestId does not resolve it: write data-testid, prefixed with its screen').toEqual([]);
  });

  it('a hook is spelled data-testid="…" and nothing else', () => {
    const offenders: string[] = [];
    for (const { name, source } of UI_SOURCES) {
      for (const bad of badSpellings(source)) offenders.push(`${name}: ${bad}`);
    }
    expect(offenders, 'the rules above read one spelling: any other is a hook with no contract').toEqual([]);
  });

  it('the spelling rule denies EVERY other way of writing the same attribute', () => {
    // Held against fixtures and not against the tree, because a rule that only ever sees the one
    // spelling nobody has typed yet is a rule nothing has checked. Each of these is an attribute
    // Lit renders and `getByTestId` may or may not reach — and that NO rule in this file reads.
    for (const fixture of [
      '<ion-input :data-testid="x"></ion-input>', // Vue's shorthand: an attribute literally named `:data-testid`
      '<ion-input v-bind:data-testid="x"></ion-input>',
      '<ion-input .data-testid="x"></ion-input>', // Lit property binding
      '<ion-input ?data-testid="x"></ion-input>', // Lit boolean binding
      "<ion-input data-testid='x'></ion-input>", // single quotes: every reader here wants double
      '<ion-input data-testid=${name}></ion-input>', // unquoted binding: no shape to read
      '<ion-input data-testid = "x"></ion-input>', // spaced `=`: the coverage reader takes it, the
      // contract reader does NOT — so the control counts as hooked and its name is never frozen
    ]) {
      expect(badSpellings(fixture), `this spelling has to be denied: ${fixture}`).not.toEqual([]);
    }
    expect(badSpellings('<ion-input data-testid="x"></ion-input>'), 'the one spelling').toEqual([]);
  });

  it('only the one spelling counts as a hook for coverage', () => {
    // The other half of the rule above: the two readers have to agree on what a hook IS. While they
    // disagree, `data-testid = "x"` leaves the control covered and its name outside the contract,
    // and a rename of it breaks nothing here.
    expect(hasTestid('<ion-input data-testid="x">'), 'the one spelling is a hook').toBe(true);
    expect(hasTestid('<ion-input :data-testid="x">'), ':data-testid is not a hook Lit resolves').toBe(false);
    expect(hasTestid('<ion-input data-testid = "x">'), 'a spelling the contract cannot read').toBe(false);
  });

  it('every screen with a form is classified: covered, or pending with its issue', () => {
    const unclassified = SURFACES.filter(
      ({ name, source }) =>
        controls(source).length > 0 && !(name in COVERED) && !(name in NOT_YET_COVERED),
    ).map(({ name }) => name);
    expect(
      unclassified,
      'a new form screen is born with its data-testid — or enters NOT_YET_COVERED with its issue',
    ).toEqual([]);
  });

  it('a pending screen that is already complete does not stay pending', () => {
    const stale = Object.keys(NOT_YET_COVERED).filter(
      (name) => uncoveredControls(surfaceOf(name)).length === 0,
    );
    expect(stale, 'it already has every hook: move it to COVERED with its contract').toEqual([]);
  });

  it('the pending list only shrinks: a new screen is born covered, not pending', () => {
    const pending = Object.keys(NOT_YET_COVERED).length;
    expect(
      pending,
      pending > PENDING_TODAY
        ? 'a new screen does not enter NOT_YET_COVERED: hook it and move it to COVERED'
        : `a pending screen left the list: lower PENDING_TODAY to ${pending}`,
    ).toBe(PENDING_TODAY);
  });

  it('every pending screen cites a real issue, not a placeholder', () => {
    const placeholders = Object.entries(NOT_YET_COVERED)
      .filter(([, issue]) => !/^[a-z][a-z0-9_-]*#\d+$/.test(issue))
      .map(([name, issue]) => `${name}: "${issue}"`);
    expect(placeholders, 'open the issue and write its number: a blank is not on the board').toEqual([]);
  });
});
