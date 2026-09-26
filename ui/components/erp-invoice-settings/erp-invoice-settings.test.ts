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
    | (HTMLElement & { addable: boolean; fill: boolean; open: (p?: string) => void; close: () => void; rowClickable: boolean })
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

    // pm#450: editing opens the SAME panel in its «edit» mode (with OutfitKit < 0.1.94 that mode
    // still paints the `create` slot), so the header stops saying «New».
    expect(abiertos, 'editar no abre el panel de la tabla en modo «edit»').toEqual(['edit']);
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

// ── pm#155 (outfitkit#67, second half) ────────────────────────────────────────────────────────
//
// At 1440 px the «Actions» column fell off the screen with nothing hinting the table went on to
// the right, so the only door into a series was a button nobody could see. OutfitKit 0.1.44
// pins that column, but the other half of the fix is opt-in: `rowClickable` turns the whole row
// into a door — the first thing a user tries. The list has to ask for it, and wire `rowClick`
// to the same edit form the «edit» action opens.
describe('clicking the row opens the series (pm#155)', () => {
  it('the table declares `rowClickable` → the whole row is a door, not just the action button', async () => {
    const el = await montar();
    expect(
      tabla(el)?.rowClickable,
      'without `rowClickable` the row is dead: if the actions column is off-screen there is no way in',
    ).toBe(true);
  });

  it('`rowClick` puts the series in the edit form, same as the «edit» action', async () => {
    const el = await montar();
    tabla(el)!.dispatchEvent(new CustomEvent('rowClick', { detail: { row: SERIES[0] } }));
    await new Promise((r) => setTimeout(r, 0));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const wc = el as unknown as { form: { series_id: string } };
    expect(wc.form.series_id, 'the row was clicked and the edit form did not take the series').toBe('sr1');
  });
});

