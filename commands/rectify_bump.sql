-- Advances the RECT series counter (monotonic). The runtime injects :hub_id and :now.
--
-- invoice#39: THIS UPDATE HAD NO GUARD. `_bump_series` did, so the two doors of the numbering
-- behaved differently: here a retried `invoice.rectify` on the same invoice spent a number AND
-- issued a SECOND rectifying invoice. `uq_invoice_series_number` cannot see that — the second
-- number is ANOTHER number — so nothing stopped it.
--
-- The guard is EXACTLY the precondition of `rectify_insert.sql` (guard pattern, ADR-0020: the same
-- condition on every door of the chain). If the insert is going to be a no-op, no number is spent
-- here. Two doors walk this one chain (invoice#62), and they are gated differently:
--
--   * `invoice.rectify` (a person, from the screen) names the document: `:original_id`. It negates
--     the WHOLE original, so it requires that nothing rectifies it yet — the original exists,
--     belongs to this hub, is alive, is NOT itself a rectification (a rectification is not
--     rectified: the fiscal chain is followed through `rectifies_invoice_id`), and carries no live
--     rectification of any kind (a manual whole-negation on top of a partial one would declare
--     money twice).
--
--   * `invoice._rectify_from_refund` (the outbox relay, delivering `sale.refunded`) cannot name a
--     document: the event carries `sale_id`. So the original is RESOLVED here, from this module's
--     own row — `source_type='sale'` + `source_id`, the tuple `uq_invoice_source` already keeps
--     unique per hub. The payload never names which fiscal document is about to be rectified,
--     which is the half of "do not trust the payload" that can actually be enforced from SQL.
--
-- ── WHAT invoice#63 CHANGED: EVERY refund gets its document, for the money it returns ───────────
--
-- Before, the refund path issued only when the WHOLE invoice came back (`fully_refunded`), and a
-- partial refund produced nothing — while art. 80.Dos LIVA modifies the taxable base at the moment
-- of the return, not when the rest comes back. Now a refund issues a rectificativa POR DIFERENCIAS
-- for what it returns, `I` in `TipoRectificativa` (ADR-0379: negative amounts, no
-- `ImporteRectificacion`), the original stays issued, and the two documents coexist — that is what
-- «por diferencias» means. The closing act (`fully_refunded`) rectifies WHAT IS LEFT of the invoice,
-- never its own `total`, so the sum of the documents is the original to the cent and nothing is
-- ever declared twice. One invoice therefore carries N rectifications, one per refund document
-- (migration 011 retires the «one per invoice» index, 010 keeps «one per refund»).
--
-- FULLNESS IS NO LONGER THE GATE — STANDING MONEY IS. The refund path issues when the original of
-- this sale still has money on it (`total_amount + Σ live rectifications > 0`) and the refund
-- brings a positive amount or closes the return. `fully_refunded` is still taken on the event's
-- word, and that is a bounded trust on purpose: it only decides that the LAST document takes the
-- remainder rather than a proration — the money it can move is capped by what is left.
--
-- NO REFERENCE, NO DOCUMENT. `refund_ref` is the refund document's id, stable across retries
-- (sales#160 keys it off its own idempotency key). Without it a redelivery could not be recognised
-- as one, so the refund path refuses to issue rather than risk a second fiscal document.
UPDATE invoice_invoiceseries
SET current_number = current_number + 1
WHERE hub_id = :hub_id AND code = 'RECT'
  AND CAST(year AS TEXT) = substr(CAST(CAST(CAST(CAST(:now AS TEXT) AS timestamptz) AT TIME ZONE COALESCE(NULLIF(CAST(:timezone AS TEXT), ''), 'UTC') AS date) AS TEXT), 1, 4)
  AND (
    -- the manual door: the whole original, untouched so far
    (CAST(:sale_id AS TEXT) IS NULL AND EXISTS (
      SELECT 1 FROM invoice_invoice o
      WHERE o.hub_id = :hub_id AND o.id = CAST(:original_id AS TEXT)
        AND o.invoice_type NOT LIKE 'R%' AND o.is_deleted = 0
        AND NOT EXISTS (
          SELECT 1 FROM invoice_invoice r
          WHERE r.hub_id = :hub_id AND r.rectifies_invoice_id = o.id AND r.is_deleted = 0
        )
    ))
    OR
    -- the refund door: money still standing on the sale's original, and this refund unseen
    (CAST(:sale_id AS TEXT) IS NOT NULL
     AND CAST(:original_id AS TEXT) IS NULL
     AND NULLIF(CAST(:refund_ref AS TEXT), '') IS NOT NULL
     AND (COALESCE(CAST(:fully_refunded AS INTEGER), 0) = 1
          OR COALESCE(CAST(:total AS INTEGER), 0) > 0)
     AND EXISTS (
       SELECT 1 FROM invoice_invoice o
       WHERE o.hub_id = :hub_id
         AND o.source_type = 'sale' AND o.source_id = CAST(:sale_id AS TEXT)
         AND o.invoice_type NOT LIKE 'R%' AND o.is_deleted = 0
         AND o.total_amount + COALESCE((
               SELECT SUM(r.total_amount) FROM invoice_invoice r
               WHERE r.hub_id = o.hub_id AND r.rectifies_invoice_id = o.id AND r.is_deleted = 0
             ), 0) > 0
     )
     AND NOT EXISTS (
       SELECT 1 FROM invoice_invoice rr
       WHERE rr.hub_id = :hub_id
         AND rr.rectifies_ref = NULLIF(CAST(:refund_ref AS TEXT), '')
         AND rr.is_deleted = 0
     ))
  );
