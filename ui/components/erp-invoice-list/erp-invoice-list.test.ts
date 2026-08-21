// Contrato de la BARRA de la lista de facturas.
//
// El alta MANUAL de factura (`invoice.create`, source_type='manual' — la factura que NO nace de una
// venta) se pintaba con un botón «Nueva factura» en un <header> propio y una tarjeta-formulario
// suelta ENCIMA de la `ok-data-table`. El resto del Hub —/employees en el core, el CRUD de productos
// de `inventory`, `services`— no lo hace así: el alta vive DENTRO de `ok-data-table`, detrás del «+»
// de su barra, que despliega el panel `slot="create"`.
//
// Aquí se fija esa paridad. OJO: esto es COLOCACIÓN de UI. El comando `invoice.create`, la cadena
// fiscal (numeración de serie, firma VeriFactu) y el contrato de datos NO se tocan: el payload que
// se manda es el mismo de antes, y estos tests lo vigilan.
import { beforeEach, describe, expect, it } from 'vitest';

const SERIES = [
  { id: 'sr1', code: 'FACT', name: 'Facturas', invoice_type: 'F1', is_active: 1 },
  { id: 'sr2', code: 'TICKET', name: 'Tickets', invoice_type: 'F2', is_active: 1 },
];

const FACTURA = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-0001', issue_date: '2026-07-13',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 10000, tax_amount: 2100,
  total_amount: 12100, status: 'issued', source_type: 'manual',
};

const comandos: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) => (name === 'invoice.series.list' ? SERIES : []),
    queryPage: async () => ({ rows: [FACTURA], total: 1 }),
    command: async (name: string, payload: Record<string, unknown>) => {
      comandos.push({ name, payload });
      return {};
    },
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

async function montar() {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('ok-data-table') as (HTMLElement & { addable: boolean; fill: boolean; close: () => void }) | null;

describe('el alta manual vive DENTRO de la tabla (paridad con /employees e inventory)', () => {
  it('la tabla declara `addable` → pinta el «+» en su barra', async () => {
    const el = await montar();
    expect(tabla(el)?.addable, 'sin `addable` no hay «+» en la barra de la tabla').toBe(true);
  });

  it('la tabla llena el alto (`fill`)', async () => {
    const el = await montar();
    expect(tabla(el)?.fill).toBe(true);
  });

  it('el formulario de alta se proyecta en el panel `create` de la tabla', async () => {
    const el = await montar();
    const form = el.shadowRoot.querySelector('form[slot="create"]');
    expect(form, 'el formulario de alta no está en el slot `create`').toBeTruthy();
    expect(form?.closest('ok-data-table'), 'el formulario de alta cuelga fuera de la tabla').toBeTruthy();
  });

  it('no queda NINGÚN control de alta suelto fuera de la tabla', async () => {
    const el = await montar();
    const sueltos = [...el.shadowRoot.querySelectorAll('form, ion-input, ion-select, ion-textarea, ion-button')].filter(
      (n) => !n.closest('ok-data-table'),
    );
    expect(sueltos.map((n) => n.tagName.toLowerCase()), 'hay controles de alta fuera de la tabla').toEqual([]);
  });

  it('las series se cargan sin abrir el panel (el «+» de la tabla no avisa de que se abrió)', async () => {
    const el = await montar();
    const wc = el as unknown as { seriesOptions: { code: string }[] };
    expect(wc.seriesOptions.map((s) => s.code), 'el select de serie del panel saldría vacío').toEqual(['FACT', 'TICKET']);
  });
});

// CAMBIO DE CONTRATO (ADR-0123 + ADR-0147, 2026-07-19): el payload anterior mandaba lo tecleado
// TAL CUAL (`unit_price: 50` por «50 €», `quantity: 2` lógica). El schema y la BD siempre fueron
// céntimos enteros, y la cantidad ahora es punto fijo 10⁶ — la conversión ocurre en la frontera
// de la UI (eurosToCents / toMicro), como en inventory y sales.
describe('la cadena fiscal habla el contrato: céntimos y punto fijo 10⁶', () => {
  it('emitir manda invoice.create con precios en CÉNTIMOS y cantidades en µ, y cierra el panel', async () => {
    const el = await montar();
    const t = tabla(el)!;
    let cerrado = false;
    t.close = () => { cerrado = true; };

    const wc = el as unknown as {
      newSeriesCode: string; newCustomerName: string; newCustomerTaxId: string;
      newItems: { description: string; quantity: string; unit_price: string; tax_rate: string }[];
      create: (ev: Event) => Promise<void>;
    };
    wc.newSeriesCode = 'FACT';
    wc.newCustomerName = 'ACME';
    wc.newCustomerTaxId = 'B12345678';
    wc.newItems = [{ description: 'Servicio', quantity: '2', unit_price: '50', tax_rate: '21' }];
    await wc.create(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'invoice.create');
    expect(alta, 'no se mandó el alta de la factura').toBeTruthy();
    expect(alta!.payload.series_code).toBe('FACT');
    expect(alta!.payload.customer_name).toBe('ACME');
    expect(alta!.payload.source_type, 'la factura manual debe seguir marcándose como manual').toBe('manual');
    expect(alta!.payload.items).toEqual([
      { description: 'Servicio', quantity: 2_000_000, unit_price: 5000, tax_rate: 21, product_id: null },
    ]);
    expect(cerrado, 'el panel de alta no se cerró tras emitir').toBe(true);
  });

  it('media unidad se puede facturar: 0,5 → 500000 µ (coma o punto)', async () => {
    const el = await montar();
    const wc = el as unknown as {
      newSeriesCode: string;
      newItems: { description: string; quantity: string; unit_price: string; tax_rate: string }[];
      create: (ev: Event) => Promise<void>;
    };
    wc.newSeriesCode = 'FACT';
    wc.newItems = [{ description: 'Vino a granel', quantity: '0,5', unit_price: '12', tax_rate: '21' }];
    await wc.create(new Event('submit'));
    const alta = comandos.find((c) => c.name === 'invoice.create');
    expect((alta!.payload.items as Array<{ quantity: number; unit_price: number }>)[0]).toMatchObject({
      quantity: 500_000, unit_price: 1200,
    });
  });
});

describe('el dinero se pinta con formatMoney (céntimos → euros), no crudo (bug ×100)', () => {
  it('la columna total divide: 12100 céntimos son 121.00 €, no 12100.00 €', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; format?: (r: unknown) => string }[] }).columns;
    const total = cols.find((c) => c.key === 'total_amount');
    expect(total?.format, 'la columna total no tiene formato de dinero').toBeTruthy();
    expect(total!.format!(FACTURA)).toBe('121.00 €');
  });
});

