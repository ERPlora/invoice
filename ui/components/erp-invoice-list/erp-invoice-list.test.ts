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
