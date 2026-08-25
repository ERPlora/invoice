-- The ONE line of a rectificativa por diferencias (invoice#63): the refund itself.
--
-- A partial refund does not undo the original's concepts one by one — it returns an amount. Art.
-- 15.2 RD 1619/2012 asks a rectifying invoice for «los datos identificativos de la factura
-- rectificada y la rectificación efectuada», not for a mirror of the original: copying the lines
-- negated would print a document whose concepts add up to the whole ticket under a total that is
-- a fraction of it. So the concept is the refund, for exactly the header's money — which is what
-- makes Σ lines == header hold on this document too (`tests/rectify_from_refund…` §3).
--
-- SAME SIGN RULE AS `rectify_lines.sql`: one signed factor, the quantity (−1 unit in the fixed
-- point of ADR-0147), so `quantity × unit_price == total_amount` keeps holding with both sides
-- flipped, and `unit_price` stays the positive amount returned.
--
-- `tax_rate` is a NOT NULL column and a document that spans several rates has no single one: what
-- is written is the EFFECTIVE rate of the header (informational, the fiscal truth is the
-- breakdown), and `surcharge_rate` 0 so the row reads as the current generation.
--
-- THE GUARD is the id THIS request minted (`:new_id`) — if `rectify_insert.sql` was a no-op no row
-- carries it and nothing is written — plus «not a whole negation» (the case `rectify_lines.sql`
-- owns) and «no lines yet» (a retry replaying the same `:new_id`). The runtime injects :hub_id,
-- :now and :new_id.
INSERT INTO invoice_invoiceitem (
    id, hub_id, invoice_id, line_number, description, quantity, unit_price,
    tax_rate, surcharge_rate, tax_category_key,
    base_amount, tax_amount, total_amount, product_id, created_at
)
SELECT
    r.id || '/refund',
    r.hub_id, r.id, 1,
    'Refund ' || COALESCE(NULLIF(CAST(:refund_ref AS TEXT), ''), o.number),
    -1000000, -r.total_amount,
    CASE WHEN r.base_amount = 0 THEN 0
         ELSE round(100.0 * r.tax_amount / r.base_amount, 2) END,
    0, NULL,
    r.base_amount, r.tax_amount, r.total_amount, NULL, :now
FROM invoice_invoice r
JOIN invoice_invoice o
  ON o.hub_id = r.hub_id AND o.id = r.rectifies_invoice_id
WHERE r.hub_id = :hub_id
  AND r.id = :new_id
  AND r.total_amount <> -o.total_amount
  AND NOT EXISTS (
      SELECT 1 FROM invoice_invoiceitem x
      WHERE x.hub_id = r.hub_id AND x.invoice_id = r.id
  );
