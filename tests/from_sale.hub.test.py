#!/usr/bin/env python3
"""The `sale.completed` → auto-F2 chain of `invoice`, against the REAL kernel. Ported from the
hub's `invoice_e2e.rs` (ERPlora/hub#1264, contract «El Hub se CIERRA como KERNEL» §5).

`invoice.create_from_sale` is the listener `invoice` registers on `sales`' `sale.completed`
(module.json: `events.listen`) and is also a public command an external caller (the assistant, a
future public API) can invoke directly with a `sale_id`. Both paths share ONE handler, so both are
proven here:

  1. A completed sale auto-creates exactly one F2 (simplified ticket, series `TICKET`) through the
     OUTBOX relay — no caller ever invokes `invoice.create_from_sale` by hand for the POS's own
     checkout.
  2. `create_from_sale` with a `sale_id` that does not exist is refused with `invoice.sale_not_found`
     — hub#108, a P0 fiscal regression: a bogus `sale_id` used to mint a ZERO invoice (blank NIF,
     no real origin), consuming a ticket number and polluting numbering/traceability. Nothing is
     written and no number is consumed. This is also the fix of ERPlora/hub#1264: the hub's own
     e2e read the rejection off the internal `RuntimeError` directly (`err.to_string()`), which
     never went through hub#1074's client-facing redaction gate — every external caller (this
     battery included, before the fix in `handler/src/lib.rs`) saw only "the request could not be
     completed" with no code to act on. `create_from_sale_pure` now answers through `Output.error`
     like every other rejection in this module.
  3. A DIRECT invocation with a REAL `sale_id` issues the correct F2 — the path an external caller
     takes — and is idempotent against the relay's own asynchronous delivery of the same sale: only
     ONE invoice ever exists per `source_id` (`commands/_insert_invoice.sql`'s own `NOT EXISTS`
     guard, D2) — and the path that lost the race burnt no ticket number either (the same guard in
     `_bump_series.sql`): the next sale is numbered N+1 and `invoice.numbering.gaps` stays empty.

Numbering is asserted RELATIVELY (`N`, `N+1`), never as an absolute `-000001`: `TICKET` is one
series shared by every run this battery has ever had against this hub, unlike the throwaway series
`create.hub.test.py` mints per test. The relay is genuinely asynchronous (the outbox's own tick,
`crates/server/src/lib.rs`) — [`hub_harness.wait_for_invoice_by_source`] polls for it instead of a
`drain_outbox()` this HTTP door does not offer.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]` (module-toolkit#110). Never on its
own: without a runtime it fails, it does not skip.
"""

import sys

import hub_harness
from hub_harness import (
    ONE,
    Hub,
    cash_method_id,
    cents,
    ensure_business_identity,
    key,
    unique_tag,
    wait_for_invoice_by_source,
)


def suffix(number: str) -> int:
    """`TICKET-2026-000007` → 7: the atomic per-series counter is the last dash-separated group."""
    return int(number.rsplit("-", 1)[1])


def charge_a_sale(
    hub: Hub, cash: str, tag: str, price: int = 200, qty: int = ONE
) -> str:
    """A real `sales.complete_sale`, cash, tax-excluded — the id of the sale it minted."""
    out = hub.run(
        "sales.complete_sale",
        {
            "idempotency_key": key(tag),
            "payment_method_id": cash,
            "customer_name": unique_tag("Bar Manolo"),
            "tax_included": False,
            "items": [
                {
                    "product_name": "Café",
                    "price": price,
                    "quantity": qty,
                    "tax_rate": 21.0,
                }
            ],
        },
    )
    return out["new_ids"][0]


def test_a_completed_sale_auto_creates_exactly_one_f2(hub: Hub, cash: str) -> None:
    print("\n1 · sale.completed → invoice.create_from_sale mints exactly one F2 ticket")
    sale_id = charge_a_sale(hub, cash, "auto-f2", price=200, qty=3 * ONE)
    inv = wait_for_invoice_by_source(hub, sale_id)
    hub.check("invoice_type", inv.get("invoice_type"), "F2")
    hub.check("series", inv.get("series"), "TICKET")
    hub.check("source_type", inv.get("source_type"), "sale")
    hub.check("source_id names THIS sale", inv.get("source_id"), sale_id)
    hub.check(
        "issuer_nif carries the hub's business identity, never blank",
        inv.get("issuer_nif"),
        "B12345674",
    )
    detail = hub.query("invoice.get", {"invoice_id": inv["id"]})[0]
    hub.check("base = 3 × 2,00 €, cents", cents(detail.get("base_amount")), 600)
    hub.check("tax = 21% of 6,00 €, cents", cents(detail.get("tax_amount")), 126)
    hub.check("total = base + tax, cents", cents(detail.get("total_amount")), 726)