describe('los filtros de dominio cerrado son `select` (y el servidor los soporta)', () => {
  it('tipo y estado se filtran con select; la fecha con daterange', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; filterType?: string; options?: unknown[] }[] }).columns;
    expect(cols.find((c) => c.key === 'invoice_type')?.filterType).toBe('select');
    expect(cols.find((c) => c.key === 'status')?.filterType).toBe('select');
    expect(cols.find((c) => c.key === 'status')?.options?.length).toBeGreaterThan(0);
    expect(cols.find((c) => c.key === 'issue_date')?.filterType).toBe('daterange');
  });
});

// invoice#22 (ADR-0196, single print gate): printing must go through the `sdk.print` cascade —
// the shell routes to a Bridge printer when one exists and falls back to the browser dialog
// otherwise. A direct `window.print()` bypasses the shell and ignores any physical printer.
// `window.print()` stays ONLY as the last resort when the SDK is not initialized (dev preview).
describe('printing goes through the sdk.print cascade, never window.print() directly', () => {
  const DETAIL = {
    ...FACTURA, issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
    description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
    rectifies_invoice_id: null, paid_at: null, notes: '',
  };

  async function mountDetail() {
    const el = await montar();
    const wc = el as unknown as { detail: unknown; detailLines: unknown[]; updateComplete: Promise<unknown> };
    wc.detail = DETAIL;
    wc.detailLines = [];
    await wc.updateComplete;
    return el;
  }

  it('the detail print button calls sdk.print with the a4 invoice document and a traceable jobId', async () => {
    const printed: Record<string, unknown>[] = [];
    (globalThis.erplora as unknown as Record<string, unknown>).print =
      async (req: Record<string, unknown>) => { printed.push(req); return { via: 'bridge' }; };
    let browserPrints = 0;
    (window as { print: () => void }).print = () => { browserPrints += 1; };

    const el = await mountDetail();
    const btn = el.shadowRoot.querySelector('header ion-button.print') as HTMLElement | null;
    expect(btn, 'the detail header has no print button routed through the gate').toBeTruthy();
    btn!.click();

    expect(printed.length, 'the print button did not go through sdk.print').toBe(1);
    expect(printed[0]).toMatchObject({ role: 'receipt', documentType: 'invoice', format: 'a4', jobId: 'invoice-i1' });
    expect(printed[0].data, 'sdk.print got no document data for the Bridge/PDF path').toBeTruthy();
    expect(browserPrints, 'window.print() must not fire when sdk.print exists').toBe(0);
  });

  it('falls back to window.print() only when the shell SDK does not expose print (dev preview)', async () => {
    // The default mock in beforeEach has no `print` — that IS the dev-preview scenario.
    let browserPrints = 0;
    (window as { print: () => void }).print = () => { browserPrints += 1; };

    const el = await mountDetail();
    (el.shadowRoot.querySelector('header ion-button.print') as HTMLElement).click();

    expect(browserPrints, 'without sdk.print the browser dialog is the last resort').toBe(1);
  });
});

