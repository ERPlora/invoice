// @vitest-environment happy-dom

// invoice#84 — the invoice opened from the Invoices list showed the VeriFactu QR WITHOUT the
// legal texts that sales#327/#339 put on the POS ticket and invoice: «VERI*FACTU» right under the
// QR (RD 1619/2012 art. 6.5.b and 7.5; Orden HAC/1177/2024 art. 20.1.b) and «QR tributario:»
// right above it (AEAT QR spec v0.5.0 §3). Both are literal AEAT text — the same in every
// language, so they are not catalog keys — and travel ONLY with a fiscal QR.
//
// Three surfaces carry the QR here: the on-screen AEAT card, the print-only `<ok-invoice>` (A4)
// and the thermal job (`invoiceToPrintDocument`, read by the hub's ESC/POS renderer).
import { beforeEach, describe, expect, it } from 'vitest';
import { invoiceToPrintDocument } from '../../lib/print-document';

const QR = 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B00000000&numserie=FACT-0001&fecha=25-08-2026&importe=48.00';

const DETAIL = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-0001', issue_date: '2026-08-25',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 4000, tax_amount: 800,
  total_amount: 4800, status: 'issued', source_type: 'manual',
  issuer_nif: 'B00000000', issuer_name: 'Emisora SL', customer_address: '',
  description: '', tax_breakdown: '', currency: 'EUR', source_id: null,
  rectifies_invoice_id: null, paid_at: null, notes: '',
};
const LINES = [{ id: 'li1', line_number: 1, description: 'Corte', quantity: 1_000_000, unit_price: 4000, tax_rate: 20, base_amount: 4000, tax_amount: 800, total_amount: 4800 }];

type Aeat = { status?: string; csv?: string; qr?: string; record_type?: string } | null;
type DocProp = { qr?: string; qr_note?: string; qr_legend?: string; qr_heading?: string };

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = 'es';
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryOptional: async () => undefined,
    queryPage: async () => ({ rows: [DETAIL], total: 1 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_c: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

async function mountDetail(aeat: Aeat): Promise<HTMLElement & { shadowRoot: ShadowRoot }> {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list');
  document.body.appendChild(el);
  const wc = el as unknown as { detail: unknown; detailLines: unknown[]; aeat: Aeat; updateComplete: Promise<unknown> };
  await wc.updateComplete;
  wc.detail = DETAIL;
  wc.detailLines = LINES;
  wc.aeat = aeat;
  await wc.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await wc.updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

function docProp(el: HTMLElement & { shadowRoot: ShadowRoot }): DocProp {
  const doc = el.shadowRoot.querySelector('ok-invoice') as unknown as { invoice?: DocProp } | null;
  expect(doc, 'the print-only <ok-invoice> is rendered').toBeTruthy();
  return doc!.invoice!;
}

describe('the invoice viewer carries the VeriFactu legal texts with its QR (invoice#84)', () => {
  it('<ok-invoice>: «VERI*FACTU» under the QR and «QR tributario:» above it; the CSV note stays', async () => {
    const inv = docProp(await mountDetail({ status: 'accepted', csv: 'A-XYZ', qr: QR }));
    expect(inv.qr).toBe(QR);
    expect(inv.qr_legend).toBe('VERI*FACTU');
    expect(inv.qr_heading).toBe('QR tributario:');
    expect(inv.qr_note, 'the legend is its own key, never folded into the note').toBe('CSV: A-XYZ');
  });

  it('<ok-invoice>: no QR, no legal texts (a legend without a QR would claim a record that does not exist)', async () => {
    for (const aeat of [null, { status: 'pending', csv: '', qr: '' }] as Aeat[]) {
      const inv = docProp(await mountDetail(aeat));
      expect(inv.qr).toBeUndefined();
      expect(inv.qr_legend).toBeUndefined();
      expect(inv.qr_heading).toBeUndefined();
    }
  });

  it('the on-screen AEAT card paints «QR tributario:» above the QR and «VERI*FACTU» under it', async () => {
    const el = await mountDetail({ status: 'accepted', csv: 'A-XYZ', qr: QR });
    const wrap = el.shadowRoot.querySelector('[data-testid="invoice-aeat"] .qr-wrap') as HTMLElement | null;
    expect(wrap, 'the card shows the QR').toBeTruthy();
    const kids = Array.from(wrap!.children);
    const qrAt = kids.findIndex((k) => k.tagName.toLowerCase() === 'ok-qr');
    const headingAt = kids.findIndex((k) => k.getAttribute('data-testid') === 'invoice-aeat-qr-heading');
    const legendAt = kids.findIndex((k) => k.getAttribute('data-testid') === 'invoice-aeat-qr-legend');
    expect(kids[headingAt]?.textContent?.trim()).toBe('QR tributario:');
    expect(kids[legendAt]?.textContent?.trim()).toBe('VERI*FACTU');
    expect(headingAt, 'heading right above the QR').toBe(qrAt - 1);
    expect(legendAt, 'legend right under the QR').toBe(qrAt + 1);
  });

  it('the on-screen AEAT card without a QR paints neither text', async () => {
    const el = await mountDetail({ status: 'pending', csv: '', qr: '' });
    const card = el.shadowRoot.querySelector('[data-testid="invoice-aeat"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.querySelector('[data-testid="invoice-aeat-qr-heading"]')).toBeNull();
    expect(card.querySelector('[data-testid="invoice-aeat-qr-legend"]')).toBeNull();
    expect(card.textContent).not.toContain('VERI*FACTU');
  });

  it('the thermal job carries `qr_heading`/`qr_legend` next to `qr_data`', async () => {
    const printed: Array<{ data?: Record<string, unknown> }> = [];
    (globalThis.erplora as Record<string, unknown>).print = async (req: { data?: Record<string, unknown> }) => { printed.push(req); return { via: 'bridge' }; };
    const el = await mountDetail({ status: 'accepted', csv: 'A-XYZ', qr: QR });
    (el.shadowRoot!.querySelector('header ion-button.print') as HTMLElement).click();
    expect(printed[0]?.data).toMatchObject({ qr_data: QR, qr_legend: 'VERI*FACTU', qr_heading: 'QR tributario:' });
  });

  it('invoiceToPrintDocument: the texts go with the QR and never without it', () => {
    const withQr = invoiceToPrintDocument(DETAIL, LINES, 2, { qr: QR });
    expect(withQr.qr_legend).toBe('VERI*FACTU');
    expect(withQr.qr_heading).toBe('QR tributario:');
    for (const fiscal of [{}, { qr: '' }, { qr: undefined }]) {
      const doc = invoiceToPrintDocument(DETAIL, LINES, 2, fiscal);
      expect(doc.qr_data).toBeUndefined();
      expect(doc.qr_legend).toBeUndefined();
      expect(doc.qr_heading).toBeUndefined();
    }
  });
});
