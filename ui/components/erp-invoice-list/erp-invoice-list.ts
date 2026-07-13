import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import '@erplora/outfitkit/ok-invoice';
import '@erplora/outfitkit/ok-qr';
import type { DataTableColumn, DataTableAction, InvoiceData } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  /** Integración OPCIONAL (ADR-0127): undefined SOLO si el módulo dueño no está instalado;
   *  un contrato roto contra un módulo presente EXPLOTA (no es un catch silencioso). */
  queryOptional<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T | undefined>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  hasPermission?(perm: string): boolean;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
  /** Moneda del hub + formateo de dinero (ADR-0059). `opts.currency` sobreescribe (factura en otra divisa). */
  currency: string;
  formatAmount(units: number, opts?: { currency?: string; locale?: string }): string;
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

// Importes en UNIDADES mayores (la factura guarda decimales, no céntimos). Dinero → formateado con
// la moneda del HUB por defecto (ADR-0059) o la propia de la factura (`fmtDoc`, que pasa `d.currency`);
// `num` es para valores NO monetarios (cantidades, % de impuesto) que solo quieren 2 decimales.
const fmtMoney = (v: unknown) => erplora().formatAmount(Number(v || 0));
const fmtDoc = (v: unknown, currency: string) => erplora().formatAmount(Number(v || 0), { currency });
const num = (v: unknown) => Number(v || 0).toFixed(2);
const emptyItem = (): DraftItem => ({ description: '', quantity: '1', unit_price: '', tax_rate: '21' });

