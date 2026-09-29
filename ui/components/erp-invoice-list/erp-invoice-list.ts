import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import '@erplora/outfitkit/ok-data-table';
import '@erplora/outfitkit/ok-invoice';
import '@erplora/outfitkit/ok-money';
import '@erplora/outfitkit/ok-qr';
import type { DataTableColumn, DataTableAction, InvoiceData, OkInvoiceLabels } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';
// What a person types or pastes into a money field, read the one way every module reads it (pm#521).
import { formatMoneyInput, normaliseMoneyInput, parseMoneyInput } from '@erplora/module-toolkit/money-input';
// Aduana de la escala de cantidades (ADR-0147): la UI habla lógico (0,5), el cable habla µ (500000).
import { QUANTITY_SCALE, parseQuantity, formatQuantity, fromMicro } from '../../lib/quantity';
import { lineTaxLabel } from '../../lib/line-tax';
import { currencySymbol } from '../../lib/currency-symbol';
import { ionTone, type IonTone } from '../../lib/ion-tone';
import { invoiceToPrintDocument, qrLegalTexts, reprintJobId, QR_TRIBUTARIO_HEADING, VERIFACTU_LEGEND } from '../../lib/print-document';

/** `<ok-invoice>` paints `qr_heading`/`qr_legend` since outfitkit#151/#158 (invoice#84); an
 *  older outfitkit ignores the keys. Widened here so the module builds against either. */
type InvoiceDocData = InvoiceData & { qr_legend?: string; qr_heading?: string };
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

/** The `errors` catalog of `locales/{en,es}.json`, resolved by the active language.
 *
 *  It is NOT reachable through `erplora().t()`: that helper splits the key on dots to walk the
 *  catalog, and the `errors` block is FLAT — the whole namespaced code is ONE key
 *  (`"invoice.line_amount_underflow"`), the shape `appointments`/`customers` already ship. */
function catalogError(code: string): string {
  for (const lang of [erplora().locale, 'en']) {
    const dict = (CATALOG[lang] as { errors?: Record<string, string> } | undefined)?.errors;
    const text = dict?.[code];
    if (typeof text === 'string' && text) return text;
  }
  return '';
}

/** A business refusal (hub#139) travels as a stable `code` plus the handler's English fallback
 *  sentence: paint the code's TRANSLATION and keep the sentence for codes the catalog has not
 *  learned yet — same as `appointments`/`customers`.
 *
 *  invoice#49: the refusal this form can actually provoke talks about µ-units and scale 10⁶.
 *  Untranslated, it reaches whoever issues the invoice as English jargon.
 *
 *  Only OUR codes: another module's (or the core's) is not in this catalog, and its own sentence
 *  beats anything this one could invent for it. */
function domainErrorText(e: unknown, fallbackKey: string): string {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : '';
  if (typeof code === 'string' && code.startsWith('invoice.')) {
    const text = catalogError(code);
    if (text) return text;
  }
  return message || erploraT(fallbackKey);
}

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
  /** ISO code of the hub currency (ADR-0059). Amounts are painted by `<ok-money>` (pm#289). */
  currency: string;
  /** Decimals of the hub currency (ADR-0123 §7): EUR 2, JPY 0, KWD 3. The printable documents
   *  carry integers in the minor unit and need this scale to cut them (ADR-0400). */
  currencyDecimals?: number;
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
  /** invoice#124: the number of the invoice this one rectifies (`invoice.get`, same hub). */
  rectifies_number?: string | null;
}

/** invoice#109 — what can still be done to an invoice, by its state. The row of the list and the card
 *  of the open invoice ask these SAME two questions, so they never offer different actions. */
type InvoiceState = Pick<Invoice, 'status' | 'invoice_type'>;
/** Only an issued invoice is waiting for its payment (the server refuses the rest: `invoice.cannot_mark_paid`). */
const canBeMarkedPaid = (inv: InvoiceState): boolean => inv.status === 'issued';
/** A rectifying invoice is not rectified again, and a cancelled one has already been rectified. */
const canBeRectified = (inv: InvoiceState): boolean =>
  !(inv.invoice_type ?? '').startsWith('R') && inv.status !== 'cancelled';

/** The slice of Ionic's `<ion-alert>` the «Mark as paid» confirmation drives (invoice#109). */
type IonicAlertElement = HTMLElement & {
  header: string;
  message: string;
  buttons: Array<{ text: string; role?: string; handler?: () => void }>;
  isOpen?: boolean;
  present?: () => Promise<void>;
};

interface InvoiceLine {
  id: string; line_number: number; description: string; quantity: number; unit_price: number;
  tax_rate: number; base_amount: number; tax_amount: number; total_amount: number;
  /** invoice#21: equivalence surcharge apart from `tax_rate` (main rate). NULL = legacy row whose
   *  `tax_rate` may still be the combined sum; painted as frozen (see `lib/line-tax.ts`). */
  surcharge_rate?: number | null;
  product_id: string | null;
}

interface SeriesRow { id: string; code: string; name: string; invoice_type: string; is_active: number; }

/**
 * Línea del formulario de alta (strings: vienen de ion-input).
 *
 * `uid` es la identidad de la línea EN PANTALLA, y existe para nombrar sus ganchos de QA
 * (`invoice-line-<uid>-…`, invoice#76). Por índice no vale: borrar la primera renumera todas las de
 * abajo, y el spec que rellenaba `…-0-…` pasaría a rellenar otra línea sin enterarse. No viaja al
 * cable — `create()` arma el payload campo a campo.
 */
interface DraftItem { uid: number; description: string; quantity: string; unit_price: string; tax_rate: string; }

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

/** invoice#128 — the rótulos of the printed document (`<ok-invoice .labels>`) from the module
 *  catalog, the same words the sales invoice prints. Without them OutfitKit paints its English
 *  defaults on a Spanish business's paper. The title names what the document IS: a rectificativa
 *  (R1–R5) says so, a simplified invoice (F2) too; F1/F3 are plain invoices. */
function invoiceLabels(invoiceType: string): OkInvoiceLabels {
  const title = invoiceType.startsWith('R') ? 'ui.docRectifyingInvoice'
    : invoiceType === 'F2' ? 'ui.docSimplifiedInvoice'
    : 'ui.docInvoice';
  return {
    empty: erploraT('ui.docEmptyInvoice'),
    invoice: erploraT(title),
    number: erploraT('ui.docNumber'),
    date: erploraT('ui.docDate'),
    dueDate: erploraT('ui.docDueDate'),
    billTo: erploraT('ui.docBillTo'),
    description: erploraT('ui.docDescription'),
    qty: erploraT('ui.docQty'),
    price: erploraT('ui.docPrice'),
    discount: erploraT('ui.docDiscount'),
    tax: erploraT('ui.docTax'),
    amount: erploraT('ui.docAmount'),
    noLines: erploraT('ui.docNoLines'),
    taxBase: erploraT('ui.docTaxBase'),
    discountTotal: erploraT('ui.docDiscountTotal'),
    total: erploraT('ui.docTotal'),
    paymentMethod: erploraT('ui.docPaymentMethod'),
  };
}

