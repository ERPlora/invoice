-- Books the number just handed out (invoice#39, RD 1007/2023: sin huecos, sin duplicados).
--
-- WHERE IT RUNS. It is the LAST sql[] of `invoice._insert_invoice` and of `invoice.rectify`, so it
-- travels in the SAME transaction as the counter bump and the invoice INSERT (ADR-0369 D1). There is
-- no second transaction to fall out of sync: if the invoice rolls back, so does its book row.
--
-- THE NUMBER IS NOT RE-RENDERED: it is COPIED from the invoice (`i.number`). The only places that
-- FORMAT a number are `_insert_invoice.sql` and `rectify_insert.sql`. That is deliberate — in
-- `invoice_series` the same template lived in two SQL files marked "keep in sync", and that debt is
-- explicitly not inherited (ADR-0369 D3a).
--
-- IDEMPOTENCY, for free. The invoice is looked up **by the id this request minted**
-- (`:invoice_id` for the WASM chain, `:new_id` for the declarative one). On a redelivery of
-- `sale.completed`, `_insert_invoice` no-ops on its `uq_invoice_source` guard, so NO invoice carries
-- that fresh id, the join finds nothing and the book does not grow — the same no-op `_bump_series`
-- performed one statement earlier (guard pattern, ADR-0020). Same for a retried rectification once
-- `rectify_bump.sql` grew its own guard.
--
-- invoice#62: `:year` FALLS BACK TO `:now`. It is not a system parameter — the runtime injects
-- `:hub_id`, `:current_user_id`, `:now` and `:new_id`, and nothing else — so it only ever arrived
-- because a screen or a handler put it in the payload. An EVENT payload has neither, and without
-- the fallback this join would find no series, book no number, and the numbering ledger would
-- silently stop recording the rectifications a refund issues. The year is read on the BUSINESS
-- clock (`:now` in `:timezone`, invoice#78) — the one the handler (`business_date`) and
-- `rectify_ensure`/`rectify_bump`/`rectify_insert` use — so the doors agree on what year it is.
--
-- The two id conventions are a runtime fact, not a trick: a WASM handler binds the ids it took from
-- `context.new_ids` under its own names, while a declarative command receives exactly one
-- runtime-injected `:new_id`. A `:param` absent from the payload binds as NULL, so COALESCE picks
-- whichever exists. The CASTs are needed because Postgres cannot infer the type of a NULL parameter
-- inside COALESCE.
--
-- `id` is deterministic (hub/code/year/padded sequence) instead of a UUID: it needs no id from the
-- runtime (which is what lets ONE file serve both chains) and it makes the primary key say the same
-- thing as `uq_invoice_allocation_seq` — a second attempt at the same allocation cannot invent a
-- second row even if a future caller forgot the guard.
--
-- That padded sequence is a FOURTH place a number is rendered, and the only one the "three render
-- sites" note next door does not reach: it pads to 6 whatever width the series' own template asked
-- for. It is safe because the width is a MINIMUM (ERPlora/hub#1378) — cut to exactly 6, sequence
-- 1.000.000 would mint the key of sequence 100.000 and take the whole emission down with it on the
-- primary key. `tests/number_format.postgres.test.py` §6b asserts this key at that border.
INSERT INTO invoice_number_allocation (
    id, hub_id, series_id, code, year, sequence, document_number, invoice_id, allocated_at,
    is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
    i.hub_id || '/' || i.series || '/' || CAST(s.year AS TEXT) || '/' || erp_pad(s.current_number, 6),
    i.hub_id, s.id, i.series, s.year, s.current_number, i.number, i.id, :now,
    0, :current_user_id, :current_user_id, :now, :now
FROM invoice_invoice i
JOIN invoice_invoiceseries s
  ON s.hub_id = i.hub_id
 AND s.code = i.series
 AND CAST(s.year AS TEXT) = COALESCE(CAST(:year AS TEXT), to_char(CAST(CAST(:now AS TEXT) AS timestamptz) AT TIME ZONE COALESCE(NULLIF(CAST(:timezone AS TEXT), ''), 'UTC'), 'YYYY'))
 AND s.is_deleted = 0
WHERE i.hub_id = :hub_id
  AND i.id = COALESCE(CAST(:invoice_id AS TEXT), CAST(:new_id AS TEXT))
  AND NOT EXISTS (
      SELECT 1 FROM invoice_number_allocation a
      WHERE a.hub_id = i.hub_id AND a.code = i.series
        AND a.year = s.year AND a.sequence = s.current_number
  );
