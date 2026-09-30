// A list that could not load must not read «No invoices» + «0 records» (pm#533, hub#2328).
//
// The shell's `<ok-data-table>` (OutfitKit ≥ 0.1.113) paints a failed load itself: «could not
// load», the reason and a Retry button. The invoice list hands it its controller's `error` and
// reloads on its `retry` event — and drops its own red banner, which would say the same thing twice.
// But a module paints with the SHELL's OutfitKit (ADR-0451): on a hub whose table has no `error`
// property the banner is the only place the reason is shown, so it stays.
//
// The shell's table is stood in for by a bare element registered BEFORE the screen loads (as the
// shell does at boot; the screen's own `define()` then loses, like in the hub). Its `error`
// property is added or removed per test, which is exactly what `dataTableShowsLoadError()` reads.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

class ShellTable extends HTMLElement {}
const errors = new WeakMap<HTMLElement, unknown>();

function shellTableKnowsErrors(yes: boolean) {
  if (yes) {
    Object.defineProperty(ShellTable.prototype, 'error', {
      configurable: true,
      get(this: HTMLElement) { return errors.get(this) ?? ''; },
      set(this: HTMLElement, v: unknown) { errors.set(this, v); },
    });
  } else {
    delete (ShellTable.prototype as { error?: unknown }).error;
  }
}

const TAG = 'erp-invoice-list';
const LIST = 'invoice.list';
const TABLE = 'invoice-table';
const BANNER = 'invoice-list-error';
const REASON = 'The hub is not responding.';
const ROW = { id: 'i1', number: 'F-2026-0001', series_code: 'FACT', status: 'issued', customer_name: 'Ana', total_amount: 1210, issue_date: '2026-09-30' };
const SERIES = { id: 's1', code: 'FACT', name: 'Facturas', is_active: 1 };

let hubAnswers = false;
let pageCalls = 0;
let queryCalls: string[] = [];
let commandCalls: string[] = [];

beforeAll(async () => {
  customElements.define('ok-data-table', ShellTable);
  await import('./erp-invoice-list');
});

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  hubAnswers = false;
  pageCalls = 0;
  queryCalls = [];
  commandCalls = [];
  const answer = async (name: string) => {
    queryCalls.push(name);
    if (!hubAnswers) throw new Error(REASON);
    return name === 'invoice.series.list' ? [SERIES] : [];
  };
  (globalThis as Record<string, unknown>).erplora = {
    query: answer,
    queryAll: answer,
    queryOptional: async () => undefined,
    queryPage: async (name: string) => {
      if (name === LIST) pageCalls++;
      else queryCalls.push(name);
      if (!hubAnswers) throw new Error(REASON);
      return { rows: [ROW], total: 1 };
    },
    command: async (name: string) => {
      commandCalls.push(name);
      return {};
    },
    hasPermission: () => true,
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
  };
});

type Screen = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function mountFailed(): Promise<{ el: Screen; table: HTMLElement }> {
  const el = document.createElement(TAG) as Screen;
  document.body.appendChild(el);
  await vi.waitFor(() => {
    if (pageCalls === 0) throw new Error('the list has not asked for its page yet');
  });
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  const table = el.shadowRoot.querySelector<HTMLElement>(`ok-data-table[testid="${TABLE}"]`);
  expect(table, 'the list paints its table').toBeTruthy();
  return { el, table: table! };
}

async function retry(el: Screen, table: HTMLElement): Promise<void> {
  const before = pageCalls;
  hubAnswers = true;
  table.dispatchEvent(new CustomEvent('retry', { detail: {} }));
  await vi.waitFor(() => {
    if (pageCalls === before) throw new Error('Retry did not ask the hub again');
  });
  await vi.waitFor(async () => {
    await el.updateComplete;
    if ((table as unknown as { error: string }).error !== '') throw new Error('the error is still on the table');
  });
  // Retry only reads: it must never repeat a write the person did not ask for (rv-schedules-61).
  expect(commandCalls, 'Retry sent a command').toEqual([]);
}

describe('erp-invoice-list — a list that could not load (pm#533)', () => {
  it('hands the reason to the shell table and paints no second banner', async () => {
    shellTableKnowsErrors(true);
    const { el, table } = await mountFailed();
    expect((table as unknown as { error: string }).error).toBe(REASON);
    expect(el.shadowRoot.querySelector(`[data-testid="${BANNER}"]`), 'the reason would be said twice').toBeNull();
    // Any notice counts, not only the one with this testid (rv-schedules-61).
    expect(el.shadowRoot.textContent, 'another notice repeats the reason').not.toContain(REASON);
  });

  it('Retry on the table asks the hub again and paints the rows that now arrive', async () => {
    shellTableKnowsErrors(true);
    const { el, table } = await mountFailed();
    await retry(el, table);
    expect((table as unknown as { rows: unknown[] }).rows).toEqual([ROW]);
  });

  it('Retry also asks again for the series of the «new invoice» form', async () => {
    // Read once when the screen opens and silent on failure: after a failed start the series picker
    // of the form stayed empty even once the hub answered.
    shellTableKnowsErrors(true);
    const { el, table } = await mountFailed();
    const count = () => queryCalls.filter((n) => n === 'invoice.series.list').length;
    await vi.waitFor(() => {
      if (count() !== 1) throw new Error('the series are asked once with the list');
    });
    await retry(el, table);
    await vi.waitFor(() => {
      if (count() < 2) throw new Error('the series were not asked again');
    });
  });

  it('on a shell whose table cannot paint the error, keeps its own banner with the reason', async () => {
    shellTableKnowsErrors(false);
    const { el } = await mountFailed();
    const node = el.shadowRoot.querySelector(`[data-testid="${BANNER}"]`);
    expect(node, 'an older hub would show the failure nowhere').toBeTruthy();
    expect(node!.textContent).toContain(REASON);
    // On the PAGE, said once: a notice inside the closed «new» panel is invisible (rv-appointments-227).
    expect(node!.closest('[slot="create"]'), 'the notice sits in the «new» panel').toBeNull();
    expect(el.shadowRoot.textContent!.split(REASON).length - 1, 'the reason is said once').toBe(1);
  });
});
