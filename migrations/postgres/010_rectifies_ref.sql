ALTER TABLE invoice_invoice ADD COLUMN IF NOT EXISTS rectifies_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_rectifies_ref
  ON invoice_invoice (hub_id, rectifies_ref)
  WHERE rectifies_ref IS NOT NULL AND rectifies_ref <> '' AND is_deleted = 0;

-- Invoice · 010 — invoice#62: ONE rectifying invoice per REFUND DOCUMENT, enforced by the schema.
--
-- (Prose at the end on purpose: a `;` inside a leading `--` block is what splits a migration in the
-- wrong place, and a chunk that starts mid-sentence is the failure that is hardest to read.)
--
-- WHAT IT IS FOR. Since this version a refund does not wait for anyone to remember it: `sales`
-- emits `sale.refunded` and `invoice._rectify_from_refund` issues the credit note. The refund
-- document's id (`refund_ref`, stable across retries by sales#160's own idempotency key) is stamped
-- on the rectifying invoice, and this index is what makes "the same refund twice is one document"
-- a property of the DATABASE rather than of the guards on one command.
--
-- WHY A GUARD IS NOT ENOUGH — and this is the whole point. `rectify_bump` / `rectify_insert` /
-- `rectify_cancel` share a `NOT EXISTS` precondition (invoice#39, ADR-0020) and that is what stops
-- a redelivery from spending a number. But a `NOT EXISTS` read followed by an INSERT is
-- check-then-act: two relays inside the same window both read "nothing there" and both write. Only
-- a unique index decides a race, and `ON CONFLICT DO NOTHING` on `rectify_insert.sql` is what turns
-- its verdict into a silent no-op instead of an aborted transaction. Guards protect the door they
-- are nailed to; this module is written for a runtime where a flow, the assistant or the public API
-- can reach a row another way.
--
-- Two rectifications of one refund are two VeriFactu records for one operation, and a transmitted
-- record cannot be un-transmitted. The cost is not a duplicate row: it is a second declaration of
-- the same fact to the AEAT, on a chain whose links are consumed even when a record is rejected.
--
-- WHY IT DOES NOT REPLACE `ux_invoice_rectifies` (009). They answer different questions and both
-- stay: 009 says "one rectification per rectified INVOICE", 010 says "one per REFUND". Today 009 is
-- the stricter of the two, so a second refund on an already-rectified invoice is stopped by 009 and
-- never reaches this one. That stops being true the day partial refunds get their rectificativa por
-- diferencias (invoice#63), where one invoice legitimately carries N of them, one per refund — and
-- on that day this index is the one that still holds.
--
-- Partial, portable, additive: per hub, only live rows, only rows that carry a reference. The empty
-- string is excluded as well as NULL, so a manual `invoice.rectify` (no refund behind it, the
-- parameter binds as NULL) and any legacy row that ever stamped '' both stay outside — a partial
-- index must not turn "no reference" into a value that can collide.
--
-- ⚠️ BEFORE applying on a LIVE hub: a unique index that cannot be built aborts the hub boot, which
-- is worse than the hole it closes. The column is new in this migration, so every existing row is
-- NULL and the index builds on an empty set — there is nothing to check and nothing to repair. The
-- query is written down anyway for whoever re-reads this after the column has been in use:
--
--   SELECT hub_id, rectifies_ref, count(*)
--     FROM invoice_invoice
--    WHERE rectifies_ref IS NOT NULL AND rectifies_ref <> '' AND is_deleted = 0
--    GROUP BY hub_id, rectifies_ref
--   HAVING count(*) > 1
--
-- Types: portable "ERPlora SQL" subset (ADR-0007) — refs are TEXT.
