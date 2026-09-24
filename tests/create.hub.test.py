#!/usr/bin/env python3
"""Direct invoicing of `invoice` — numbering and rectification — against the REAL kernel. Ported
from the hub's `invoice_e2e.rs` (ERPlora/hub#1264, contract «El Hub se CIERRA como KERNEL» §5: the
module proves its own behaviour; the hub keeps only the conformance of its fixture).

`invoice.create` and `invoice.create_from_sale` are Tier 2 (WASM) handlers: they run inside the
runtime, with the ids the host minted and the `reads` the dispatcher pre-loaded. `invoice.rectify`
is Tier 0/1 (declarative SQL) but reaches the same fiscal tables. So the only place their promises
can be checked is a running hub, through `POST /api/command` and `POST /api/query`. Every number
below is the one the hub's e2e asserted, in cents (ADR-0007/0123) and 10^6 fixed-point quantities
(ADR-0147):

  1. `invoice.create` with 2 lines writes the series (ensured + bumped), the header and its lines
     in one transaction (`operations` = 5), numbers it `<series>-000001` on a fresh series, and
     gets the line-level VAT right (2 rates, tax-excluded).
  2. The SAME series numbers its second invoice `-000002` — atomic, sequential, per `(hub_id,
     code, year)` (`commands/_ensure_series.sql`).
  3. `invoice.rectify` issues an R1 with every amount NEGATED, under its own `RECT` series, and
     cancels the original (`status = 'cancelled'`) — the original's money never double-counts.
  4. `invoice.rectify` dates the R1 itself, on the business day (invoice#79): a date other than
     today, a year other than this one or an original dated after today is refused with
     `invoice.rectify_date_not_allowed` (HTTP 409) and nothing is written; today's date sent
     explicitly, or no date at all, is accepted and the R1 is dated today. The business's today is
     the original's own `issue_date`: the handler dated it with the same clock (invoice#78).

What the hub's e2e checked structurally (`install_registers_capabilities`: the module installs,
`invoice.create`/`invoice.rectify` are registered commands, `invoice.create_from_sale` listens to
`sale.completed`) is not a section of its own here: [`hub_harness.Hub._require_installed`] already
fails loudly if `invoice` (or its `taxes`/`sales` chain) is not installed, every section below
calls a registered command successfully, and the listener registration is what
`tests/from_sale.hub.test.py` exercises behaviourally (an auto-F2 cannot exist unless the listener
fired). The kernel's own promise — that installing a module registers every surface it
declares — is `kernel_conformance_install::installing_registers_every_declared_surface_hub1238`.

The kernel's fiscal precondition gate (ADR-0203, hub#328) is NOT re-proven here: it is the
KERNEL's contract, proven by its own fixture (hub#1264 §5). [`hub_harness.ensure_business_identity`]
only satisfies it once per run — the same write the fiscal setup wizard makes — so `invoice`'s own
numbering/rectification logic can be exercised at all.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]` (module-toolkit#110). Never on its
own: without a runtime it fails, it does not skip.
"""

import datetime
import sys

import hub_harness
from hub_harness import (
    ONE,
    Hub,
    cents,
    ensure_business_identity,
    unique_series,
    unique_tag,
)


def suffix(number: str) -> str:
    """`FACT7F3A2B-2026-000001` → `000001`: the atomic per-series counter is the last
    dash-separated group."""
    return number.rsplit("-", 1)[1]


