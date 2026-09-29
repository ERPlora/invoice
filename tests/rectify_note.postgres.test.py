#!/usr/bin/env python3
"""A rectifying invoice stores no English sentence in its notes — invoice#124.

Runs against a REAL Postgres 18 in Docker, applying the module's `migrations/postgres/*.sql` the
way the runtime does and executing the manifest's `sql[]` chain bound like the runtime binds it
(shared harness: `substitution_unique.postgres.test.py`).

What was wrong
--------------
`commands/rectify_insert.sql` wrote `'Rectifies ' || number || '. Reason: ' || :reason` into
`notes`. The screen shows `notes` in the detail and sends it as the footer of the printed
document, so a Spanish business handed its customer a rectificativa that read «Rectifies
FACT-2026-000002. Reason: Error en el precio» — half English, half Spanish. The SQL cannot know
the business language; a sentence baked into a row can never follow it.

What this battery pins
----------------------
1. BOTH DOORS leave `notes` empty on the rectificativa (the manual `invoice.rectify` and the
   `sale.refunded` listener share the SQL). The reason stays where it already lived, verbatim, in
   `description`, and the link to the original in `rectifies_invoice_id`.
2. `invoice.get` answers `rectifies_number` — the NUMBER of the invoice it rectifies — so the
   screen composes «Rectifica a {number}. Motivo: {reason}» through i18n without a second read.
3. That number is read INSIDE the hub: a row of hub B pointing at an id of hub A resolves to
   nothing, never to hub A's number. An ordinary invoice answers no number.

Usage: tests/rectify_note.postgres.test.py
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
H.DB = f"invoice_rectify_note_test_{os.getpid()}"

failures = H.failures
check = H.check
literal = H.literal
q = H.q
run_command = H.run_command

REASON = "Error en el precio"


def get_invoice(invoice_id: str, hub: str) -> dict:
    """`invoice.get` the way the runtime runs it: the query file, bound with the hub."""
    sql = (MODULE_DIR / "queries/get.sql").read_text()
    bound = H.bind(sql, {"invoice_id": invoice_id, "hub_id": hub}).rstrip().rstrip(";")
    raw = q(f"SELECT row_to_json(r) FROM ({bound}) AS r")
    return json.loads(raw) if raw and raw.startswith("{") else {}


def rectification_of(original_id: str, hub: str) -> dict:
    raw = q(
        "SELECT row_to_json(r) FROM (SELECT id, notes, description FROM invoice_invoice "
        f"WHERE hub_id = {literal(hub)} AND rectifies_invoice_id = {literal(original_id)} "
        "AND is_deleted = 0) AS r"
    )
    return json.loads(raw) if raw and raw.startswith("{") else {}


def issue_manual(invoice_id: str, hub: str) -> None:
    ok, err = R.issue(
        invoice_id,
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        source_id=None,
        customer_tax_id="B12345678",
        hub=hub,
    )
    check(f"the original {invoice_id} is issued", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    R.add_line(invoice_id, f"{invoice_id}/L1", hub=hub)


# ── 1. Neither door writes a sentence into the notes ────────────────────────────────────


def test_the_manual_door_keeps_the_reason_and_writes_no_note():
    print("\n== 1a. `invoice.rectify` by hand: empty notes, the reason verbatim ==")
    hub = "hub-note-a"
    issue_manual("NM-1", hub)
    ok, err = run_command(
        "invoice.rectify",
        {"original_id": "NM-1", "new_id": str(uuid.uuid4()), "reason": REASON},
        hub,
    )
    check("the rectification is issued", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    r = rectification_of("NM-1", hub)
    check(
        "the rectificativa carries no hard-coded sentence in its notes",
        "",
        r.get("notes"),
    )
    check(
        "the reason is kept verbatim in the description", REASON, r.get("description")
    )


def test_the_refund_door_keeps_the_reason_and_writes_no_note():
    print("\n== 1b. the `sale.refunded` listener: empty notes, the reason verbatim ==")
    hub = "hub-note-b"
    ok, _ = R.issue("NR-1", source_id="sale-nr-1", hub=hub)
    check("the ticket is issued", True, ok)
    R.add_line("NR-1", "NR-1/L1", hub=hub)
    ok, err = R.on_refund(
        R.refunded_event(
            "sale-nr-1", refund_ref="DEV-NR-1", reason="Cliente insatisfecho"
        ),
        hub,
    )
    check("the refund issues the rectification", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    r = rectification_of("NR-1", hub)
    check(
        "the refund's rectificativa carries no sentence in its notes",
        "",
        r.get("notes"),
    )
    check(
        "the refund reason is kept verbatim",
        "Cliente insatisfecho",
        r.get("description"),
    )


# ── 2. `invoice.get` names the original by its number ───────────────────────────────────


def test_get_answers_the_number_of_the_original():
    print("\n== 2. `invoice.get` answers `rectifies_number` ==")
    hub = "hub-note-a"
    original = get_invoice("NM-1", hub)
    r = rectification_of("NM-1", hub)
    got = get_invoice(r.get("id", ""), hub)
    check("the original has a number", True, bool(original.get("number")))
    check(
        "the rectificativa answers the original's number",
        original.get("number"),
        got.get("rectifies_number"),
    )
    check(
        "an ordinary invoice answers no rectified number",
        None,
        original.get("rectifies_number"),
    )


# ── 3. …and only inside its own hub ─────────────────────────────────────────────────────


def test_the_rectified_number_never_crosses_hubs():
    print("\n== 3. a row of hub B pointing at hub A's id resolves to nothing ==")
    hub_b = "hub-note-other"
    ok, _ = R.issue(
        "NX-1", invoice_type="F1", series="FACT", source_type="manual", hub=hub_b
    )
    check("hub B has its own invoice", True, ok)
    # A forged link: hub B's row names hub A's original. The number must not leak.
    q(
        f"UPDATE invoice_invoice SET rectifies_invoice_id = {literal('NM-1')} "
        f"WHERE id = {literal('NX-1')} AND hub_id = {literal(hub_b)} RETURNING id"
    )
    got = get_invoice("NX-1", hub_b)
    check("hub B reads its own row", "NX-1", got.get("id"))
    check("hub A's number never reaches hub B", None, got.get("rectifies_number"))


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
        test_the_manual_door_keeps_the_reason_and_writes_no_note()
        test_the_refund_door_keeps_the_reason_and_writes_no_note()
        test_get_answers_the_number_of_the_original()
        test_the_rectified_number_never_crosses_hubs()
    finally:
        H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — a rectificativa stores no English sentence; the screen composes it (invoice#124)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
