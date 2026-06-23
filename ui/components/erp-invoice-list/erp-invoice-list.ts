import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn, DataTableAction } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  hasPermission?(perm: string): boolean;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

interface Invoice {
  id: string; invoice_type: string; series: string; number: string; issue_date: string;
  customer_name: string; customer_tax_id: string; base_amount: number; tax_amount: number;
  total_amount: number; status: string; source_type: string;
}

interface InvoiceDetail extends Invoice {
  issuer_nif: string; issuer_name: string; customer_address: string; description: string;
  tax_breakdown: string; currency: string; source_id: string | null;
  rectifies_invoice_id: string | null; paid_at: string | null; notes: string;
}

interface InvoiceLine {
  id: string; line_number: number; description: string; quantity: number; unit_price: number;
  tax_rate: number; base_amount: number; tax_amount: number; total_amount: number;
  product_id: string | null;
}

interface SeriesRow { id: string; code: string; name: string; invoice_type: string; is_active: number; }

/** Línea del formulario de alta (strings: vienen de ion-input). */
interface DraftItem { description: string; quantity: string; unit_price: string; tax_rate: string; }

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

function erploraT(key: string, params?: Record<string, unknown>): string {
  return erplora().t(CATALOG, key, params);
}

// Etiquetas de tipo/estado i18n: las CLAVES (F1, draft…) son enums del backend (no se traducen);
// solo el texto visible se resuelve por el catálogo activo (ADR-0055).
function typeLabel(code: string): string {
  const map: Record<string, string> = {
    F1: erploraT('ui.typeInvoice'), F2: erploraT('ui.typeTicket'), F3: erploraT('ui.typeInvoice'),
    R1: erploraT('ui.typeRectifying'), R2: erploraT('ui.typeRectifying'), R3: erploraT('ui.typeRectifying'),
    R4: erploraT('ui.typeRectifying'), R5: erploraT('ui.typeRectifying'),
  };
  return map[code] ?? code;
}

function statusLabel(code: string): string {
  const map: Record<string, string> = {
    draft: erploraT('ui.statusDraft'), issued: erploraT('ui.statusIssued'),
    paid: erploraT('ui.statusPaid'), cancelled: erploraT('ui.statusCancelled'),
  };
  return map[code] ?? code;
}

const TYPE_CODES = ['F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'];
const STATUS_CODES = ['draft', 'issued', 'paid', 'cancelled'];

const STATUS_COLOR: Record<string, string> = {
  draft: 'medium', issued: 'primary', paid: 'success', cancelled: 'danger',
};

const money = (v: unknown) => Number(v || 0).toFixed(2);
const emptyItem = (): DraftItem => ({ description: '', quantity: '1', unit_price: '', tax_rate: '21' });

