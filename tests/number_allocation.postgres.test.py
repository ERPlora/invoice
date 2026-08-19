#!/usr/bin/env python3
"""The numbering book: append-only, one row per number handed out (invoice#39, ADR-0369).

Runs against the REAL Postgres 18 test container, applying the module's `migrations/postgres/*.sql`
the way the runtime does and driving the module's OWN commands (`invoice._ensure_series` →
`invoice._bump_series` → `invoice._insert_invoice`, and the declarative `invoice.rectify` chain)
bound like the runtime binds.

Why the test exists. `invoice` numbers invoices but kept no book: the only trace of a number was the
invoice itself, so a number consumed by a transaction whose invoice never landed left no record of
why it is missing — exactly what the "no gaps, no duplicates" audit of RD 1007/2023 asks for.
`invoice_series` had that book (`invoice_series_allocation`) and never numbered anything; ADR-0369
absorbs it here, keyed on `(hub_id, code, year, sequence)` — the key `invoice` actually uses.

And it pins the bug the absorption uncovered: `commands/rectify_bump.sql` had NO idempotency guard
(unlike `_bump_series`), so re-running `invoice.rectify` for the same original invoice consumed a
second number AND issued a second rectifying invoice — `uq_invoice_series_number` cannot see it,
because the second number is a different number.

Usage: tests/number_allocation.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container by default (override: INVOICE_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import importlib.util
import os
import pathlib
import subprocess
import sys
import uuid

HERE = pathlib.Path(__file__).resolve().parent
MODULE_DIR = HERE.parent

# Reuse the runtime-in-miniature (psql, bind, run_command, issue, load_migrations) of the sibling
# test instead of copying it: one shim, one place to fix.
_spec = importlib.util.spec_from_file_location(
    "invoice_pg_harness", HERE / "substitution_unique.postgres.test.py"
)
H = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(H)
H.DB = f"invoice_number_allocation_test_{os.getpid()}"

failures = H.failures
check = H.check
HUB = H.HUB
OTHER_HUB = H.OTHER_HUB
YEAR = "2026"


# ── Driving the two numbering chains ─────────────────────────────────────────────────────


def issue_sale(
    invoice_id: str, sale_id: str | None, *, hub: str = HUB
) -> tuple[bool, str]:
    """A POS ticket: the op chain the WASM handler returns for `create_from_sale`."""
    return H.issue(
        invoice_id,
        invoice_type="F2",
        series="TICKET",
        source_type="sale",
        source_id=sale_id,
        substitutes=None,
        hub=hub,
    )


def issue_manual(invoice_id: str, *, hub: str = HUB) -> tuple[bool, str]:
    """A manual complete invoice (`source_id` NULL). Rectifications are driven from one of these on
    purpose: `rectify_insert.sql` COPIES `source_type`/`source_id` from the original, so rectifying
    a sale-sourced invoice dies on `uq_invoice_source` — a separate, pre-existing bug (invoice#42),
    out of the scope of this one."""
    return H.issue(
        invoice_id,
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        source_id=None,
        substitutes=None,
        hub=hub,
    )


def rectify(original_id: str, *, hub: str = HUB) -> tuple[bool, str]:
    """`invoice.rectify` exactly as the runtime runs it: every declared sql[] in ONE transaction,
    with a fresh `:new_id` per attempt (the runtime mints one per request)."""
    return H.run_command(
        "invoice.rectify",
        {
            "new_id": str(uuid.uuid4()),
            "original_id": original_id,
            "year": YEAR,
            "issue_date": H.NOW[:10],
            "reason": "Wrong customer",
        },
        hub,
    )


def book(code: str, *, hub: str = HUB) -> list[tuple[str, str, str]]:
    """(sequence, document_number, invoice_id) of the book for a series, in sequence order."""
    raw = H.q(
        "SELECT COALESCE(string_agg(sequence || '|' || document_number || '|' "
        "|| COALESCE(invoice_id, 'NULL'), ',' ORDER BY sequence), '') "
        "FROM invoice_number_allocation "
        f"WHERE hub_id = {H.literal(hub)} AND code = {H.literal(code)} "
        f"AND year = {YEAR} AND is_deleted = 0"
    )
    if "<sql error" in raw:
        return [(raw, "", "")]
    return [tuple(x.split("|")) for x in raw.split(",")] if raw else []


def counter(code: str, *, hub: str = HUB) -> int:
    return H.qi(
        "SELECT current_number FROM invoice_invoiceseries "
        f"WHERE hub_id = {H.literal(hub)} AND code = {H.literal(code)} AND year = {YEAR}"
    )


def query_rows(rel: str, params: dict) -> str:
    """Run a declared query file the way the runtime does (params bound, no ORDER BY of its own)."""
    sql = H.bind((MODULE_DIR / rel).read_text(), params).rstrip().rstrip(";")
    return H.q(f"SELECT count(*) FROM ({sql}) AS r")


# ── 1. The migration and the manifest ────────────────────────────────────────────────────


def test_the_book_exists_and_is_declared():
    print(
        "\n== 1. migration 007: the book table, its two unique keys, and the manifest =="
    )
    check(
        "the table exists",
        "invoice_number_allocation",
        H.q(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_name = 'invoice_number_allocation'"
        ),
    )
    check(
        "the migration is declared",
        True,
        "migrations/postgres/007_number_allocation.sql"
        in H.MANIFEST["migrations"]["postgres"],
    )
    # ONE linear head: the manifest declares every migration on disk, in filename order. Two open
    # heads make the deploy's `migrate` abort in SILENCE (the deploy still goes green).
    check(
        "...and the declared list is every file on disk, in order",
        [
            f"migrations/postgres/{p.name}"
            for p in sorted((MODULE_DIR / "migrations" / "postgres").glob("*.sql"))
        ],
        H.MANIFEST["migrations"]["postgres"],
    )
    check(
        "one row per sequence of a series-year (uq_invoice_allocation_seq)",
        "1",
        H.q(
            "SELECT count(*) FROM pg_indexes WHERE tablename = 'invoice_number_allocation' "
            "AND indexname = 'uq_invoice_allocation_seq'"
        ),
    )
    check(
        "one row per rendered number of a series (uq_invoice_allocation_number)",
        "1",
        H.q(
            "SELECT count(*) FROM pg_indexes WHERE tablename = 'invoice_number_allocation' "
            "AND indexname = 'uq_invoice_allocation_number'"
        ),
    )
    check(
        "the allocation SQL is wired to the INVOICE insert, not to a second command",
        True,
        "commands/_insert_allocation.sql"
        in H.MANIFEST["commands"]["invoice._insert_invoice"]["sql"],
    )
    check(
        "...and to the rectify chain, after its own insert",
        ["commands/rectify_insert.sql", "commands/_insert_allocation.sql"],
        H.MANIFEST["commands"]["invoice.rectify"]["sql"][2:4],
    )


# ── 2. N invoices → N contiguous allocations ──────────────────────────────────────────────


def test_every_number_handed_out_is_booked():
    print("\n== 2. three tickets → three contiguous allocations, no gaps ==")
    for n in (1, 2, 3):
        ok, err = issue_sale(f"F2-{n}", f"sale-{n}")
        check(f"ticket {n} is issued", (True, ""), (ok, err))
    check("the counter advanced three times", 3, counter("TICKET"))
    check(
        "the book has one row per number, contiguous, each pointing at its invoice",
        [
            ("1", "TICKET-2026-000001", "F2-1"),
            ("2", "TICKET-2026-000002", "F2-2"),
            ("3", "TICKET-2026-000003", "F2-3"),
        ],
        book("TICKET"),
    )
    check(
        "the booked number is the invoice's own number (one render site, never re-formatted)",
        "0",
        H.q(
            "SELECT count(*) FROM invoice_number_allocation a JOIN invoice_invoice i "
            "ON i.id = a.invoice_id WHERE a.document_number <> i.number"
        ),
    )


# ── 3. Idempotency: a redelivered sale books nothing new ─────────────────────────────────


def test_a_redelivered_sale_neither_bumps_nor_books():
    print(
        "\n== 3. the bus redelivers `sale.completed` for sale-2: no bump, no new allocation =="
    )
    before = book("TICKET")
    # The runtime mints a FRESH id for the retry; `_insert_invoice` no-ops on `uq_invoice_source`'s
    # guard, so no invoice carries that id and the book has nothing to record.
    ok, err = issue_sale("F2-RETRY", "sale-2")
    check(
        "the retry runs without error (it is a no-op, not a failure)",
        (True, ""),
        (ok, err),
    )
    check("the counter did NOT advance", 3, counter("TICKET"))
    check("the book did NOT grow", before, book("TICKET"))
    check(
        "no invoice was created for the retry id",
        0,
        H.qi("SELECT count(*) FROM invoice_invoice WHERE id = 'F2-RETRY'"),
    )


# ── 4. The rectify chain: booked once, and a retry burns no number ───────────────────────


def test_a_retried_rectification_burns_no_number():
    print(
        "\n== 4. `invoice.rectify` twice on the same invoice: one number, one rectification =="
    )
    ok, err = issue_manual("F1-M")
    check("a manual invoice to rectify is issued", (True, ""), (ok, err))

    ok, err = rectify("F1-M")
    check("the first rectification is issued", (True, ""), (ok, err))
    check("the RECT counter is at 1", 1, counter("RECT"))
    first = book("RECT")
    check("the rectification is booked in the RECT series", 1, len(first))
    check("...with the number the invoice carries", "RECT-2026-000001", first[0][1])

    # THE BUG (invoice#39 §4): `rectify_bump.sql` had no guard, so this consumed number 2 and
    # issued a SECOND rectifying invoice for the same original — the unique index on
    # (hub_id, series, number) cannot see it, because the number is a different number.
    ok, err = rectify("F1-M")
    check("the retry runs without error (no-op)", (True, ""), (ok, err))
    check("the RECT counter did NOT advance", 1, counter("RECT"))
    check("the book did NOT grow", first, book("RECT"))
    check(
        "still exactly ONE rectifying invoice for the original",
        1,
        H.qi(
            "SELECT count(*) FROM invoice_invoice "
            f"WHERE hub_id = {H.literal(HUB)} AND rectifies_invoice_id = 'F1-M' AND is_deleted = 0"
        ),
    )


def test_rectifying_something_unrectifiable_burns_no_number():
    print("\n== 5. rectifying something that cannot be rectified consumes no number ==")
    ok, err = rectify("does-not-exist")
    check("the attempt runs without error (no-op)", (True, ""), (ok, err))
    check("the RECT counter did NOT advance", 1, counter("RECT"))
    check("the book did NOT grow", 1, len(book("RECT")))
    # A rectification of a rectification is refused the same way (invoice_type NOT LIKE 'R%') — and
    # the whole chain has to agree: no number, no insert, and the target NOT marked as cancelled.
    rect_id = H.q(
        "SELECT id FROM invoice_invoice WHERE rectifies_invoice_id = 'F1-M' AND is_deleted = 0"
    )
    ok, err = rectify(rect_id)
    check("rectifying a rectification is a no-op too", (True, ""), (ok, err))
    check("the RECT counter still did NOT advance", 1, counter("RECT"))
    check(
        "...and it did not cancel the rectification it could not rectify",
        "issued",
        H.q(f"SELECT status FROM invoice_invoice WHERE id = {H.literal(rect_id)}"),
    )


# ── 6. Tenancy: a live neighbour does not cross books ────────────────────────────────────


def test_the_book_is_scoped_per_hub():
    print("\n== 6. a LIVE neighbouring hub numbers its own tickets in its own book ==")
    ok, err = issue_sale("N-F2-1", "sale-1", hub=OTHER_HUB)
    check("the neighbour issues its first ticket", (True, ""), (ok, err))
    check("the neighbour's counter starts at 1", 1, counter("TICKET", hub=OTHER_HUB))
    check(
        "the neighbour's book has ONLY its own row",
        [("1", "TICKET-2026-000001", "N-F2-1")],
        book("TICKET", hub=OTHER_HUB),
    )
    check("our book is untouched", 3, len(book("TICKET")))
    check(
        "the same rendered number lives in both hubs without colliding",
        2,
        H.qi(
            "SELECT count(*) FROM invoice_number_allocation "
            "WHERE document_number = 'TICKET-2026-000001' AND is_deleted = 0"
        ),
    )


# ── 7. The audit queries: list the book, find the gaps ───────────────────────────────────


def test_the_audit_queries_answer_an_inspection():
    print(
        "\n== 7. `invoice.numbering.allocations` lists the book; `.gaps` finds a hole =="
    )
    check(
        "the allocations query is declared with the read permission",
        ("queries/allocations.sql", "invoice.view_invoice"),
        (
            H.MANIFEST["queries"]["invoice.numbering.allocations"]["sql"],
            H.MANIFEST["queries"]["invoice.numbering.allocations"]["permission"],
        ),
    )
    check(
        "the gaps query is declared too",
        "queries/numbering_gaps.sql",
        H.MANIFEST["queries"]["invoice.numbering.gaps"]["sql"],
    )
    check(
        "the allocations query returns this hub's rows only "
        "(3 tickets + 1 manual invoice + 1 rectification)",
        "5",
        query_rows("queries/allocations.sql", {"hub_id": HUB}),
    )
    check(
        "with no hole, the gaps query returns nothing",
        "0",
        query_rows("queries/numbering_gaps.sql", {"hub_id": HUB}),
    )

    # Forge a hole the only way a hub could get one: a number the book never recorded. Deleting a
    # booked row is not something any command does — the book is append-only — so this is the
    # inspector's scenario, not a supported operation.
    H.psql(
        [
            "-c",
            "DELETE FROM invoice_number_allocation "
            f"WHERE hub_id = {H.literal(HUB)} AND code = 'TICKET' AND sequence = 2",
        ],
        db=H.DB,
    )
    check(
        "a missing sequence INSIDE the recorded range is reported",
        "1",
        query_rows("queries/numbering_gaps.sql", {"hub_id": HUB}),
    )
    check(
        "...naming the series and the first missing number",
        "TICKET|2",
        H.q(
            "SELECT code || '|' || missing_from FROM ("
            + H.bind(
                (MODULE_DIR / "queries" / "numbering_gaps.sql").read_text(),
                {"hub_id": HUB},
            )
            .rstrip()
            .rstrip(";")
            + ") AS g"
        ),
    )


# ── 8. The migration is re-entrant ───────────────────────────────────────────────────────


def test_migration_is_reentrant():
    print("\n== 8. re-applying 007 is a no-op (IF NOT EXISTS) ==")
    mig = MODULE_DIR / "migrations" / "postgres" / "007_number_allocation.sql"
    check("the migration file exists", True, mig.exists())
    if mig.exists():
        try:
            H.psql(
                [],
                db=H.DB,
                stdin=H.DDL_TOKEN.sub(
                    lambda m: H.DDL_TYPES[m.group(1).upper()], mig.read_text()
                ),
            )
            check("re-applying 007 does not fail", True, True)
        except RuntimeError as exc:
            check("re-applying 007 does not fail", True, str(exc).splitlines()[0])


def main() -> int:
    running = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", H.CONTAINER],
        capture_output=True,
        text=True,
    )
    if "true" not in running.stdout:
        subprocess.run(["docker", "start", H.CONTAINER], capture_output=True)

    H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])
    H.psql(["-c", f"CREATE DATABASE {H.DB}"])
    try:
        H.load_migrations()
        test_the_book_exists_and_is_declared()
        test_every_number_handed_out_is_booked()
        test_a_redelivered_sale_neither_bumps_nor_books()
        test_a_retried_rectification_burns_no_number()
        test_rectifying_something_unrectifiable_burns_no_number()
        test_the_book_is_scoped_per_hub()
        test_the_audit_queries_answer_an_inspection()
        test_migration_is_reentrant()
    finally:
        H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — every fiscal number handed out is booked once, and a retry burns none"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
