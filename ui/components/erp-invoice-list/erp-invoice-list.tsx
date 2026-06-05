import { Component, State, h } from '@stencil/core';
// Importa el DataTable compartido (Stencil) para que se auto-registre y esbuild
// lo empaquete dentro del bundle del módulo. El shell provee los `ion-*`.
import '../../../../_shared/ui/components/data-table/data-table';
import type { DataTableColumn } from '../../../../_shared/ui/components/data-table/data-table';

// WC del módulo `invoice` (Stencil). Mini-app: listado de facturas (F1/F2/R1…) con
// estado y tipo. La emisión va por el runtime (handler WASM); este WC es lectura +
// acciones ligeras. 90% lógica en Rust; reactivo a invoice.created/rectified.
// El listado usa el DataTable compartido + Ionic.

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
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

@Component({
  tag: 'erp-invoice-list',
  shadow: true,
  styles: `
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .err { color:#d9480f; font-weight:600; }
  `,
})
export class ErpInvoiceList {
  @State() invoices: Invoice[] = [];
  @State() loading = true;
  @State() error = '';
  private unsub?: () => void;

  private columns: DataTableColumn[] = [
    { key: 'number', header: 'Número' },
    { key: 'invoice_type', header: 'Tipo', format: (r) => TYPE_LABEL[r.invoice_type as string] ?? (r.invoice_type as string) },
    { key: 'customer_name', header: 'Cliente', format: (r) => (r.customer_name as string) || '—' },
    { key: 'status', header: 'Estado' },
    { key: 'total_amount', header: 'Total', align: 'right', format: (r) => Number(r.total_amount || 0).toFixed(2) },
  ];

  async componentWillLoad() {
    await this.refresh();
    try {
      const a = erplora().on('invoice.created', () => this.refresh());
      const b = erplora().on('invoice.rectified', () => this.refresh());
      this.unsub = () => { a(); b(); };
    } catch { /* preview */ }
  }
  disconnectedCallback() { this.unsub?.(); }

  private async refresh() {
    this.loading = true; this.error = '';
    try { this.invoices = (await erplora().query<Invoice[]>('invoice.list')) ?? []; }
    catch (e) { this.error = e instanceof Error ? e.message : 'Error cargando facturas'; }
    finally { this.loading = false; }
  }

  render() {
    return (
      <div>
        <header>
          <h2>Facturas</h2>
        </header>

        {this.error && <p class="err">{this.error}</p>}

        <data-table
          columns={this.columns}
          rows={this.invoices as unknown as Record<string, unknown>[]}
          searchKeys={['number', 'customer_name', 'status']}
          searchPlaceholder="Buscar número, cliente o estado…"
          emptyMessage={this.loading ? 'Cargando…' : 'Aún no hay facturas.'}
        />
      </div>
    );
  }
}
