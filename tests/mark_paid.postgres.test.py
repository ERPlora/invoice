#!/usr/bin/env python3
"""«Mark as paid» only moves an ISSUED invoice of this hub, and says so when it does not — invoice#109.

Runs against a REAL Postgres 18 in Docker, applying the module's `migrations/postgres/*.sql` the
way the runtime does and executing the manifest's `sql[]` chain bound like the runtime binds it
(shared harness: `substitution_unique.postgres.test.py`).

What was wrong
--------------
`invoice.mark_paid` is a public door (no `_`): the invoice list, the invoice card, the API and the
assistant all reach it. Its UPDATE already filtered `status IN ('issued')`, so a paid, draft or
cancelled invoice — or an id of another hub, or no invoice at all — was left untouched… and the
command answered SUCCESS. The list offered «Mark as paid» on rows that were already paid; a row
that was paid in another tab still read «issued» on this one, the screen let the tap through, the
server said «done» and nothing had happened. The only refusal lived in the screen (`status !==
'issued'`), which the API and the assistant never pass through.

What this battery pins
----------------------
1. THE DOOR DECLARES ITS REFUSAL. `invoice.mark_paid` anchors an `expect_rows` gate (min 1 row)
   to its UPDATE: 0 rows moved → the runtime rolls back and answers the translatable code
   `invoice.cannot_mark_paid` (en + es in `locales/`), the same shape the state transitions of
   `appointments` use.
2. ONLY «ISSUED» MOVES. Issued → paid with the payment date; paid again, draft, cancelled or an
   unknown id → refused, and the refused attempt changes nothing (a paid invoice keeps its FIRST
   payment date).
3. TENANCY. An issued invoice of another hub, asked from this one, is refused and stays issued in
   its own hub; the same id from its own hub goes through.

The gate is evaluated the way the runtime counts it: rows moved by THAT statement, inside the
command's transaction, rolled back when below the minimum (hub#1091).

Usage: tests/mark_paid.postgres.test.py
  Uses the `erplora-test-pg-5433` container by default (override: INVOICE_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import importlib.util
import json
import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
MODULE_DIR = HERE.parent

_spec = importlib.util.spec_from_file_location(
    "invoice_refund_fixtures", HERE / "rectify_from_refund.postgres.test.py"
)
R = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R)
H = R.H
H.DB = f"invoice_mark_paid_test_{os.getpid()}"

failures = H.failures
check = H.check
literal = H.literal
q = H.q
MANIFEST = H.MANIFEST

CODE = "invoice.cannot_mark_paid"
COMMAND = "invoice.mark_paid"
LATER = "2026-08-19T09:30:00+00:00"


def gate() -> dict:
    return MANIFEST["commands"][COMMAND].get("expect_rows") or {}


def anchored_statement() -> str | None:
    """The statement whose rows the runtime counts: the declared one, or the only one."""
    expect = gate()
    chain = MANIFEST["commands"][COMMAND].get("sql") or []
    return expect.get("statement") or (chain[0] if len(chain) == 1 else None)


def mark_paid(invoice_id: str, hub: str, now: str = H.NOW) -> tuple[bool, str]:
    """`invoice.mark_paid` the way the runtime runs it: one transaction, the anchored statement's
    moved rows counted, COMMIT when they reach the gate's minimum and ROLLBACK + code otherwise.
    Without a gate the chain simply commits — which is what the command did before invoice#109."""
    expect = gate()
    anchor = anchored_statement() if expect else None
    params = {
        "invoice_id": invoice_id,
        "hub_id": hub,
        "current_user_id": H.USER,
        "now": now,
    }
    script = ["BEGIN;"]
    for rel in MANIFEST["commands"][COMMAND]["sql"]:
        sql = H.bind((MODULE_DIR / rel).read_text(), params).rstrip().rstrip(";")
        if rel == anchor:
            script.append(
                f"WITH g AS (\n{sql}\nRETURNING 1\n) SELECT count(*) AS gate_rows FROM g \\gset"
            )
        else:
            script.append(sql + ";")
    if anchor:
        script += [
            f"SELECT :gate_rows >= {int(expect.get('n', 1))} AS gate_ok \\gset",
            "\\if :gate_ok",
            "COMMIT;",
            "\\else",
            "ROLLBACK;",
            "\\echo GATE_REFUSED",
            "\\endif",
        ]
    else:
        script.append("COMMIT;")
    try:
        out = H.psql([], db=H.DB, stdin="\n".join(script))
    except RuntimeError as exc:
        return False, str(exc)
    if "GATE_REFUSED" in out:
        return False, expect.get("error") or "refused without a code"
    return True, ""


