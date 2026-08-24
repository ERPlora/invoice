-- Makes sure the RECT series of the year exists (R1). The runtime injects :new_id, :hub_id, :now.
--
-- THE YEAR IS DERIVED WHEN NOBODY SENDS IT (invoice#62). `:year` is NOT a system parameter — the
-- runtime injects `:hub_id`, `:current_user_id`, `:now` and `:new_id`, nothing else — so it only
-- ever arrived because the screen that calls `invoice.rectify` puts it in the payload. An EVENT
-- payload has no such thing: `sale.refunded` carries the sale, the refund and the money, and that
-- is all. Without the fallback the RECT series would be created for year NULL, the joins in
-- `rectify_bump` / `rectify_insert` would match nothing and the whole chain would be a SILENT
-- no-op — the shape of failure this module has already paid for twice.
--
-- `substr(:now, 1, 4)` is not a new convention: it is the module's own. `handler/src/lib.rs`
-- derives `issue_date = now.split('T')[0]` and takes the year off it for every invoice it issues.
--
-- THE REFUND PRECONDITION. On the listener path (`:sale_id` present) the series is created only if
-- this refund is going to produce a document at all — see `rectify_bump.sql` for what fullness
-- means and why. Without it a partial refund would leave an empty RECT series behind: harmless to
-- the numbering (nothing is booked at 0) but a lie in the settings screen, which would show a
-- rectifying series for a hub that has never rectified anything. On the manual path (`:sale_id`
-- NULL) the condition is vacuously true and the behaviour is exactly what it was.
INSERT INTO invoice_invoiceseries
  (id, hub_id, code, name, invoice_type, year, current_number, prefix, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT
  :new_id, :hub_id, 'RECT', 'Rectifying Invoices', 'R1',
  CAST(COALESCE(CAST(:year AS TEXT), substr(CAST(:now AS TEXT), 1, 4)) AS INTEGER),
  0, 'RECT', 1,
  0, :current_user_id, :current_user_id, :now, :now
WHERE CAST(:sale_id AS TEXT) IS NULL
   OR (COALESCE(CAST(:fully_refunded AS INTEGER), 0) = 1
       AND NULLIF(CAST(:refund_ref AS TEXT), '') IS NOT NULL)
ON CONFLICT (hub_id, code, year) DO NOTHING;