// invoice#14 — touch targets of the module's OWN buttons. `ion-button size="small"` renders ~27 px
// high; a finger needs 44×44 (WCAG 2.5.5, Ionic default size). The row actions, the toolbar and the
// pager of `ok-data-table` already got their 44 px centrally in OutfitKit (`9927a4c`), so what is
// left here are the buttons this component paints itself: the rectify card, the detail header, the
// detail actions and the create panel. Same fix `cash_register` and `tables` applied: drop
// `size="small"` and pin `min-height: 44px` in the component styles.
//
// happy-dom does no layout, so the height cannot be measured here: what is fixed is the CONTRACT
// that produces it (no `size="small"` left + the rule present in the styles), plus the accessible
// name of the icon-only control.
describe("the module's own buttons are 44px touch targets (invoice#14)", () => {
  const DETAIL_ISSUED = {
    ...FACTURA, issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
    description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
    rectifies_invoice_id: null, paid_at: null, notes: '',
  };

  const smallOnes = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
    [...el.shadowRoot.querySelectorAll('ion-button[size="small"]')].map((b) => b.textContent?.trim() ?? '?');

  it('no ion-button of the create panel uses size="small" (add line, issue, cancel, remove line)', async () => {
    const el = await montar();
    const wc = el as unknown as { newItems: unknown[]; updateComplete: Promise<unknown> };
    // two lines so the per-line ✕ is rendered too
    wc.newItems = [...(wc.newItems as unknown[]), { description: '', quantity: '1', unit_price: '0', tax_rate: '21' }];
    await wc.updateComplete;
    expect(smallOnes(el), 'size="small" = ~27 px, below the 44 px touch target').toEqual([]);
  });

  it('no ion-button of the rectify card uses size="small"', async () => {
    const el = await montar();
    const wc = el as unknown as { rectifyTarget: unknown; updateComplete: Promise<unknown> };
    wc.rectifyTarget = FACTURA;
    await wc.updateComplete;
    expect(smallOnes(el)).toEqual([]);
  });

  it('no ion-button of the detail uses size="small" (print, back, mark paid, rectify)', async () => {
    const el = await montar();
    const wc = el as unknown as { detail: unknown; detailLines: unknown[]; updateComplete: Promise<unknown> };
    wc.detail = DETAIL_ISSUED;
    wc.detailLines = [];
    await wc.updateComplete;
    expect(el.shadowRoot.querySelectorAll('header ion-button.print').length, 'the detail header must still paint its buttons').toBe(1);
    expect(smallOnes(el)).toEqual([]);
  });

  it('the touch-target rule is in the component styles: ion-button min-height 44px', async () => {
    const el = await montar();
    const cssText = ((el.constructor as unknown as { styles: { cssText: string } }).styles).cssText;
    expect(cssText).toMatch(/ion-button\s*\{[^}]*min-height:\s*44px/);
  });

  it('the icon-only button that removes a draft line has an accessible name', async () => {
    const el = await montar();
    const wc = el as unknown as { newItems: unknown[]; updateComplete: Promise<unknown> };
    wc.newItems = [...(wc.newItems as unknown[]), { description: '', quantity: '1', unit_price: '0', tax_rate: '21' }];
    await wc.updateComplete;
    const removes = [...el.shadowRoot.querySelectorAll('.item-row ion-button')];
    expect(removes.length, 'with two draft lines each one carries its remove control').toBe(2);
    for (const b of removes) {
      expect(b.getAttribute('aria-label'), 'an icon-only button with no aria-label is announced as «✕»').toBe('ui.removeLine');
    }
  });
});

// invoice#49 — una NEGATIVA de negocio (hub#139) llega con un `code` estable y namespaced, y la
// pantalla tiene que pintar su TRADUCCIÓN, no la frase inglesa que el handler manda de reserva.
// Sin esto, la única refusal que este formulario puede provocar se lee en inglés y en jerga
// («prices to 0, scale 1000000»), que es exactamente lo que el catálogo `errors` existe para evitar.
describe('las negativas del handler se leen traducidas', () => {
  async function emitirConError(err: unknown) {
    (globalThis as Record<string, unknown>).erplora = {
      ...((globalThis as Record<string, unknown>).erplora as Record<string, unknown>),
      command: async () => { throw err; },
    };
    const el = await montar();
    const t = tabla(el)!;
    const wc = el as unknown as {
      newItems: { description: string; quantity: string; unit_price: string; tax_rate: string }[];
      formError: string;
      updateComplete: Promise<unknown>;
    };
    wc.newItems = [{ description: 'Servicio', quantity: '2', unit_price: '50', tax_rate: '21' }];
    await wc.updateComplete;
    (t.querySelector('form[slot="create"]') as HTMLFormElement).requestSubmit();
    await new Promise((r) => setTimeout(r, 0));
    await wc.updateComplete;
    return wc.formError;
  }

  it('un `invoice.line_amount_underflow` se pinta en el idioma del hub', async () => {
    const err = Object.assign(new Error('line 1 `Servicio`: quantity 2 at 5000 minor units each prices to 0'), {
      code: 'invoice.line_amount_underflow',
    });
    const texto = await emitirConError(err);
    expect(texto, 'se pintó la frase inglesa del handler en vez de la traducción').toContain('millonésimas');
  });

  it('el código de OTRO módulo se respeta tal cual (su frase gana a cualquier invento nuestro)', async () => {
    const err = Object.assign(new Error('that sale does not exist'), { code: 'sales.sale_not_found' });
    expect(await emitirConError(err)).toBe('that sale does not exist');
  });
});