// pm#450 (outfitkit#150): editing opened the panel with open('create'), so its header said «New»
// while the body said «Edit series FACT». The table knows an «edit» mode and takes the whole title:
// the screen asks for it and drops the repeated line from the body. Only the panel title moves —
// the series commands and their payloads (fiscal numbering) are untouched.
describe('editing titles the panel header, not its body (pm#450)', () => {
  type Mounted = HTMLElement & { shadowRoot: ShadowRoot };
  type Table = HTMLElement & { open: (panel?: unknown, opts?: { title?: string }) => void; shadowRoot: ShadowRoot };
  type Wc = {
    onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => void;
    form: { series_id: string; code: string; name: string };
    startCreate: () => void;
    cancelForm: () => void;
  };
  const table = (el: Mounted) => el.shadowRoot.querySelector('ok-data-table') as Table;
  const wc = (el: Mounted) => el as unknown as Wc;
  const settle = async (el: Mounted) => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    }
  };
  const edit = (el: Mounted) =>
    wc(el).onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'edit', row: SERIES[0] } }));
  const EDIT_TITLE = 'ui.seriesEditTitle:FACT';

  beforeEach(() => {
    const sdk = (globalThis as Record<string, unknown>).erplora as Record<string, unknown>;
    sdk.t = (_catalog: unknown, key: string, params?: Record<string, unknown>) =>
      params?.code ? `${key}:${String(params.code)}` : key;
  });

  it("opens the panel with open('edit', { title }) — «Edit series <code>» in the header", async () => {
    const el = await montar();
    const calls: unknown[][] = [];
    table(el).open = (...args: unknown[]) => void calls.push(args);
    edit(el);
    await settle(el);
    expect(calls).toEqual([['edit', { title: EDIT_TITLE }]]);
  });

  // The header only carries the title with OutfitKit >= 0.1.94 (outfitkit#150); an older shell
  // (hub:stable ships 0.1.73) ignores it and keeps «New». The body line only goes away when the
  // table REALLY painted the title — its dialog is labelled with it — never on faith.
  const shellTable = (el: Mounted, honoursTitle: boolean) => {
    const t = table(el);
    const dialog = document.createElement('aside');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Form');
    const root = document.createElement('div');
    root.appendChild(dialog);
    Object.defineProperty(t, 'shadowRoot', { value: root, configurable: true });
    // Like the real Lit table, open() only schedules the render: the dialog is labelled on the
    // next microtask and `updateComplete` resolves once it is (M10 of the services review).
    let rendered: Promise<void> = Promise.resolve();
    Object.defineProperty(t, 'updateComplete', { get: () => rendered, configurable: true });
    t.open = (_panel?: unknown, opts?: { title?: string }) => {
      rendered = Promise.resolve().then(() => {
        if (honoursTitle && opts?.title) dialog.setAttribute('aria-label', opts.title);
      });
    };
  };
  const formTitle = (el: Mounted) =>
    el.shadowRoot.querySelector('form[slot="create"] [data-testid="invoice-series-form-title"]') as HTMLElement | null;

  it('the form body no longer repeats the editing title once the header carries it', async () => {
    const el = await montar();
    shellTable(el, true);
    edit(el);
    await settle(el);
    const form = el.shadowRoot.querySelector('form[slot="create"]') as HTMLElement;
    expect(formTitle(el)).toBeNull();
    expect(form.textContent).not.toContain('ui.seriesEditTitle');
  });

  it('with a shell whose table ignores the title (OutfitKit < 0.1.94), the body keeps the editing line', async () => {
    const el = await montar();
    shellTable(el, false);
    edit(el);
    await settle(el);
    const line = formTitle(el);
    expect(line, 'the header says «New»: without this line nothing says it is an edit').toBeTruthy();
    expect(line!.textContent).toContain(EDIT_TITLE);
  });

  it('the create form keeps its own title (creating is unchanged)', async () => {
    const el = await montar();
    expect(formTitle(el)?.textContent).toContain('ui.seriesCreateTitle');
  });

  it('cancelling the edit shows the create title again', async () => {
    const el = await montar();
    shellTable(el, false);
    edit(el);
    await settle(el);
    wc(el).cancelForm();
    await settle(el);
    expect(formTitle(el)?.textContent).toContain('ui.seriesCreateTitle');
  });

  it('«Add» after an edit opens a CLEAN create form, and keeps the panel open (the header says «New»: the form must agree)', async () => {
    const el = await montar();
    edit(el);
    await settle(el);
    expect(wc(el).form.series_id).toBe('sr1');
    const add = table(el).shadowRoot.querySelector('[data-testid="invoice-series-table-add"]') as HTMLElement;
    expect(add, 'the table paints its «Add» button').toBeTruthy();
    add.click();
    await settle(el);
    expect(wc(el).form.series_id, 'a submit here would UPDATE the edited series under a «New» header').toBe('');
    expect(wc(el).form.code).toBe('');
    // cancelForm() also closes the panel: «Add» must only reset the form, or it would shut the
    // panel it has just opened (TRAMPA 3 of the pm#450 recipe).
    expect((table(el) as unknown as { panel: unknown }).panel).toBe('create');
  });

  it('a click INSIDE the edit form (a field, the table) does not drop the edit — only «Add» does', async () => {
    const el = await montar();
    edit(el);
    await settle(el);
    (el.shadowRoot.querySelector('[data-testid="invoice-series-name"]') as HTMLElement).click();
    table(el).click();
    await settle(el);
    expect(wc(el).form.series_id, 'the table host hears every click of the projected form').toBe('sr1');
  });

  it('«Add» with no edit in progress keeps what was typed', async () => {
    const el = await montar();
    wc(el).form = { ...wc(el).form, code: 'ABONO' };
    (table(el).shadowRoot.querySelector('[data-testid="invoice-series-table-add"]') as HTMLElement).click();
    await settle(el);
    expect(wc(el).form.code).toBe('ABONO');
  });
});
