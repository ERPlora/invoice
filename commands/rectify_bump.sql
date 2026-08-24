-- Advances the RECT series counter (monotonic). The runtime injects :hub_id and :now.
--
-- invoice#39: THIS UPDATE HAD NO GUARD. `_bump_series` did, so the two doors of the numbering
-- behaved differently: here a retried `invoice.rectify` on the same invoice spent a number AND
-- issued a SECOND rectifying invoice. `uq_invoice_series_number` cannot see that — the second
-- number is ANOTHER number — so nothing stopped it.
--
-- The guard is EXACTLY the precondition of `rectify_insert.sql` (guard pattern, ADR-0020: the same
-- condition on every door of the chain). If the insert is going to be a no-op, no number is spent
-- here:
--   * the original exists, belongs to this hub, is alive and is NOT itself a rectification (a
--     rectification is not rectified: the fiscal chain is followed through `rectifies_invoice_id`),
--   * there is no live rectification pointing at it already (one per invoice),
--   * and, on the refund path, no live rectification carries this refund reference already.
--
-- ── WHAT invoice#62 ADDED ───────────────────────────────────────────────────────────────────────
--
-- TWO DOORS, ONE CHAIN. `invoice.rectify` (a person, from the screen) names the invoice:
-- `:original_id`. `invoice._rectify_from_refund` (the outbox relay, delivering `sale.refunded`)
-- cannot: the event carries `sale_id` and nothing else that identifies a document. So the original
-- is RESOLVED here, from this module's own row — `source_type='sale'` + `source_id`, the tuple
-- `uq_invoice_source` already keeps unique per hub. The payload never names which fiscal document
-- is about to be cancelled, which is the half of "do not trust the payload" that can actually be
-- enforced from SQL. The alternative — a second copy of this chain for the refund path — would mean
-- a FOURTH copy of the document-number template, and this module already carries three with a
-- "touch one, touch all three" warning on top.
--
-- FULLNESS IS THE GATE, NOT THE DOCUMENT TYPE. `invoice.create_from_sale` issues a row for EVERY
-- completed sale (F1 when it was taken as a full invoice, F2 when it is a plain ticket) and both
-- are ingested into the VeriFactu chain, so a refunded TICKET needs its rectifying invoice just as
-- much as a refunded invoice does — the core turns the R1 into the R5 the AEAT wants when the
-- document has no recipient NIF (`resolve_invoice_type`). What this chain does is negate the WHOLE
-- original and cancel it, and that is the truth only when the WHOLE of it came back. So the refund
-- path additionally requires `fully_refunded`.
--
-- `fully_refunded` is the one thing here that is taken on the event's word, and that is a bounded
-- trust on purpose: `sales` computes it against the sale total and everything already returned
-- (`already + total >= sale_total`), which is why it cannot be re-derived from `:total` — the
-- closing act of a return made in two goes carries only its own amount. What contains a wrong flag
-- is that the command is INTERNAL (only the relay reaches it, hub#131/#145) and that "one
-- rectification per invoice" (migration 009) means even a lie can produce at most ONE document,
-- never a duplicate declaration to the AEAT.
--
-- A refund that leaves part of the invoice standing gets nothing from this chain: it needs a
-- rectificativa POR DIFERENCIAS over a prorated share of the original's frozen `tax_breakdown`,
-- with its own rounding contract and its own numbering — invoice#63.
--
-- NO REFERENCE, NO DOCUMENT. `refund_ref` is the refund document's id, stable across retries
-- (sales#160 keys it off its own idempotency key). Without it a redelivery could not be recognised
-- as one, so the refund path refuses to issue rather than risk a second fiscal document.
UPDATE invoice_invoiceseries
SET current_number = current_number + 1
WHERE hub_id = :hub_id AND code = 'RECT'
  AND CAST(year AS TEXT) = COALESCE(CAST(:year AS TEXT), substr(CAST(:now AS TEXT), 1, 4))
  AND (CAST(:sale_id AS TEXT) IS NULL
       OR (COALESCE(CAST(:fully_refunded AS INTEGER), 0) = 1
           AND NULLIF(CAST(:refund_ref AS TEXT), '') IS NOT NULL))
  AND EXISTS (
    SELECT 1 FROM invoice_invoice o
    WHERE o.hub_id = :hub_id
      AND (o.id = CAST(:original_id AS TEXT)
           OR (CAST(:original_id AS TEXT) IS NULL
               AND o.source_type = 'sale'
               AND o.source_id = CAST(:sale_id AS TEXT)))
      AND o.invoice_type NOT LIKE 'R%' AND o.is_deleted = 0
      AND NOT EXISTS (
        SELECT 1 FROM invoice_invoice r
        WHERE r.hub_id = :hub_id AND r.rectifies_invoice_id = o.id AND r.is_deleted = 0
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM invoice_invoice rr
    WHERE rr.hub_id = :hub_id
      AND rr.rectifies_ref = NULLIF(CAST(:refund_ref AS TEXT), '')
      AND rr.is_deleted = 0
  );
