// ERPlora/pm#521 — the PRICE of a line of a manual invoice reads what a person types or pastes the one
// way every module does (`@erplora/module-toolkit/money-input`).
//
// It used to be a `type="number"` field read with `Number()` + `majorToMinor()`. The detail of an
// invoice prints «1.250,50 €»; copied back into a new line:
//   * in the browser, the number field threw the pasted text away and «Issue invoice» stayed grey
//     with no reason given;
//   * «1.250,50», «1250,5» or «1 250,50» were NaN → the same grey button, no reason;
//   * «1.250» (one thousand two hundred and fifty for whoever typed it) went out as 1,25 € — an
//     invoice issued, numbered and sent to the tax authority for a thousandth of its price.
// Garbage and an ambiguous «1.250» are refused with a code the form explains, and nothing is sent.
//
// The SIGN (HALLAZGO rv-122): the piece keeps it («-1.250,50» → -125050). A line price below zero is
// refused HERE, with its own reason: the command schema says `unit_price` has `minimum: 0` (the
// server refuses it too, but with schema prose — «/items/0/unit_price: -500 is less than the minimum
// of 0» — that names no line and no way out),
// and money given back is a corrective invoice, never a negative line on an ordinary one — the same
// reason the handler gives for `invoice.negative_total`. Zero stays valid: a free line (a gift, a
// comped service) is an honest line, and the handler only judges PRICED lines.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { moduleRootFrom } from '@erplora/module-toolkit/money-display-guard';

type Item = { uid: number; description: string; quantity: string; unit_price: string; tax_rate: string };
type Form = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  requestUpdate: () => void;
  newSeriesCode: string;
  newItems: Item[];
  formError: string;
  create: (ev: Event) => Promise<void>;
};

const comandos: { name: string; payload: Record<string, unknown> }[] = [];
/** Every `t()` call, with its params, so a refusal can be checked for the line and the readings. */
const translated: { key: string; params?: Record<string, unknown> }[] = [];

function sdk(): Record<string, unknown> {
  return (globalThis as unknown as { erplora: Record<string, unknown> }).erplora;
}

beforeEach(() => {
  comandos.length = 0;
  translated.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async (name: string, payload: Record<string, unknown>) => {
      comandos.push({ name, payload });
      return {};
    },
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string, params?: Record<string, unknown>) => {
      translated.push({ key, params });
      return key;
    },
    currency: 'EUR',
    currencyDecimals: 2,
  };
});

