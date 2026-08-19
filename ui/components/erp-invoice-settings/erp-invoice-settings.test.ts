// Contrato de la BARRA de las SERIES de facturación.
//
// Aunque la vista se llame «ajustes», lo que pinta es un CRUD de filas: una `ok-data-table` de
// series (código, tipo, año, contador…) con un alta y una edición. El alta estaba suelta ENCIMA de
// la tabla (botón «Nueva serie» en un <header> propio + tarjeta-formulario), que es justo el
// anti-patrón: en /employees y en `inventory` el alta vive DENTRO de la tabla, detrás del «+» de su
// barra (panel `slot="create"`), y «editar» reabre ESE MISMO panel pre-rellenado.
//
// OJO: la serie es la que numera las facturas (cadena fiscal). Aquí solo se mueve la UI: los
// comandos `invoice.series.create` / `invoice.series.update` y sus payloads no se tocan.
import { beforeEach, describe, expect, it } from 'vitest';

const SERIES = [
  { id: 'sr1', code: 'FACT', name: 'Facturas', invoice_type: 'F1', year: 2026, current_number: 12, prefix: '', is_active: 1, is_default: 1 },
  { id: 'sr2', code: 'TICKET', name: 'Tickets', invoice_type: 'F2', year: 2026, current_number: 340, prefix: 'T', is_active: 1, is_default: 0 },
];

const comandos: { name: string; payload: Record<string, unknown> }[] = [];
const consultas: string[] = [];

beforeEach(() => {
  comandos.length = 0;
  consultas.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) => {
      consultas.push(name);
      if (name === 'invoice.series.list') return SERIES;
      // La vista previa la RENDERIZA EL SERVIDOR (queries/series_peek_next.sql).
      if (name === 'invoice.series.peek_next') return [{ next_number: 'FACT-2026-000013', format_locked: 0 }];
      return [];
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      comandos.push({ name, payload });
      return {};
    },
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

async function montar() {
  await import('./erp-invoice-settings');
  const el = document.createElement('erp-invoice-settings');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('ok-data-table') as
    | (HTMLElement & { addable: boolean; fill: boolean; open: (p?: string) => void; close: () => void })
    | null;

describe('el alta de serie vive DENTRO de la tabla', () => {
  it('la tabla declara `addable` (hay permiso) → pinta el «+» en su barra', async () => {
    const el = await montar();
    expect(tabla(el)?.addable, 'sin `addable` no hay «+» en la barra de la tabla').toBe(true);
  });

  it('la tabla llena el alto (`fill`)', async () => {
    const el = await montar();
    expect(tabla(el)?.fill).toBe(true);
  });

  it('el formulario se proyecta en el panel `create` de la tabla', async () => {
    const el = await montar();
    const form = el.shadowRoot.querySelector('form[slot="create"]');
    expect(form, 'el formulario de serie no está en el slot `create`').toBeTruthy();
    expect(form?.closest('ok-data-table'), 'el formulario cuelga fuera de la tabla').toBeTruthy();
  });

  it('no queda NINGÚN control de alta suelto fuera de la tabla (ni el viejo botón «Nueva serie»)', async () => {
    const el = await montar();
    const sueltos = [...el.shadowRoot.querySelectorAll('form, ion-input, ion-select, ion-toggle, ion-button')].filter(
      (n) => !n.closest('ok-data-table'),
    );
    expect(sueltos.map((n) => n.tagName.toLowerCase()), 'hay controles de alta fuera de la tabla').toEqual([]);
  });
});

describe('alta y edición usan el MISMO panel', () => {
  it('crear manda invoice.series.create y cierra el panel', async () => {
    const el = await montar();
    const t = tabla(el)!;
    let cerrado = false;
    t.close = () => { cerrado = true; };

    const wc = el as unknown as {
      startCreate: () => void;
      form: Record<string, unknown> | null;
      submit: (ev: Event) => Promise<void>;
    };
    wc.startCreate();
    wc.form = { ...wc.form, code: 'ABONO', name: 'Abonos', invoice_type: 'R1', year: '2026', prefix: 'A' } as Record<string, unknown>;
    await wc.submit(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'invoice.series.create');
    expect(alta, 'no se mandó el alta de la serie').toBeTruthy();
    expect(alta!.payload.code).toBe('ABONO');
    expect(alta!.payload.invoice_type).toBe('R1');
    expect(alta!.payload.year).toBe(2026);
    expect(cerrado, 'el panel no se cerró tras crear').toBe(true);
  });

  it('la acción «editar» de una fila ABRE el panel de la tabla con la serie cargada', async () => {
    const el = await montar();
    const t = tabla(el)!;
    const abiertos: (string | undefined)[] = [];
    t.open = (p?: string) => { abiertos.push(p); };

    const wc = el as unknown as {
      onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => void;
      form: { series_id: string; code: string } | null;
    };
    wc.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'edit', row: SERIES[1] } }));

    expect(abiertos, 'editar no abre el panel `create` de la tabla').toEqual(['create']);
    expect(wc.form?.series_id).toBe('sr2');
    expect(wc.form?.code).toBe('TICKET');
  });
});

describe('los filtros de dominio cerrado son `select`', () => {
  it('tipo, activa y por defecto se filtran con select', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; filterable?: boolean; filterType?: string; options?: unknown[] }[] }).columns;
    expect(cols.find((c) => c.key === 'invoice_type')?.filterType).toBe('select');
    const activa = cols.find((c) => c.key === 'is_active');
    expect(activa?.filterable, 'activa/inactiva no se puede filtrar').toBe(true);
    expect(activa?.filterType).toBe('select');
    expect(activa?.options?.length).toBe(2);
    const porDefecto = cols.find((c) => c.key === 'is_default');
    expect(porDefecto?.filterType).toBe('select');
  });
});

