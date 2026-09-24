-- The date gate of `invoice.rectify` (invoice#79). ONE row when the request may be honoured, NONE
-- when it may not; `module.json` anchors `expect_rows` to THIS statement (hub#1091), so no row
-- rolls the whole command back and answers `invoice.rectify_date_not_allowed` — translatable, en+es.
--
-- THE RULE. A rectificativa is dated the day it is issued (RD 1619/2012 art. 6.1.i and art. 15):
-- the expedition date is not something the requester chooses, and it can never be earlier than the
-- invoice it corrects. The chain below dates the document by itself on the business day (`:now` in
-- `:timezone`, invoice#78) and reads no date from the payload any more. This gate is what keeps a
-- caller that DID send one — the API, the assistant — from getting a document silently dated on a
-- different day than the one it asked for: it is refused, visibly, instead.
--
--   * `issue_date`, when sent (and not empty), must be the business's today;
--   * `year`, when sent, must be the business's year;
--   * the original, when it is this hub's, must not be dated after today (an original the hub does
--     not own is not judged here: the chain already no-ops on it, tenancy first).
--
-- A pure read of state the chain does not change, so its place in `sql[]` does not alter the
-- verdict; it runs FIRST so a refused request does no work at all before the rollback. The refund
-- listener (`invoice._rectify_from_refund`) walks the same `sql[]` (the two doors share ONE chain,
-- `tests/refund_listener.contract.test.py`) but declares no `expect_rows`, so here this statement
-- is inert: an event must never dead-letter over a date, and the chain ignores whatever date an
-- event carries anyway.
SELECT 1 AS ok
WHERE (NULLIF(CAST(:issue_date AS TEXT), '') IS NULL
       OR CAST(:issue_date AS TEXT) = CAST(CAST(CAST(CAST(:now AS TEXT) AS timestamptz) AT TIME ZONE COALESCE(NULLIF(CAST(:timezone AS TEXT), ''), 'UTC') AS date) AS TEXT))
  AND (NULLIF(CAST(:year AS TEXT), '') IS NULL
       OR CAST(:year AS TEXT) = substr(CAST(CAST(CAST(CAST(:now AS TEXT) AS timestamptz) AT TIME ZONE COALESCE(NULLIF(CAST(:timezone AS TEXT), ''), 'UTC') AS date) AS TEXT), 1, 4))
  AND NOT EXISTS (
    SELECT 1 FROM invoice_invoice o
    WHERE o.hub_id = :hub_id
      AND o.id = CAST(:original_id AS TEXT)
      AND o.is_deleted = 0
      AND o.issue_date > CAST(CAST(CAST(CAST(:now AS TEXT) AS timestamptz) AT TIME ZONE COALESCE(NULLIF(CAST(:timezone AS TEXT), ''), 'UTC') AS date) AS TEXT)
  );
