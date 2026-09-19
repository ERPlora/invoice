#!/usr/bin/env python3
"""A rectifying invoice is dated on the BUSINESS's day, not on UTC's (invoice#78).

Runs against a REAL Postgres 18 in Docker, with the plumbing of `rectify_from_refund.postgres.test.py`
(the manifest's `sql[]` chains bound like the runtime binds them; a `:param` absent from the payload
is NULL).

WHAT IS UNDER TEST — and what it is protecting.

The handler already dates the invoices it issues on the business clock (`handler/src/lib.rs`,
`business_date_tests`). The declarative rectify chain is the other door that dates a fiscal
document by itself: nobody hands it a date when `sale.refunded` arrives at night, so it derived one
from `:now` — the runtime's instant, in UTC. A bar in Madrid that refunds a drink at 01:50 on the
19th would issue a rectificativa dated the 18th; on New Year's night, one from LAST year's RECT
series. The runtime binds the business zone as `:timezone` in every command (hub#1022); the chain
reads the date and the series year on that clock.

1. THE LISTENER at 01:50 in Madrid (23:50 UTC the day before) → the rectificativa is dated the 19th.
2. THE MANUAL DOOR on New Year's night → dated 2027, numbered and booked in the 2027 RECT series,
   the three statements that name the year agreeing with each other (ensure, bump, insert, ledger).
3. THE ZONE DECIDES, not a fixed offset: the same instant is still 2026 in the Canaries.
4. A RUNTIME OLDER THAN hub#1022 binds no `:timezone` (NULL) → the UTC date, exactly as before.
5. THE SETUP CHECKLIST judges the same fiscal year the documents are numbered in.

Usage: tests/business_date.postgres.test.py
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
    "invoice_refund_fixtures", HERE / "rectify_from_refund.postgres.test.py"
)
R = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R)
H = R.H
H.DB = f"invoice_business_date_test_{os.getpid()}"

failures = H.failures
check = H.check
literal = H.literal
q = H.q
qi = H.qi
run_command = H.run_command

MADRID = "Europe/Madrid"
CANARY = "Atlantic/Canary"
# 01:50 on 19/09 in Madrid (UTC+2 in summer) — UTC still says the 18th. The QA case.
NIGHT = "2026-09-18T23:50:00.123456789+00:00"
# 00:30 on 01/01/2027 in Madrid (UTC+1 in winter) — UTC still says 31/12/2026.
NEW_YEAR = "2026-12-31T23:30:00+00:00"


def rectification(original_id: str, hub: str) -> dict:
    raw = q(
        "SELECT row_to_json(r) FROM (SELECT issue_date, number, series FROM invoice_invoice "
        f"WHERE hub_id = {literal(hub)} AND rectifies_invoice_id = {literal(original_id)} "
        "AND is_deleted = 0) AS r"
    )
    return json.loads(raw) if raw and raw.startswith("{") else {}


def issue_original(invoice_id: str, hub: str, sale_id: str | None = None) -> None:
    """An invoice issued earlier in 2026 — the one about to be rectified."""
    ok, err = R.issue(
        invoice_id,
        invoice_type="F2" if sale_id else "F1",
        series="TICKET" if sale_id else "FACT",
        source_type="sale" if sale_id else "manual",
        source_id=sale_id,
        customer_tax_id="" if sale_id else "B12345678",
        hub=hub,
    )
    check(f"the original {invoice_id} is issued", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    R.add_line(invoice_id, f"{invoice_id}/L1", hub=hub)


def rectify_by_hand(original_id: str, hub: str, now: str, timezone: str | None) -> None:
    """`invoice.rectify` as the screen sends it since invoice#78: no `year`, no `issue_date` —
    the server dates the document. `timezone` is what the runtime binds (None = a runtime that
    predates hub#1022 and binds nothing)."""
    payload = {
        "original_id": original_id,
        "new_id": str(uuid.uuid4()),
        "reason": "Wrong amount",
        "now": now,
    }
    if timezone is not None:
        payload["timezone"] = timezone
    ok, err = run_command("invoice.rectify", payload, hub)
    check(f"the rectification of {original_id} succeeds", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")


# ── 1. The refund listener at night ─────────────────────────────────────────────────────


def test_a_refund_after_local_midnight_is_dated_on_the_business_day():
    print(
        "\n== 1. `sale.refunded` at 01:50 in Madrid: the rectificativa says the 19th =="
    )
    hub = "hub-night"
    issue_original("NIGHT-1", hub, sale_id="sale-night-1")
    ok, err = R.on_refund(
        {
            **R.refunded_event("sale-night-1", refund_ref="ref-night-1"),
            "now": NIGHT,
            "timezone": MADRID,
        },
        hub=hub,
    )
    check("the listener issues", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check(
        "dated on the business's day, not UTC's",
        "2026-09-19",
        rectification("NIGHT-1", hub).get("issue_date"),
    )


# ── 2. The manual door on New Year's night ──────────────────────────────────────────────


def test_new_years_night_rectifies_in_the_new_years_series():
    print(
        "\n== 2. `invoice.rectify` at 00:30 on 1 January in Madrid: a 2027 document =="
    )
    hub = "hub-new-year"
    issue_original("NY-1", hub)
    rectify_by_hand("NY-1", hub, NEW_YEAR, MADRID)
    doc = rectification("NY-1", hub)
    check("dated 1 January 2027", "2027-01-01", doc.get("issue_date"))
    check("numbered in the 2027 RECT series", "RECT-2027-000001", doc.get("number"))
    check(
        "the 2027 RECT series exists and handed out exactly one number",
        1,
        qi(
            "SELECT COALESCE(max(current_number), -1) FROM invoice_invoiceseries WHERE hub_id = "
            f"{literal(hub)} AND code = 'RECT' AND year = 2027"
        ),
    )
    check(
        "no 2026 RECT series was opened for it",
        0,
        qi(
            "SELECT count(*) FROM invoice_invoiceseries WHERE hub_id = "
            f"{literal(hub)} AND code = 'RECT' AND year = 2026"
        ),
    )
    check(
        "its number is booked in the 2027 ledger, pointing at the document (RD 1007/2023)",
        1,
        qi(
            "SELECT count(*) FROM invoice_number_allocation a JOIN invoice_invoice r "
            "ON r.id = a.invoice_id AND r.hub_id = a.hub_id "
            f"WHERE a.hub_id = {literal(hub)} AND a.code = 'RECT' AND a.year = 2027 "
            "AND r.rectifies_invoice_id = 'NY-1'"
        ),
    )


# ── 3. The zone decides, not an offset ──────────────────────────────────────────────────


def test_the_same_instant_is_still_last_year_in_the_canaries():
    print("\n== 3. the same instant in the Canaries (UTC+0 in winter): still 2026 ==")
    hub = "hub-canary"
    issue_original("CN-1", hub)
    rectify_by_hand("CN-1", hub, NEW_YEAR, CANARY)
    doc = rectification("CN-1", hub)
    check("dated 31 December 2026", "2026-12-31", doc.get("issue_date"))
    check("numbered in the 2026 RECT series", "RECT-2026-000001", doc.get("number"))


# ── 4. A runtime that predates hub#1022 ─────────────────────────────────────────────────


def test_without_a_zone_the_date_stays_on_utc():
    print(
        "\n== 4. no `:timezone` bound (runtime older than hub#1022): the UTC date, as before =="
    )
    hub = "hub-old-runtime"
    issue_original("OLD-1", hub)
    rectify_by_hand("OLD-1", hub, NIGHT, None)
    check(
        "the UTC date, unchanged",
        "2026-09-18",
        rectification("OLD-1", hub).get("issue_date"),
    )
    hub = "hub-utc"
    issue_original("UTC-1", hub)
    rectify_by_hand("UTC-1", hub, NIGHT, "UTC")
    check(
        "a hub whose zone IS UTC gets the UTC date",
        "2026-09-18",
        rectification("UTC-1", hub).get("issue_date"),
    )


# ── 5. The setup checklist ──────────────────────────────────────────────────────────────


def fiscal_year(now: str, timezone: str | None) -> object:
    params = {"hub_id": "hub-checklist", "now": now}
    if timezone is not None:
        params["timezone"] = timezone
    sql = (
        H.bind((MODULE_DIR / "queries" / "numbering_status.sql").read_text(), params)
        .rstrip()
        .rstrip(";")
    )
    raw = q(f"SELECT row_to_json(r) FROM ({sql}) AS r LIMIT 1")
    if not raw or not raw.startswith("{"):
        return raw
    return json.loads(raw).get("fiscal_year")


def test_the_checklist_judges_the_year_the_documents_are_numbered_in():
    print(
        "\n== 5. numbering status on New Year's night: the fiscal year is the business's =="
    )
    check("Madrid, 00:30 on 1 January → 2027", 2027, fiscal_year(NEW_YEAR, MADRID))
    check("no zone bound → the UTC year, as before", 2026, fiscal_year(NEW_YEAR, None))


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
        test_a_refund_after_local_midnight_is_dated_on_the_business_day()
        test_new_years_night_rectifies_in_the_new_years_series()
        test_the_same_instant_is_still_last_year_in_the_canaries()
        test_without_a_zone_the_date_stays_on_utc()
        test_the_checklist_judges_the_year_the_documents_are_numbered_in()
    finally:
        H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — a rectificativa is dated and numbered on the business's day (invoice#78)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
