// invoice#66 — the invoice on THERMAL paper.
//
// Two papers, two contracts. The A4/PDF document is the live `<ok-invoice>` (OutfitKit ≥ 0.1.48,
// ADR-0400): integers in the minor unit + `decimals`, cut by string, never divided. The thermal
// job is different: `sdk.print` hands `data` to the hub's ESC/POS renderer
// (`hub/crates/peripherals/src/escpos.rs::render_receipt`, the branch `DocumentType::Invoice`
// shares), which looks things up BY KEY — `items[]` with `name`/`quantity`/`total`, `subtotal`,
// `tax_amount`, `total` — as floats in MAJOR units printed with `{:.2}`. Handing it the
// `InvoiceData` object printed a paper with no lines and «TOTAL 4800.00» for 48,00 €.
//
// Same split `sales` keeps (`ui/lib/print-document.ts` there): the renderer's contract is the
// crate's, not ours, and the crate stays in major units (ADR-0400, «lo que queda fuera»). What
// ADR-0123 §4 asks is that the conversion lives in ONE named function at the boundary, scaled by
// the hub's currency (§7) — not a loose `/100` that would print a JPY invoice a hundred times
// too small.
import { fromMicro } from './quantity';

/** The row `invoice.get` returns — only what the paper needs. */
export interface PrintableInvoice {
  number: string;
  issuer_nif?: string;
  issuer_name?: string;
  customer_name?: string;
  base_amount: number;
  tax_amount: number;
  total_amount: number;
}

/** The row `invoice.lines` returns — only what the paper needs. */
export interface PrintableLine {
  description: string;
  /** Fixed-point integer, scale 10⁶ (ADR-0147). */
  quantity: number;
  total_amount: number;
}

export interface PrintDocumentItem {
  name: string;
  quantity: number;
  total: number;
}

/** What `escpos::render_document` reads for `DocumentType::Invoice` (major units). */
export interface PrintDocument extends Record<string, unknown> {
  business_name: string;
  vat_number?: string;
  receipt_id: string;
  customer_name?: string;
  items: PrintDocumentItem[];
  subtotal: number;
  tax_amount: number;
  total: number;
  qr_data?: string;
}

/**
 * Minor → major units at the boundary, scaled by the currency's decimals (EUR 2, JPY 0, KWD 3).
 * The ONLY place this module divides money, and only for a consumer whose contract is major units.
 */
export function toUnits(minor: number | undefined, decimals: number): number {
  const n = Number(minor ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** decimals;
}

export function invoiceToPrintDocument(
  invoice: PrintableInvoice,
  lines: PrintableLine[],
  decimals: number,
  fiscal: { qr?: string } = {},
): PrintDocument {
  return {
    business_name: invoice.issuer_name || '',
    vat_number: invoice.issuer_nif || undefined,
    receipt_id: invoice.number,
    customer_name: invoice.customer_name || undefined,
    items: lines.map((l) => ({
      name: l.description,
      quantity: fromMicro(Number(l.quantity) || 0),
      total: toUnits(l.total_amount, decimals),
    })),
    subtotal: toUnits(invoice.base_amount, decimals),
    tax_amount: toUnits(invoice.tax_amount, decimals),
    total: toUnits(invoice.total_amount, decimals),
    qr_data: fiscal.qr || undefined,
  };
}
