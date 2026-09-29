#!/usr/bin/env python3
"""An invoice is never issued while the hub cannot read what it is issued from — against the REAL
kernel (invoice#133).

The three commands that mint an invoice (`invoice.create`, `invoice.create_from_sale`,
`invoice.substitute`) get the hub's tax rules from the kernel, which pre-loads the read
`taxes.rules.list` before the handler runs (ADR-0069); `create_from_sale` also pre-loads the sale it
invoices (`sales.get`). While those reads were declared without `required`, a read that FAILED (the
database hiccuped, the query broke) was silently OMITTED and the handler ran anyway:

  * without the rules catalogue every line falls back to "domestic VAT, subject and not exempt" —
    an invoice numbered, chained and declared with a fiscal key nobody resolved (an IGIC hub in the
    Canary Islands would declare VAT);
  * without the sale row `create_from_sale` answered `invoice.sale_not_found` — blaming a sale that
    exists for what was an outage.

`sales` already marks the rules read `required` at the till, and `taxes.calculate` does too
(taxes#82): the kernel then aborts the command with `read_unavailable` (hub#701) before the handler
runs, so nothing is written and no number is consumed. This battery proves `invoice` behaves the
same, and that it recovers once the reads answer again:

  1. Positive control: with everything readable, `invoice.create` numbers a fresh series `-000001`.
  2. With the rules table unreachable, the three issuing commands are refused with
     `read_unavailable`, and none of them wrote an invoice.
  3. With the sales table unreachable, `create_from_sale` on a sale that EXISTS is refused with
     `read_unavailable`, not `invoice.sale_not_found`.
  4. With both tables back, the same series continues at `-000002` (the refusals consumed no
     number) and the ticket is substituted by its F3.

Only a running hub resolves `reads`, and only its database can be broken on purpose: the tables are
renamed through the session the runner hands over in `ERPLORA_HUB_PSQL` (module-toolkit#405) and
renamed back in a `finally`, whatever happens in between.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]` (module-toolkit#110). Never on its
own: without a runtime it fails, it does not skip.
"""

import os
import shlex
import subprocess
import sys
import uuid

from hub_harness import (
    ONE,
    Hub,
    cash_method_id,
    ensure_business_identity,
    key,
    unique_series,
    unique_tag,
    wait_for_invoice_by_source,
)

BATTERY = "issuing_refuses_without_reads.hub"
PSQL = tuple(shlex.split(os.environ.get("ERPLORA_HUB_PSQL", "")))

RULES_TABLE = "taxes_rule"
SALES_TABLE = "sales_sale"


def psql(sql: str) -> str:
    done = subprocess.run(
        [*PSQL, "-tAc", sql], capture_output=True, text=True, timeout=60, check=False
    )
    if done.returncode != 0:
        raise AssertionError(
            f"psql `{sql}` exited {done.returncode}: {done.stderr.strip()}"
        )
    return done.stdout.strip()


class Unreachable:
    """Renames a table out of the way for the length of a `with` block and ALWAYS renames it back.
    The hidden name is unique per run: a previous run that died between the two renames must not
    collide with this one."""

    def __init__(self, table: str):
        self.table = table
        self.hidden = f"{table}_hidden_{uuid.uuid4().hex[:8]}"

    def __enter__(self):
        psql(f"ALTER TABLE {self.table} RENAME TO {self.hidden}")
        return self

    def __exit__(self, *exc):
        psql(f"ALTER TABLE {self.hidden} RENAME TO {self.table}")
        return False


