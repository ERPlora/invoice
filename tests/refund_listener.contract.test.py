#!/usr/bin/env python3
"""A refund leaves a credit note behind it, or the money goes back and the invoice still lies
(invoice#62).

THE DEFECT. `sales` v2.16.4 refunds a COMPLETED sale by eligible tender (sales#160, ADR-0386) and
emits `sale.refunded`. `cash_register` v1.3.38 already listens to it and books the drawer movement.
This module did not listen at all: `events.listen` carried exactly one entry, `sale.completed` →
`invoice.create_from_sale`. So the cash came out of the till, the drawer was reconciled — and the
invoice (and its VeriFactu record) went on saying the money had been collected. The fiscal half was
left to whoever remembered to open `invoice` and run `invoice.rectify` by hand.

WHAT THE LISTENER MAY DO, AND WHEN. Deliberately NOT what the issue first proposed
(«emit when `document_type == "invoice"`, a POS ticket carries no invoice to rectify»): that premise
is false against this module. `invoice.create_from_sale` issues a row for EVERY completed sale — F1
with `document_type='invoice'`, F2 (simplified) otherwise — and both are ingested into the VeriFactu
chain by `verifactu.records.ingest_invoice`. Filtering by `document_type` would leave every POS
ticket refund out of the fiscal chain, which is the exact hole invoice#5 closed. The recipient-less
case needs nothing here either: the core downgrades R1 → R5 on its own when the invoice carries no
`customer_tax_id` (`crates/verifactu/src/lib.rs::resolve_invoice_type`), which IS the
«rectificativa de factura simplificada» the AEAT asks for.

What the listener does filter on is FULLNESS, decided by the money and not by the document type —
see `commands/rectify_bump.sql`. A refund that leaves part of the invoice standing needs a
rectificativa POR DIFERENCIAS whose base and quota are a proration of the original's frozen
`tax_breakdown`, and that arithmetic (with its cent residual, and with a second partial refund
having to prorate over what is LEFT) is its own contract: invoice#63.

THE COMMAND IS INTERNAL. `invoice._rectify_from_refund` is reachable only by the outbox relay
(`Origin::Internal`, hub#131/#145 — the `_` in the last segment and `internal: true` both say so).
That is what lets it read `refund_ref` and `fully_refunded` off the payload at all: the payload is
one `sales` handler's output replayed by the runtime, never a caller's. Everything that CAN be
checked against this module's own rows still is — the original is resolved from `invoice_invoice`
by `source_id`, never named by the payload.

Usage: tests/refund_listener.contract.test.py   (exit 0 = green). No Postgres, no Docker.
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

LISTENER = "invoice._rectify_from_refund"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def check_listener_is_declared() -> None:
    listen = MANIFEST.get("events", {}).get("listen", {})

    # Compatibility (invoice#62 §3): a hub running a `sales` older than v2.16.4 never emits
    # `sale.refunded`, so it must keep behaving exactly as before — which means the entry that was
    # already there is untouched and the new one is purely ADDITIVE.
    completed = listen.get("sale.completed", {}).get("command")
    if completed != "invoice.create_from_sale":
        fail(
            "`sale.completed` no longer maps to `invoice.create_from_sale` "
            f"(got {completed!r}): a hub with an older `sales` must be unaffected by this change"
        )

    refunded = listen.get("sale.refunded", {}).get("command")
    if refunded != LISTENER:
        fail(
            f"`events.listen['sale.refunded']` is {refunded!r}, expected {LISTENER!r} — "
            "the money goes back and no rectifying invoice is issued"
        )


def check_command_contract() -> None:
    cmd = MANIFEST.get("commands", {}).get(LISTENER)
    if cmd is None:
        fail(f"`{LISTENER}` is not declared in `commands`")
        return

    if cmd.get("internal") is not True:
        fail(
            f"`{LISTENER}` must declare `internal: true`: it trusts its payload because only the "
            "outbox relay can call it, and that is what the origin gate enforces"
        )

    if cmd.get("transaction") is not True:
        fail(
            f"`{LISTENER}` must declare `transaction: true`: the number bump, the insert, the "
            "lines, the allocation and the cancellation are one fiscal act or none"
        )

    if cmd.get("emit") != ["invoice.rectified"]:
        fail(
            f"`{LISTENER}` must emit exactly ['invoice.rectified'] (got {cmd.get('emit')!r}) — "
            "it is the event `verifactu.records.ingest_invoice` listens to"
        )

    rectify = MANIFEST.get("commands", {}).get("invoice.rectify", {})
    if cmd.get("permission") != rectify.get("permission"):
        fail(
            f"`{LISTENER}` gates {cmd.get('permission')!r} but `invoice.rectify` gates "
            f"{rectify.get('permission')!r}: the same fiscal act cannot have two permissions"
        )

    # ONE chain, not a copy of it. The statements are `invoice.rectify`'s own files: a second set
    # would mean a second copy of the document-number template, and this module already carries
    # three of those with a "touch one, touch all three" warning on top (`rectify_insert.sql`).
    if cmd.get("sql") != rectify.get("sql"):
        fail(
            f"`{LISTENER}` declares a DIFFERENT sql[] than `invoice.rectify`:\n"
            f"    listener: {cmd.get('sql')!r}\n"
            f"    manual:   {rectify.get('sql')!r}\n"
            "  the two doors must walk the same chain or the number format drifts between them"
        )

    if cmd.get("handler") is not None:
        fail(
            f"`{LISTENER}` declares a WASM handler. It must stay DECLARATIVE: the module gate "
            "starts a real Postgres and runs `tests/*.postgres.test.py`, but it never compiles "
            "`handler/` to wasm32 nor runs its `cargo test` — it says so out loud. Fiscal "
            "arithmetic the gate cannot execute is fiscal arithmetic nobody checks."
        )


def check_it_is_invisible_from_outside() -> None:
    """The origin gate keys off the LAST SEGMENT starting with `_` (hub#131) as well as
    `internal: true`. Both are declared on purpose: the name is what a reader sees."""
    last = LISTENER.rsplit(".", 1)[-1]
    if not last.startswith("_"):
        fail(
            f"`{LISTENER}`'s last segment is {last!r}: an event listener that believes its "
            "payload must also be unreachable from `POST /api/command`"
        )


def main() -> int:
    check_listener_is_declared()
    check_command_contract()
    check_it_is_invisible_from_outside()

    if failures:
        print(f"\nFAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "\nOK: `sale.refunded` reaches one internal, declarative, transactional chain"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
