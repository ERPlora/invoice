// invoice#111 — every field of the series form shows its BOX.
//
// The Hub shell pins `mode: 'ios'` (ADR-0143), and there Ionic never paints `fill` on
// ion-input/ion-select: a `fill="outline"` alone is loose text with no border, only rescued by the
// shell's registration shim (hub#1060). The combination that paints on its own is
// `fill="outline" mode="md"`, the convention of the shell (hub#760) and of the modules swept by
// ERPlora/pm#152 — and the one the module-toolkit ratchet asks for.
import { beforeEach, describe, expect, it } from 'vitest';

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

const SERIES = [
  { id: 'sr1', code: 'FACT', name: 'Facturas', invoice_type: 'F1', year: 2026, current_number: 0, prefix: 'F', format: null, format_locked: 0, is_active: 1, is_default: 1 },
];

beforeEach(() => {
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) => (name === 'invoice.series.list' ? SERIES : []),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'en',
    t: (_catalog: unknown, key: string) => key,
  };
});

async function mount(): Promise<Wc> {
  await import('./erp-invoice-settings');
  const el = document.createElement('erp-invoice-settings') as unknown as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const form = (el: Wc) => el.shadowRoot.querySelector('form[slot="create"]')!;
const fieldsOf = (el: Wc) => [...form(el).querySelectorAll('ion-input, ion-select, ion-textarea')];

function expectBox(f: Element): void {
  const id = f.getAttribute('data-testid') ?? f.tagName;
  expect(f.getAttribute('fill'), `${id}: no fill → no box in ios mode`).toBe('outline');
  expect(f.getAttribute('mode'), `${id}: fill without mode="md" never paints in ios mode`).toBe('md');
}

describe('series form: every field has its box in ios mode (invoice#111)', () => {
  it('the six fields of a new series', async () => {
    const el = await mount();
    const fields = fieldsOf(el);
    expect(fields.map((f) => f.getAttribute('data-testid'))).toEqual([
      'invoice-series-code',
      'invoice-series-name',
      'invoice-series-type',
      'invoice-series-year',
      'invoice-series-prefix',
      'invoice-series-format',
    ]);
    for (const f of fields) expectBox(f);
  });

  it('and the same fields when an existing series is edited', async () => {
    const el = await mount();
    const t = el.shadowRoot.querySelector('ok-data-table')!;
    t.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'edit', row: SERIES[0] } }));
    await el.updateComplete;
    expect(form(el).querySelector('[data-testid="invoice-series-code"]')?.hasAttribute('disabled')).toBe(true);
    const fields = fieldsOf(el);
    expect(fields).toHaveLength(6);
    for (const f of fields) expectBox(f);
  });
});