def charge_a_sale(hub: Hub, cash: str) -> str:
    """A real `sales.complete_sale`, cash, tax-excluded, 1 × 2,00 € — the id of the sale it minted."""
    out = hub.run(
        "sales.complete_sale",
        {
            "idempotency_key": key("no-reads"),
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
    return out["new_ids"][0]


def manual_invoice(series: str, customer: str) -> dict:
    return {
        "series_code": series,
        "invoice_type": "F1",
        "customer_name": customer,
        "customer_tax_id": "B99999999",
        "items": [
            {
                "description": "Consultoría",
                "quantity": ONE,
                "unit_price": 10000,
                "tax_rate": 21.0,
                "tax_category_key": "product.generic",
            }
        ],
    }


def from_sale(sale_id: str) -> dict:
    return {
        "sale_id": sale_id,
        "customer_name": "Bar Manolo",
        "items": [
            {
                "product_name": "Café",
                "quantity": ONE,
                "unit_price": 200,
                "tax_rate": 21.0,
            }
        ],
    }


def substitution(ticket_id: str, customer: str) -> dict:
    return {
        "original_invoice_id": ticket_id,
        "customer_name": customer,
        "customer_tax_id": "B99999999",
        "items": [
            {
                "description": "Café",
                "quantity": ONE,
                "unit_price": 200,
                "tax_rate": 21.0,
                "base_amount": 200,
                "tax_amount": 42,
            }
        ],
    }


def invoices_of(hub: Hub, customer: str) -> list:
    return hub.query("invoice.list", {"search": customer})


def number_of(hub: Hub, customer: str) -> str:
    rows = invoices_of(hub, customer)
    if len(rows) != 1:
        raise AssertionError(f"expected ONE invoice for {customer}, got {rows}")
    return rows[0]["number"]


def main() -> int:
    hub = Hub(BATTERY)
    if not PSQL:
        print(
            f"{BATTERY}: hub_psql_missing — ERPLORA_HUB_PSQL is empty. The runner has to hand over "
            "a session on the hub's database; without it the reads cannot be broken on purpose."
        )
        return 1
    # The session must open THIS hub's database, or renaming the tables proves nothing.
    seeded = psql(f"SELECT count(*) FROM {RULES_TABLE} WHERE hub_id = '{hub.hub_id}'")
    if not seeded.isdigit() or int(seeded) == 0:
        print(
            f"{BATTERY}: ERPLORA_HUB_PSQL shows no `{RULES_TABLE}` rows for hub {hub.hub_id} "
            f"({seeded!r})"
        )
        return 1

    ensure_business_identity(hub)
    cash = cash_method_id(hub)
    sale_id = charge_a_sale(hub, cash)
    ticket = wait_for_invoice_by_source(hub, sale_id)
    series = unique_series("noreads")

    print(
        "\n1 · everything readable: invoice.create numbers a fresh series (positive control)"
    )
    first = unique_tag("Readable")
    hub.run("invoice.create", manual_invoice(series, first))
    hub.check(
        "first invoice of the series", number_of(hub, first).rsplit("-", 1)[1], "000001"
    )

    print("\n2 · tax rules unreadable: no invoice is issued (invoice#133)")
    blind_create = unique_tag("NoRules")
    blind_substitute = unique_tag("NoRulesF3")
    with Unreachable(RULES_TABLE):
        hub.refused(
            "invoice.create",
            "invoice.create",
            manual_invoice(series, blind_create),
            "read_unavailable",
        )
        hub.refused(
            "invoice.create_from_sale",
            "invoice.create_from_sale",
            from_sale(sale_id),
            "read_unavailable",
        )
        hub.refused(
            "invoice.substitute",
            "invoice.substitute",
            substitution(ticket["id"], blind_substitute),
            "read_unavailable",
        )
    hub.check(
        "no invoice was written for the refused create",
        invoices_of(hub, blind_create),
        [],
    )
    hub.check(
        "no F3 was written for the refused substitution",
        hub.query("invoice.by_source", {"source_id": ticket["id"]}),
        [],
    )

    print(
        "\n3 · sales unreadable: an existing sale is not reported as missing (invoice#133)"
    )
    with Unreachable(SALES_TABLE):
        hub.refused(
            "invoice.create_from_sale on a sale that exists",
            "invoice.create_from_sale",
            from_sale(sale_id),
            "read_unavailable",
        )

    print(
        "\n4 · everything readable again: issuing recovers and no number was consumed"
    )
    after = unique_tag("Recovered")
    hub.run("invoice.create", manual_invoice(series, after))
    hub.check(
        "the refusals consumed no number: the series continues at -000002",
        number_of(hub, after).rsplit("-", 1)[1],
        "000002",
    )
    hub.run("invoice.substitute", substitution(ticket["id"], unique_tag("RecoveredF3")))
    f3 = hub.query("invoice.by_source", {"source_id": ticket["id"]})
    hub.check(
        "the ticket is substituted by exactly one F3",
        [r.get("invoice_type") for r in f3],
        ["F3"],
    )
    hub.run("invoice.create_from_sale", from_sale(sale_id))

    return hub.finish("an invoice is never issued from a read the hub could not make")


if __name__ == "__main__":
    sys.exit(main())