def test_a_nonexistent_sale_id_is_rejected_and_consumes_no_number(
    hub: Hub, cash: str
) -> None:
    print(
        "\n2 · create_from_sale with a sale_id nobody minted is rejected, and consumes no number "
        "(hub#108)"
    )
    before_sale = charge_a_sale(hub, cash, "before-rejection")
    before = wait_for_invoice_by_source(hub, before_sale)

    missing_sale_id = "__missing_sale__"
    hub.refused(
        "a made-up sale_id",
        "invoice.create_from_sale",
        {
            "sale_id": missing_sale_id,
            "customer_name": "Nadie",
            "items": [
                {
                    "product_name": "Café",
                    "quantity": ONE,
                    "unit_price": 100,
                    "tax_rate": 21.0,
                }
            ],
        },
        "invoice.sale_not_found",
    )
    hub.check(
        "no invoice was minted for a sale_id that does not exist",
        hub.query("invoice.by_source", {"source_id": missing_sale_id}),
        [],
    )

    after_sale = charge_a_sale(hub, cash, "after-rejection")
    after = wait_for_invoice_by_source(hub, after_sale)
    hub.check(
        "the rejected attempt consumed NO ticket number: the next real sale gets N+1, not N+2",
        suffix(after["number"]),
        suffix(before["number"]) + 1,
    )


def test_direct_invocation_with_a_real_sale_id_is_correct_and_idempotent(
    hub: Hub, cash: str
) -> None:
    print(
        "\n3 · a DIRECT create_from_sale with a real sale_id issues the correct F2, and never "
        "duplicates the relay's own delivery"
    )
    sale_id = charge_a_sale(hub, cash, "direct-invocation", price=200, qty=2 * ONE)
    # Race the relay on purpose (module-toolkit#110's HTTP door has no `drain_outbox()`): whichever
    # of the two — this direct call, or the relay's own async delivery — lands first mints the
    # invoice; `_insert_invoice.sql`'s `NOT EXISTS` guard (D2) makes the other one a safe no-op.
    # Both outcomes are legitimate, so `operations` is checked as EITHER 4 (this call won: ensure +
    # bump + insert + 1 line) or 0 (the relay had already won) — the invariant this test protects
    # is the FINAL state, asserted below regardless of who won.
    direct = hub.run(
        "invoice.create_from_sale",
        {
            "sale_id": sale_id,
            "customer_name": "Bar Manolo",
            "items": [
                {
                    "product_name": "Café",
                    "quantity": 2 * ONE,
                    "unit_price": 200,
                    "tax_rate": 21.0,
                }
            ],
        },
    )
    hub.check_true(
        "operations is 4 (this call won the race) or 0 (the relay already had): "
        f"{direct.get('operations')!r}",
        direct.get("operations") in (0, 4),
        str(direct),
    )

    inv = wait_for_invoice_by_source(hub, sale_id)
    hub.check("invoice_type", inv.get("invoice_type"), "F2")
    hub.check("series", inv.get("series"), "TICKET")
    hub.check("source_type", inv.get("source_type"), "sale")
    detail = hub.query("invoice.get", {"invoice_id": inv["id"]})[0]
    hub.check("base = 2 × 2,00 €, cents", cents(detail.get("base_amount")), 400)
    hub.check("tax = 21% of 4,00 €, cents", cents(detail.get("tax_amount")), 84)
    hub.check("total = base + tax, cents", cents(detail.get("total_amount")), 484)

    # Idempotency (D2): whichever path lost the race is a no-op, never a second row — the unique
    # `source_id` this query is scoped to already proves there is at most one, and it is the SAME
    # one seen above.
    still_one = wait_for_invoice_by_source(hub, sale_id)
    hub.check(
        "the id is stable: no second invoice ever displaced it",
        still_one.get("id"),
        inv.get("id"),
    )

    # Gapless numbering — the other half of D2 (art. 6.1.a RD 1619/2012; «sin huecos, sin
    # duplicados», RD 1007/2023): whichever path LOST the race must not have burnt a ticket number
    # either. `commands/_bump_series.sql` carries the same `NOT EXISTS` guard as
    # `_insert_invoice.sql`, and a counter that moved with no invoice behind it is invisible until
    # the NEXT number is handed out. One more real sale makes it observable: the relay drains the
    # outbox in order (`crates/runtime/src/outbox.rs`, `ORDER BY created_at`), so by the time this
    # sale's auto-F2 lands the loser of the race above has already run; its ticket is therefore
    # N+1 (a burnt number would make it N+2), and the module's own gap detector — the query a tax
    # inspection is answered with — reports nothing for the series. Dropping the guard from
    # `_bump_series.sql` turns BOTH checks red naming the hole (reviewed mutant, hub#1264).
    next_sale = charge_a_sale(hub, cash, "after-the-race")
    next_inv = wait_for_invoice_by_source(hub, next_sale)
    hub.check(
        "the loser of the race burnt NO ticket number: the next real sale gets N+1, not N+2",
        suffix(next_inv["number"]),
        suffix(inv["number"]) + 1,
    )
    hub.check(
        "invoice.numbering.gaps finds the TICKET series correlative",
        [g for g in hub.query("invoice.numbering.gaps") if g.get("code") == "TICKET"],
        [],
    )


def main() -> int:
    hub = Hub("from_sale.hub")
    print(
        f"Hub battery · from_sale (hub#1264 ← invoice_e2e.rs) · {hub_harness.BASE} · "
        f"hub {hub.hub_id} · user {hub.user}"
    )
    ensure_business_identity(hub)
    cash = cash_method_id(hub)
    test_a_completed_sale_auto_creates_exactly_one_f2(hub, cash)
    test_a_nonexistent_sale_id_is_rejected_and_consumes_no_number(hub, cash)
    test_direct_invocation_with_a_real_sale_id_is_correct_and_idempotent(hub, cash)
    return hub.finish(
        "the sale.completed to auto-F2 chain keeps every promise the hub's e2e used to assert, "
        "against the real kernel"
    )


if __name__ == "__main__":
    sys.exit(main())