// ── invoice#40: plantilla de formato por serie ─────────────────────────────────────────────
//
// El formato entra en la huella encadenada de VeriFactu a través del número, así que en cuanto la
// serie ha emitido algo NO se puede tocar: `queries/series_list.sql` trae `format_locked` y la
// pantalla tiene que OBEDECERLO — no basta con que el SQL ignore el cambio, el usuario no puede
// creerse que ha guardado algo que no se guardó.
//
// La VISTA PREVIA la da el servidor (`invoice.series.peek_next`), nunca un render en JS: el número
// se formatea en tres SQL y un cuarto renderizador en el navegador es exactamente la deuda que
// invoice#40 vino a no heredar. Una previa que no coincide con el número emitido es peor que
// ninguna previa.
describe('formato de numeración por serie (invoice#40)', () => {
  it('la columna de formato se pinta, y una serie sin plantilla enseña el formato histórico', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; format?: (r: Record<string, unknown>) => string }[] }).columns;
    const col = cols.find((c) => c.key === 'format');
    expect(col, 'la tabla no enseña el formato de la serie').toBeTruthy();
    expect(col!.format!({ format: null, prefix: 'FAC' }), 'sin plantilla debe leerse el formato por defecto')
      .toContain('NNNNNN');
    expect(col!.format!({ format: '{code}{year}/{seq:05d}', prefix: '' })).toBe('{code}{year}/{seq:05d}');
  });

  it('editar una serie CON emisiones deja el campo de formato bloqueado', async () => {
    const el = await montar();
    const wc = el as unknown as {
      onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => void;
      formatLocked: boolean;
    };
    // sr2 = TICKET, current_number 340 → ya numeró.
    wc.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'edit', row: SERIES[1] } }));
    expect(wc.formatLocked, 'una serie que ya numeró debe bloquear el formato').toBe(true);

    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const campo = el.shadowRoot.querySelector('ion-input[data-field="format"]') as HTMLElement & { disabled?: boolean };
    expect(campo, 'no hay campo de formato en el formulario').toBeTruthy();
    expect(campo.hasAttribute('disabled'), 'el campo de formato no está deshabilitado').toBe(true);
  });

  it('una serie NUEVA (contador a 0) sí deja elegir el formato', async () => {
    const el = await montar();
    const wc = el as unknown as {
      onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => void;
      formatLocked: boolean;
    };
    wc.onRowAction(new CustomEvent('rowAction', {
      detail: { actionId: 'edit', row: { ...SERIES[0], id: 'sr3', current_number: 0 } },
    }));
    expect(wc.formatLocked).toBe(false);
  });

  it('guardar una serie bloqueada NO manda `format` (no se promete lo que no se puede cumplir)', async () => {
    const el = await montar();
    const wc = el as unknown as {
      onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => void;
      submit: (ev: Event) => Promise<void>;
    };
    wc.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'edit', row: SERIES[1] } }));
    await wc.submit(new Event('submit'));
    const upd = comandos.find((c) => c.name === 'invoice.series.update')!;
    expect(upd, 'no se mandó la edición').toBeTruthy();
    expect('format' in upd.payload, 'mandó `format` en una serie que ya numeró').toBe(false);
  });

  it('editar una serie desbloqueada manda el `format` y pide la vista previa AL SERVIDOR', async () => {
    const el = await montar();
    const wc = el as unknown as {
      onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => void;
      form: Record<string, unknown>;
      submit: (ev: Event) => Promise<void>;
      preview: string;
    };
    wc.onRowAction(new CustomEvent('rowAction', {
      detail: { actionId: 'edit', row: { ...SERIES[0], id: 'sr3', current_number: 0 } },
    }));
    await new Promise((r) => setTimeout(r, 0));
    // La previa viene de `invoice.series.peek_next`, no de un render en JS.
    expect(consultas, 'la vista previa no se pidió al servidor').toContain('invoice.series.peek_next');

    wc.form = { ...wc.form, format: '{code}-{seq:04d}' };
    await wc.submit(new Event('submit'));
    const upd = comandos.find((c) => c.name === 'invoice.series.update')!;
    expect(upd.payload.format).toBe('{code}-{seq:04d}');
  });
});

// invoice#14 — touch targets of the module's OWN buttons. `ion-button size="small"` renders ~27 px
// high; a finger needs 44×44 (WCAG 2.5.5). The table's own actions/toolbar/pager already got their
// 44 px centrally in OutfitKit (`9927a4c`); these are the two buttons of the series form (submit +
// cancel). Same fix `cash_register` and `tables` applied: drop `size="small"` and pin
// `min-height: 44px` in the component styles.
describe("the module's own buttons are 44px touch targets (invoice#14)", () => {
  it('no ion-button of the series form uses size="small" (save/create + cancel)', async () => {
    const el = await montar();
    const small = [...el.shadowRoot.querySelectorAll('ion-button[size="small"]')].map((b) => b.textContent?.trim() ?? '?');
    expect(small, 'size="small" = ~27 px, below the 44 px touch target').toEqual([]);
    expect(el.shadowRoot.querySelectorAll('.row-actions ion-button').length, 'the form must still paint its two buttons').toBe(2);
  });

  it('the touch-target rule is in the component styles: ion-button min-height 44px', async () => {
    const el = await montar();
    const cssText = ((el.constructor as unknown as { styles: { cssText: string } }).styles).cssText;
    expect(cssText).toMatch(/ion-button\s*\{[^}]*min-height:\s*44px/);
  });
});
