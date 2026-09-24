-- Makes sure the RECT series of the year exists (R1). The runtime injects :new_id, :hub_id, :now.
--
-- THE YEAR IS ALWAYS THE SERVER'S (invoice#62, closed by invoice#79). `:year` is not a system
-- parameter, and a payload's `:year` is no longer read at all: an event (`sale.refunded`) never
-- carried one, and a caller of `invoice.rectify` that sends one no longer chooses the series a fiscal
-- document is numbered in — `rectify_date_assert.sql` refuses a year other than this one, and the
-- chain derives it here, in `rectify_bump`, `rectify_insert` and `_insert_allocation` alike.
--
-- THE YEAR IS THE BUSINESS'S (invoice#78). `:now` is the runtime's instant in UTC; `:timezone` is
-- the business zone the runtime binds in every command (hub#1022). Reading the year straight off
-- `:now` opened LAST year's series for a rectification issued at 00:30 on 1 January in Madrid. It
-- is the same clock `handler/src/lib.rs::business_date` dates every invoice with; a runtime older
-- than hub#1022 binds no `:timezone` (NULL) and gets the UTC year, exactly as before.
--
-- THE REFUND PRECONDITION (invoice#62, widened by invoice#63). On the listener path (`:sale_id`
-- present) the series is created only if this refund is going to produce a document at all — the
-- same gate `rectify_bump.sql` spells out: a stable `refund_ref`, an original of this sale with
-- money still standing on it, and no document for this refund yet. Without it a refund that
-- issues nothing would leave an empty RECT series behind: harmless to the numbering (nothing is
-- booked at 0) but a lie in the settings screen. On the manual path (`:sale_id` NULL) the
-- condition is vacuously true and the behaviour is exactly what it was.
INSERT INTO invoice_invoiceseries
  (id, hub_id, code, name, invoice_type, year, current_number, prefix, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT
  :new_id, :hub_id, 'RECT', 'Rectifying Invoices', 'R1',
  CAST(substr(CAST(CAST(CAST(CAST(:now AS TEXT) AS timestamptz) AT TIME ZONE COALESCE(NULLIF(CAST(:timezone AS TEXT), ''), 'UTC') AS date) AS TEXT), 1, 4) AS INTEGER),
  0, 'RECT', 1,
  0, :current_user_id, :current_user_id, :now, :now
WHERE CAST(:sale_id AS TEXT) IS NULL
   OR (NULLIF(CAST(:refund_ref AS TEXT), '') IS NOT NULL
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
ON CONFLICT (hub_id, code, year) DO NOTHING;