export class ErpInvoiceList extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    /* La vista llena el alto: el data-table ocupa todo (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    h3 { margin:0 0 .5rem; font-size:1rem; }
    .err { color:#d9480f; font-weight:600; }
    .card { border:1px solid var(--ion-border-color,#e7e2d6); border-radius:10px; padding:1rem; margin-bottom:1rem; background:var(--ion-card-background,#fffdf7); }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap:.35rem .75rem; margin:.5rem 0; }
    .grid dt { font-size:.72rem; text-transform:uppercase; letter-spacing:.03em; color:var(--ion-color-medium,#8a8577); margin:0; }
    .grid dd { margin:0 0 .4rem; font-weight:500; word-break:break-word; }
    table.lines { width:100%; border-collapse:collapse; margin-top:.5rem; font-size:.9rem; }
    table.lines th, table.lines td { padding:.35rem .5rem; border-bottom:1px solid var(--ion-border-color,#e7e2d6); text-align:left; }
    table.lines th:nth-child(n+3), table.lines td:nth-child(n+3) { text-align:right; }
    .totals { display:flex; gap:1.5rem; justify-content:flex-end; margin-top:.6rem; font-weight:600; }
    /* El alta vive en el panel lateral de la tabla (estrecho): los campos van APILADOS. */
    .form { display:flex; flex-direction:column; gap:.7rem; margin:0 0 .5rem; }
    .item-row { display:flex; gap:.5rem; flex-wrap:wrap; align-items:end; margin:.5rem 0; }
    .item-row .desc { flex:1 1 100%; }
    .item-row .num { flex:1 1 5rem; min-width:4.5rem; }
    .row-actions { display:flex; gap:.5rem; margin-top:.6rem; }
    .muted { color: var(--ion-color-medium,#8a8577); }
    .kv { display:flex; gap:.5rem; align-items:baseline; margin:.25rem 0; }
    .kv .k { font-size:.72rem; text-transform:uppercase; letter-spacing:.03em; color:var(--ion-color-medium,#8a8577); }
    .kv code { font-family: ui-monospace, monospace; font-size:.85rem; word-break:break-all; }
    .link { color: var(--ion-color-primary,#3880ff); font-weight:600; text-decoration:none; }
    .aeat-card .aeat-head { display:flex; gap:.5rem; align-items:center; }
    .aeat-card .aeat-head h3 { margin:0; flex:1; }
    .qr-wrap { display:flex; flex-direction:column; align-items:center; gap:.4rem; padding:.5rem 0; }
    .qr-note { font-size:.72rem; color:var(--ion-color-medium,#8a8577); text-align:center; }
    /* Documento imprimible: oculto en pantalla, único visible al imprimir / Guardar como PDF. */
    .print-only { display:none; }
    @media print {
      .screen-only { display:none !important; }
      .print-only { display:block !important; }
    }
  `;

  @state() tick = 0;

  // ── detalle ──
  @state() detail: InvoiceDetail | null = null;

  @state() detailLines: InvoiceLine[] = [];

  @state() detailError = '';

  /** Justificante VeriFactu de la factura abierta (estado AEAT + CSV + QR). */
  @state() aeat: { status?: string; csv?: string; qr?: string; record_type?: string } | null = null;

  // ── alta manual (vive en el panel `create` de la tabla) ──
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
    { key: 'total_amount', header: t('ui.colTotal'), align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => fmtMoney(r.total_amount) },
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
    // Las series se cargan YA, no al abrir el panel: el «+» de la barra de la tabla lo abre la
    // propia tabla (no avisa al módulo), así que si esperásemos a un toggle el select saldría vacío.
    await this.loadSeries();
    try {
      const a = erplora().on('invoice.created', () => this.ctrl.load());
      const b = erplora().on('invoice.rectified', () => this.ctrl.load());
      this.unsub = () => { a(); b(); };
    } catch { /* preview */ }
  }

  private async loadSeries() {
    try {
      const rows = await erplora().query<SeriesRow[]>('invoice.series.list', {});
      this.seriesOptions = (Array.isArray(rows) ? rows : []).filter((sr) => sr.is_active);
    } catch { /* sin series aún: el handler asegura FACT por defecto */ }
  }

  // Referencia al ok-data-table para abrir/cerrar su panel lateral (el alta se proyecta dentro).
  private dataTable(): { open(p?: 'filters' | 'create'): void; close(): void } | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | { open(p?: 'filters' | 'create'): void; close(): void }
      | null;
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
      // Justificante VeriFactu (estado AEAT + CSV + QR) — best-effort: si no hay registro o permiso,
      // la factura se muestra igual sin el bloque AEAT.
      this.aeat = await this.loadAeat(id);
    } catch (e) {
      this.detailError = e instanceof Error ? e.message : erploraT('ui.errLoadDetail');
    }
  }

  /** Carga el registro VeriFactu de la factura (qr_url + CSV + estado). Tolerante a fallos. */
  private async loadAeat(invoiceId: string) {
    try {
      // `queryOptional` (ADR-0127): verifactu puede NO estar instalado (factura sin cadena fiscal
      // AEAT) — eso devuelve undefined y aquí no pasa nada. Un contrato ROTO (query renombrada,
      // permiso) sí explota: eso lo atrapa el catch de este método, que ya era tolerante.
      const rows = await erplora().queryOptional<Record<string, unknown> | Record<string, unknown>[]>(
        'verifactu.records.by_invoice', { invoice_id: invoiceId });
      const rec = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;
      if (!rec) return null;
      return {
        status: (rec.status as string) || '',
        csv: (rec.aeat_csv as string) || '',
        qr: (rec.qr_url as string) || '',
        record_type: (rec.record_type as string) || '',
      };
    } catch {
      return null; // verifactu no instalado / sin registro / sin permiso
    }
  }

  private closeDetail() { this.detail = null; this.detailLines = []; this.detailError = ''; this.rectifyTarget = null; this.aeat = null; }

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
      this.newNotes = ''; this.newItems = [emptyItem()];
      this.dataTable()?.close(); // el panel de alta se cierra solo tras emitir
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erploraT('ui.errCreate');
    } finally {
      this.saving = false;
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  // ── documento imprimible (ok-invoice) + estado AEAT ───────────────────────

  private aeatStatusLabel(s?: string): string {
    const map: Record<string, string> = {
      accepted: erploraT('ui.aeatAccepted'), pending: erploraT('ui.aeatPending'),
      rejected: erploraT('ui.aeatRejected'), error: erploraT('ui.aeatErrorStatus'),
    };
    return s ? (map[s] ?? s) : '';
  }

  private aeatStatusColor(s?: string): string {
    const map: Record<string, string> = { accepted: 'success', pending: 'warning', rejected: 'danger', error: 'danger' };
    return (s && map[s]) || 'medium';
  }

  /** tax_breakdown JSON {"21.00":{base,tax}} → líneas de impuesto de ok-invoice. */
  private parseTaxes(d: InvoiceDetail): Array<{ label: string; rate?: number; base: number; amount: number }> {
    let obj: Record<string, { base?: number; tax?: number }> = {};
    try { obj = d.tax_breakdown ? JSON.parse(d.tax_breakdown) : {}; } catch { obj = {}; }
    const entries = Object.entries(obj);
    if (!entries.length) {
      // Sin desglose (p.ej. rectificativa): una línea con base/impuesto de cabecera.
      return [{ label: 'IVA', base: d.base_amount, amount: d.tax_amount }];
    }
    return entries.map(([rate, v]) => {
      const r = Number(rate);
      return { label: `IVA ${Number.isFinite(r) ? r.toFixed(0) : rate}%`, rate: Number.isFinite(r) ? r : undefined, base: Number(v?.base ?? 0), amount: Number(v?.tax ?? 0) };
    });
  }

  /** Factura → contrato ok-invoice (layout PDF/print) con el QR de VeriFactu. */
  private invoiceDocData(): InvoiceData {
    const d = this.detail!;
    const qr = this.aeat?.qr || '';
    const csv = this.aeat?.csv || '';
    return {
      issuer: { name: d.issuer_name || '—', tax_id: d.issuer_nif || undefined },
      customer: { name: d.customer_name || '—', tax_id: d.customer_tax_id || undefined, address: d.customer_address || undefined },
      number: d.number,
      issue_date: d.issue_date,
      lines: this.detailLines.map((l) => ({ description: l.description, qty: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate, total: l.total_amount })),
      subtotal: d.base_amount,
      taxes: this.parseTaxes(d),
      tax_total: d.tax_amount,
      total: d.total_amount,
      currency: d.currency || erplora().currency,
      qr: qr || undefined,
      qr_note: csv ? `CSV: ${csv}` : (qr ? erploraT('ui.qrValidateNote') : undefined),
      footer: d.notes || undefined,
    };
  }

  private renderAeatCard() {
    const a = this.aeat;
    if (!a) return nothing;
    return html`<div class="card aeat-card screen-only">
      <div class="aeat-head">
        <h3>${erploraT('ui.aeatTitle')}</h3>
        <ion-badge color=${this.aeatStatusColor(a.status)}>${this.aeatStatusLabel(a.status) || '—'}</ion-badge>
      </div>
      ${a.csv ? html`<div class="kv"><span class="k">${erploraT('ui.aeatCsv')}</span><code>${a.csv}</code></div>` : nothing}
      ${a.qr
        ? html`<div class="qr-wrap">
            <ok-qr value=${a.qr} size="120" ec="M"></ok-qr>
            <span class="qr-note">${erploraT('ui.qrValidateNote')}</span>
            <a class="link" href=${a.qr} target="_blank" rel="noopener noreferrer">${erploraT('ui.aeatValidateLink')}</a>
          </div>`
        : html`<p class="muted">${erploraT('ui.aeatNoRecord')}</p>`}
    </div>`;
  }

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
      <header class="screen-only">
        <h2>${erploraT('ui.detailTitle', { number: d.number })}</h2>
        <ion-badge color=${STATUS_COLOR[d.status] ?? 'medium'}>${statusLabel(d.status)}</ion-badge>
        <ion-button size="small" @click=${() => window.print()}>
          <ion-icon slot="start" name="print-outline"></ion-icon> ${erploraT('ui.actionPrint')}
        </ion-button>
        <ion-button size="small" fill="outline" color="medium" @click=${() => this.closeDetail()}>← ${erploraT('ui.back')}</ion-button>
      </header>
      ${this.actionError ? html`<p class="err screen-only">${this.actionError}</p>` : nothing}
      <div class="screen-only">${this.renderRectifyCard()}</div>
      ${this.renderAeatCard()}
      <div class="card screen-only">
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
            <td>${fmtDoc(l.unit_price, d.currency)}</td><td>${num(l.tax_rate)}%</td>
            <td>${fmtDoc(l.base_amount, d.currency)}</td><td>${fmtDoc(l.tax_amount, d.currency)}</td><td>${fmtDoc(l.total_amount, d.currency)}</td>
          </tr>`)}</tbody>
        </table>` : html`<p>${erploraT('ui.noLines')}</p>`}
        <div class="totals">
          <span>${erploraT('ui.totalBase')}: ${fmtDoc(d.base_amount, d.currency)}</span>
          <span>${erploraT('ui.totalTaxes')}: ${fmtDoc(d.tax_amount, d.currency)}</span>
          <span>${erploraT('ui.totalTotal')}: ${fmtDoc(d.total_amount, d.currency)}</span>
        </div>
        <div class="row-actions">
          ${this.canAdd && d.status === 'issued' ? html`<ion-button size="small" color="success" ?disabled=${this.busy} @click=${() => this.markPaid(d)}>${erploraT('ui.actionMarkPaid')}</ion-button>` : nothing}
          ${this.canRectify && !(d.invoice_type ?? '').startsWith('R') && d.status !== 'cancelled' ? html`<ion-button size="small" fill="outline" color="danger" ?disabled=${this.busy} @click=${() => this.startRectify(d)}>${erploraT('ui.actionRectify')}</ion-button>` : nothing}
        </div>
      </div>
      <!-- Documento imprimible (solo al imprimir / Guardar como PDF): layout factura con QR VeriFactu. -->
      <div class="print-only"><ok-invoice .invoice=${this.invoiceDocData()}></ok-invoice></div>
    </div>`;
  }

  // Alta manual: se proyecta SIEMPRE en el panel `create` de la tabla (aunque esté cerrado); si solo
  // se pintara al abrir, el «+» de la barra —que lo despliega la propia tabla— saldría vacío.
  private renderCreateForm() {
    return html`<form slot="create" @submit=${(e: Event) => this.create(e)}>
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
          <ion-button size="small" fill="clear" color="medium" @click=${() => this.dataTable()?.close()}>${erploraT('ui.cancel')}</ion-button>
        </div>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
      </form>`;
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  // El alta manual ya no tiene botón propio: es el «+» de la barra de la tabla (`addable`).
  render() {
    if (this.detail) return this.renderDetail();
    return html`<div class="page">
        ${this.renderRectifyCard()}
        ${this.actionError ? html`<p class="err">${this.actionError}</p>` : nothing}
        ${this.detailError ? html`<p class="err">${this.detailError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .fill=${true} .addable=${this.canAdd} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${erploraT('ui.searchPlaceholder')} .actions=${this.rowActions} .emptyMessage=${this.ctrl?.loading ? erploraT('ui.loading') : erploraT('ui.empty')} @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}>
          ${this.canAdd ? this.renderCreateForm() : nothing}
        </ok-data-table>
      </div>`;
  }
}

define('erp-invoice-list', ErpInvoiceList);