export class ErpInvoiceList extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    h3 { margin:0 0 .5rem; font-size:1rem; }
    .err { color:#d9480f; font-weight:600; }
    .card { border:1px solid var(--line,#e7e2d6); border-radius:10px; padding:1rem; margin-bottom:1rem; background:var(--surface-1,#fffdf7); }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap:.35rem .75rem; margin:.5rem 0; }
    .grid dt { font-size:.72rem; text-transform:uppercase; letter-spacing:.03em; color:var(--ion-color-medium,#8a8577); margin:0; }
    .grid dd { margin:0 0 .4rem; font-weight:500; word-break:break-word; }
    table.lines { width:100%; border-collapse:collapse; margin-top:.5rem; font-size:.9rem; }
    table.lines th, table.lines td { padding:.35rem .5rem; border-bottom:1px solid var(--line,#e7e2d6); text-align:left; }
    table.lines th:nth-child(n+3), table.lines td:nth-child(n+3) { text-align:right; }
    .totals { display:flex; gap:1.5rem; justify-content:flex-end; margin-top:.6rem; font-weight:600; }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1.25rem; }
    .form ion-input, .form ion-select, .form ion-textarea { flex:1 1 11rem; min-width:9rem; }
    .form ion-textarea { flex:2 1 20rem; min-width:16rem; }
    .item-row { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0; }
    .item-row .desc { flex:2 1 20rem; min-width:16rem; }
    .item-row .num { flex:1 1 6.5rem; min-width:6.5rem; }
    .row-actions { display:flex; gap:.5rem; margin-top:.6rem; }
  `;

  @state() tick = 0;

  // ── detalle ──
  @state() detail: InvoiceDetail | null = null;

  @state() detailLines: InvoiceLine[] = [];

  @state() detailError = '';

  // ── alta manual ──
  @state() showCreate = false;

  @state() saving = false;

  @state() formError = '';

  @state() newCustomerName = '';

  @state() newCustomerTaxId = '';

  @state() newCustomerAddress = '';

  @state() newNotes = '';

  @state() newSeriesCode = 'FACT';

  @state() newItems: DraftItem[] = [emptyItem()];

  @state() seriesOptions: SeriesRow[] = [];

  // ── rectificar ──
  @state() rectifyTarget: Invoice | null = null;

  @state() rectifyReason = '';

  @state() actionError = '';

  @state() busy = false;

  private canAdd = true;

  private canRectify = true;

  private ctrl!: ListController<Invoice>;

  private unsub?: () => void;

  // Getter (no campo): se re-evalúa en cada render, así los textos cambian con el idioma activo
  // (ADR-0055). `connectedCallback` re-renderiza al recibir `erplora:locale-changed`.
  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erploraT(k);
    return [
    { key: 'number', header: t('ui.colNumber'), sortable: true, filterable: true, filterType: 'text' },
    {
      key: 'invoice_type',
      header: t('ui.colType'),
      sortable: true,
      filterable: true,
      filterType: 'select',
      options: TYPE_CODES.map((value) => ({ value, label: typeLabel(value) })),
      format: (r) => typeLabel(r.invoice_type as string),
    },
    { key: 'issue_date', header: t('ui.colDate'), sortable: true, filterable: true, filterType: 'daterange' },
    { key: 'customer_name', header: t('ui.colCustomer'), sortable: true, filterable: true, filterType: 'text', format: (r) => (r.customer_name as string) || '—' },
    {
      key: 'status',
      header: t('ui.colStatus'),
      sortable: true,
      filterable: true,
      filterType: 'select',
      options: STATUS_CODES.map((value) => ({ value, label: statusLabel(value) })),
      render: (r) => html`<ion-badge color=${STATUS_COLOR[r.status as string] ?? 'medium'}>${statusLabel(r.status as string)}</ion-badge>`,
    },
    { key: 'total_amount', header: t('ui.colTotal'), align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => money(r.total_amount) },
    ];
  }

  private get rowActions(): DataTableAction[] {
    const acts: DataTableAction[] = [{ id: 'view', label: erploraT('ui.actionView'), icon: 'eye-outline' }];
    if (this.canAdd) acts.push({ id: 'paid', label: erploraT('ui.actionMarkPaid'), icon: 'checkmark-circle-outline', color: 'success' });
    if (this.canRectify) acts.push({ id: 'rectify', label: erploraT('ui.actionRectify'), icon: 'arrow-undo-outline', color: 'danger' });
    return acts;
  }

  // Re-render al cambiar el idioma del shell (ADR-0055): los getters `columns`/`rowActions` y el
  // texto del template se re-evalúan con el nuevo `erplora.locale`.
  private readonly onLocaleChange = (): void => this.requestUpdate();

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    // hasPermission es SOLO para mostrar/ocultar: la seguridad real la revalida el runtime.
    try {
      const c = erplora();
      this.canAdd = c.hasPermission?.('invoice.add_invoice') ?? true;
      this.canRectify = c.hasPermission?.('invoice.rectify_invoice') ?? true;
    } catch { /* preview */ }
    this.ctrl = createListController<Invoice>(erplora(), 'invoice.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'id',
      dir: 'asc',
    });
    await this.ctrl.load();
    try {
      const a = erplora().on('invoice.created', () => this.ctrl.load());
      const b = erplora().on('invoice.rectified', () => this.ctrl.load());
      this.unsub = () => { a(); b(); };
    } catch { /* preview */ }
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    super.disconnectedCallback(); this.unsub?.(); }

  // ── detalle (invoice.get + invoice.lines) ─────────────────────────────────

  private async openDetail(id: string) {
    this.detailError = '';
    try {
      const [inv, lines] = await Promise.all([
        erplora().query<InvoiceDetail[] | InvoiceDetail>('invoice.get', { invoice_id: id }),
        erplora().query<InvoiceLine[]>('invoice.lines', { invoice_id: id }),
      ]);
      const row = Array.isArray(inv) ? inv[0] : inv;
      if (!row) { this.detailError = erploraT('ui.errNotFound'); return; }
      this.detail = row;
      this.detailLines = Array.isArray(lines) ? lines : [];
    } catch (e) {
      this.detailError = e instanceof Error ? e.message : erploraT('ui.errLoadDetail');
    }
  }

  private closeDetail() { this.detail = null; this.detailLines = []; this.detailError = ''; this.rectifyTarget = null; }

  // ── acciones (mark_paid / rectify) ────────────────────────────────────────

  private async markPaid(inv: { id: string; status: string }) {
    if (inv.status !== 'issued') { this.actionError = erploraT('ui.errMarkPaidStatus'); return; }
    this.actionError = '';
    this.busy = true;
    try {
      await erplora().command('invoice.mark_paid', { invoice_id: inv.id });
      await this.ctrl.load();
      if (this.detail?.id === inv.id) await this.openDetail(inv.id);
    } catch (e) {
      this.actionError = e instanceof Error ? e.message : erploraT('ui.errMarkPaid');
    } finally {
      this.busy = false;
    }
  }

  private startRectify(inv: Invoice) {
    if (inv.invoice_type?.startsWith('R')) { this.actionError = erploraT('ui.errRectifyRectifying'); return; }
    if (inv.status === 'cancelled') { this.actionError = erploraT('ui.errAlreadyCancelled'); return; }
    this.actionError = '';
    this.rectifyReason = '';
    this.rectifyTarget = inv;
  }

  private async confirmRectify() {
    const target = this.rectifyTarget;
    if (!target || !this.rectifyReason.trim()) return;
    this.busy = true;
    this.actionError = '';
    try {
      const now = new Date();
      await erplora().command('invoice.rectify', {
        original_id: target.id,
        reason: this.rectifyReason.trim(),
        year: now.getFullYear(),
        issue_date: now.toISOString().slice(0, 10),
      });
      this.rectifyTarget = null;
      await this.ctrl.load();
      if (this.detail?.id === target.id) await this.openDetail(target.id);
    } catch (e) {
      this.actionError = e instanceof Error ? e.message : erploraT('ui.errRectify');
    } finally {
      this.busy = false;
    }
  }

  private onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const inv = ev.detail.row as unknown as Invoice;
    if (ev.detail.actionId === 'view') this.openDetail(inv.id);
    else if (ev.detail.actionId === 'paid') this.markPaid(inv);
    else if (ev.detail.actionId === 'rectify') this.startRectify(inv);
  }

  // ── alta manual (invoice.create) ──────────────────────────────────────────

  private async toggleCreate() {
    this.showCreate = !this.showCreate;
    this.formError = '';
    if (this.showCreate && !this.seriesOptions.length) {
      try {
        const rows = await erplora().query<SeriesRow[]>('invoice.series.list', {});
        this.seriesOptions = (Array.isArray(rows) ? rows : []).filter((sr) => sr.is_active);
      } catch { /* sin series aún: el handler asegura FACT por defecto */ }
    }
  }

  private setItem(i: number, key: keyof DraftItem, value: string) {
    this.newItems = this.newItems.map((it, j) => (j === i ? { ...it, [key]: value } : it));
  }

  private get itemsValid(): boolean {
    return this.newItems.length > 0 && this.newItems.every(
      (it) => it.description.trim() && Number(it.quantity) > 0 && it.unit_price !== '' && !Number.isNaN(Number(it.unit_price)),
    );
  }

  private async create(ev: Event) {
    ev.preventDefault();
    if (!this.itemsValid) return;
    this.saving = true;
    this.formError = '';
    try {
      await erplora().command('invoice.create', {
        series_code: this.newSeriesCode || 'FACT',
        customer_name: this.newCustomerName.trim(),
        customer_tax_id: this.newCustomerTaxId.trim(),
        customer_address: this.newCustomerAddress.trim(),
        notes: this.newNotes.trim(),
        source_type: 'manual',
        items: this.newItems.map((it) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0,
          tax_rate: Number(it.tax_rate) || 0,
          product_id: null,
        })),
      });
      this.newCustomerName = ''; this.newCustomerTaxId = ''; this.newCustomerAddress = '';
      this.newNotes = ''; this.newItems = [emptyItem()]; this.showCreate = false;
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erploraT('ui.errCreate');
    } finally {
      this.saving = false;
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  private renderRectifyCard() {
    const t = this.rectifyTarget;
    if (!t) return nothing;
    return html`<div class="card">
      <h3>${erploraT('ui.rectifyTitle', { number: t.number })}</h3>
      <p>${erploraT('ui.rectifyNote')}</p>
      <div class="form">
        <ion-textarea fill="outline" label-placement="floating" label=${erploraT('ui.lblReason')} placeholder=${erploraT('ui.rectifyReasonPlaceholder')} auto-grow .value=${this.rectifyReason} @ionInput=${(e: any) => (this.rectifyReason = e.target.value)}></ion-textarea>
      </div>
      <div class="row-actions">
        <ion-button size="small" color="danger" ?disabled=${this.busy || !this.rectifyReason.trim()} @click=${() => this.confirmRectify()}>${this.busy ? erploraT('ui.rectifying') : erploraT('ui.issueRectifying')}</ion-button>
        <ion-button size="small" fill="outline" color="medium" @click=${() => (this.rectifyTarget = null)}>${erploraT('ui.cancel')}</ion-button>
      </div>
    </div>`;
  }

  private renderDetail() {
    const d = this.detail!;
    return html`<div>
      <header>
        <h2>${erploraT('ui.detailTitle', { number: d.number })}</h2>
        <ion-badge color=${STATUS_COLOR[d.status] ?? 'medium'}>${statusLabel(d.status)}</ion-badge>
        <ion-button size="small" fill="outline" color="medium" @click=${() => this.closeDetail()}>← ${erploraT('ui.back')}</ion-button>
      </header>
      ${this.actionError ? html`<p class="err">${this.actionError}</p>` : nothing}
      ${this.renderRectifyCard()}
      <div class="card">
        <dl class="grid">
          <div><dt>${erploraT('ui.fieldType')}</dt><dd>${typeLabel(d.invoice_type)} (${d.invoice_type})</dd></div>
          <div><dt>${erploraT('ui.fieldSeries')}</dt><dd>${d.series}</dd></div>
          <div><dt>${erploraT('ui.fieldIssueDate')}</dt><dd>${d.issue_date}</dd></div>
          <div><dt>${erploraT('ui.fieldCustomer')}</dt><dd>${d.customer_name || '—'}</dd></div>
          <div><dt>${erploraT('ui.fieldCustomerTaxId')}</dt><dd>${d.customer_tax_id || '—'}</dd></div>
          <div><dt>${erploraT('ui.fieldAddress')}</dt><dd>${d.customer_address || '—'}</dd></div>
          <div><dt>${erploraT('ui.fieldIssuer')}</dt><dd>${d.issuer_name || '—'} ${d.issuer_nif ? `(${d.issuer_nif})` : ''}</dd></div>
          <div><dt>${erploraT('ui.fieldSource')}</dt><dd>${d.source_type}${d.source_id ? ` · ${d.source_id}` : ''}</dd></div>
          ${d.rectifies_invoice_id ? html`<div><dt>${erploraT('ui.fieldRectifies')}</dt><dd>${d.rectifies_invoice_id}</dd></div>` : nothing}
          ${d.paid_at ? html`<div><dt>${erploraT('ui.fieldPaidAt')}</dt><dd>${d.paid_at}</dd></div>` : nothing}
          ${d.notes ? html`<div><dt>${erploraT('ui.fieldNotes')}</dt><dd>${d.notes}</dd></div>` : nothing}
        </dl>
        ${this.detailLines.length ? html`<table class="lines">
          <thead><tr><th>#</th><th>${erploraT('ui.lineDescription')}</th><th>${erploraT('ui.lineQty')}</th><th>${erploraT('ui.linePrice')}</th><th>${erploraT('ui.lineTaxPct')}</th><th>${erploraT('ui.lineBase')}</th><th>${erploraT('ui.lineTax')}</th><th>${erploraT('ui.lineTotal')}</th></tr></thead>
          <tbody>${this.detailLines.map((l) => html`<tr>
            <td>${l.line_number}</td><td>${l.description}</td><td>${l.quantity}</td>
            <td>${money(l.unit_price)}</td><td>${money(l.tax_rate)}</td>
            <td>${money(l.base_amount)}</td><td>${money(l.tax_amount)}</td><td>${money(l.total_amount)}</td>
          </tr>`)}</tbody>
        </table>` : html`<p>${erploraT('ui.noLines')}</p>`}
        <div class="totals">
          <span>${erploraT('ui.totalBase')}: ${money(d.base_amount)} ${d.currency}</span>
          <span>${erploraT('ui.totalTaxes')}: ${money(d.tax_amount)} ${d.currency}</span>
          <span>${erploraT('ui.totalTotal')}: ${money(d.total_amount)} ${d.currency}</span>
        </div>
        <div class="row-actions">
          ${this.canAdd && d.status === 'issued' ? html`<ion-button size="small" color="success" ?disabled=${this.busy} @click=${() => this.markPaid(d)}>${erploraT('ui.actionMarkPaid')}</ion-button>` : nothing}
          ${this.canRectify && !(d.invoice_type ?? '').startsWith('R') && d.status !== 'cancelled' ? html`<ion-button size="small" fill="outline" color="danger" ?disabled=${this.busy} @click=${() => this.startRectify(d)}>${erploraT('ui.actionRectify')}</ion-button>` : nothing}
        </div>
      </div>
    </div>`;
  }

  private renderCreateForm() {
    return html`<div class="card">
      <h3>${erploraT('ui.createTitle')}</h3>
      <form @submit=${(e: Event) => this.create(e)}>
        <div class="form">
          <ion-select fill="outline" label-placement="floating" label=${erploraT('ui.fieldSeries')} interface="popover" .value=${this.newSeriesCode} @ionChange=${(e: any) => (this.newSeriesCode = e.target.value)}>
            ${this.seriesOptions.length
              ? this.seriesOptions.map((sr) => html`<ion-select-option .value=${sr.code}>${sr.code} — ${sr.name || typeLabel(sr.invoice_type)}</ion-select-option>`)
              : html`<ion-select-option value="FACT">FACT — ${typeLabel('F1')} (F1)</ion-select-option><ion-select-option value="TICKET">TICKET — ${typeLabel('F2')} (F2)</ion-select-option>`}
          </ion-select>
          <ion-input fill="outline" label-placement="floating" label=${erploraT('ui.fieldCustomer')} .value=${this.newCustomerName} @ionInput=${(e: any) => (this.newCustomerName = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${erploraT('ui.fieldCustomerTaxId')} placeholder=${erploraT('ui.placeholderTaxId')} .value=${this.newCustomerTaxId} @ionInput=${(e: any) => (this.newCustomerTaxId = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${erploraT('ui.fieldAddress')} .value=${this.newCustomerAddress} @ionInput=${(e: any) => (this.newCustomerAddress = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${erploraT('ui.fieldNotes')} .value=${this.newNotes} @ionInput=${(e: any) => (this.newNotes = e.target.value)}></ion-input>
        </div>
        ${this.newItems.map((it, i) => html`<div class="item-row">
          <ion-input class="desc" fill="outline" label-placement="floating" label=${erploraT('ui.lineDescription')} .value=${it.description} @ionInput=${(e: any) => this.setItem(i, 'description', e.target.value)}></ion-input>
          <ion-input class="num" fill="outline" label-placement="floating" label=${erploraT('ui.lineQty')} type="number" .value=${it.quantity} @ionInput=${(e: any) => this.setItem(i, 'quantity', e.target.value)}></ion-input>
          <ion-input class="num" fill="outline" label-placement="floating" label=${erploraT('ui.linePrice')} type="number" .value=${it.unit_price} @ionInput=${(e: any) => this.setItem(i, 'unit_price', e.target.value)}></ion-input>
          <ion-input class="num" fill="outline" label-placement="floating" label=${erploraT('ui.lineTaxPct')} type="number" .value=${it.tax_rate} @ionInput=${(e: any) => this.setItem(i, 'tax_rate', e.target.value)}></ion-input>
          ${this.newItems.length > 1 ? html`<ion-button size="small" fill="clear" color="danger" @click=${() => (this.newItems = this.newItems.filter((_, j) => j !== i))}>✕</ion-button>` : nothing}
        </div>`)}
        <div class="row-actions">
          <ion-button size="small" fill="outline" @click=${() => (this.newItems = [...this.newItems, emptyItem()])}>${erploraT('ui.addLine')}</ion-button>
          <ion-button size="small" type="submit" ?disabled=${this.saving || !this.itemsValid}>${this.saving ? erploraT('ui.issuing') : erploraT('ui.issueInvoice')}</ion-button>
          <ion-button size="small" fill="clear" color="medium" @click=${() => (this.showCreate = false)}>${erploraT('ui.cancel')}</ion-button>
        </div>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
      </form>
    </div>`;
  }

  render() {
    if (this.detail) return this.renderDetail();
    return html`<div>
        <header>
          <h2>${erploraT('ui.pageTitle')}</h2>
          ${this.canAdd ? html`<ion-button size="small" @click=${() => this.toggleCreate()}>${this.showCreate ? erploraT('ui.close') : erploraT('ui.newInvoice')}</ion-button>` : nothing}
        </header>
        ${this.showCreate ? this.renderCreateForm() : nothing}
        ${this.renderRectifyCard()}
        ${this.actionError ? html`<p class="err">${this.actionError}</p>` : nothing}
        ${this.detailError ? html`<p class="err">${this.detailError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${erploraT('ui.searchPlaceholder')} .actions=${this.rowActions} .emptyMessage=${this.ctrl?.loading ? erploraT('ui.loading') : erploraT('ui.empty')} @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-invoice-list', ErpInvoiceList);