function statusLabel(code: string): string {
  const map: Record<string, string> = {
    draft: erploraT('ui.statusDraft'), issued: erploraT('ui.statusIssued'),
    paid: erploraT('ui.statusPaid'), cancelled: erploraT('ui.statusCancelled'),
  };
  return map[code] ?? code;
}

/** invoice#124 — the note a document carries, in the business language. A rectificativa stores
 *  no sentence (SQL cannot know the language, and this text is printed on the customer's paper):
 *  it is composed here from the original's number and the reason (`description`). Rectificativas
 *  issued before the fix stored «Rectifies {number}. Reason: {reason}» in English; that exact
 *  sentence is translated too. Any other note is the person's own text and goes out verbatim. */
function documentNote(d: InvoiceDetail): string {
  const notes = d.notes || '';
  const original = d.rectifies_invoice_id ? d.rectifies_number || '' : '';
  if (!original) return notes;
  const reason = (d.description || '').trim();
  const legacy = `Rectifies ${original}. Reason: ${d.description || ''}`;
  if (notes && notes !== legacy) return notes;
  return reason
    ? erploraT('ui.rectifiesNote', { number: original, reason })
    : erploraT('ui.rectifiesNoteNoReason', { number: original });
}

const TYPE_CODES = ['F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'];
/** invoice#86 — simplified invoices (F2 and its rectifying R5) are tickets: they identify no
 *  customer, so the thermal printer prints them as a `receipt`, the way sales prints its tickets. */
const SIMPLIFIED_TYPES = new Set(['F2', 'R5']);
const STATUS_CODES = ['draft', 'issued', 'paid', 'cancelled'];

// The tone of each status. Painted INLINE through `ionTone`, never through `color=` (pm#392): the
// table's chip lives inside `ok-data-table`'s shadow root, where Ionic's global `.ion-color-*` rule
// does not arrive.
const STATUS_COLOR: Record<string, IonTone> = {
  draft: 'medium', issued: 'primary', paid: 'success', cancelled: 'danger',
};

/** Scale of the hub currency for the papers (ADR-0400). An SDK that does not expose it is a
 *  two-decimal hub — the same default `<ok-invoice>` applies. */
const currencyDecimals = (): number => {
  const d = erplora().currencyDecimals;
  return typeof d === 'number' && Number.isFinite(d) ? d : 2;
};
/**
 * The PRICE typed on line `line` (1-based) → minor units of the hub currency, or the sentence that
 * says why it cannot be issued (pm#521). It used to be `Number()` + `majorToMinor()`: «1.250,50» —
 * verbatim what the invoice detail prints — was NaN and left «Issue invoice» grey with no reason,
 * and «1.250» was issued as 1,25 €. A price below zero is refused here with its own reason: the
 * command schema has `minimum: 0` (the server's own refusal is schema prose that names no line and
 * no way out) and money given back is a corrective invoice. Zero is an honest free line.
 */
function readLinePrice(typed: string, line: number): { ok: true; minor: number } | { ok: false; message: string } {
  const c = erplora();
  const d = currencyDecimals();
  const read = parseMoneyInput(typed, d, { currency: c.currency || undefined, locale: c.locale });
  if (read.ok && read.minor !== null) {
    if (read.minor < 0) return { ok: false, message: erploraT('ui.errLinePriceNegative', { line }) };
    return { ok: true, minor: read.minor };
  }
  if (!read.ok && read.code === 'ambiguous_amount') {
    // Both readings, in the hub's format, so the person can copy the one they meant back.
    return {
      ok: false,
      message: erploraT('ui.errAmbiguousAmount', {
        line,
        typed: typed.trim(),
        grouped: formatMoneyInput(read.readings.grouped, d, c.locale),
        decimal: formatMoneyInput(read.readings.decimal, d, c.locale),
      }),
    };
  }
  // Garbage — or nothing at all, which `itemsValid` already keeps away from «Issue invoice».
  return { ok: false, message: erploraT('ui.errNotAnAmount', { line }) };
}

/** The price field once the person leaves it: the hub format when readable, as typed when not. */
function normaliseLinePrice(typed: string): string {
  const c = erplora();
  return normaliseMoneyInput(typed, currencyDecimals(), c.locale, c.currency || undefined);
}
/** `step` of the line quantity: one unit of the 10⁶ quantity scale (ADR-0147), so the browser
 *  accepts «0.5» and refuses only what parseQuantity refuses — a 7th decimal (invoice#97). */
const QUANTITY_STEP = `0.${'0'.repeat(String(QUANTITY_SCALE).length - 2)}1`;
/** `step` of the line tax rate. A percentage is neither money nor quantity: no currency or 10⁶
 *  scale applies and the engine keeps it unscaled, so any decimal passes — IGIC 9.5, surcharge
 *  5.2, QST 9.975 (invoice#98). */
const TAX_RATE_STEP = 'any';

// Invoice amounts are INTEGERS in the minor unit in the DB and the JSON (ADR-0123). `<ok-money>`
// cuts them by string with the hub's scale — never a division (pm#289; before, `formatMoney`
// divided in a float and 23100 once painted as «23100,00 €» through `formatAmount`). `currency` is
// the invoice's own ISO code, else the hub's.
const money = (v: unknown, currency?: string) => html`<ok-money
  .value=${Number(v || 0)}
  .decimals=${currencyDecimals()}
  .currency=${currencySymbol(currency || erplora().currency, erplora().locale)}
  .locale=${erplora().locale || ''}
></ok-money>`;
/** La primera línea de un alta recién abierta. Congelado para que el QA lo pueda predecir. */
const FIRST_ITEM_UID = 1;

const emptyItem = (uid: number): DraftItem => ({ uid, description: '', quantity: '1', unit_price: '', tax_rate: '21' });

