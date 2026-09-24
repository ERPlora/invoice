#!/usr/bin/env python3
"""The server dates a rectificativa, and refuses a date it will not honour — invoice#79, against the
REAL kernel.

`invoice.rectify` is a public door: the screen, the API and the assistant all reach it. Before this
battery the chain took an `issue_date`/`year` from the payload at face value, so any caller with the
rectify permission could date the document — and the VeriFactu record — on any day of any year.

The rule is the one of the invoicing regulation and of every POS/ERP on the market: the
expedition date is the day the document is issued, and never earlier than the invoice it corrects.
So:

  1. a date other than the business's today, or a year other than this one → the runtime refuses
     with the translatable code `invoice.rectify_date_not_allowed` (HTTP 409), and NOTHING is
     written: the original stays issued, no R1 exists;
  2. today's date sent explicitly → accepted, the R1 is dated today;
  3. no date at all (what the screen sends since invoice#78) → accepted, dated today.

"Today" is the business's, not this machine's: the runtime dates the original with the same clock
(`business_date`, invoice#78), so the original's own `issue_date` IS the business's today here.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]` (module-toolkit#110). Never on its
own: without a runtime it fails, it does not skip.
"""

import datetime
import sys

import hub_harness
from hub_harness import ONE, Hub, ensure_business_identity, unique_series, unique_tag

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
    hub = Hub("rectify_date.hub")
    print(
        f"Hub battery · rectify date (invoice#79) · {hub_harness.BASE} · "
        f"hub {hub.hub_id} · user {hub.user}"
    )
    ensure_business_identity(hub)
    test_a_date_other_than_today_is_refused(hub)
    test_today_explicitly_is_accepted(hub)
    test_no_date_is_dated_today_by_the_server(hub)
    return hub.finish(
        "a rectificativa is dated the day it is issued, never by the caller"
    )


if __name__ == "__main__":
    sys.exit(main())
