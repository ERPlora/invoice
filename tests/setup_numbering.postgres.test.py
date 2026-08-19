#!/usr/bin/env python3
"""The numbering setup item — the one the hub's checklist shows (invoice#41, ADR-0063/0369).

Runs against the REAL Postgres 18 test container, applying the module's `migrations/postgres/*.sql`
the way the runtime does and evaluating `queries/numbering_status.sql` bound the way the runtime
binds it (`:hub_id`, `:now` injected).

Why the test exists. `invoice_series` declared a REQUIRED checklist item that asked the customer to
configure a series which never numbered a single invoice; ADR-0369 retires that module, and without
a replacement the hub would simply stop asking about numbering — while the series that DOES number
is born on its own at the first sale, prefix and all, with nobody ever having looked at it.

What the item must be honest about:
  * it is about the CURRENT fiscal year (the key is `(hub_id, code, year)`, so January starts over);
  * the AEAT wants a SEPARATE series for rectifying invoices (art. 6.1.a RD 1619/2012), so an
    ordinary series alone is NOT "configured";
  * `configured_when` may only name fields the query actually returns — a check on a missing column
    can never pass, and the item would sit pending forever with nothing to do about it.

Usage: tests/setup_numbering.postgres.test.py   (exit 0 = green)
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
H.DB = f"invoice_setup_numbering_test_{os.getpid()}"

failures = H.failures
check = H.check
HUB = H.HUB
OTHER_HUB = H.OTHER_HUB
MANIFEST = H.MANIFEST
SETUP = MANIFEST.get("setup", {})
YEAR = H.NOW[:4]  # the runtime's `:now` is the only clock the query has


def status(hub: str = HUB) -> dict:
    """The first row of the setup query, which is what the runtime evaluates."""
    sql = (
        H.bind(
            (MODULE_DIR / "queries" / "numbering_status.sql").read_text(),
            {"hub_id": hub, "now": H.NOW},
        )
        .rstrip()
        .rstrip(";")
    )
    raw = H.q(f"SELECT row_to_json(r) FROM ({sql}) AS r LIMIT 1")
    if not raw or "<sql error" in raw:
        return {"__error__": raw}
    return json.loads(raw)


def configured(hub: str = HUB) -> bool:
    """Apply `configured_when` exactly as the runtime does: ALL checks on the FIRST row."""
    row = status(hub)
    if "__error__" in row:
        return False
    for c in SETUP.get("configured_when", []):
        value = row.get(c["field"])
        if "truthy" in c and bool(c["truthy"]) != bool(
            value not in (None, 0, "0", "", False)
        ):
            return False
        if "equals" in c and str(value) != str(c["equals"]):
            return False
    return True


def create_series(
    code: str, invoice_type: str, year: str, *, hub: str = HUB
) -> tuple[bool, str]:
    """The real door a user goes through in the Settings tab."""
    return H.run_command(
        "invoice.series.create",
        {
            "new_id": str(uuid.uuid4()),
            "code": code,
            "name": code,
            "invoice_type": invoice_type,
            "year": year,
            "prefix": code,
            "is_active": 1,
            "is_default": 0,
        },
        hub,
    )


# ── 1. The manifest declares the item, at the level and the slot the core assigned ───────


def test_the_setup_block_is_declared():
    print(
        "\n== 1. the `setup` block: functional, at the numbering slot, pointing at Settings =="
    )
    check(
        "the query is the module's own numbering status",
        "invoice.numbering.status",
        SETUP.get("query"),
    )
    check(
        "it is declared as a query of this module",
        True,
        "invoice.numbering.status" in MANIFEST["queries"],
    )
    # `required: true` is what the core reads as 🔴 functional. NOT ⛔ blocking: that list is the
    # core's, and a module may not proclaim itself a blocker of the sale.
    check(
        "level functional (`required: true`), never blocking",
        True,
        SETUP.get("required"),
    )
    check("the slot the core reserved for invoice numbering", 50, SETUP.get("order"))
    check(
        "it routes to the Settings tab of THIS module",
        "/m/invoice/settings",
        SETUP.get("route"),
    )
    check(
        "acting on it needs the series permission",
        "invoice.manage_series",
        SETUP.get("permission"),
    )
    check(
        "it applies to every country (numbering is not a Spanish idea)",
        [],
        SETUP.get("countries"),
    )


def test_configured_when_only_names_fields_the_query_returns():
    print("\n== 2. every `configured_when` field is a real column of the query ==")
    row = status()
    check("the query answers", True, "__error__" not in row)
    fields = [c["field"] for c in SETUP.get("configured_when", [])]
    check(
        "both halves are checked: an ordinary series AND a rectifying one",
        ["ordinary_series", "rectifying_series"],
        fields,
    )
    for f in fields:
        check(f"`{f}` is a column the query returns", True, f in row)


# ── 3. A fresh hub: one row, and NOT configured ──────────────────────────────────────────


def test_a_fresh_hub_is_not_configured_but_still_answers():
    print(
        "\n== 3. a hub with no series at all: ONE row, everything at zero, not configured =="
    )
    row = status()
    # It is an aggregate on purpose: ADR-0063's "no row ⇒ not configured" case can never happen
    # here, so the verdict is carried by the numbers, which is also what the assistant can explain.
    check(
        "it answers with a row even with nothing configured",
        True,
        "__error__" not in row,
    )
    check("no ordinary series", 0, row.get("ordinary_series"))
    check("no rectifying series", 0, row.get("rectifying_series"))
    check("it reports the fiscal year it judged", int(YEAR), row.get("fiscal_year"))
    check("the item is PENDING", False, configured())


# ── 4. The series born on its own is not enough ──────────────────────────────────────────


def test_the_auto_born_ticket_series_alone_does_not_tick_the_item():
    print(
        "\n== 4. the first sale is numbered → an F2 series exists, and the item is STILL pending =="
    )
    ok, err = H.issue(
        "F2-1",
        invoice_type="F2",
        series="TICKET",
        source_type="sale",
        source_id="sale-1",
        substitutes=None,
    )
    check(
        "the ticket is issued (the series is ensured on first use)",
        (True, ""),
        (ok, err),
    )
    row = status()
    check("the ordinary series counts", 1, row.get("ordinary_series"))
    check("there is still no rectifying series", 0, row.get("rectifying_series"))
    # This is the whole point of the item: the AEAT wants the rectifying series SEPARATE
    # (art. 6.1.a RD 1619/2012), and no sale will ever create it by itself.
    check("the item is STILL pending", False, configured())


def test_creating_the_rectifying_series_ticks_the_item():
    print(
        "\n== 5. the user creates the rectifying series in Settings → the item is done =="
    )
    ok, err = create_series("RECT", "R1", YEAR)
    check(
        "the series is created through `invoice.series.create`", (True, ""), (ok, err)
    )
    row = status()
    check("the rectifying series counts", 1, row.get("rectifying_series"))
    check("the item is DONE", True, configured())


# ── 6. It is about the CURRENT year, and about THIS hub ──────────────────────────────────


def test_last_years_series_do_not_tick_this_years_item():
    print("\n== 6. a series of another fiscal year does not answer for this one ==")
    previous = str(int(YEAR) - 1)
    ok, err = create_series("OLDR", "R1", previous, hub=OTHER_HUB)
    check("the neighbour gets a series of the previous year", (True, ""), (ok, err))
    row = status(OTHER_HUB)
    check(
        "it does not count as this year's rectifying series",
        0,
        row.get("rectifying_series"),
    )
    check("the neighbour's item is pending", False, configured(OTHER_HUB))


def test_a_live_neighbour_does_not_tick_our_item():
    print(
        "\n== 7. a LIVE neighbouring hub with everything configured leaves us alone =="
    )
    ok, _ = create_series("FACT", "F1", YEAR, hub=OTHER_HUB)
    ok2, _ = create_series("RECT", "R1", YEAR, hub=OTHER_HUB)
    check("the neighbour configures both series", (True, True), (ok, ok2))
    check("the neighbour is now done", True, configured(OTHER_HUB))
    check(
        "...and it counts only its own", 1, status(OTHER_HUB).get("rectifying_series")
    )
    check("our hub is unaffected and still done", True, configured())
    check(
        "our counts did not absorb the neighbour's",
        1,
        status().get("rectifying_series"),
    )


# ── 8. What the user is actually told ────────────────────────────────────────────────────


def test_the_text_says_what_the_user_must_do():
    print(
        "\n== 8. the wording: review the prefix, and continue the numbering you already had =="
    )
    en = json.loads((MODULE_DIR / "locales" / "en.json").read_text())
    es = json.loads((MODULE_DIR / "locales" / "es.json").read_text())
    check(
        "English is the canonical source, in the manifest",
        True,
        bool(SETUP.get("title")),
    )
    check(
        "...and it has its Spanish translation",
        True,
        bool(es.get("setup", {}).get("title")),
    )
    check(
        "English carries the key too (ADR-0055)",
        True,
        bool(en.get("setup", {}).get("title")),
    )

    body = (
        SETUP.get("description", "") + " " + en.get("setup", {}).get("description", "")
    ).lower()
    check("it tells the user to check the prefix", True, "prefix" in body)
    # The nº1 failure when adapting to VeriFactu is interleaving series: someone starts at 1 in the
    # new system while the old one had reached 3.480.
    check(
        "it tells them to continue the numbering they came with",
        True,
        "continue" in body and ("numbering" in body or "number" in body),
    )
    es_body = es.get("setup", {}).get("description", "").lower()
    check("the Spanish says the same about the prefix", True, "prefijo" in es_body)
    check(
        "...and about continuing the previous numbering",
        True,
        "numeraci" in es_body and "contin" in es_body,
    )


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
        test_the_setup_block_is_declared()
        test_configured_when_only_names_fields_the_query_returns()
        test_a_fresh_hub_is_not_configured_but_still_answers()
        test_the_auto_born_ticket_series_alone_does_not_tick_the_item()
        test_creating_the_rectifying_series_ticks_the_item()
        test_last_years_series_do_not_tick_this_years_item()
        test_a_live_neighbour_does_not_tick_our_item()
        test_the_text_says_what_the_user_must_do()
    finally:
        H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — the checklist asks for this year's numbering, rectifying series included"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
