import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn, DataTableAction } from '@erplora/outfitkit';
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  hasPermission?(perm: string): boolean;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

/** Fila devuelta por `invoice.series.list` (queries/series_list.sql). */
interface SeriesRow {
  id: string;
  code: string;
  name: string;
  invoice_type: string;
  year: number;
  current_number: number;
  prefix: string;
  /** Plantilla del número (invoice#40). NULL/vacía = el formato histórico `PREFIX-YYYY-NNNNNN`. */
  format: string | null;
  /** 1 = la serie ya emitió → su forma está congelada (entra en la huella de VeriFactu). */
  format_locked: number;
  is_active: number;
  is_default: number;
}

/** Estado del formulario (strings: vienen de ion-input/ion-select). */
interface SeriesForm {
  series_id: string; // vacío => alta
  code: string;
  name: string;
  invoice_type: string;
  year: string;
  prefix: string;
  format: string;
  is_active: boolean;
  is_default: boolean;
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

function erploraT(key: string, params?: Record<string, unknown>): string {
  return erplora().t(CATALOG, key, params);
}

// Etiquetas de tipo i18n: las CLAVES (F1, F2…) son enums del backend (no se traducen);
// solo el texto visible se resuelve por el catálogo activo (ADR-0055).
function typeLabel(code: string): string {
  const map: Record<string, string> = {
    F1: erploraT('ui.typeInvoice'), F2: erploraT('ui.typeTicket'), F3: erploraT('ui.typeInvoice'),
    R1: erploraT('ui.typeRectifying'), R2: erploraT('ui.typeRectifying'), R3: erploraT('ui.typeRectifying'),
    R4: erploraT('ui.typeRectifying'), R5: erploraT('ui.typeRectifying'),
  };
  return map[code] ?? code;
}

// Tipos válidos según schemas/series_create.json (enum).
const TYPE_CODES = ['F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'];

const blankForm = (): SeriesForm => ({
  series_id: '', code: '', name: '', invoice_type: 'F1',
  year: String(new Date().getFullYear()), prefix: '', format: '', is_active: true, is_default: false,
});

/** Lo que se enseña cuando la serie no tiene plantilla: el formato histórico, escrito tal cual. */
const DEFAULT_FORMAT_LABEL = 'PREFIX-YYYY-NNNNNN';

export class ErpInvoiceSettings extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    /* La vista llena el alto: el data-table ocupa todo (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    /* invoice#14: every own control is a touch target (44px), like the ok-data-table actions.
       size="small" rendered ~27 px; Ionic md buttons default to 36 px. A finger needs 44×44
       (WCAG 2.5.5). Same rule cash_register and tables applied. */
    ion-button { min-height:44px; --min-height:44px; }
    h3 { margin:0 0 .5rem; font-size:1rem; }
    .err { color:#d9480f; font-weight:600; }
    .intro { color: var(--ion-color-medium,#8a8577); font-size:.85rem; margin:0 0 .75rem; max-width:60ch; line-height:1.45; }
    /* El alta/edición vive en el panel lateral de la tabla (estrecho): los campos van APILADOS. */
    .form { display:flex; flex-direction:column; gap:.7rem; margin:.5rem 0; }
    .toggles { display:flex; flex-direction:column; margin:.5rem 0; }
    .toggles ion-item { --background:transparent; --padding-start:0; --inner-padding-end:0; }
    .hint { display:block; font-size:.72rem; color:var(--ion-color-medium,#8a8577); margin:-.25rem 0 .25rem; }
    .row-actions { display:flex; gap:.5rem; margin-top:.6rem; }
  `;

  // ── listado de series ──
  @state() rows: SeriesRow[] = [];

  @state() loading = false;

  @state() listError = '';

  // ── formulario de alta/edición ──
  // NUNCA es null: el panel `create` de la tabla lo proyecta SIEMPRE (el «+» lo abre la propia
  // tabla, sin avisar al módulo; si el form solo existiera "al abrir", el «+» saldría vacío).
  // `series_id` vacío = alta; con id = edición de esa serie.
  @state() form: SeriesForm = blankForm();

  @state() saving = false;

  @state() formError = '';
  /** invoice#40: la serie ya emitió → su plantilla de número está congelada. */
  @state() formatLocked = false;
  /** Siguiente número, RENDERIZADO POR EL SERVIDOR (`invoice.series.peek_next`). */
  @state() preview = '';

  private canManage = false;

  private unsub?: () => void;

  // Getter (no campo): se re-evalúa en cada render, así los textos cambian con el idioma activo
  // (ADR-0055). `connectedCallback` re-renderiza al recibir `erplora:locale-changed`.
  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erploraT(k);
    return [
      { key: 'code', header: t('ui.seriesColCode'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'name', header: t('ui.seriesColName'), sortable: true, filterable: true, filterType: 'text', format: (r) => (r.name as string) || '—' },
      {
        key: 'invoice_type',
        header: t('ui.seriesColType'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: TYPE_CODES.map((value) => ({ value, label: typeLabel(value) })),
        format: (r) => `${typeLabel(r.invoice_type as string)} (${r.invoice_type})`,
      },
      { key: 'year', header: t('ui.seriesColYear'), align: 'right', sortable: true },
      { key: 'prefix', header: t('ui.seriesColPrefix'), format: (r) => (r.prefix as string) || '—' },
      // invoice#40: la plantilla del número. Sin plantilla se escribe el formato histórico —
      // «—» haría creer que la serie no numera con ninguna forma concreta, y sí lo hace.
      {
        key: 'format',
        header: t('ui.seriesColFormat'),
        format: (r) => (r.format as string) || DEFAULT_FORMAT_LABEL,
      },
      { key: 'current_number', header: t('ui.seriesColNumber'), align: 'right', sortable: true },
      // Sí/no = dominio cerrado: se filtra eligiendo, no tecleando 1 ó 0.
      {
        key: 'is_active',
        header: t('ui.seriesColActive'),
        filterable: true,
        filterType: 'select',
        options: [
          { value: '1', label: t('ui.yes') },
          { value: '0', label: t('ui.no') },
        ],
        render: (r) => html`<ion-badge color=${r.is_active ? 'success' : 'medium'}>${r.is_active ? t('ui.yes') : t('ui.no')}</ion-badge>`,
      },
      {
        key: 'is_default',
        header: t('ui.seriesColDefault'),
        filterable: true,
        filterType: 'select',
        options: [
          { value: '1', label: t('ui.yes') },
          { value: '0', label: t('ui.no') },
        ],
        render: (r) => (r.is_default ? html`<ion-badge color="primary">${t('ui.yes')}</ion-badge>` : html`<span>—</span>`),
      },
    ];
  }

  private get rowActions(): DataTableAction[] {
    if (!this.canManage) return [];
    return [{ id: 'edit', label: erploraT('ui.seriesActionEdit'), icon: 'create-outline' }];
  }

  // Referencia al ok-data-table para abrir/cerrar su panel lateral (alta y edición comparten panel).
  private dataTable(): { open(p?: 'filters' | 'create'): void; close(): void } | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | { open(p?: 'filters' | 'create'): void; close(): void }
      | null;
  }

  // Re-render al cambiar el idioma del shell (ADR-0055): los getters `columns`/`rowActions` y el
  // texto del template se re-evalúan con el nuevo `erplora.locale`.
  private readonly onLocaleChange = (): void => this.requestUpdate();

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    // hasPermission es SOLO para mostrar/ocultar: la seguridad real la revalida el runtime.
    try {
      this.canManage = erplora().hasPermission?.('invoice.manage_series') ?? true;
    } catch { /* preview */ }
    await this.load();
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    super.disconnectedCallback();
    this.unsub?.();
  }

  private async load() {
    this.loading = true;
    this.listError = '';
    try {
      const rows = await erplora().query<SeriesRow[]>('invoice.series.list', {});
      this.rows = Array.isArray(rows) ? rows : [];
    } catch (e) {
      this.listError = e instanceof Error ? e.message : erploraT('ui.errSeriesLoad');
    } finally {
      this.loading = false;
    }
  }

  // ── alta / edición ─────────────────────────────────────────────────────────

  private startCreate() {
    this.formError = '';
    this.form = blankForm();
    this.formatLocked = false;
    this.preview = '';
  }

  // «Editar» reabre EL MISMO panel `create`, ya relleno: no hay una segunda pantalla de edición.
  private startEdit(row: SeriesRow) {
    this.formError = '';
    this.form = {
      series_id: row.id,
      code: row.code,
      name: row.name || '',
      invoice_type: row.invoice_type,
      year: String(row.year ?? ''),
      prefix: row.prefix || '',
      format: row.format || '',
      is_active: !!row.is_active,
      is_default: !!row.is_default,
    };
    // 🔴 En cuanto la serie ha emitido algo su forma queda congelada: el número entra en la huella
    // encadenada de VeriFactu. El SQL ya ignora el cambio, pero la pantalla tiene que decirlo — si
    // no, el usuario cree haber guardado algo que no se guardó.
    this.formatLocked = !!row.format_locked || (row.current_number ?? 0) > 0;
    this.preview = '';
    void this.loadPreview(row.id);
    this.dataTable()?.open('create');
  }

  /** La vista previa la RENDERIZA EL SERVIDOR (`queries/series_peek_next.sql`).
   *  Deliberadamente NO se formatea el número en JS: ya se formatea en tres SQL, y un cuarto
   *  renderizador —encima en otro lenguaje— es justo la deuda que invoice#40 vino a no heredar.
   *  Una previa que no coincide con el número emitido es peor que no tener previa. */
  private async loadPreview(seriesId: string) {
    if (!seriesId) { this.preview = ''; return; }
    try {
      const res = await erplora().query<unknown>('invoice.series.peek_next', { series_id: seriesId });
      const row = (Array.isArray(res) ? res[0] : (res as { rows?: unknown[] })?.rows?.[0]) as
        | { next_number?: string; format_locked?: number }
        | undefined;
      this.preview = row?.next_number ?? '';
      if (row?.format_locked !== undefined) this.formatLocked = !!row.format_locked;
    } catch {
      this.preview = ''; // una previa que falla no rompe la pantalla: es información, no un gate
    }
  }

  private cancelForm() {
    this.startCreate(); // deja el panel listo para un alta: si no, el «+» reabriría la última edición
    this.dataTable()?.close();
  }

  private setField<K extends keyof SeriesForm>(key: K, value: SeriesForm[K]) {
    this.form = { ...this.form, [key]: value };
  }

  private get isEdit(): boolean { return !!this.form.series_id; }

  private async submit(ev: Event) {
    ev.preventDefault();
    const f = this.form;
    if (!this.isEdit && !f.code.trim()) { this.formError = erploraT('ui.errSeriesCodeRequired'); return; }
    this.saving = true;
    this.formError = '';
    try {
      if (this.isEdit) {
        // Code, year y contador son inmutables (schemas/series_update.json): solo mutables.
        // `format` viaja SOLO si la serie aún puede cambiarlo: mandarlo en una serie que ya numeró
        // sería pedir algo que `commands/series_update.sql` va a ignorar — y prometer al usuario un
        // cambio que no ocurre. El esquema exige un marcador de secuencia, así que una plantilla
        // vacía se omite (= conservar la que hay).
        const cambios: Record<string, unknown> = {
          series_id: f.series_id,
          name: f.name.trim(),
          prefix: f.prefix.trim(),
          is_active: f.is_active,
          is_default: f.is_default,
        };
        if (!this.formatLocked && f.format.trim()) cambios.format = f.format.trim();
        await erplora().command('invoice.series.update', cambios);
      } else {
        // schemas/series_create.json: required code, invoice_type, year.
        const alta: Record<string, unknown> = {
          code: f.code.trim(),
          name: f.name.trim(),
          invoice_type: f.invoice_type,
          year: Number(f.year) || new Date().getFullYear(),
          prefix: f.prefix.trim(),
          is_active: f.is_active,
          is_default: f.is_default,
        };
        if (f.format.trim()) alta.format = f.format.trim();
        await erplora().command('invoice.series.create', alta);
      }
      this.startCreate(); // vacía el formulario (el panel es el mismo para alta y edición)
      this.dataTable()?.close(); // el panel se cierra solo tras guardar
      await this.load();
    } catch (e) {
      this.formError = e instanceof Error
        ? e.message
        : erploraT(this.isEdit ? 'ui.errSeriesUpdate' : 'ui.errSeriesCreate');
    } finally {
      this.saving = false;
    }
  }

  private onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    if (ev.detail.actionId === 'edit') this.startEdit(ev.detail.row as unknown as SeriesRow);
  }

  // ── render ───────────────────────────────────────────────────────────────

  // Alta Y edición: se proyecta SIEMPRE en el panel `create` de la tabla (aunque esté cerrado); si
  // solo se pintara al abrir, el «+» de la barra —que lo despliega la propia tabla— saldría vacío.
  private renderForm() {
    const f = this.form;
    const title = this.isEdit ? erploraT('ui.seriesEditTitle', { code: f.code }) : erploraT('ui.seriesCreateTitle');
    return html`<form slot="create" @submit=${(e: Event) => this.submit(e)}>
      <h3>${title}</h3>
        <div class="form">
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT('ui.fieldCode')}
            ?disabled=${this.isEdit}
            .value=${f.code}
            @ionInput=${(e: any) => this.setField('code', e.target.value)}></ion-input>
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT('ui.fieldName')}
            .value=${f.name}
            @ionInput=${(e: any) => this.setField('name', e.target.value)}></ion-input>
          <ion-select
            fill="outline" label-placement="floating" label=${erploraT('ui.fieldInvoiceType')}
            interface="popover" ?disabled=${this.isEdit}
            .value=${f.invoice_type}
            @ionChange=${(e: any) => this.setField('invoice_type', e.target.value)}>
            ${TYPE_CODES.map((c) => html`<ion-select-option .value=${c}>${typeLabel(c)} (${c})</ion-select-option>`)}
          </ion-select>
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT('ui.fieldYear')}
            type="number" ?disabled=${this.isEdit}
            .value=${f.year}
            @ionInput=${(e: any) => this.setField('year', e.target.value)}></ion-input>
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT('ui.fieldPrefix')}
            .value=${f.prefix}
            @ionInput=${(e: any) => this.setField('prefix', e.target.value)}></ion-input>
          <ion-input
            fill="outline" label-placement="floating" label=${erploraT('ui.fieldFormat')}
            data-field="format" ?disabled=${this.formatLocked}
            .value=${f.format}
            @ionInput=${(e: any) => this.setField('format', e.target.value)}></ion-input>
        </div>
        ${this.isEdit ? nothing : html`<span class="hint">${erploraT('ui.codeHint')}</span>`}
        <span class="hint">${erploraT('ui.prefixHint')}</span>
        <span class="hint">${erploraT('ui.formatHint')}</span>
        ${this.formatLocked
          ? html`<ok-inline-feedback tone="warning" icon="lock-closed-outline">${erploraT('ui.formatLockedHint')}</ok-inline-feedback>`
          : nothing}
        ${this.preview
          ? html`<span class="hint">${erploraT('ui.formatPreview')}: <strong>${this.preview}</strong></span>`
          : nothing}
        <div class="toggles">
          <ion-item lines="none">
            <ion-toggle .checked=${f.is_active} @ionChange=${(e: any) => this.setField('is_active', e.target.checked)}>${erploraT('ui.fieldActive')}</ion-toggle>
          </ion-item>
          <ion-item lines="none">
            <ion-toggle .checked=${f.is_default} @ionChange=${(e: any) => this.setField('is_default', e.target.checked)}>${erploraT('ui.fieldDefault')}</ion-toggle>
          </ion-item>
        </div>
        <div class="row-actions">
          <ion-button type="submit" ?disabled=${this.saving}>
            ${this.saving
              ? erploraT(this.isEdit ? 'ui.saving' : 'ui.creating')
              : erploraT(this.isEdit ? 'ui.save' : 'ui.create')}
          </ion-button>
          <ion-button fill="clear" color="medium" @click=${() => this.cancelForm()}>${erploraT('ui.cancel')}</ion-button>
        </div>
        ${this.formError ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.formError}</ok-inline-feedback>` : nothing}
      </form>`;
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  // El alta ya no tiene botón propio: es el «+» de la barra de la tabla (`addable`), con permiso.
  render() {
    return html`<div class="page">
      <p class="intro">${erploraT('ui.seriesIntro')}</p>
      ${this.listError ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.listError}</ok-inline-feedback>` : nothing}
      <!-- The «Edit» button is not the only door: rowClickable makes the whole row open the
           same edit form (outfitkit#67 — the actions column can be off-screen at 1440 px). -->
      <ok-data-table
        .fill=${true}
        .addable=${this.canManage}
        .columns=${this.columns}
        .views=${true}
        .cardTitle=${(r: Record<string, unknown>) => String(r.name || r.code || '—')}
        .cardIcon=${() => 'bookmark-outline'}
        .rows=${this.rows}
        .searchable=${true}
        .searchPlaceholder=${erploraT('ui.seriesSearchPlaceholder')}
        .actions=${this.rowActions}
        .rowClickable=${true}
        .emptyMessage=${this.loading ? erploraT('ui.seriesLoading') : erploraT('ui.seriesEmpty')}
        @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)}
        @rowClick=${(e: CustomEvent<{ row: Record<string, unknown> }>) => this.onRowAction({ detail: { actionId: 'edit', row: e.detail.row } } as CustomEvent<{ actionId: string; row: Record<string, unknown> }>)}>
        ${this.canManage ? this.renderForm() : nothing}
      </ok-data-table>
    </div>`;
  }
}

define('erp-invoice-settings', ErpInvoiceSettings);

declare global {
  interface HTMLElementTagNameMap {
    'erp-invoice-settings': ErpInvoiceSettings;
  }
}