async function montar(): Promise<Form> {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list') as Form;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const line = (uid: number, unit_price: string): Item => ({ uid, description: 'Servicio', quantity: '1', unit_price, tax_rate: '21' });

async function issue(...prices: string[]): Promise<Form> {
  const el = await montar();
  el.newSeriesCode = 'FACT';
  el.newItems = prices.map((p, i) => line(i + 1, p));
  await el.create(new Event('submit'));
  return el;
}

const sentPrices = () =>
  (comandos.find((c) => c.name === 'invoice.create')?.payload.items as { unit_price: number }[] | undefined)?.map((i) => i.unit_price);

/** The params of the last refusal the form translated under `key`. */
const paramsOf = (key: string) => [...translated].reverse().find((t) => t.key === key)?.params;

describe('a pasted line price is read, never dropped nor guessed (pm#521)', () => {
  // `\u202f` (NNBSP) and `\u00a0` (NBSP) are what `Intl` prints between groups in fr / es: real pastes.
  it.each(['1.250,50', '1,250.50', '1250,5', '1 250,50', '1\u202f250,50', '1\u00a0250,50 €', '1.250,50 €', 'EUR 1.250,50'])(
    '«%s» typed in the line price is sent as 125050',
    async (typed) => {
      const el = await issue(typed);
      expect(sentPrices(), `«${typed}» was refused: ${el.formError}`).toEqual([125050]);
      expect(el.formError).toBe('');
    },
  );

  it('each line is sent with its own price', async () => {
    const el = await issue('12,50', '1.250,50', '0');
    expect(sentPrices(), `refused: ${el.formError}`).toEqual([1250, 125050, 0]);
  });

  it('uses the hub currency scale, not two fixed decimals (KWD «1,5» → 1500)', async () => {
    Object.assign(sdk(), { currency: 'KWD', currencyDecimals: 3 });
    await issue('1,5');
    expect(sentPrices()).toEqual([1500]);
  });

  it('cleans the hub currency as the hub locale prints it (JPY in ja: «1,250￥» → 1250)', async () => {
    Object.assign(sdk(), { currency: 'JPY', currencyDecimals: 0, locale: 'ja' });
    await issue('1,250￥');
    expect(sentPrices()).toEqual([1250]);
  });

  // HALLAZGO rv-395 / rv-397: a minus BEHIND the digits and accounting brackets are not guessed; `$12`
  // in a euro hub is not this hub's money; letters glued to the figure are not an amount.
  it.each(['abc', '12abc', '12−', '(12)', '$12', '1.5k', '5½', '12%'])(
    '«%s» is refused with not_an_amount and no invoice is issued',
    async (typed) => {
      const el = await issue(typed);
      expect(comandos.find((c) => c.name === 'invoice.create'), 'garbage must never be invoiced').toBeFalsy();
      expect(el.formError).toBe('ui.errNotAnAmount');
      expect(paramsOf('ui.errNotAnAmount')).toMatchObject({ line: 1 });
    },
  );

  // Spaces around it (a real paste) must not reach the sentence: it quotes what the person wrote.
  it.each(['1.250', ' 1.250 '])('an ambiguous «%s» is refused, showing both readings in the hub format', async (typed) => {
    const el = await issue(typed);
    expect(comandos.find((c) => c.name === 'invoice.create'), '«1.250» must never be invoiced as 1,25 €').toBeFalsy();
    expect(el.formError).toBe('ui.errAmbiguousAmount');
    expect(paramsOf('ui.errAmbiguousAmount')).toEqual({ line: 1, typed: '1.250', grouped: '1250,00', decimal: '1,25' });
  });

  it('the readings of an ambiguous amount follow the hub locale', async () => {
    Object.assign(sdk(), { locale: 'en' });
    await issue('1.250');
    expect(paramsOf('ui.errAmbiguousAmount')).toMatchObject({ grouped: '1250.00', decimal: '1.25' });
  });

  it('a refusal on the second line names the second line, and nothing is issued', async () => {
    const el = await issue('12,50', 'abc');
    expect(comandos.find((c) => c.name === 'invoice.create')).toBeFalsy();
    expect(el.formError).toBe('ui.errNotAnAmount');
    expect(paramsOf('ui.errNotAnAmount')).toMatchObject({ line: 2 });
  });

  it.each(['-1.250,50', '−1.250,50', '-12'])(
    'a negative line price «%s» is refused with its own reason, never sent (nor flipped to positive)',
    async (typed) => {
      const el = await issue(typed);
      expect(comandos.find((c) => c.name === 'invoice.create'), 'a negative line must never be issued').toBeFalsy();
      expect(el.formError).toBe('ui.errLinePriceNegative');
      expect(paramsOf('ui.errLinePriceNegative')).toMatchObject({ line: 1 });
    },
  );

  it('a free line (price 0) is still issued: a gift or a comped service is an honest line', async () => {
    const el = await issue('0');
    expect(sentPrices(), `refused: ${el.formError}`).toEqual([0]);
  });

  it.each(['', '   '])('an empty price «%s» keeps «Issue invoice» disabled and sends nothing', async (typed) => {
    const el = await montar();
    el.newSeriesCode = 'FACT';
    el.newItems = [line(1, typed)];
    el.requestUpdate();
    await el.updateComplete;
    const submit = el.shadowRoot.querySelector('[data-testid="invoice-create-submit"]');
    expect(submit!.hasAttribute('disabled'), 'a line without a price cannot be issued').toBe(true);
    await el.create(new Event('submit'));
    expect(comandos.find((c) => c.name === 'invoice.create')).toBeFalsy();
  });

  it('a price that cannot be read leaves «Issue invoice» enabled, so pressing it says why', async () => {
    const el = await montar();
    el.newItems = [line(1, 'abc')];
    el.requestUpdate();
    await el.updateComplete;
    const submit = el.shadowRoot.querySelector('[data-testid="invoice-create-submit"]');
    expect(submit!.hasAttribute('disabled')).toBe(false);
  });
});

describe('the line price field takes what is pasted (pm#521)', () => {
  // A `type="number"` field throws a pasted «1.250,50» away in a real browser before any code runs.
  it('is a text field with the decimal keyboard, not a number field', async () => {
    const el = await montar();
    const input = el.shadowRoot.querySelector('[data-testid="invoice-line-1-price"]');
    expect(input, 'the line price input is not rendered').toBeTruthy();
    expect(input!.getAttribute('type')).toBe('text');
    expect(input!.getAttribute('inputmode')).toBe('decimal');
  });

  async function blur(unit_price: string): Promise<string> {
    const el = await montar();
    el.newItems = [line(1, unit_price)];
    el.requestUpdate();
    await el.updateComplete;
    el.shadowRoot.querySelector('[data-testid="invoice-line-1-price"]')!.dispatchEvent(new CustomEvent('ionBlur'));
    return el.newItems[0].unit_price;
  }

  it('leaving the field rewrites a readable amount in the hub format', async () => {
    expect(await blur('1.250,5')).toBe('1250,50');
    expect(await blur('EUR 12')).toBe('12,00');
  });

  it('follows the hub locale when rewriting', async () => {
    Object.assign(sdk(), { locale: 'en' });
    expect(await blur('12')).toBe('12.00');
  });

  it('rewrites to the hub currency scale (KWD: three decimals)', async () => {
    Object.assign(sdk(), { currency: 'KWD', currencyDecimals: 3 });
    expect(await blur('12')).toBe('12,000');
  });

  it('leaves what cannot be read exactly as typed', async () => {
    expect(await blur('abc')).toBe('abc');
    expect(await blur('1.250')).toBe('1.250');
  });
});

describe('the refusals of the line price speak both languages (pm#521)', () => {
  const root = moduleRootFrom(import.meta.url);
  const ui = (lang: string) => (JSON.parse(readFileSync(join(root, 'locales', `${lang}.json`), 'utf8')) as { ui: Record<string, string> }).ui;

  it.each([
    ['errNotAnAmount', ['{line}']],
    ['errAmbiguousAmount', ['{line}', '{typed}', '{grouped}', '{decimal}']],
    ['errLinePriceNegative', ['{line}']],
  ])('ui.%s exists in en and es with its placeholders', (key, placeholders) => {
    for (const lang of ['en', 'es']) {
      const text = ui(lang)[key];
      expect(text, `${lang}: ui.${key}`).toBeTruthy();
      for (const p of placeholders) expect(text, `${lang}: ui.${key} ${p}`).toContain(p);
    }
    expect(ui('es')[key]).not.toBe(ui('en')[key]);
  });
});
