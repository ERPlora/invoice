import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  on(event: string, cb: (payload: unknown) => void): () => void;
}

interface Invoice {
  id: string; invoice_type: string; number: string; issue_date: string;
  customer_name: string; total_amount: number; status: string; source_type: string;
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

const TYPE_LABEL: Record<string, string> = {
  F1: 'Factura', F2: 'Ticket', F3: 'Factura', R1: 'Rectificativa', R2: 'Rectificativa',
  R3: 'Rectificativa', R4: 'Rectificativa', R5: 'Rectificativa',
};

export class ErpInvoiceList extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() tick = 0;

  private ctrl!: ListController<Invoice>;

  private unsub?: () => void;

  private columns: DataTableColumn[] = [
    { key: 'number', header: 'Número', sortable: true, filterable: true, filterType: 'text' },
    {
      key: 'invoice_type',
      header: 'Tipo',
      sortable: true,
      filterable: true,
      filterType: 'select',
      options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })),
      format: (r) => TYPE_LABEL[r.invoice_type as string] ?? (r.invoice_type as string),
    },
    { key: 'customer_name', header: 'Cliente', sortable: true, filterable: true, filterType: 'text', format: (r) => (r.customer_name as string) || '—' },
    { key: 'status', header: 'Estado', sortable: true, filterable: true, filterType: 'text' },
    { key: 'total_amount', header: 'Total', align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => Number(r.total_amount || 0).toFixed(2) },
  ];

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
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
    super.disconnectedCallback(); this.unsub?.(); }

  render() {
    return html`<div>
        <header>
          <h2>Facturas</h2>
        </header>
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${"Buscar número, cliente o estado…"} .emptyMessage=${this.ctrl?.loading ? 'Cargando…' : 'Aún no hay facturas.'} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-invoice-list', ErpInvoiceList);