export class ErpInvoiceList extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color,#1c1b18); }
    /* La vista llena el alto: el data-table ocupa todo (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    /* invoice#14: every own control is a touch target (44px), like the ok-data-table actions.
       size="small" rendered ~27 px; Ionic md buttons default to 36 px. A finger needs 44×44
       (WCAG 2.5.5). Same rule cash_register and tables applied. */
    ion-button { min-height:44px; --min-height:44px; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    h3 { margin:0 0 .5rem; font-size:1rem; }
    .card { border:1px solid var(--ion-border-color,#e7e2d6); border-radius: var(--ok-radius-sm, 10px); padding:1rem; margin-bottom:1rem; background:var(--ion-card-background,#fffdf7); }
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
    .qr-heading { font-size:.8rem; font-weight:600; text-align:center; }
    .qr-legend { font-size:.8rem; font-weight:700; letter-spacing:.02em; text-align:center; }
    .qr-note { font-size:.72rem; color:var(--ion-color-medium,#8a8577); text-align:center; }
    /* pm#392 — the buttons paint from HERE, never from \`color=\`: Ionic resolves it through a GLOBAL
       \`.ion-color-*\` rule that does not reach inside this shadow root, so the solid «Issue
       rectifying» and «Mark as paid» came out with no fill and the outline/clear ones fell back to
       primary blue. Custom properties do inherit through the boundary, so the theme token applies. */
    ion-button.tone-danger:not([fill]) {
      --background: var(--ion-color-danger, #c5000f);
      --background-activated: var(--ion-color-danger-shade, #ad000d);
      --background-focused: var(--ion-color-danger-shade, #ad000d);
      --background-hover: var(--ion-color-danger-tint, #cb1a27);
      --color: var(--ion-color-danger-contrast, #fff);
    }
    ion-button.tone-success:not([fill]) {
      --background: var(--ion-color-success, #2dd55b);
      --background-activated: var(--ion-color-success-shade, #28bb50);
      --background-focused: var(--ion-color-success-shade, #28bb50);
      --background-hover: var(--ion-color-success-tint, #42d96b);
      --color: var(--ion-color-success-contrast, #000);
    }
    ion-button.tone-danger[fill] {
      --color: var(--ion-color-danger, #c5000f);
      --border-color: var(--ion-color-danger, #c5000f);
    }
    ion-button.tone-medium[fill] {
      --color: var(--ion-color-medium, #636469);
      --border-color: var(--ion-color-medium, #636469);
    }
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

  /** Generation of the detail opening (invoice#102): a reply is painted only if no newer opening
   *  or «Back» happened while it was in flight. */
  private detailSeq = 0;

  // ── alta manual (vive en el panel `create` de la tabla) ──
  @state() saving = false;

  @state() formError = '';

  @state() newCustomerName = '';

  @state() newCustomerTaxId = '';

  @state() newCustomerAddress = '';

  @state() newNotes = '';

  @state() newSeriesCode = 'FACT';

  @state() newItems: DraftItem[] = [emptyItem(FIRST_ITEM_UID)];

  /** Siguiente identidad de línea. Vuelve a 1 con el formulario, así un alta recién abierta empieza
   *  siempre por `invoice-line-1-…` y el QA puede predecir el nombre. */
  private nextItemUid = FIRST_ITEM_UID + 1;

  @state() seriesOptions: SeriesRow[] = [];

  // ── rectify (invoice#107: a dialog, never a card in the page flow) ──
  @state() rectifyTarget: Invoice | null = null;

  @state() rectifyReason = '';

  /** Drives the dialog's `isOpen`; the rest of the state is dropped on `ionModalDidDismiss`, so the
   *  dialog does not repaint as an empty form while it animates out. */
  @state() rectifyOpen = false;

  /** A refusal or an error of the rectification, painted INSIDE its dialog. */
  @state() rectifyError = '';

  /** The document cannot be rectified: the dialog only says why. */
  @state() rectifyBlocked = false;

  /** The rectifying invoice was issued: the dialog shows the result until the user closes it. */
  @state() rectifyDone = false;

  /** What a row action («Mark as paid» from the table) was refused: no panel is open then, so it goes on the page. */
  @state() actionError = '';

  /** What an action pressed in the OPEN invoice was refused: painted in its card, above that button (pm#513). */
  @state() detailActionError = '';

  @state() busy = false;

  private canAdd = true;

  private canRectify = true;

  private ctrl!: ListController<Invoice>;

  private unsub?: () => void;

  // Getter (no campo): se re-evalúa en cada render, así los textos cambian con el idioma activo
  // (ADR-0055). `connectedCallback` re-renderiza al recibir `erplora:locale-changed`.
  //
  // invoice#51 — ORDEN y ANCHO son contrato, no gusto: `ok-data-table` desborda POR DISEÑO
  // (`min-width: max-content`) y sin `width` cada pista mide TODO su contenido, así que un
  // nombre de cliente largo mandaba la tabla a 1794px y TOTAL (el importe, lo primero que se
  // mira en un facturador) quedaba tras el scroll a 1440. Ahora:
  //   · orden por importancia de negocio: number · customer · TOTAL · status · date · type
  //     (type la última = la primera en ceder; reactivable en el selector «Columnas»);
  //   · `width` acotado en TODAS (`minmax(min,max)`rem): un máximo fijo acota la contribución
  //     max-content de la pista y el texto largo corta con ellipsis — la suma de máximos + la
  //     columna de acciones (≈7rem) cabe en el pliegue medido a 1440 (clientWidth 1168px), y el
  //     borde derecho de TOTAL queda a 30rem del inicio, dentro del pliegue de 834 (medido en
  //     Chromium vía `erplora dev`: a 834 con sidebar de 240px el área útil es 562px y el borde
  //     de TOTAL cae en 496px; a 1440 la tabla entera cabe sin scroll). En 390 manda
  //     la vista de tarjetas, que ya pintaba el total.
  //     Lo fija `columns.contract.test.ts`; ok-data-table 0.1.44 no fija columnas de DATOS
  //     (solo acciones, outfitkit#67), de ahí que la fix sea de layout del módulo.
  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erploraT(k);
    return [
    { key: 'number', header: t('ui.colNumber'), sortable: true, filterable: true, filterType: 'text', width: 'minmax(9rem, 10rem)' },
    {
      key: 'customer_name',
      header: t('ui.colCustomer'),
      sortable: true,
      filterable: true,
      filterType: 'text',
      width: 'minmax(10rem, 12rem)',
      format: (r) => (r.customer_name as string) || '—',
    },
    { key: 'total_amount', header: t('ui.colTotal'), align: 'right', sortable: true, filterable: true, filterType: 'range', width: 'minmax(7rem, 8rem)', render: (r) => money(r.total_amount) },
    {
      key: 'status',
      header: t('ui.colStatus'),
      sortable: true,
      filterable: true,
      filterType: 'select',
      width: 'minmax(7rem, 9rem)',
      options: STATUS_CODES.map((value) => ({ value, label: statusLabel(value) })),
      render: (r) => html`<ion-badge style=${ionTone('solid', STATUS_COLOR[r.status as string] ?? 'medium')}>${statusLabel(r.status as string)}</ion-badge>`,
    },
    { key: 'issue_date', header: t('ui.colDate'), sortable: true, filterable: true, filterType: 'daterange', width: 'minmax(7.5rem, 9rem)' },
    {
      key: 'invoice_type',
      header: t('ui.colType'),
      sortable: true,
      filterable: true,
      filterType: 'select',
      width: 'minmax(6rem, 8rem)',
      options: TYPE_CODES.map((value) => ({ value, label: typeLabel(value) })),
      format: (r) => typeLabel(r.invoice_type as string),
    },
    ];
  }

  private get rowActions(): DataTableAction[] {
    const acts: DataTableAction[] = [{ id: 'view', label: erploraT('ui.actionView'), icon: 'eye-outline' }];
    // invoice#109: an action that does not apply to the row is not offered on it (`hidden`, not
    // `disabled`: a greyed-out tick reads as «something is blocked», hub#2014) — same rule as the card.
    const row = (r: Record<string, unknown>) => r as unknown as InvoiceState;
    if (this.canAdd) acts.push({ id: 'paid', label: erploraT('ui.actionMarkPaid'), icon: 'checkmark-circle-outline', color: 'success', hidden: (r) => !canBeMarkedPaid(row(r)) });
    if (this.canRectify) acts.push({ id: 'rectify', label: erploraT('ui.actionRectify'), icon: 'arrow-undo-outline', color: 'danger', hidden: (r) => !canBeRectified(row(r)) });
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
    // «Total» is an INTEGER in the minor unit painted as money of the hub, so the person types the
    // major unit («12»): the SDK scales each edge with the hub's currency decimals on every page it
    // asks for, and the state keeps what was typed (invoice#113, pm#498, pm#501).
    this.ctrl = createListController<Invoice>(erplora(), 'invoice.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'id',
      dir: 'asc',
      moneyFilters: ['total_amount'],
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

  // ── detail (invoice.get + invoice.lines) ──────────────────────────────────

  private async openDetail(id: string) {
    const seq = ++this.detailSeq;
    this.detailError = '';
    this.detailActionError = ''; // a refusal is about the invoice it was pressed on, not the next one
    try {
      const [inv, lines] = await Promise.all([
        erplora().query<InvoiceDetail[] | InvoiceDetail>('invoice.get', { invoice_id: id }),
        erplora().query<InvoiceLine[]>('invoice.lines', { invoice_id: id }),
      ]);
      // The last opening wins: a late reply of an earlier opening (header, lines, AEAT record, or
      // its own error) must never paint over another invoice — checked before the not-found branch
      // too, so a stale not-found does not paint an error under the newer invoice.
      if (seq !== this.detailSeq) return;
      const row = Array.isArray(inv) ? inv[0] : inv;
      if (!row) { this.detailError = erploraT('ui.errNotFound'); return; }
      this.detail = row;
      this.detailLines = Array.isArray(lines) ? lines : [];
      // VeriFactu record (AEAT status + CSV + QR) — best-effort: with no record or no permission
      // the invoice still shows, without the AEAT block.
      const aeat = await this.loadAeat(id);
      if (seq !== this.detailSeq) return;
      this.aeat = aeat;
    } catch (e) {
      if (seq !== this.detailSeq) return;
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

  private closeDetail() { this.detailSeq++; this.detail = null; this.detailLines = []; this.detailError = ''; this.resetRectify(); this.aeat = null; }

  // ── acciones (mark_paid / rectify) ────────────────────────────────────────

  /** `from` says where the button was: a row of the table (the refusal goes on the page) or the card
   *  of the open invoice (it goes next to the button, pm#513). */
  private async markPaid(inv: Invoice, from: 'row' | 'detail' = 'row') {
    const refuse = (text: string) => { if (from === 'detail') this.detailActionError = text; else this.actionError = text; };
    if (!canBeMarkedPaid(inv)) { refuse(erploraT('ui.errMarkPaidStatus')); return; }
    await this.confirmMarkPaid(inv, from);
  }

  /** invoice#109: «Mark as paid» records the payment with the current time and has no undo, so it asks
   *  first, like every invoicing back office (Stripe, Square, Odoo, QuickBooks). A GLOBAL Ionic overlay
   *  appended to `document.body` (kitchen#115, appointments#207): an inline `<ion-alert>` in this
   *  shadow root loses its styles when Ionic teleports it (hub#2162). */
  private async confirmMarkPaid(inv: Invoice, from: 'row' | 'detail') {
    const alert = document.createElement('ion-alert') as IonicAlertElement;
    alert.header = erploraT('ui.markPaidConfirmTitle', { number: inv.number });
    alert.message = erploraT('ui.markPaidConfirmMessage');
    alert.buttons = [
      { text: erploraT('ui.cancel'), role: 'cancel' },
      { text: erploraT('ui.actionMarkPaid'), role: 'confirm', handler: () => { void this.doMarkPaid(inv, from); } },
    ];
    alert.setAttribute('data-testid', 'invoice-mark-paid-confirm');
    // Ionic moves the teleported overlay back to its original parent right AFTER emitting
    // ionAlertDidDismiss: remove it on the next task or a hidden alert is left on every tap.
    alert.addEventListener('ionAlertDidDismiss', () => setTimeout(() => alert.remove(), 0), { once: true });
    document.body.appendChild(alert);
    try {
      if (typeof alert.present === 'function') await alert.present();
      else alert.isOpen = true;
    } catch {
      alert.remove();
      if (from === 'detail') this.detailActionError = erploraT('ui.errMarkPaid');
      else this.actionError = erploraT('ui.errMarkPaid');
    }
  }

  private async doMarkPaid(inv: Invoice, from: 'row' | 'detail') {
    const refuse = (text: string) => { if (from === 'detail') this.detailActionError = text; else this.actionError = text; };
    // Pressed again, from either place: an older refusal on the page or in the card is stale (staff#75).
    this.actionError = '';
    this.detailActionError = '';
    this.busy = true;
    try {
      await erplora().command('invoice.mark_paid', { invoice_id: inv.id });
      await this.ctrl.load();
      if (this.detail?.id === inv.id) await this.openDetail(inv.id);
    } catch (e) {
      // `invoice.cannot_mark_paid`: this screen was stale (paid or rectified meanwhile, elsewhere).
      // Say it in the person's language, and let the list catch up with what the server knows.
      if ((e as { code?: unknown } | null)?.code === 'invoice.cannot_mark_paid') {
        await this.ctrl.load();
        if (this.detail?.id === inv.id) await this.openDetail(inv.id);
      }
      refuse(domainErrorText(e, 'ui.errMarkPaid'));
    } finally {
      this.busy = false;
    }
  }

  /** invoice#107 — «Refund» opens the dialog wherever the page is scrolled: the reason, a refusal
   *  and the result are all read there, next to what the user just pressed. */
  private startRectify(inv: Invoice) {
    const refusal = inv.invoice_type?.startsWith('R') ? 'ui.errRectifyRectifying'
      : inv.status === 'cancelled' ? 'ui.errAlreadyCancelled'
      : '';
    this.rectifyTarget = inv;
    this.rectifyReason = '';
    this.rectifyDone = false;
    this.rectifyBlocked = !!refusal;
    this.rectifyError = refusal ? erploraT(refusal) : '';
    this.rectifyOpen = true;
  }

  private resetRectify() {
    this.rectifyOpen = false;
    this.rectifyTarget = null;
    this.rectifyReason = '';
    this.rectifyError = '';
    this.rectifyBlocked = false;
    this.rectifyDone = false;
  }

  private async confirmRectify() {
    const target = this.rectifyTarget;
    // One fiscal document per press: a second call while the first is in flight (`busy`), or after
    // it was issued (`rectifyDone`), must never reach the server.
    if (!target || this.busy || this.rectifyBlocked || this.rectifyDone || !this.rectifyReason.trim()) return;
    this.busy = true;
    this.rectifyError = '';
    try {
      // No date and no year (invoice#78): the server dates the document on the BUSINESS clock
      // (`:now` in `:timezone`). The browser's `toISOString()` is the UTC date and its
      // `getFullYear()` the device's year — two different clocks, neither of them the business's.
      await erplora().command('invoice.rectify', {
        original_id: target.id,
        reason: this.rectifyReason.trim(),
      });
    } catch (e) {
      // Dismissed while in flight and reopened for another invoice: this answer is not about it.
      if (this.rectifyTarget === target) this.rectifyError = domainErrorText(e, 'ui.errRectify');
      return;
    } finally {
      this.busy = false;
    }
    // Issued: the result stays on screen until closed, and the page behind it catches up.
    if (this.rectifyTarget === target) this.rectifyDone = true;
    await this.ctrl.load();
    if (this.detail?.id === target.id) await this.openDetail(target.id);
  }

  private onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const inv = ev.detail.row as unknown as Invoice;
    if (ev.detail.actionId === 'view') this.openDetail(inv.id);
    else if (ev.detail.actionId === 'paid') this.markPaid(inv);
    else if (ev.detail.actionId === 'rectify') this.startRectify(inv);
  }

  // ── alta manual (invoice.create) ──────────────────────────────────────────

  private addItem() {
    this.newItems = [...this.newItems, emptyItem(this.nextItemUid++)];
  }

  private resetItems() {
    this.nextItemUid = FIRST_ITEM_UID + 1;
    this.newItems = [emptyItem(FIRST_ITEM_UID)];
  }

  private setItem(i: number, key: keyof DraftItem, value: string) {
    this.newItems = this.newItems.map((it, j) => (j === i ? { ...it, [key]: value } : it));
  }

  private get itemsValid(): boolean {
    // La cantidad se valida con la aduana (ADR-0147): rechaza >6 decimales y basura, admite coma.
    return this.newItems.length > 0 && this.newItems.every(
      // The price only has to be there: what cannot be read is refused on «Issue» WITH its reason
      // (pm#521) — a grey button with no reason was what a pasted «1.250,50» used to get.
      (it) => it.description.trim() && (parseQuantity(it.quantity) ?? 0) > 0 && it.unit_price.trim() !== '',
    );
  }

  private async create(ev: Event) {
    ev.preventDefault();
    if (!this.itemsValid) return;
    this.saving = true;
    this.formError = '';
    this.actionError = ''; // issuing is the next thing the person did: an older row refusal is stale (staff#75)
    try {
      // Every price is read before anything is sent: one line that cannot be read issues nothing.
      const prices: number[] = [];
      for (const [i, it] of this.newItems.entries()) {
        const read = readLinePrice(it.unit_price, i + 1);
        if (!read.ok) throw new Error(read.message);
        prices.push(read.minor);
      }
      await erplora().command('invoice.create', {
        series_code: this.newSeriesCode || 'FACT',
        customer_name: this.newCustomerName.trim(),
        customer_tax_id: this.newCustomerTaxId.trim(),
        customer_address: this.newCustomerAddress.trim(),
        notes: this.newNotes.trim(),
        source_type: 'manual',
        // Contract boundary: the human types the price in the hub currency's MAJOR unit and
        // logical quantities; the wire carries MINOR units (ADR-0123) with the hub currency scale
        // — the same one that paints and prints the invoice (JPY 0, KWD 3; invoice#95) — and
        // quantities in 10⁶ fixed point (ADR-0147).
        items: this.newItems.map((it, i) => ({
          description: it.description.trim(),
          quantity: parseQuantity(it.quantity) ?? QUANTITY_SCALE,
          unit_price: prices[i],
          tax_rate: Number(it.tax_rate) || 0,
          product_id: null,
        })),
      });
      this.newCustomerName = ''; this.newCustomerTaxId = ''; this.newCustomerAddress = '';
      this.newNotes = ''; this.resetItems();
      this.dataTable()?.close(); // el panel de alta se cierra solo tras emitir
      await this.ctrl.load();
    } catch (e) {
      this.formError = domainErrorText(e, 'ui.errCreate');
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

  private aeatStatusColor(s?: string): IonTone {
    const map: Record<string, IonTone> = { accepted: 'success', pending: 'warning', rejected: 'danger', error: 'danger' };
    return (s && map[s]) || 'medium';
  }

  /** invoice#86 — a full invoice whose customer has no tax id cannot be printed on the thermal
   *  printer (ERPlora/hub#2005): the screen says so before anyone presses Print. */
  private missingCustomerTaxId(d: InvoiceDetail): boolean {
    return !SIMPLIFIED_TYPES.has(d.invoice_type) && !d.customer_tax_id?.trim();
  }

  /**
   * `tax_breakdown` → líneas de impuesto de `ok-invoice`. Entiende las DOS generaciones del
   * contrato (hub#292):
   *
   * - **array** — una entrada por clave fiscal completa (`tax`/`class`/`rate`/`base`/`quota`,
   *   más el recargo cuando lo hay). Es lo que se emite desde que la calificación dejó de ser
   *   literal, y permite que la factura impresa diga «Exento (art. 20)» en vez de «IVA 0 %»,
   *   que es lo que el cliente tiene que leer.
   * - **objeto** — clave = tipo, `{base, tax}`. Las facturas ya emitidas están encadenadas en la
   *   huella fiscal y se siguen imprimiendo como se imprimían.
   */
  private parseTaxes(d: InvoiceDetail): Array<{ label: string; rate?: number; base: number; amount: number }> {
    let parsed: unknown = null;
    try { parsed = d.tax_breakdown ? JSON.parse(d.tax_breakdown) : null; } catch { parsed = null; }

    const pct = (n: number) => (Number.isInteger(n) ? n.toFixed(0) : String(n));
    const out: Array<{ label: string; rate?: number; base: number; amount: number }> = [];

    if (Array.isArray(parsed)) {
      for (const e of parsed as Array<Record<string, unknown>>) {
        const rate = Number(e.rate ?? 0);
        const base = Number(e.base ?? 0);
        const kind = String(e.tax ?? 'vat').toUpperCase();
        const name = kind === 'VAT' ? 'IVA' : kind;
        const cls = String(e.class ?? 'subject');
        let label: string;
        if (cls === 'exempt') {
          const cause = String(e.exempt_reason ?? '');
          label = cause ? `Exento (${cause})` : 'Exento';
        } else if (cls === 'not_subject' || cls === 'not_subject_location') {
          label = 'No sujeto';
        } else if (cls === 'subject_reverse') {
          label = 'Inversión del sujeto pasivo';
        } else {
          label = `${name} ${pct(rate)}%`;
        }
        out.push({ label, rate: Number.isFinite(rate) ? rate : undefined, base, amount: Number(e.quota ?? 0) });
        // El recargo de equivalencia comparte base con el IVA: es su propia línea en el documento
        // (el cliente tiene que ver los dos importes) aunque en el registro fiscal vaya dentro.
        if (e.surcharge_rate != null) {
          const sr = Number(e.surcharge_rate);
          out.push({ label: `${erploraT('ui.taxSurchargeLong')} ${pct(sr)}%`, rate: sr, base, amount: Number(e.surcharge_quota ?? 0) });
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const [rate, v] of Object.entries(parsed as Record<string, { base?: number; tax?: number }>)) {
        const r = Number(rate);
        out.push({
          label: `IVA ${Number.isFinite(r) ? r.toFixed(0) : rate}%`,
          rate: Number.isFinite(r) ? r : undefined,
          base: Number(v?.base ?? 0),
          amount: Number(v?.tax ?? 0),
        });
      }
    }

    // Sin desglose (p.ej. rectificativa): una línea con base/impuesto de cabecera.
    return out.length ? out : [{ label: 'IVA', base: d.base_amount, amount: d.tax_amount }];
  }

  /** Factura → contrato ok-invoice (layout PDF/print) con el QR de VeriFactu.
   *
   *  invoice#66 / ADR-0400: every amount is an INTEGER in the minor unit, exactly as the row
   *  carries it (`d.total_amount`, `l.unit_price`…), plus `decimals` so OutfitKit cuts the text
   *  by string. The module never divides: with the previous contract (units, `toFixed(2)`) a
   *  48,00 € invoice printed «4800.00 EUR». */
  private invoiceDocData(): InvoiceDocData {
    const d = this.detail!;
    const qr = this.aeat?.qr || '';
    const csv = this.aeat?.csv || '';
    return {
      issuer: { name: d.issuer_name || '—', tax_id: d.issuer_nif || undefined },
      customer: { name: d.customer_name || '—', tax_id: d.customer_tax_id || undefined, address: d.customer_address || undefined },
      number: d.number,
      issue_date: d.issue_date,
      lines: this.detailLines.map((l) => ({ description: l.description, qty: fromMicro(Number(l.quantity) || 0), unit_price: l.unit_price, tax_rate: l.tax_rate, total: l.total_amount })),
      subtotal: d.base_amount,
      taxes: this.parseTaxes(d),
      tax_total: d.tax_amount,
      total: d.total_amount,
      decimals: currencyDecimals(),
      currency: d.currency || erplora().currency,
      qr: qr || undefined,
      qr_note: csv ? `CSV: ${csv}` : (qr ? erploraT('ui.qrValidateNote') : undefined),
      ...qrLegalTexts(qr),
      footer: documentNote(d) || undefined,
    };
  }

  private renderAeatCard() {
    const a = this.aeat;
    if (!a) return nothing;
    return html`<div class="card aeat-card screen-only" data-testid="invoice-aeat">
      <div class="aeat-head">
        <h3>${erploraT('ui.aeatTitle')}</h3>
        <ion-badge data-testid="invoice-aeat-status" style=${ionTone('solid', this.aeatStatusColor(a.status))}>${this.aeatStatusLabel(a.status) || '—'}</ion-badge>
      </div>
      ${a.csv ? html`<div class="kv"><span class="k">${erploraT('ui.aeatCsv')}</span><code data-testid="invoice-aeat-csv">${a.csv}</code></div>` : nothing}
      ${a.qr
        ? html`<div class="qr-wrap">
            <span class="qr-heading" data-testid="invoice-aeat-qr-heading">${QR_TRIBUTARIO_HEADING}</span>
            <ok-qr value=${a.qr} size="120" ec="M"></ok-qr>
            <span class="qr-legend" data-testid="invoice-aeat-qr-legend">${VERIFACTU_LEGEND}</span>
            <span class="qr-note">${erploraT('ui.qrValidateNote')}</span>
            <a class="link" href=${a.qr} target="_blank" rel="noopener noreferrer">${erploraT('ui.aeatValidateLink')}</a>
          </div>`
        : html`<p class="muted">${erploraT('ui.aeatNoRecord')}</p>`}
    </div>`;
  }

  /** The rectify dialog. `ion-modal` reparents itself to <body> when it presents, out of this
   *  shadow root: inside it only Ionic classes and INLINE tones paint (no shadow CSS, and `color=`
   *  is banned in modules, pm#392). Its body exists only while a rectification is in course, and
   *  stays until `ionModalDidDismiss` so the dialog does not go blank while it animates out. */
  private renderRectifyDialog() {
    const t = this.rectifyTarget;
    return html`<ion-modal data-testid="invoice-rectify" .isOpen=${this.rectifyOpen} @ionModalDidDismiss=${() => this.resetRectify()}>
      ${t
        ? html`<ion-header class="ion-no-border"><ion-toolbar><ion-title>${erploraT('ui.rectifyTitle', { number: t.number })}</ion-title></ion-toolbar></ion-header>
          <ion-content class="ion-padding">${this.renderRectifyBody(t.number)}</ion-content>`
        : nothing}
    </ion-modal>`;
  }

  private renderRectifyBody(number: string) {
    const close = html`<ion-button data-testid="invoice-rectify-close" class="ion-margin-top" expand="block" fill="outline" style=${ionTone('outline', 'medium')} @click=${() => (this.rectifyOpen = false)}>${erploraT('ui.close')}</ion-button>`;
    if (this.rectifyDone) {
      return html`<ok-inline-feedback data-testid="invoice-rectify-done" tone="success" icon="checkmark-circle-outline">${erploraT('ui.rectifyDone', { number })}</ok-inline-feedback>${close}`;
    }
    if (this.rectifyBlocked) {
      return html`<ok-inline-feedback data-testid="invoice-rectify-error" tone="warning" icon="alert-circle-outline">${this.rectifyError}</ok-inline-feedback>${close}`;
    }
    return html`<p>${erploraT('ui.rectifyNote')}</p>
      <ion-textarea data-testid="invoice-rectify-reason" fill="outline" mode="md" label-placement="floating" label=${erploraT('ui.lblReason')} placeholder=${erploraT('ui.rectifyReasonPlaceholder')} auto-grow .value=${this.rectifyReason} @ionInput=${(e: CustomEvent<{ value?: string | null }>) => (this.rectifyReason = e.detail?.value ?? '')}></ion-textarea>
      ${this.rectifyError ? html`<ok-inline-feedback class="ion-margin-top" data-testid="invoice-rectify-error" tone="danger" icon="alert-circle-outline">${this.rectifyError}</ok-inline-feedback>` : nothing}
      <ion-button data-testid="invoice-rectify-submit" class="ion-margin-top" expand="block" style=${ionTone('solid', 'danger')} ?disabled=${this.busy || !this.rectifyReason.trim()} @click=${() => this.confirmRectify()}>${this.busy ? erploraT('ui.rectifying') : erploraT('ui.issueRectifying')}</ion-button>
      <ion-button data-testid="invoice-rectify-cancel" expand="block" fill="outline" style=${ionTone('outline', 'medium')} ?disabled=${this.busy} @click=${() => (this.rectifyOpen = false)}>${erploraT('ui.cancel')}</ion-button>`;
  }

  /**
   * Prints through the shell's single print gate (`sdk.print`, ADR-0196): the shell routes to a
   * Bridge printer with the `receipt` role when one exists and falls back to the browser dialog
   * otherwise — a direct `window.print()` ignored the shell (and any physical printer).
   * `window.print()` stays only as the last resort when the SDK is not initialized (dev preview);
   * there the `.print-only` block still makes the browser print just the document. This module has
   * no standalone-HTML builder for its document (it is the live `<ok-invoice>`), so the isolated
   * iframe rung of the sales cascade does not apply here.
   *
   * invoice#88 — the result is read, as the sales viewer does (sales#349): a printer or the queue
   * took it, or the A4 dialog opened → silence (the paper is the answer); queued with no printer
   * set up to drain it → a warning that it waits for one; anything else → an error with the reason.
   */
  private async printDetail(): Promise<void> {
    const d = this.detail;
    if (!d) return;
    const sdk = (globalThis as { erplora?: {
      print?: (r: Record<string, unknown>) => Promise<{ via?: string; error?: string; awaitingHost?: boolean } | undefined>;
      notify?: (n: { type: 'error' | 'warning'; message: string }) => void;
    } }).erplora;
    if (!sdk?.print) {
      window.print();
      return;
    }
    let res: { via?: string; error?: string; awaitingHost?: boolean } | undefined;
    try {
      res = await sdk.print({
        role: 'receipt',
        // invoice#86 — a full invoice goes as `invoice`, which the thermal renderer refuses without
        // the customer's tax id and the VAT per rate (ERPlora/hub#2005); a simplified one is a ticket.
        documentType: SIMPLIFIED_TYPES.has(d.invoice_type) ? 'receipt' : 'invoice',
        format: 'a4',
        // The thermal renderer reads ANOTHER shape, in major units (`lib/print-document.ts`):
        // the ok-invoice object is for the A4 path only. The VAT rows are the ones the A4 paints.
        // invoice#128 — the roll carries the same note as the sheet's foot: a rectificativa names
        // the invoice it rectifies.
        data: invoiceToPrintDocument(d, this.detailLines, currencyDecimals(), { qr: this.aeat?.qr || undefined, note: documentNote(d) }, this.parseTaxes(d)),
        // invoice#90 — unique PER ATTEMPT (as sales#92): the queue deduplicates by job id and
        // reports the duplicate as queued, so a fixed key swallowed every copy after the first.
        jobId: reprintJobId(d.id),
      });
    } catch (e) {
      res = { via: 'none', error: e instanceof Error ? e.message : String(e) };
    }
    if (res?.via === 'queue' && res.awaitingHost) {
      sdk.notify?.({ type: 'warning', message: erploraT('ui.printWaitingForPrinter', { number: d.number }) });
      return;
    }
    if (res?.via === 'bridge' || res?.via === 'queue' || res?.via === 'browser') return;
    sdk.notify?.({ type: 'error', message: res?.error ? `${erploraT('ui.printFailed')}: ${res.error}` : erploraT('ui.printFailed') });
  }

  private renderDetail() {
    const d = this.detail!;
    return html`<div data-testid="invoice-detail">
      <header class="screen-only">
        <h2>${erploraT('ui.detailTitle', { number: d.number })}</h2>
        <ion-badge data-testid="invoice-detail-status" style=${ionTone('solid', STATUS_COLOR[d.status] ?? 'medium')}>${statusLabel(d.status)}</ion-badge>
        <ion-button class="print" data-testid="invoice-detail-print" @click=${() => void this.printDetail()}>
          <ion-icon slot="start" name="print-outline"></ion-icon> ${erploraT('ui.actionPrint')}
        </ion-button>
        <ion-button data-testid="invoice-detail-back" fill="outline" class="tone-medium" @click=${() => this.closeDetail()}>← ${erploraT('ui.back')}</ion-button>
      </header>
      ${this.missingCustomerTaxId(d)
        ? html`<ok-inline-feedback class="screen-only" tone="warning" icon="alert-circle-outline" data-testid="invoice-missing-tax-id">${erploraT('ui.invoiceMissingCustomerTaxId')}</ok-inline-feedback>`
        : nothing}
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
          ${documentNote(d) ? html`<div><dt>${erploraT('ui.fieldNotes')}</dt><dd data-testid="invoice-detail-notes">${documentNote(d)}</dd></div>` : nothing}
        </dl>
        ${this.detailLines.length ? html`<table class="lines" data-testid="invoice-detail-lines">
          <thead><tr><th>#</th><th>${erploraT('ui.lineDescription')}</th><th>${erploraT('ui.lineQty')}</th><th>${erploraT('ui.linePrice')}</th><th>${erploraT('ui.lineTaxPct')}</th><th>${erploraT('ui.lineBase')}</th><th>${erploraT('ui.lineTax')}</th><th>${erploraT('ui.lineTotal')}</th></tr></thead>
          <tbody>${this.detailLines.map((l) => html`<tr>
            <td>${l.line_number}</td><td>${l.description}</td><td>${formatQuantity(Number(l.quantity) || 0)}</td>
            <td>${money(l.unit_price, d.currency)}</td><td>${lineTaxLabel(l, erploraT)}</td>
            <td>${money(l.base_amount, d.currency)}</td><td>${money(l.tax_amount, d.currency)}</td><td>${money(l.total_amount, d.currency)}</td>
          </tr>`)}</tbody>
        </table>` : html`<p data-testid="invoice-detail-no-lines">${erploraT('ui.noLines')}</p>`}
        <div class="totals">
          <span data-testid="invoice-detail-base">${erploraT('ui.totalBase')}: ${money(d.base_amount, d.currency)}</span>
          <span data-testid="invoice-detail-taxes">${erploraT('ui.totalTaxes')}: ${money(d.tax_amount, d.currency)}</span>
          <span data-testid="invoice-detail-total">${erploraT('ui.totalTotal')}: ${money(d.total_amount, d.currency)}</span>
        </div>
        <!-- pm#513: the refusal sits above the button that was pressed — at the top of the detail it
             was scrolled out of a phone's screen. -->
        ${this.detailActionError ? html`<ok-inline-feedback data-testid="invoice-detail-error" tone="danger" icon="alert-circle-outline">${this.detailActionError}</ok-inline-feedback>` : nothing}
        <div class="row-actions">
          ${this.canAdd && canBeMarkedPaid(d) ? html`<ion-button data-testid="invoice-detail-mark-paid" class="tone-success" ?disabled=${this.busy} @click=${() => this.markPaid(d, 'detail')}>${erploraT('ui.actionMarkPaid')}</ion-button>` : nothing}
          ${this.canRectify && canBeRectified(d) ? html`<ion-button data-testid="invoice-detail-rectify" fill="outline" class="tone-danger" ?disabled=${this.busy} @click=${() => this.startRectify(d)}>${erploraT('ui.actionRectify')}</ion-button>` : nothing}
        </div>
      </div>
      <!-- Documento imprimible (solo al imprimir / Guardar como PDF): layout factura con QR VeriFactu. -->
      <div class="print-only"><ok-invoice .invoice=${this.invoiceDocData()} .labels=${invoiceLabels(d.invoice_type ?? '')}></ok-invoice></div>
    </div>`;
  }

  // Alta manual: se proyecta SIEMPRE en el panel `create` de la tabla (aunque esté cerrado); si solo
  // se pintara al abrir, el «+» de la barra —que lo despliega la propia tabla— saldría vacío.
  private renderCreateForm() {
    return html`<form slot="create" data-testid="invoice-create-form" @submit=${(e: Event) => this.create(e)}>
        <div class="form">
          <ion-select data-testid="invoice-create-series" fill="outline" label-placement="floating" label=${erploraT('ui.fieldSeries')} interface="popover" .value=${this.newSeriesCode} @ionChange=${(e: any) => (this.newSeriesCode = e.target.value)}>
            ${this.seriesOptions.length
              ? this.seriesOptions.map((sr) => html`<ion-select-option .value=${sr.code}>${sr.code} — ${sr.name || typeLabel(sr.invoice_type)}</ion-select-option>`)
              : html`<ion-select-option value="FACT">FACT — ${typeLabel('F1')} (F1)</ion-select-option><ion-select-option value="TICKET">TICKET — ${typeLabel('F2')} (F2)</ion-select-option>`}
          </ion-select>
          <ion-input data-testid="invoice-create-customer" fill="outline" label-placement="floating" label=${erploraT('ui.fieldCustomer')} .value=${this.newCustomerName} @ionInput=${(e: any) => (this.newCustomerName = e.target.value)}></ion-input>
          <ion-input data-testid="invoice-create-customer-tax-id" fill="outline" label-placement="floating" label=${erploraT('ui.fieldCustomerTaxId')} placeholder=${erploraT('ui.placeholderTaxId')} .value=${this.newCustomerTaxId} @ionInput=${(e: any) => (this.newCustomerTaxId = e.target.value)}></ion-input>
          <ion-input data-testid="invoice-create-address" fill="outline" label-placement="floating" label=${erploraT('ui.fieldAddress')} .value=${this.newCustomerAddress} @ionInput=${(e: any) => (this.newCustomerAddress = e.target.value)}></ion-input>
          <ion-input data-testid="invoice-create-notes" fill="outline" label-placement="floating" label=${erploraT('ui.fieldNotes')} .value=${this.newNotes} @ionInput=${(e: any) => (this.newNotes = e.target.value)}></ion-input>
        </div>
        ${this.newItems.map((it, i) => html`<div class="item-row">
          <ion-input data-testid="invoice-line-${it.uid}-description" class="desc" fill="outline" label-placement="floating" label=${erploraT('ui.lineDescription')} .value=${it.description} @ionInput=${(e: any) => this.setItem(i, 'description', e.target.value)}></ion-input>
          <ion-input data-testid="invoice-line-${it.uid}-quantity" class="num" fill="outline" label-placement="floating" label=${erploraT('ui.lineQty')} type="number" step=${QUANTITY_STEP} .value=${it.quantity} @ionInput=${(e: any) => this.setItem(i, 'quantity', e.target.value)}></ion-input>
          <ion-input data-testid="invoice-line-${it.uid}-price" class="num" fill="outline" label-placement="floating" label=${erploraT('ui.linePrice')} type="text" inputmode="decimal" .value=${it.unit_price} @ionInput=${(e: any) => this.setItem(i, 'unit_price', e.target.value)} @ionBlur=${() => this.setItem(i, 'unit_price', normaliseLinePrice(this.newItems[i]?.unit_price ?? ''))}></ion-input>
          <ion-input data-testid="invoice-line-${it.uid}-tax-rate" class="num" fill="outline" label-placement="floating" label=${erploraT('ui.lineTaxPct')} type="number" step=${TAX_RATE_STEP} .value=${it.tax_rate} @ionInput=${(e: any) => this.setItem(i, 'tax_rate', e.target.value)}></ion-input>
          ${this.newItems.length > 1 ? html`<ion-button data-testid="invoice-line-${it.uid}-remove" fill="clear" class="tone-danger" aria-label=${erploraT('ui.removeLine')} @click=${() => (this.newItems = this.newItems.filter((_, j) => j !== i))}><ion-icon slot="icon-only" name="close-outline"></ion-icon></ion-button>` : nothing}
        </div>`)}
        <!-- pm#513: the refusal sits above «Issue invoice» — under the buttons it was painted below
             the bottom edge of the sheet on a phone. -->
        ${this.formError ? html`<ok-inline-feedback data-testid="invoice-create-error" tone="danger" icon="alert-circle-outline">${this.formError}</ok-inline-feedback>` : nothing}
        <div class="row-actions">
          <ion-button data-testid="invoice-create-add-line" fill="outline" @click=${() => this.addItem()}>${erploraT('ui.addLine')}</ion-button>
          <ion-button data-testid="invoice-create-submit" type="submit" ?disabled=${this.saving || !this.itemsValid}>${this.saving ? erploraT('ui.issuing') : erploraT('ui.issueInvoice')}</ion-button>
          <ion-button data-testid="invoice-create-cancel" fill="clear" class="tone-medium" @click=${() => this.dataTable()?.close()}>${erploraT('ui.cancel')}</ion-button>
        </div>
      </form>`;
  }

  /** pm#513: a refusal appears above the button that was pressed — on a phone that can still leave it
   *  off the screen. Bring it into view when it appears, not again on every keystroke or repaint. */
  updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('formError') && this.formError) void this.revealRefusal('[data-testid="invoice-create-error"]');
    if (changed.has('detailActionError') && this.detailActionError) void this.revealRefusal('[data-testid="invoice-detail-error"]');
  }

  /** ok-inline-feedback lays itself out in its own update: scrolled to before it, the box is empty. */
  private async revealRefusal(selector: string): Promise<void> {
    const banner = this.renderRoot.querySelector(selector) as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
    await banner?.updateComplete;
    banner?.scrollIntoView?.({ block: 'center' });
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  // El alta manual ya no tiene botón propio: es el «+» de la barra de la tabla (`addable`).
  render() {
    // The dialog sits OUTSIDE the detail/list switch: a presented `ion-modal` lives in <body>, and
    // one dropped with the template it was painted in would stay open there, orphaned.
    return html`${this.detail ? this.renderDetail() : this.renderList()}${this.renderRectifyDialog()}`;
  }

  private renderList() {
    return html`<div class="page">
        ${this.actionError ? html`<ok-inline-feedback data-testid="invoice-action-error" tone="danger" icon="alert-circle-outline">${this.actionError}</ok-inline-feedback>` : nothing}
        ${this.detailError ? html`<ok-inline-feedback data-testid="invoice-detail-load-error" tone="danger" icon="alert-circle-outline">${this.detailError}</ok-inline-feedback>` : nothing}
        ${this.ctrl?.error ? html`<ok-inline-feedback data-testid="invoice-list-error" tone="danger" icon="alert-circle-outline">${this.ctrl.error}</ok-inline-feedback>` : nothing}
        <!-- The «View» button is not the only door: rowClickable makes the whole row open the
             same detail (outfitkit#67 — the actions column can be off-screen at 1440 px). -->
        <ok-data-table testid="invoice-table" .serverSide=${true} .fill=${true} .addable=${this.canAdd} .columns=${this.columns} .views=${true} .cardTitle=${(r: Record<string, unknown>) => String(r.number ?? '—')} .cardIcon=${() => 'document-text-outline'} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${erploraT('ui.searchPlaceholder')} .actions=${this.rowActions} .rowClickable=${true} .emptyMessage=${this.ctrl?.loading ? erploraT('ui.loading') : erploraT('ui.empty')} @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)} @rowClick=${(e: CustomEvent<{ row: Record<string, unknown> }>) => this.openDetail(String(e.detail.row.id))} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}>
          ${this.canAdd ? this.renderCreateForm() : nothing}
        </ok-data-table>
      </div>`;
  }
}

define('erp-invoice-list', ErpInvoiceList);
