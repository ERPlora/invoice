-- invoice#34 · ADR-0140: ONE complete invoice (F3) per substituted ticket (F2), enforced by the
-- schema. Until now the substitution link (`substitutes_invoice_id`, 003) was a loose column and
-- the "one F3 per F2" rule only held because of guards that live elsewhere: `uq_invoice_source`
-- (the sales idempotency index — `substitute_from_invoice` happens to write
-- source_type='substitution', source_id=<F2>) and the one-shot claim redemption of the public
-- door (hub#963). Neither is the substitution invariant, and neither stops an `invoice.substitute`
-- issued from the POS, the assistant, a flow or the public API under a different source key.
--
-- Partial, portable, additive: per hub, only live rows with a link. Two F3 pointing at the same
-- F2 would mean two VeriFactu records for one operation, which cannot be un-sent.
--
-- ⚠️ BEFORE applying on a LIVE hub check there are no duplicates already — a unique index that
-- cannot be built aborts the hub boot, which is worse than the hole it closes:
--
--   SELECT hub_id, substitutes_invoice_id, count(*)
--     FROM invoice_invoice
--    WHERE substitutes_invoice_id IS NOT NULL AND is_deleted = 0
--    GROUP BY hub_id, substitutes_invoice_id
--   HAVING count(*) > 1;
--
-- If it returns rows, resolve them by hand (soft-delete the spurious F3 after checking its fiscal
-- record) before the hub picks up this version.
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_substitutes
  ON invoice_invoice (hub_id, substitutes_invoice_id)
  WHERE substitutes_invoice_id IS NOT NULL AND is_deleted = 0;
