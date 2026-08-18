#!/usr/bin/env python3
"""The invoice LINE freezes the equivalence surcharge apart from the main rate (invoice#21).

Runs against the REAL Postgres 18 test container, applying the module's `migrations/postgres/*.sql`
the way the runtime does and writing lines through the module's OWN private SQL
(`invoice._insert_line`), bound like the runtime binds.

Why the test exists: `invoice_invoiceitem.tax_rate` stored the COMBINED rate that arrives from the
sale under equivalence surcharge (21 + 5.2 = 26.2). 26.2 is a sum, not a rate; the breakdown had
already split it (ADR-0186) and the line contradicted it. Migration `006_line_surcharge_rate.sql`
adds `surcharge_rate` (append-only, no backfill): NULL marks the LEGACY generation (whose `tax_rate`
may still be a sum), a non-null value marks the NEW generation (`tax_rate` = main rate). The two
generations coexist in the same table and `invoice.lines` returns both.

Usage: tests/line_surcharge_rate.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container by default (override: INVOICE_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import importlib.util
import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
MODULE_DIR = HERE.parent

# Reuse the runtime-in-miniature (psql, bind, run_command, issue, load_migrations) of the sibling
# test instead of copying it: one shim, one place to fix.
_spec = importlib.util.spec_from_file_location(
    "invoice_pg_harness", HERE / "substitution_unique.postgres.test.py"
)
H = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(H)
H.DB = f"invoice_line_surcharge_rate_test_{os.getpid()}"

failures = H.failures
check = H.check
HUB = H.HUB


def line(invoice_id: str, line_id: str, params: dict) -> tuple[bool, str]:
    base = {
        "line_id": line_id,
        "invoice_id": invoice_id,
        "line_number": 1,
        "description": "Producto",
        "quantity": 1_000_000,
        "unit_price": 10000,
        "tax_category_key": "product.generic",
        "base_amount": 10000,
        "tax_amount": 2620,
        "total_amount": 12620,
        "product_id": None,
    }
    return H.run_command("invoice._insert_line", {**base, **params})


def read_lines(invoice_id: str) -> list[tuple[str, str]]:
    """What `invoice.lines` returns: (tax_rate, surcharge_rate) per line, in order."""
    sql = (
        H.bind(
            (MODULE_DIR / "queries" / "lines.sql").read_text(),
            {"invoice_id": invoice_id, "hub_id": HUB},
        )
        .rstrip()
        .rstrip(";")
    )
    raw = H.q(
        f"SELECT string_agg(tax_rate::text || '|' || COALESCE(surcharge_rate::text, 'NULL'), ',') "
        f"FROM ({sql}) AS l"
    )
    return (
        [tuple(x.split("|")) for x in raw.split(",")]
        if raw and "<sql error" not in raw
        else [raw]
    )


def test_the_column_exists_and_defaults_to_null():
    print(
        "\n== 1. migration 006: `surcharge_rate` exists, nullable, no default (NULL = legacy) =="
    )
    check(
        "the column exists",
        "double precision",
        H.q(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = 'invoice_invoiceitem' AND column_name = 'surcharge_rate'"
        ),
    )
    check(
        "the migration is declared in module.json",
        True,
        "migrations/postgres/006_line_surcharge_rate.sql"
        in H.MANIFEST["migrations"]["postgres"],
    )
    check(
        "the migration is the last one (append-only, linear head)",
        "migrations/postgres/006_line_surcharge_rate.sql",
        H.MANIFEST["migrations"]["postgres"][-1],
    )


def test_new_generation_line_persists_main_rate_and_surcharge_apart():
    print(
        "\n== 2. a new-generation line: tax_rate = 21 (main), surcharge_rate = 5.2 =="
    )
    ok, err = H.issue(
        "INV-NEW",
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        source_id=None,
        substitutes=None,
    )
    check("the invoice is issued", True, ok)
    ok, err = line("INV-NEW", "L-NEW", {"tax_rate": 21.0, "surcharge_rate": 5.2})
    check("the line is inserted through `_insert_line`", (True, ""), (ok, err))
    check(
        "`invoice.lines` returns main rate + surcharge apart",
        [("21", "5.2")],
        read_lines("INV-NEW"),
    )


def test_legacy_line_is_readable_next_to_a_new_one():
    print(
        "\n== 3. a legacy line (no surcharge_rate bound → NULL) coexists and reads as it was =="
    )
    ok, _ = H.issue(
        "INV-OLD",
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        source_id=None,
        substitutes=None,
    )
    check("the invoice is issued", True, ok)
    # A legacy handler never bound `:surcharge_rate`; the shim binds absent params as NULL, exactly
    # like the runtime. Its `tax_rate` is the combined sum it always was.
    ok, err = line("INV-OLD", "L-OLD", {"tax_rate": 26.2})
    check("the legacy-shaped line is inserted", (True, ""), (ok, err))
    check(
        "the reader tells the generation by the NULL: legacy keeps its combined 26.2",
        [("26.2", "NULL")],
        read_lines("INV-OLD"),
    )


def test_migration_is_reentrant():
    print("\n== 4. re-applying 006 is a no-op (IF NOT EXISTS) ==")
    mig = MODULE_DIR / "migrations" / "postgres" / "006_line_surcharge_rate.sql"
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
            check("re-applying 006 does not fail", True, True)
        except RuntimeError as exc:
            check("re-applying 006 does not fail", True, str(exc).splitlines()[0])


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
        test_the_column_exists_and_defaults_to_null()
        test_new_generation_line_persists_main_rate_and_surcharge_apart()
        test_legacy_line_is_readable_next_to_a_new_one()
        test_migration_is_reentrant()
    finally:
        H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "OK: the invoice line freezes main rate and surcharge apart; legacy rows read as they were"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
