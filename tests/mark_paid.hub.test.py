#!/usr/bin/env python3
"""«Mark as paid» against the REAL kernel — invoice#109.

`invoice.mark_paid` is a public door: the list, the invoice card, the API and the assistant reach
it. Its UPDATE only moves an `issued` invoice, but the command used to answer SUCCESS when it moved
nothing — a paid invoice marked «paid» again, a rectified (cancelled) one, an id that is no
invoice. The screen's own check (`status !== 'issued'`) only guarded the screen, and a row paid in
another tab still read «issued» there.

What this battery asserts, through `POST /api/command` on a running hub:

  1. An issued invoice is marked paid: status `paid`, with its payment date.
  2. Marking it paid AGAIN is refused with the domain code `invoice.cannot_mark_paid` — the code,
     never the prose — and its first payment date is kept.
  3. A rectified (cancelled) invoice and an id that is no invoice are refused with the same code.

Tenancy (another hub's invoice) is pinned by `mark_paid.postgres.test.py`: this harness always
talks as the runtime's own hub.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]` (module-toolkit#110). Never on its
own: without a runtime it fails, it does not skip.
"""

import sys

import hub_harness
from hub_harness import (
    ONE,
    Hub,
    ensure_business_identity,
    unique_series,
    unique_tag,
)

CODE = "invoice.cannot_mark_paid"


def issue(hub: Hub) -> dict:
    created = hub.run(
        "invoice.create",
        {
            "series_code": unique_series("paid"),
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
    return get(hub, created["new_ids"][0])


def get(hub: Hub, invoice_id: str) -> dict:
    return hub.query("invoice.get", {"invoice_id": invoice_id})[0]


def test_an_issued_invoice_is_marked_paid_once(hub: Hub) -> None:
    print("\n1 · issued → paid; paid again → refused, and the first payment date stays")
    inv = issue(hub)
    hub.check("it is born issued", inv.get("status"), "issued")
    hub.run("invoice.mark_paid", {"invoice_id": inv["id"]})
    paid = get(hub, inv["id"])
    hub.check("it is paid", paid.get("status"), "paid")
    hub.check_true("with its payment date", bool(paid.get("paid_at")), paid)
    hub.refused(
        "marking it paid again", "invoice.mark_paid", {"invoice_id": inv["id"]}, CODE
    )
    hub.check(
        "it keeps its first payment date",
        get(hub, inv["id"]).get("paid_at"),
        paid.get("paid_at"),
    )


def test_a_cancelled_or_unknown_invoice_is_refused(hub: Hub) -> None:
    print("\n2 · a rectified (cancelled) invoice and an unknown id are refused")
    inv = issue(hub)
    hub.run("invoice.rectify", {"original_id": inv["id"], "reason": "Wrong amount"})
    hub.check(
        "the original is cancelled", get(hub, inv["id"]).get("status"), "cancelled"
    )
    hub.refused(
        "marking a cancelled invoice paid",
        "invoice.mark_paid",
        {"invoice_id": inv["id"]},
        CODE,
    )
    hub.check(
        "it stays cancelled, without a payment date",
        (get(hub, inv["id"]).get("status"), get(hub, inv["id"]).get("paid_at")),
        ("cancelled", None),
    )
    hub.refused(
        "marking an id that is no invoice paid",
        "invoice.mark_paid",
        {"invoice_id": "00000000-0000-0000-0000-000000000000"},
        CODE,
    )


def main() -> int:
    hub = Hub("mark_paid.hub")
    print(
        f"Hub battery · mark_paid (invoice#109) · {hub_harness.BASE} · "
        f"hub {hub.hub_id} · user {hub.user}"
    )
    ensure_business_identity(hub)
    test_an_issued_invoice_is_marked_paid_once(hub)
    test_a_cancelled_or_unknown_invoice_is_refused(hub)
    return hub.finish(
        "«Mark as paid» moves only an issued invoice, and refuses everything else with a code"
    )


if __name__ == "__main__":
    sys.exit(main())
