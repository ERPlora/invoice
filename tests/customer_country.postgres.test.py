#!/usr/bin/env python3
"""The customer's COUNTRY and DOCUMENT KIND travel with the invoice (ERPlora/hub#1967).

Runs against a REAL Postgres 18 in Docker, with the harness of `substitution_unique.postgres.test.py`
(the module's migrations applied like the runtime applies them, the manifest's `sql[]` bound like
the runtime binds them — a `:param` absent from the payload is NULL).

Why the test exists: an invoice to a customer from outside the EU was declared to the AEAT with
the customer as a Spanish `NIF` — the AEAT does not find it in its census and the record comes back
with errors, the chain number already spent. The hub's VeriFactu engine can declare a foreigner
(`IDOtro`) only if the invoice says WHERE the customer is from and WHAT document the number is.
Those two facts are part of the fiscal snapshot of the invoice (ADR-0132): a COPY, frozen at issue,
never re-read from the customer's file.

What is pinned:
1. `_insert_invoice` stores `customer_country` / `customer_id_type`.
2. A caller that does not know them (every caller before this version) stores '' — never NULL,
   which the engine would read as a value.
3. The rectifying invoice identifies the SAME customer as the invoice it rectifies: `rectify_insert`
   copies the two facts from the original, like it copies the tax id.
4. The migration is declared in the manifest and is re-entrant.

Usage: tests/customer_country.postgres.test.py
  Uses the `erplora-test-pg-5433` container by default (override: INVOICE_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import uuid

HERE = pathlib.Path(__file__).resolve().parent
MODULE_DIR = HERE.parent
_spec = importlib.util.spec_from_file_location(
    "invoice_pg_harness", HERE / "substitution_unique.postgres.test.py"
)
H = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(H)
H.DB = f"invoice_customer_country_test_{os.getpid()}"

failures = H.failures
check = H.check
psql = H.psql
q = H.q
literal = H.literal

MIGRATION = "migrations/postgres/012_customer_country.sql"
YEAR = "2026"


def issue(invoice_id: str, **customer) -> tuple[bool, str]:
    """`_ensure_series` → `_bump_series` → `_insert_invoice`: the op chain of one F1."""
    base = {
        "code": "FACT",
        "series": "FACT",
        "name": "FACT",
        "invoice_type": "F1",
        "year": YEAR,
        "prefix": "FACT",
        "source_type": "manual",
        "source_id": None,
    }
    ok, err = H.run_command("invoice._ensure_series", {**base, "new_id": str(uuid.uuid4())})
    if not ok:
        return ok, err
    ok, err = H.run_command("invoice._bump_series", base)
    if not ok:
        return ok, err
    return H.run_command(
        "invoice._insert_invoice",
        {
            **base,
            "invoice_id": invoice_id,
            "issue_date": H.NOW[:10],
            "issuer_nif": "B00000000",
            "issuer_name": "Test SL",
            "customer_tax_id": "123456789",
            "customer_name": "Client Inc",
            "customer_address": "1 Main St, Springfield",
            "description": "",
            "base_amount": 1000,
            "tax_amount": 210,
            "total_amount": 1210,
            "tax_breakdown": json.dumps({"21.00": {"base": 1000, "tax": 210}}),
            "substitutes_invoice_id": "",
            "notes": "",
            "business_tax_id": "B00000000",
            "business_legal_name": "Test SL",
            **customer,
        },
    )


def customer_of(where: str) -> str:
    return q(
        "SELECT coalesce(customer_country, '<null>') || '|' || coalesce(customer_id_type, '<null>') "
        f"FROM invoice_invoice WHERE hub_id = {literal(H.HUB)} AND {where}"
    )


def test_the_invoice_stores_the_customers_country_and_document():
    print("\n== 1. an invoice to a customer from the US keeps where they are from and their document ==")
    ok, err = issue("F1-US", customer_country="US", customer_id_type="03")
    check("the invoice is issued", True, ok)
    if not ok:
        print(f"    {err}")
    check("country and document kind are stored", "US|03", customer_of("id = 'F1-US'"))


def test_a_caller_that_does_not_know_them_stores_empty():
    print("\n== 2. a caller that sends neither (every caller before hub#1967) stores '' ==")
    ok, err = issue("F1-ES")
    check("the invoice is issued", True, ok)
    if not ok:
        print(f"    {err}")
    check("empty, never NULL", "|", customer_of("id = 'F1-ES'"))


def test_the_rectification_identifies_the_same_customer():
    print("\n== 3. the rectifying invoice declares the same foreign customer as the original ==")
    ok, err = H.run_command(
        "invoice.rectify",
        {
            "original_id": "F1-US",
            "new_id": "R-US",
            "year": YEAR,
            "issue_date": H.NOW[:10],
            "reason": "Customer returned the order",
        },
    )
    check("the rectification is issued", True, ok)
    if not ok:
        print(f"    {err}")
    check(
        "the R copies country and document kind from the original",
        "US|03",
        customer_of("rectifies_invoice_id = 'F1-US'"),
    )


def test_migration_is_declared_and_reentrant():
    print("\n== 4. the migration is declared and applying it twice is harmless ==")
    check("declared in module.json", True, MIGRATION in H.MANIFEST["migrations"]["postgres"])
    path = MODULE_DIR / MIGRATION
    check("the file exists", True, path.exists())
    if path.exists():
        try:
            psql([], db=H.DB, stdin=path.read_text())
            reapplied = True
        except RuntimeError as exc:
            print(f"    {exc}")
            reapplied = False
        check("re-applying it does not fail", True, reapplied)


def main() -> int:
    running = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", H.CONTAINER],
        capture_output=True,
        text=True,
    )
    if "true" not in running.stdout:
        subprocess.run(["docker", "start", H.CONTAINER], capture_output=True)

    psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])
    psql(["-c", f"CREATE DATABASE {H.DB}"])
    try:
        H.load_migrations()
        test_the_invoice_stores_the_customers_country_and_document()
        test_a_caller_that_does_not_know_them_stores_empty()
        test_the_rectification_identifies_the_same_customer()
        test_migration_is_declared_and_reentrant()
    finally:
        psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — the invoice keeps the customer's country and document kind, and so does its rectification")
    return 0


if __name__ == "__main__":
    sys.exit(main())