def issue(invoice_id: str, hub: str) -> None:
    ok, err = R.issue(
        invoice_id,
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        customer_tax_id="B12345678",
        hub=hub,
    )
    check(f"{invoice_id} is issued", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")


def set_status(invoice_id: str, hub: str, status: str) -> None:
    H.psql(
        [
            "-c",
            f"UPDATE invoice_invoice SET status = {literal(status)} "
            f"WHERE hub_id = {literal(hub)} AND id = {literal(invoice_id)}",
        ],
        db=H.DB,
    )


def state(invoice_id: str, hub: str) -> str:
    """`status|paid_at` — what the person sees change (or not) on the invoice."""
    return q(
        "SELECT status || '|' || COALESCE(paid_at, '') FROM invoice_invoice "
        f"WHERE hub_id = {literal(hub)} AND id = {literal(invoice_id)}"
    )


# ── 1. The door declares its refusal ───────────────────────────────────────────────────


def test_the_door_declares_a_translated_refusal():
    print(
        "\n== 1. `invoice.mark_paid` declares the gate, and the code is translated =="
    )
    expect = gate()
    check("expect_rows.error", CODE, expect.get("error"))
    check("expect_rows.op", "min", expect.get("op"))
    check("expect_rows.n", 1, expect.get("n"))
    check(
        "the gate counts the UPDATE that marks it paid",
        "commands/mark_paid.sql",
        anchored_statement(),
    )
    check(
        "a fallback sentence for codes a catalogue has not learned",
        True,
        bool(expect.get("message")),
    )
    for lang in ("en", "es"):
        errors = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text()).get(
            "errors", {}
        )
        check(f"locales/{lang}.json translates {CODE}", True, bool(errors.get(CODE)))


# ── 2. Only «issued» moves ─────────────────────────────────────────────────────────────


def test_only_an_issued_invoice_is_marked_paid():
    print("\n== 2. issued → paid; paid again, draft, cancelled, unknown → refused ==")
    hub = "hub-paid"
    issue("MP-1", hub)
    ok, err = mark_paid("MP-1", hub)
    check("an issued invoice is marked paid", (True, ""), (ok, err))
    check("paid, dated when it was marked", f"paid|{H.NOW}", state("MP-1", hub))

    ok, err = mark_paid("MP-1", hub, now=LATER)
    check("marking it paid AGAIN is refused", (False, CODE), (ok, err))
    check("and it keeps its first payment date", f"paid|{H.NOW}", state("MP-1", hub))

    for status in ("draft", "cancelled"):
        inv = f"MP-{status}"
        issue(inv, hub)
        set_status(inv, hub, status)
        ok, err = mark_paid(inv, hub)
        check(f"a {status} invoice is refused", (False, CODE), (ok, err))
        check(f"and stays {status}", f"{status}|", state(inv, hub))

    ok, err = mark_paid("MP-does-not-exist", hub)
    check("an id that is no invoice is refused", (False, CODE), (ok, err))


# ── 3. Tenancy ─────────────────────────────────────────────────────────────────────────


def test_an_invoice_of_another_hub_is_not_marked_from_this_one():
    print("\n== 3. tenancy: the neighbour's issued invoice, asked from our hub ==")
    ours, theirs = "hub-ours", "hub-theirs"
    issue("MP-N", theirs)
    ok, err = mark_paid("MP-N", ours)
    check("refused from our hub", (False, CODE), (ok, err))
    check("it stays issued in its own hub", "issued|", state("MP-N", theirs))
    check(
        "and nothing of it appears under ours",
        "0",
        q(f"SELECT count(*) FROM invoice_invoice WHERE hub_id = {literal(ours)}"),
    )
    ok, err = mark_paid("MP-N", theirs)
    check("the same id from its own hub goes through", (True, ""), (ok, err))
    check("paid in its own hub", f"paid|{H.NOW}", state("MP-N", theirs))


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
        test_the_door_declares_a_translated_refusal()
        test_only_an_issued_invoice_is_marked_paid()
        test_an_invoice_of_another_hub_is_not_marked_from_this_one()
    finally:
        H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — «Mark as paid» moves only an issued invoice of this hub, and refuses with a code otherwise (invoice#109)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
