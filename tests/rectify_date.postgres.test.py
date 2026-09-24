#!/usr/bin/env python3
"""A rectifying invoice is dated the day it is issued, and nobody can choose it — invoice#79.

Runs against a REAL Postgres 18 in Docker, applying the module's `migrations/postgres/*.sql` the
way the runtime does and executing the manifest's `sql[]` chain bound like the runtime binds it
(shared harness: `substitution_unique.postgres.test.py`).

What was wrong
--------------
`invoice.rectify` is a public door (no `_`), and its SQL took the payload's word for the date:
`issue_date = COALESCE(NULLIF(:issue_date, ''), <business day>)` and `year = COALESCE(:year,
<business year>)`. The screen stopped sending either in invoice#78, but the API and the assistant
could still send `issue_date: "2020-01-01"` and get a rectificativa dated then — numbered in a RECT
series of 2020 opened on the spot — and that is the date VeriFactu registers. The expedition date
of an invoice is the day it is issued (RD 1619/2012 art. 6.1.i and art. 15: a rectificativa is
issued when the correction is made), and it can never be earlier than the invoice it corrects.

What this battery pins
----------------------
1. THE CHAIN DATES IT ITSELF. Whatever `issue_date`/`year` the payload carries, the R1 is dated on
   the business day (`:now` in `:timezone`), numbered in that year's RECT series, and booked in
   that year's ledger — for the manual door AND for the refund listener, which shares the chain.
2. THE PUBLIC DOOR REFUSES A DATE IT WILL NOT HONOUR. Silently re-dating a document the caller
   explicitly dated would be a lie of its own, so `invoice.rectify` anchors an `expect_rows` gate
   to `commands/rectify_date_assert.sql`: an `issue_date` other than today, a `year` other than
   this one, or an original dated after today → the runtime rolls back and answers the
   translatable code `invoice.rectify_date_not_allowed` (en + es in `locales/`).
3. The gate is armed: the manifest declares it, the code is translated in both languages, and the
   anchored statement answers 0 rows exactly in the refused cases (evaluated here the way the
   runtime counts it: rows of THAT statement, hub#1091).

Usage: tests/rectify_date.postgres.test.py
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
H.DB = f"invoice_rectify_date_test_{os.getpid()}"

failures = H.failures
check = H.check
literal = H.literal
q = H.q
qi = H.qi
run_command = H.run_command
MANIFEST = H.MANIFEST

CODE = "invoice.rectify_date_not_allowed"
TODAY = H.NOW[
    :10
]  # 2026-08-18: the harness's `:now` is 10:00 UTC, the same day everywhere
YEAR = int(TODAY[:4])
MADRID = "Europe/Madrid"
# 23:30 UTC on the 18th is 01:30 on the 19th in Madrid (UTC+2 in summer).
NIGHT = "2026-08-18T23:30:00+00:00"


def rectification(original_id: str, hub: str) -> dict:
    raw = q(
        "SELECT row_to_json(r) FROM (SELECT id, issue_date, number FROM invoice_invoice "
        f"WHERE hub_id = {literal(hub)} AND rectifies_invoice_id = {literal(original_id)} "
        "AND is_deleted = 0) AS r"
    )
    return json.loads(raw) if raw and raw.startswith("{") else {}


def issue_original(invoice_id: str, hub: str, sale_id: str | None = None) -> None:
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


def gate() -> dict:
    return MANIFEST["commands"]["invoice.rectify"].get("expect_rows") or {}


def gate_rows(payload: dict, hub: str) -> object:
    """Rows of the statement the manifest anchors the gate to — what the runtime counts."""
    anchor = gate().get("statement")
    if not anchor:
        return "no anchored gate"
    params = {"hub_id": hub, "current_user_id": H.USER, "now": H.NOW, **payload}
    sql = H.bind((MODULE_DIR / anchor).read_text(), params).rstrip().rstrip(";")
    return qi(f"SELECT count(*) FROM ({sql}) AS g")


def rectify_gated(payload: dict, hub: str) -> tuple[bool, str]:
    """`invoice.rectify` the way the runtime runs it: the chain, and the anchored gate deciding
    whether it commits. The anchored statement is a pure read of state the chain does not change
    (the original's date), so evaluating it first is what the rollback would decide at the end."""
    expect = gate()
    rows = gate_rows(payload, hub)
    if not isinstance(rows, int) or rows < expect.get("n", 1):
        return False, expect.get("error") or f"gate not armed ({rows})"
    return run_command("invoice.rectify", payload, hub)


def payload(original_id: str, **extra) -> dict:
    return {
        "original_id": original_id,
        "new_id": str(uuid.uuid4()),
        "reason": "Wrong amount",
        **extra,
    }


# ── 1. The chain dates the document itself ──────────────────────────────────────────────


def test_the_chain_ignores_a_date_and_year_in_the_payload():
    print("\n== 1. the chain dates the R1 itself, whatever the payload says ==")
    hub = "hub-chain"
    issue_original("CH-1", hub)
    # Straight through the chain, no gate: this is what the refund listener runs too.
    ok, err = run_command(
        "invoice.rectify", payload("CH-1", issue_date="2020-01-01", year=2020), hub
    )
    check("the chain runs", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    doc = rectification("CH-1", hub)
    check("dated on the business day, not the payload's", TODAY, doc.get("issue_date"))
    check(
        "numbered in this year's RECT series", f"RECT-{YEAR}-000001", doc.get("number")
    )
    check(
        "no RECT series of the payload's year was opened",
        0,
        qi(
            "SELECT count(*) FROM invoice_invoiceseries WHERE hub_id = "
            f"{literal(hub)} AND code = 'RECT' AND year = 2020"
        ),
    )
    check(
        "its number is booked in this year's ledger, pointing at the document",
        1,
        qi(
            "SELECT count(*) FROM invoice_number_allocation a JOIN invoice_invoice r "
            "ON r.id = a.invoice_id AND r.hub_id = a.hub_id "
            f"WHERE a.hub_id = {literal(hub)} AND a.code = 'RECT' AND a.year = {YEAR} "
            "AND r.rectifies_invoice_id = 'CH-1'"
        ),
    )


def test_the_refund_listener_ignores_a_date_in_its_payload_too():
    print(
        "\n== 2. `sale.refunded` carrying a date: the listener dates it on the business day =="
    )
    hub = "hub-refund"
    issue_original("RF-1", hub, sale_id="sale-rf-1")
    ok, err = R.on_refund(
        {
            **R.refunded_event("sale-rf-1", refund_ref="ref-rf-1"),
            "issue_date": "2020-01-01",
            "year": 2020,
        },
        hub=hub,
    )
    check("the listener issues", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    doc = rectification("RF-1", hub)
    check("dated on the business day", TODAY, doc.get("issue_date"))
    check(
        "numbered in this year's RECT series", f"RECT-{YEAR}-000001", doc.get("number")
    )
    check(
        "booked in this year's ledger",
        1,
        qi(
            "SELECT count(*) FROM invoice_number_allocation WHERE hub_id = "
            f"{literal(hub)} AND code = 'RECT' AND year = {YEAR}"
        ),
    )


# ── 3. The public door refuses a date it will not honour ───────────────────────────────


def test_the_public_door_declares_a_translated_gate():
    print("\n== 3. `invoice.rectify` declares the gate, and the code is translated ==")
    expect = gate()
    check("expect_rows.error", CODE, expect.get("error"))
    check(
        "expect_rows.statement",
        "commands/rectify_date_assert.sql",
        expect.get("statement"),
    )
    check("expect_rows.n", 1, expect.get("n"))
    check(
        "the anchored statement is one of the command's own",
        True,
        expect.get("statement") in MANIFEST["commands"]["invoice.rectify"]["sql"],
    )
    check(
        "the internal refund door is NOT gated (an event must never dead-letter on a date)",
        None,
        MANIFEST["commands"]["invoice._rectify_from_refund"].get("expect_rows"),
    )
    for lang in ("en", "es"):
        errors = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text()).get(
            "errors", {}
        )
        check(f"locales/{lang}.json translates {CODE}", True, bool(errors.get(CODE)))
    check(
        "the rectify payload has a schema",
        "schemas/rectify.json",
        MANIFEST["commands"]["invoice.rectify"].get("schema"),
    )


def test_the_gate_answers_by_the_business_day():
    print(
        "\n== 4. the anchored statement: 1 row when the date is today, 0 otherwise =="
    )
    hub = "hub-gate"
    issue_original("GT-1", hub)
    cases = [
        ("no date, no year (the screen)", {}, 1),
        ("today, explicitly", {"issue_date": TODAY}, 1),
        ("an empty date is no date", {"issue_date": ""}, 1),
        ("this year, explicitly", {"year": YEAR}, 1),
        ("this year, as text", {"year": str(YEAR)}, 1),
        ("yesterday", {"issue_date": "2026-08-17"}, 0),
        ("tomorrow", {"issue_date": "2026-08-19"}, 0),
        ("another year's date", {"issue_date": "2020-01-01"}, 0),
        ("not a date at all", {"issue_date": "hello"}, 0),
        ("last year", {"year": YEAR - 1}, 0),
        ("today but last year", {"issue_date": TODAY, "year": YEAR - 1}, 0),
    ]
    for label, extra, want in cases:
        check(f"{label} → {want}", want, gate_rows(payload("GT-1", **extra), hub))
    print("   -- the business day, not UTC's: 01:30 on the 19th in Madrid --")
    night = {"now": NIGHT, "timezone": MADRID}
    check(
        "Madrid's today (the 19th) → 1",
        1,
        gate_rows(payload("GT-1", issue_date="2026-08-19", **night), hub),
    )
    check(
        "UTC's today (the 18th) → 0",
        0,
        gate_rows(payload("GT-1", issue_date="2026-08-18", **night), hub),
    )


def test_never_before_the_original():
    print("\n== 5. an original dated after today cannot be rectified today ==")
    hub = "hub-future"
    issue_original("FU-1", hub)
    H.psql(
        [
            "-c",
            "UPDATE invoice_invoice SET issue_date = '2026-08-20' "
            f"WHERE hub_id = {literal(hub)} AND id = 'FU-1'",
        ],
        db=H.DB,
    )
    check(
        "an original of the 20th, rectified on the 18th → 0",
        0,
        gate_rows(payload("FU-1"), hub),
    )
    issue_original("FU-2", hub)
    check("an original of today → 1", 1, gate_rows(payload("FU-2"), hub))
    print("   -- tenancy: a neighbour's future original is not read from our hub --")
    issue_original("FU-N", "hub-neighbour-future")
    H.psql(
        [
            "-c",
            "UPDATE invoice_invoice SET issue_date = '2026-08-20' "
            "WHERE hub_id = 'hub-neighbour-future' AND id = 'FU-N'",
        ],
        db=H.DB,
    )
    check(
        "the neighbour's id asked from our hub → 1 (not ours to judge)",
        1,
        gate_rows(payload("FU-N"), hub),
    )
    check(
        "the same id from its own hub → 0",
        0,
        gate_rows(payload("FU-N"), "hub-neighbour-future"),
    )


def test_a_refused_rectification_leaves_nothing_behind():
    print("\n== 6. refused end to end: no R1, no number, the original still issued ==")
    hub = "hub-refused"
    issue_original("RJ-1", hub)
    ok, err = rectify_gated(payload("RJ-1", issue_date="2026-08-17"), hub)
    check("refused", False, ok)
    check("with the translatable code", CODE, err)
    check("no R1", {}, rectification("RJ-1", hub))
    check(
        "no RECT number spent",
        0,
        qi(
            "SELECT COALESCE(max(current_number), 0) FROM invoice_invoiceseries WHERE hub_id = "
            f"{literal(hub)} AND code = 'RECT'"
        ),
    )
    check(
        "the original stays issued",
        "issued",
        q(
            f"SELECT status FROM invoice_invoice WHERE hub_id = {literal(hub)} AND id = 'RJ-1'"
        ),
    )
    ok, err = rectify_gated(payload("RJ-1"), hub)
    check("the same rectification without a date goes through", True, ok)
    check("dated today", TODAY, rectification("RJ-1", hub).get("issue_date"))


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
        test_the_chain_ignores_a_date_and_year_in_the_payload()
        test_the_refund_listener_ignores_a_date_in_its_payload_too()
        test_the_public_door_declares_a_translated_gate()
        test_the_gate_answers_by_the_business_day()
        test_never_before_the_original()
        test_a_refused_rectification_leaves_nothing_behind()
    finally:
        H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — a rectificativa is dated the day it is issued, never by the caller (invoice#79)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