def test_a_two_line_invoice_writes_series_header_and_lines(hub: Hub) -> None:
    print(
        "\n1 · invoice.create writes the series, the header and its lines, numbered -000001"
    )
    series = unique_series("create")
    customer = unique_tag("ACME")
    out = hub.run(
        "invoice.create",
        {
            "series_code": series,
            # A throwaway series code is never literally "FACT" (`unique_series`'s own point:
            # a series `series_defaults` does not recognise defaults to F2 — `handler/src/lib.rs`
            # `series_defaults`), so a caller choosing a COMPLETE-invoice series says so explicitly,
            # exactly like the screen that lets an operator pick an F1 series would.
            "invoice_type": "F1",
            "customer_name": customer,
            "customer_tax_id": "B99999999",
            "items": [
                {
                    "description": "Consultoría",
                    "quantity": ONE,
                    "unit_price": 10000,
                    "tax_rate": 21.0,
                },
                {
                    "description": "Soporte",
                    "quantity": 2 * ONE,
                    "unit_price": 5000,
                    "tax_rate": 10.0,
                },
            ],
        },
    )
    # ensure_series + bump_series + insert_invoice + 2 insert_line (invoice_e2e.rs's own count).
    hub.check("operations of a fresh two-line invoice", out.get("operations"), 5)
    invoice_id = (out.get("new_ids") or [None])[0]
    hub.check_true(
        "new_ids[0] names the invoice (handler/src/lib.rs: `new_ids.first()`)",
        isinstance(invoice_id, str) and invoice_id != "",
        str(out),
    )

    inv = hub.query("invoice.get", {"invoice_id": invoice_id})
    hub.check("the invoice is readable by that id", len(inv), 1)
    inv = inv[0] if inv else {}
    hub.check("invoice_type", inv.get("invoice_type"), "F1")
    number = inv.get("number") or ""
    hub.check_true(
        f"a FRESH series numbers its first invoice -000001: {number!r}",
        number.endswith("-000001"),
        number,
    )
    hub.check(
        "base = 100€ (10000×1) + 100€ (5000×2), cents",
        cents(inv.get("base_amount")),
        20000,
    )
    hub.check(
        "tax = 21% of 10000 + 10% of 10000, cents", cents(inv.get("tax_amount")), 3100
    )
    hub.check("total = base + tax, cents", cents(inv.get("total_amount")), 23100)

    lines = hub.query("invoice.lines", {"invoice_id": invoice_id})
    hub.check("two lines", len(lines), 2)


def test_the_same_series_numbers_its_second_invoice_next(hub: Hub) -> None:
    print(
        "\n2 · a FRESH series numbers its second invoice -000002 (atomic, sequential)"
    )
    series = unique_series("second")
    payload = {
        "series_code": series,
        "customer_name": unique_tag("ACME"),
        "customer_tax_id": "B99999999",
        "items": [
            {"description": "X", "quantity": ONE, "unit_price": 1000, "tax_rate": 21.0}
        ],
    }
    first = hub.run("invoice.create", payload)
    second = hub.run("invoice.create", payload)
    first_inv = hub.query("invoice.get", {"invoice_id": first["new_ids"][0]})[0]
    second_inv = hub.query("invoice.get", {"invoice_id": second["new_ids"][0]})[0]
    hub.check("first invoice of a fresh series", suffix(first_inv["number"]), "000001")
    hub.check(
        "second invoice of the SAME series", suffix(second_inv["number"]), "000002"
    )


def test_rectify_negates_and_cancels_the_original(hub: Hub) -> None:
    print("\n3 · invoice.rectify issues a negated R1 and cancels the original")
    series = unique_series("rect")
    original = hub.run(
        "invoice.create",
        {
            "series_code": series,
            "customer_name": unique_tag("ACME"),
            "customer_tax_id": "B99999999",
            "items": [
                {
                    "description": "X",
                    "quantity": ONE,
                    "unit_price": 10000,
                    "tax_rate": 21.0,
                }
            ],
        },
    )
    orig_id = original["new_ids"][0]
    orig = hub.query("invoice.get", {"invoice_id": orig_id})[0]
    hub.check("original total = 100€ + 21%, cents", cents(orig["total_amount"]), 12100)

    rect = hub.run(
        "invoice.rectify",
        {"original_id": orig_id, "reason": "Error en importe"},
    )
    # `commands/rectify_insert.sql` binds the header's PK to `:new_id` — the same single id
    # `execute_at`'s declarative Tier 0/1 path reports back (commands.rs: `bound.get("new_id")`).
    rect_id = (rect.get("new_ids") or [None])[0]
    hub.check_true(
        "invoice.rectify answers the id of the R1 it minted",
        isinstance(rect_id, str) and rect_id != "",
        str(rect),
    )
    rect_inv = hub.query("invoice.get", {"invoice_id": rect_id})
    hub.check("the R1 is readable by that id", len(rect_inv), 1)
    rect_inv = rect_inv[0] if rect_inv else {}
    hub.check("invoice_type", rect_inv.get("invoice_type"), "R1")
    hub.check("amounts NEGATED", cents(rect_inv.get("total_amount")), -12100)
    hub.check(
        "the RECT series prefixes the number",
        (rect_inv.get("number") or "").startswith("RECT-"),
        True,
    )

    cancelled = hub.query("invoice.get", {"invoice_id": orig_id})[0]
    hub.check(
        "the original is cancelled, never deleted", cancelled.get("status"), "cancelled"
    )


