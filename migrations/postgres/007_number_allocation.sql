-- Invoice · 007 — invoice#39 / ADR-0369: the NUMBERING BOOK, append-only.
--
-- `invoice` is the hub's only fiscal sequencer (ADR-0369), and until now the only trace of a number
-- handed out was the invoice itself. That is not enough for the "no gaps, no duplicates" audit of
-- RD 1007/2023: a number consumed by a transaction whose invoice never landed left no record of why
-- it is missing. `invoice_series` had this book (`invoice_series_allocation`) and never numbered a
-- single invoice; the piece is absorbed here, re-keyed on `(hub_id, code, year)` — the business key
-- `invoice` actually uses, which is also what makes the yearly reset automatic.
--
-- APPEND-ONLY BY CONTRACT: no command deletes or updates a row of this table. `is_deleted` /
-- `deleted_at` are here because the hub's row contract (`../hub/tenancy.md` §2.5) has them, not
-- because anything soft-deletes a booked number — the readers still filter by them so a manually
-- repaired hub reads consistently.
--
-- The book starts the day this migration lands: invoices numbered before it have no row (nothing is
-- back-filled — deriving a fiscal audit trail from parsed numbers would invent evidence). That is
-- why the gap query reports holes INSIDE the recorded range and never "everything before my first
-- row is missing".
--
-- Types: portable "ERPlora SQL" subset (ADR-0007) — ids/refs TEXT, counters INTEGER, dates TEXT
-- ISO-8601 (never TIMESTAMPTZ: the sync engine compares `updated_at` lexicographically).
CREATE TABLE IF NOT EXISTS invoice_number_allocation (
    id              TEXT PRIMARY KEY,            -- deterministic: hub/code/year/padded-sequence
    hub_id          TEXT NOT NULL,
    series_id       TEXT,                        -- the invoice_invoiceseries row that handed it out
    code            TEXT NOT NULL,               -- series code (TICKET|FACT|RECT|…)
    year            INTEGER NOT NULL,            -- fiscal year: the series key resets on it
    sequence        INTEGER NOT NULL,            -- the counter value consumed (1, 2, 3, …)
    document_number TEXT NOT NULL,               -- the RENDERED number, copied from the invoice
    invoice_id      TEXT,                        -- NULL = number consumed, no document behind it
    allocated_at    TEXT,
    is_deleted      INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
    created_by TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT
);
-- The two invariants of the audit, in the data. No gaps is a QUESTION you ask the book (see
-- `queries/numbering_gaps.sql`); no duplicates is something the database refuses outright.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_allocation_seq
    ON invoice_number_allocation (hub_id, code, year, sequence);
-- Mirrors `uq_invoice_series_number` on the invoice itself: the same rendered number cannot be
-- booked twice inside one series (and the same number in a DIFFERENT hub is a different row —
-- the key carries `hub_id`, like every business row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_allocation_number
    ON invoice_number_allocation (hub_id, code, document_number);
CREATE INDEX IF NOT EXISTS ix_invoice_allocation_hub     ON invoice_number_allocation (hub_id, is_deleted);
CREATE INDEX IF NOT EXISTS ix_invoice_allocation_invoice ON invoice_number_allocation (hub_id, invoice_id);
