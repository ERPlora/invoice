import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
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
  year: String(new Date().getFullYear()), prefix: '', is_active: true, is_default: false,
});

export class ErpInvoiceSettings extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.5rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    h3 { margin:0 0 .5rem; font-size:1rem; }
    .err { color:#d9480f; font-weight:600; }
    .intro { color: var(--ion-color-medium,#8a8577); font-size:.85rem; margin:0 0 1rem; max-width:60ch; line-height:1.45; }
    .card { border:1px solid var(--ion-border-color,#e7e2d6); border-radius:10px; padding:1rem; margin-bottom:1rem; background:var(--ion-card-background,#fffdf7); }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0; }
    .form ion-input, .form ion-select { flex:1 1 11rem; min-width:9rem; }
    .toggles { display:flex; gap:1.5rem; flex-wrap:wrap; margin:.5rem 0; }
    .toggles ion-item { --background:transparent; --padding-start:0; --inner-padding-end:0; flex:1 1 12rem; }
    .hint { display:block; font-size:.72rem; color:var(--ion-color-medium,#8a8577); margin:-.25rem 0 .25rem; }
    .row-actions { display:flex; gap:.5rem; margin-top:.6rem; }
  `;

  // ── listado de series ──
  @state() rows: SeriesRow[] = [];

  @state() loading = false;

  @state() listError = '';

  // ── formulario de alta/edición ──
  @state() form: SeriesForm | null = null;

  @state() saving = false;

  @state() formError = '';

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
      { key: 'current_number', header: t('ui.seriesColNumber'), align: 'right', sortable: true },
      {
        key: 'is_active',
        header: t('ui.seriesColActive'),
        render: (r) => html`<ion-badge color=${r.is_active ? 'success' : 'medium'}>${r.is_active ? t('ui.yes') : t('ui.no')}</ion-badge>`,
      },
      {
        key: 'is_default',
        header: t('ui.seriesColDefault'),
        render: (r) => (r.is_default ? html`<ion-badge color="primary">${t('ui.yes')}</ion-badge>` : html`<span>—</span>`),
      },
    ];
  }

  private get rowActions(): DataTableAction[] {
    if (!this.canManage) return [];
    return [{ id: 'edit', label: erploraT('ui.seriesActionEdit'), icon: 'create-outline' }];
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
  }

  private startEdit(row: SeriesRow) {
    this.formError = '';
    this.form = {
      series_id: row.id,
      code: row.code,
      name: row.name || '',
      invoice_type: row.invoice_type,
      year: String(row.year ?? ''),
      prefix: row.prefix || '',
      is_active: !!row.is_active,
      is_default: !!row.is_default,
    };
  }

  private cancelForm() { this.form = null; this.formError = ''; }

  private setField<K extends keyof SeriesForm>(key: K, value: SeriesForm[K]) {
    if (!this.form) return;
    this.form = { ...this.form, [key]: value };
  }

  private get isEdit(): boolean { return !!this.form?.series_id; }

  private async submit(ev: Event) {
    ev.preventDefault();
    const f = this.form;
    if (!f) return;
    if (!this.isEdit && !f.code.trim()) { this.formError = erploraT('ui.errSeriesCodeRequired'); return; }
    this.saving = true;
    this.formError = '';
    try {
      if (this.isEdit) {
        // Code, year y contador son inmutables (schemas/series_update.json): solo mutables.
        await erplora().command('invoice.series.update', {
          series_id: f.series_id,
          name: f.name.trim(),
          prefix: f.prefix.trim(),
          is_active: f.is_active,
          is_default: f.is_default,
        });
      } else {
        // schemas/series_create.json: required code, invoice_type, year.
        await erplora().command('invoice.series.create', {
          code: f.code.trim(),
          name: f.name.trim(),
          invoice_type: f.invoice_type,
          year: Number(f.year) || new Date().getFullYear(),
          prefix: f.prefix.trim(),
          is_active: f.is_active,
          is_default: f.is_default,
        });
      }
      this.form = null;
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

  private renderForm() {
    const f = this.form!;
    const title = this.isEdit ? erploraT('ui.seriesEditTitle', { code: f.code }) : erploraT('ui.seriesCreateTitle');
    return html`<div class="card">
      <h3>${title}</h3>
      <form @submit=${(e: Event) => this.submit(e)}>
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
        </div>
        ${this.isEdit ? nothing : html`<span class="hint">${erploraT('ui.codeHint')}</span>`}
        <span class="hint">${erploraT('ui.prefixHint')}</span>
        <div class="toggles">
          <ion-item lines="none">
            <ion-toggle .checked=${f.is_active} @ionChange=${(e: any) => this.setField('is_active', e.target.checked)}>${erploraT('ui.fieldActive')}</ion-toggle>
          </ion-item>
          <ion-item lines="none">
            <ion-toggle .checked=${f.is_default} @ionChange=${(e: any) => this.setField('is_default', e.target.checked)}>${erploraT('ui.fieldDefault')}</ion-toggle>
          </ion-item>
        </div>
        <div class="row-actions">
          <ion-button size="small" type="submit" ?disabled=${this.saving}>
            ${this.saving
              ? erploraT(this.isEdit ? 'ui.saving' : 'ui.creating')
              : erploraT(this.isEdit ? 'ui.save' : 'ui.create')}
          </ion-button>
          <ion-button size="small" fill="clear" color="medium" @click=${() => this.cancelForm()}>${erploraT('ui.cancel')}</ion-button>
        </div>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
      </form>
    </div>`;
  }

  render() {
    return html`<div>
      <header>
        <h2>${erploraT('ui.seriesTitle')}</h2>
        ${this.canManage && !this.form
          ? html`<ion-button size="small" @click=${() => this.startCreate()}>
              <ion-icon slot="start" name="add-outline"></ion-icon>${erploraT('ui.newSeries')}
            </ion-button>`
          : nothing}
      </header>
      <p class="intro">${erploraT('ui.seriesIntro')}</p>
      ${this.form ? this.renderForm() : nothing}
      ${this.listError ? html`<p class="err">${this.listError}</p>` : nothing}
      <ok-data-table
        .columns=${this.columns}
        .rows=${this.rows}
        .searchable=${true}
        .searchPlaceholder=${erploraT('ui.seriesSearchPlaceholder')}
        .actions=${this.rowActions}
        .emptyMessage=${this.loading ? erploraT('ui.seriesLoading') : erploraT('ui.seriesEmpty')}
        @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)}></ok-data-table>
    </div>`;
  }
}

define('erp-invoice-settings', ErpInvoiceSettings);

declare global {
  interface HTMLElementTagNameMap {
    'erp-invoice-settings': ErpInvoiceSettings;
  }
}