# ── invoice#79: the server dates a rectificativa ─────────────────────────────────────────

CODE = "invoice.rectify_date_not_allowed"


def issue_original(hub: Hub) -> dict:
    created = hub.run(
        "invoice.create",
        {
            "series_code": unique_series("rdate"),
            "customer_name": unique_tag("ACME"),
            "customer_tax_id": "B99999999",
            "items": [
                {
                    "description": "X",
                    "quantity": ONE,
                    "unit_price": 10000,
                    "tax_rate": 21.0,
                }
            ],
        },
    )
    return hub.query("invoice.get", {"invoice_id": created["new_ids"][0]})[0]


def status_of(hub: Hub, invoice_id: str) -> str:
    return hub.query("invoice.get", {"invoice_id": invoice_id})[0].get("status")


def test_a_date_other_than_today_is_refused(hub: Hub) -> None:
    print(
        "\n1 · a rectificativa dated on any other day is refused, and nothing is written"
    )
    orig = issue_original(hub)
    today = datetime.date.fromisoformat(orig["issue_date"])
    for label, extra in (
        ("yesterday", {"issue_date": (today - datetime.timedelta(days=1)).isoformat()}),
        ("tomorrow", {"issue_date": (today + datetime.timedelta(days=1)).isoformat()}),
        ("another year's date", {"issue_date": "2020-01-01"}),
        ("last year's series", {"year": today.year - 1}),
    ):
        hub.refused(
            f"rectify dated {label}",
            "invoice.rectify",
            {"original_id": orig["id"], "reason": "Wrong amount", **extra},
            CODE,
        )
    hub.check("the original is still issued", status_of(hub, orig["id"]), "issued")


def test_today_explicitly_is_accepted(hub: Hub) -> None:
    print("\n2 · today's date, sent explicitly, is accepted")
    orig = issue_original(hub)
    rect = hub.run(
        "invoice.rectify",
        {
            "original_id": orig["id"],
            "reason": "Wrong amount",
            "issue_date": orig["issue_date"],
        },
    )
    doc = hub.query("invoice.get", {"invoice_id": rect["new_ids"][0]})[0]
    hub.check("the R1 is dated today", doc.get("issue_date"), orig["issue_date"])
    hub.check("the original is cancelled", status_of(hub, orig["id"]), "cancelled")


def test_no_date_is_dated_today_by_the_server(hub: Hub) -> None:
    print("\n3 · no date (the screen): the server dates it today")
    orig = issue_original(hub)
    rect = hub.run(
        "invoice.rectify", {"original_id": orig["id"], "reason": "Wrong amount"}
    )
    doc = hub.query("invoice.get", {"invoice_id": rect["new_ids"][0]})[0]
    hub.check("the R1 is dated today", doc.get("issue_date"), orig["issue_date"])


def main() -> int:
    hub = Hub("create.hub")
    print(
        f"Hub battery · create (hub#1264 ← invoice_e2e.rs) · {hub_harness.BASE} · "
        f"hub {hub.hub_id} · user {hub.user}"
    )
    ensure_business_identity(hub)
    test_a_two_line_invoice_writes_series_header_and_lines(hub)
    test_the_same_series_numbers_its_second_invoice_next(hub)
    test_rectify_negates_and_cancels_the_original(hub)
    test_a_date_other_than_today_is_refused(hub)
    test_today_explicitly_is_accepted(hub)
    test_no_date_is_dated_today_by_the_server(hub)
    return hub.finish(
        "direct invoicing keeps every promise the hub's e2e used to assert, against the real kernel"
    )


if __name__ == "__main__":
    sys.exit(main())
