-- Copies the ORIGINAL's LINES onto the rectifying invoice, with the money negated (invoice#59).
--
-- THE DEFECT. `invoice.rectify` wrote a header and nothing else, so the rectification was born with
-- zero rows in `invoice_invoiceitem`. `invoice.lines` came back empty, and both the detail screen
-- and the PRINTED rectifying invoice showed a total with no concepts under it. Art. 6 + art. 15 of
-- RD 1619/2012 ask a rectifying invoice to carry the content of an invoice, not just its header.
--
-- N ROWS WITHOUT N IDS FROM THE RUNTIME. The issue prescribed moving the command to a Tier-2 WASM
-- handler, on the grounds that "N lines need N ids and a declarative command receives exactly one
-- `:new_id`". The first half is true; the second does not follow: the ids do NOT have to come from
-- the runtime. A single `INSERT … SELECT` writes N rows with DETERMINISTIC ids — the very trick
-- `_insert_allocation.sql` already documents in this module ("it needs no id from the runtime").
-- Staying declarative also keeps the chain inside the only gate that runs it: the module gate has
-- no checkout of ERPlora/hub, so it never compiles the handler to wasm32 nor runs `cargo test` on
-- `handler/` — it says so out loud ("handler WASM SIN VERIFICAR") — but it DOES start a real
-- Postgres and run `tests/rectify_lines.postgres.test.py`.
--
-- THE ID: `<rectification id>/<original line id>`. Deterministic (no runtime id needed), unique by
-- construction (`l.id` is a PK, `r.id` is a PK) and legible: the new line's id carries inside it the
-- line it rectifies, which is the traceability an auditor asks for. Deliberately NOT derived from
-- `line_number`: that column is not unique in the schema, so an inherited invoice with two lines
-- sharing a `line_number` would have collided on the primary key and — with `transaction: true` —
-- taken the whole rectification down with it.
--
-- WHAT GETS NEGATED: the line's MONEY (`base_amount`, `tax_amount`, `total_amount`) and its
-- `quantity`. The amounts, because undoing them is what a rectification is for, and because that is
-- what makes Σ lines match the negated header `rectify_insert.sql` stamps.
--
-- The COUNT, decided against the market (11 references + the Facturae XSD), not by taste. Products
-- fall in two camps: the TYPED document, where the sign lives in the document type and every line
-- stays positive (Stripe credit notes, SAP Business One, Business Central, Xero, Shopify), and the
-- SIGNED document, where the line carries it (WooCommerce, Lightspeed X-Series, Odoo's own
-- reporting layer, and what the AEAT's Sorolla2 guide and the Facturae/UXXI-EC directives describe
-- for a rectificativa). The typed camp is closed to us: since invoice#5 our header and our line
-- amounts are ALREADY negative. Inside the signed camp the market is unanimous.
--
-- And what decides is mechanical: Facturae rule FE-R005 asks each line for
-- `TotalCost = Quantity × UnitPriceWithoutTax` (±0.01). Leaving the count positive prints and emits
-- `1 × 12.10 = −12.10`, which breaks that rule on EVERY rectifying invoice. Exactly ONE factor is
-- signed: negating `unit_price` as well would flip the product back to positive. (VeriFactu never
-- sees it — the `RegistroAlta` carries only the `Desglose`, no lines — but Facturae will, the day we
-- emit it.)
--
-- It is also the only choice that preserves the sign whatever the line means: on a VAT-INCLUSIVE
-- line born from a sale, `unit_price` is the GROSS display price, so what holds on the original is
-- `quantity × unit_price == total_amount` (2 × 605 == 1210), NOT `== base_amount`. Negating the
-- count keeps that identity true with both sides flipped.
--
-- The DESCRIPTORS are not negated: `tax_rate` and `surcharge_rate` (a rectified 21 % is still a
-- 21 %, the same rule `tax_breakdown` already follows) nor `unit_price` (the price of what was sold
-- does not turn negative because it came back). `surcharge_rate` is copied AS IS, NULL included:
-- NULL marks the legacy generation whose `tax_rate` may still be a combined rate (migration 006),
-- and filling it in here would falsify the generation of a frozen fiscal row.
--
-- ⚠️ THE BREAKDOWN IS NOT RE-DERIVED FROM HERE. `tax_breakdown` is copied negated from the
-- original's snapshot by `rectify_insert.sql`, and it stays that way: the tax basis is the one of
-- the document's own price list (ADR-0210) and the breakdown closes once per RATE, not per line
-- (ADR-0123 §4). These lines ADD UP to that breakdown; they do not drive it. The test cross-checks
-- both directions.
--
-- THE GUARD is the same one `_insert_allocation.sql` uses, and for the same reason: the
-- rectification is looked up **by the id THIS request minted** (`:new_id`). If `rectify_insert.sql`
-- was a no-op — the original does not exist, is already rectified, or is itself a rectification —
-- no row carries that id, the join finds nothing and no line is copied (guard pattern, ADR-0020:
-- the same precondition on every door of the chain). The trailing `NOT EXISTS` additionally covers
-- a retry that replays the SAME `:new_id`, which the id guard alone would not see.
--
-- `l.hub_id = r.hub_id` is not decoration: without it a row belonging to another hub but pointing at
-- our invoice — whoever wrote it — would land its concept and its money on our customer's rectifying
-- invoice. That case is in the test, with the neighbour's row planted by hand.
--
-- The runtime injects :hub_id, :now and :new_id; the rest travels in the payload.
INSERT INTO invoice_invoiceitem (
    id, hub_id, invoice_id, line_number, description, quantity, unit_price,
    tax_rate, surcharge_rate, tax_category_key,
    base_amount, tax_amount, total_amount, product_id, created_at
)
SELECT
    r.id || '/' || l.id,
    r.hub_id, r.id, l.line_number, l.description, -l.quantity, l.unit_price,
    l.tax_rate, l.surcharge_rate, l.tax_category_key,
    -l.base_amount, -l.tax_amount, -l.total_amount, l.product_id, :now
FROM invoice_invoice r
JOIN invoice_invoiceitem l
  ON l.hub_id = r.hub_id AND l.invoice_id = r.rectifies_invoice_id
WHERE r.hub_id = :hub_id
  AND r.id = :new_id
  AND NOT EXISTS (
      SELECT 1 FROM invoice_invoiceitem x
      WHERE x.hub_id = r.hub_id AND x.invoice_id = r.id
  );
