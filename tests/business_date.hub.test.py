#!/usr/bin/env python3
"""A ticket is dated on the BUSINESS's day, against the REAL kernel (invoice#78).

The unit tests (`handler/src/lib.rs`, `business_date_tests`) prove the handler reads the date in
`context.timezone`. What only a live kernel can prove is the other half of the promise: that the
zone REACHES the handler on the path the POS actually takes — `sales.complete_sale` emits
`sale.completed`, the OUTBOX relay delivers it later with a context of its own, and
`invoice.create_from_sale` issues the F2. A relay context without the zone would date every night
ticket on UTC again, with every unit test green.

The kernel's clock cannot be moved from here, so the battery moves the ZONE instead: it picks one
whose calendar day differs from UTC's at the moment it runs — Pago Pago (UTC−11, the day before)
until 10:30 UTC, Kiritimati (UTC+14, the day after) from then on; each keeps that difference for at
least another half hour, far longer than a sale takes. It sets it through the real admin door
(`PUT /api/settings`), charges a sale, and asserts the relay-issued ticket carries that zone's date,
not UTC's. Then it rectifies that ticket by hand, the way the screen does since invoice#78 (no date,
no year in the payload), and asserts the declarative rectify chain dates it on the same day — the
half that depends on the kernel binding `:timezone` into SQL. The hub's previous zone is put back
whatever happens: the hub is shared with every other battery.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]`. Never on its own: without a
runtime it fails, it does not skip.
"""

import datetime
import sys
import zoneinfo

import hub_harness
from hub_harness import (
    ONE,
    Hub,
    cash_method_id,
    ensure_business_identity,
    key,
    unique_tag,
    wait_for_invoice_by_source,
)


def zone_off_utcs_day() -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    return (
        "Pacific/Pago_Pago"
        if now.hour * 60 + now.minute < 630
        else "Pacific/Kiritimati"
    )


def settings(hub: Hub) -> dict:
    status, body = hub._request("GET", "/api/settings")
    if status != 200:
        raise AssertionError(f"GET /api/settings answered {status}: {body}")
    data = body.get("data", body) if isinstance(body, dict) else {}
    return data if isinstance(data, dict) else {}


def set_timezone(hub: Hub, zone) -> None:
    status, body = hub._request("PUT", "/api/settings", {"timezone": zone})
    if status != 200:
        raise AssertionError(
            f"PUT /api/settings timezone={zone!r} answered {status}: {body}"
        )


def test_a_relay_issued_ticket_carries_the_business_date(hub: Hub, cash: str) -> None:
    zone = zone_off_utcs_day()
    print(f"\n1 · sale.completed → relay → create_from_sale, hub zone {zone}")
    set_timezone(hub, zone)
    hub.check(
        "the hub reports the zone it was given", settings(hub).get("timezone"), zone
    )

    out = hub.run(
        "sales.complete_sale",
        {
            "idempotency_key": key("business-date"),
            "payment_method_id": cash,
            "customer_name": unique_tag("Bar Manolo"),
            "tax_included": False,
            "items": [
                {
                    "product_name": "Café",
                    "price": 200,
                    "quantity": ONE,
                    "tax_rate": 21.0,
                }
            ],
        },
    )
    inv = wait_for_invoice_by_source(hub, out["new_ids"][0])
    instant = datetime.datetime.now(datetime.timezone.utc)
    local_day = instant.astimezone(zoneinfo.ZoneInfo(zone)).date().isoformat()
    utc_day = instant.date().isoformat()
    hub.check_true(
        "the zone chosen really is on another calendar day than UTC right now",
        local_day != utc_day,
        f"local {local_day} vs UTC {utc_day}",
    )
    hub.check(
        "the ticket is dated on the business's day", inv.get("issue_date"), local_day
    )
    hub.check(
        "its number carries the business's year",
        inv.get("number", "").split("-")[1] if inv.get("number") else None,
        local_day[:4],
    )

    # The rectify chain is declarative SQL: its date comes from `:now` read in `:timezone`, which
    # the kernel binds in every command (hub#1022), and from the text form of a Postgres `date`
    # (the runtime's driver pins `DateStyle=ISO`). Only a live kernel proves both.
    print("\n2 · invoice.rectify on that ticket, same hub zone")
    hub.run("invoice.rectify", {"original_id": inv["id"], "reason": "Wrong amount"})
    rows = hub.query("invoice.list", {"search": inv.get("customer_name", "")})
    rects = [r for r in rows if str(r.get("invoice_type", "")).startswith("R")]
    hub.check("one rectification of the ticket", len(rects), 1)
    if rects:
        hub.check(
            "the rectificativa is dated on the business's day too",
            rects[0].get("issue_date"),
            datetime.datetime.now(datetime.timezone.utc)
            .astimezone(zoneinfo.ZoneInfo(zone))
            .date()
            .isoformat(),
        )


def main() -> int:
    hub = Hub("business_date.hub")
    print(
        f"Hub battery · business date (invoice#78) · {hub_harness.BASE} · "
        f"hub {hub.hub_id} · user {hub.user}"
    )
    ensure_business_identity(hub)
    cash = cash_method_id(hub)
    previous = settings(hub).get("timezone")
    try:
        test_a_relay_issued_ticket_carries_the_business_date(hub, cash)
    finally:
        set_timezone(hub, previous)
    return hub.finish("the ticket the relay issues is dated on the business's clock")


if __name__ == "__main__":
    sys.exit(main())
