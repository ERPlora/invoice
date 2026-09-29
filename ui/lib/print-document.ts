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
  /** VeriFactu type (F1–F3, R1–R5): a full rectificativa (R1–R4) is titled as such (invoice#131). */
  invoice_type?: string;
  issuer_nif?: string;
  issuer_name?: string;
  customer_name?: string;
  customer_tax_id?: string;
  customer_address?: string;
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

/** One VAT row as the A4 prints it (`erp-invoice-list` `parseTaxes`): amounts in the MINOR unit. */
export interface PrintableTax {
  label: string;
  rate?: number;
  base: number;
  amount: number;
}

/** One row of a full invoice's VAT breakdown, as `escpos::render_tax_breakdown` reads it. */
export interface PrintTaxRow {
  rate: number;
  base: number;
  tax: number;
  label?: string;
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
  /** invoice#84 — «VERI*FACTU», printed right under `qr_data`. Present exactly when the QR is. */
  qr_legend?: string;
  /** invoice#84 — «QR tributario:», printed right above `qr_data`. Present exactly when the QR is. */
  qr_heading?: string;
  /** invoice#86 — the customer's tax id, printed under their name. Required by the renderer for a
   *  full invoice (ERPlora/hub#2005). */
  customer_tax_id?: string;
  /** invoice#86 — optional, printed under the customer's tax id. */
  customer_address?: string;
  /** invoice#86 — the VAT per rate, required by the renderer for a full invoice: `rate` in percent,
   *  `base`/`tax` in the unit of `total`, `label` naming the row. */
  tax_breakdown?: PrintTaxRow[];
  /** invoice#128 — the note of the document (a rectificativa names the invoice it rectifies),
   *  printed at the foot of the roll: the one free text the renderer prints on both papers. */
  receipt_footer?: string;
  /** invoice#131 — only an explicit `true` titles the roll «FACTURA RECTIFICATIVA» (hub#2381). */
  rectifying?: true;
}

/** The full rectificativas. R5 (simplified) prints as a `receipt`, which carries no title. */
const FULL_RECTIFYING_TYPES = new Set(['R1', 'R2', 'R3', 'R4']);

/**
 * invoice#84 — the legal texts of the VeriFactu QR, the same pair sales#327/#339 put on the POS
 * ticket and invoice: «VERI*FACTU» right under the QR (RD 1619/2012 art. 6.5.b and 7.5; Orden
 * HAC/1177/2024 art. 20.1.b) and «QR tributario:» right above it (AEAT QR spec v0.5.0 §3). A
 * system that sends every record to the AEAT carries the legend on EVERY fiscal QR. Both are
 * literal AEAT text, identical in every language, so they are NOT i18n catalog keys.
 */
export const VERIFACTU_LEGEND = 'VERI*FACTU';
export const QR_TRIBUTARIO_HEADING = 'QR tributario:';

/** The legal texts that travel with a fiscal QR — and nothing without one. */
export function qrLegalTexts(qr: string | undefined): { qr_heading?: string; qr_legend?: string } {
  return qr ? { qr_heading: QR_TRIBUTARIO_HEADING, qr_legend: VERIFACTU_LEGEND } : {};
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

/**
 * invoice#86 — the renderer prints a `documentType: 'invoice'` as a FULL invoice on the 80 mm roll
 * and REFUSES one without the customer's tax id or the VAT per rate (ERPlora/hub#2005,
 * `escpos::check_full_invoice`). Same shape sales#350 sends. `taxes` are the rows the A4 paints, so
 * the roll and the sheet name the same rates. A missing tax id is left missing, never sent blank:
 * the hub then fails the job naming the field, and the viewer warns before printing. A hub that
 * predates hub#2005 ignores the extra keys.
 */
export function invoiceToPrintDocument(
  invoice: PrintableInvoice,
  lines: PrintableLine[],
  decimals: number,
  fiscal: { qr?: string; note?: string } = {},
  taxes: PrintableTax[] = [],
): PrintDocument {
  const taxId = invoice.customer_tax_id?.trim();
  const address = invoice.customer_address?.trim();
  const note = fiscal.note?.trim();
  return {
    business_name: invoice.issuer_name || '',
    vat_number: invoice.issuer_nif || undefined,
    receipt_id: invoice.number,
    customer_name: invoice.customer_name || undefined,
    ...(taxId ? { customer_tax_id: taxId } : {}),
    ...(address ? { customer_address: address } : {}),
    items: lines.map((l) => ({
      name: l.description,
      quantity: fromMicro(Number(l.quantity) || 0),
      total: toUnits(l.total_amount, decimals),
    })),
    subtotal: toUnits(invoice.base_amount, decimals),
    tax_amount: toUnits(invoice.tax_amount, decimals),
    total: toUnits(invoice.total_amount, decimals),
    tax_breakdown: taxes.map((row) => ({
      // A row with no numeric rate (exempt, not subject) keeps a numeric `rate`: the renderer
      // prints `label` instead of the rate.
      rate: Number.isFinite(row.rate) ? Number(row.rate) : 0,
      base: toUnits(row.base, decimals),
      tax: toUnits(row.amount, decimals),
      ...(row.label ? { label: row.label } : {}),
    })),
    qr_data: fiscal.qr || undefined,
    ...qrLegalTexts(fiscal.qr),
    ...(note ? { receipt_footer: note } : {}),
    ...(FULL_RECTIFYING_TYPES.has(invoice.invoice_type ?? '') ? { rectifying: true as const } : {}),
  };
}

/** Sequence so two attempts inside the same millisecond still get different keys. */
let reprintSeq = 0;

/**
 * Idempotency key for printing an invoice (invoice#90) — the same fix as the sales viewer
 * (sales#92, `reprintJobId`).
 *
 * The print queue is idempotent by `(hub_id, job_id)` and reports a duplicate as queued, so a
 * fixed `invoice-<id>` key let the first copy out and swallowed every later one with no paper and
 * no warning. An invoice is IMMUTABLE (fiscal record), so a content fingerprint would be constant
 * too. Pressing Print is an explicit request for ANOTHER copy: each attempt is a new job —
 * `invoice-<id>-<attempt>`, still correlatable with the invoice it belongs to.
 */
export function reprintJobId(invoiceId: string | undefined): string | undefined {
  if (!invoiceId) return undefined;
  reprintSeq += 1;
  return `invoice-${invoiceId}-${Date.now().toString(36)}-${reprintSeq}`;
}
