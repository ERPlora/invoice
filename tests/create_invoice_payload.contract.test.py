#!/usr/bin/env python3
"""Payload contract of `invoice.create` (invoice#49 + #50) — what a caller may say, and in what units.

WHY. Quantities travel as fixed-point integers of global scale 10⁶ (ADR-0147): `2000000` is two
units, `500000` is half a unit. The handler has assumed that since the scale landed, but the
PUBLISHED schema said `{"type": "integer", "minimum": 1}` and said nothing else — so an integrator,
the assistant or the public API read the contract, sent `quantity: 2` meaning «two coffees», and got
an invoice ISSUED, numbered and chained in VeriFactu for 0,00 € (2 µ-units × 3,30 € = 0,00066 cents
→ 0). A fiscal document already issued is never deleted (ADR-0331) and `invoice.rectify` is broken
(invoice#5): the mistake is irreversible for the business that makes it.

AND (invoice#50) a line says WHAT is invoiced, never how much it adds up to. While
`base_amount`/`tax_amount` were accepted from the caller, `invoice.create` sealed a base of 5,45 €
with a quota of 99,99 € on a 6,60 € line — and `verifactu.records.ingest_invoice` copied both
verbatim into the record it sends to the AEAT.

Rules under test: the payload contract states the scale in words AND enforces a floor that a
mis-scaled quantity cannot pass; the line carries no amounts; and every domain error the handler
can return is translatable (it exists in `locales/{en,es}.json`). The guards in the handler
(`invoice.line_amount_underflow`, `invoice.tax_quota_mismatch`, …) are the second door, for the
paths that carry no schema (`invoice.create_from_sale` is fed by an event, not by a caller).

Usage: tests/create_invoice_payload.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
SCHEMA_PATH = MODULE_DIR / "schemas" / "create_invoice.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text())

# One thousandth of a unit. Below this there is no invoiceable line: money has two decimals, so
# anything smaller prices to 0,00 € at any sane unit price.
QUANTITY_FLOOR = 1000
QUANTITY_SCALE = 1_000_000

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"  FAIL: {msg}")


def ok(msg: str) -> None:
    print(f"  ok: {msg}")


def item_property(name: str) -> dict:
    return SCHEMA["properties"]["items"]["items"]["properties"][name]


def check_declares_the_scale() -> None:
    qty = item_property("quantity")
    if qty.get("type") != "integer":
        fail(f"items[].quantity must stay an integer (fixed point, never a float): {qty.get('type')}")
    else:
        ok("items[].quantity is an integer")

    minimum = qty.get("minimum")
    if minimum != QUANTITY_FLOOR:
        fail(
            f"items[].quantity.minimum must be {QUANTITY_FLOOR} (0,001 units) so a quantity sent in "
            f"UNITS is refused at the door; got {minimum}"
        )
    else:
        ok(f"items[].quantity.minimum = {minimum} (a bare `2` cannot get through)")

    description = qty.get("description", "")
    if str(QUANTITY_SCALE) not in description.replace(".", "").replace(",", ""):
        fail("items[].quantity.description must name the 10⁶ scale (1 unit = 1000000)")
    else:
        ok("items[].quantity.description names the scale")

    price = item_property("unit_price")
    if "description" not in price:
        fail("items[].unit_price must say it is integer MINOR UNITS (cents): a `3.30` here is 3 cents")
    else:
        ok("items[].unit_price documents its unit")

    if str(QUANTITY_SCALE) not in SCHEMA.get("description", "").replace(".", "").replace(",", ""):
        fail("the payload description must state the money and quantity units of the whole contract")
    else:
        ok("the payload description states the units of the contract")


def check_the_caller_does_not_state_the_amounts() -> None:
    """invoice#50 — the client proposes, the server disposes."""
    items = SCHEMA["properties"]["items"]["items"]
    if items.get("additionalProperties") is not False:
        fail(
            "items[] must be a CLOSED object: while it was open, `base_amount`/`tax_amount` from the "
            "caller were sealed into the document and copied into the VeriFactu record"
        )
    else:
        ok("items[] is a closed object (a line cannot smuggle its own amounts in)")

    declared = [f for f in ("base_amount", "tax_amount", "total_amount") if f in items["properties"]]
    if declared:
        fail(f"items[] must not declare {', '.join(declared)}: the server works the amounts out")
    else:
        ok("no amount field is declared on the line")


def check_every_refusal_is_translatable() -> None:
    """A domain error is only useful if the code has a sentence in the catalogue (hub#139)."""
    handler = (MODULE_DIR / "handler" / "src" / "lib.rs").read_text()
    # [a-z0-9_]: codes carry digits too (`invoice.f1_requires_customer_tax_id`, invoice#52) —
    # without them a code would silently escape the translatability check this battery exists for.
    codes = sorted(set(re.findall(r'DomainError::new\(\s*"(invoice\.[a-z0-9_]+)"', handler)))
    if not codes:
        fail("no `DomainError` code found in the handler — is the guard still there?")
        return
    for lang in ("en", "es"):
        catalog = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text()).get("errors", {})
        missing = [c for c in codes if not catalog.get(c)]
        if missing:
            fail(f"locales/{lang}.json has no translation for: {', '.join(missing)}")
        else:
            ok(f"locales/{lang}.json translates all {len(codes)} refusal(s): {', '.join(codes)}")


def check_against_real_payloads() -> None:
    """Same rule, exercised end to end — skipped where `jsonschema` is not installed."""
    try:
        import jsonschema
    except ImportError:
        print("  SKIPPED payload validation: `jsonschema` is not installed")
        return

    validator = jsonschema.Draft202012Validator(SCHEMA)

    def line(quantity: int) -> dict:
        return {
            "customer_name": "Cliente QA",
            "items": [
                {
                    "description": "Cafe con leche",
                    "quantity": quantity,
                    "unit_price": 330,
                    "tax_category_key": "product.generic",
                }
            ],
        }

    forged = line(2 * QUANTITY_SCALE)
    forged["items"][0].update({"base_amount": 545, "tax_amount": 9999})
    if validator.is_valid(forged):
        fail("a line carrying its own `base_amount`/`tax_amount` is accepted — that is invoice#50")
    else:
        ok("a line carrying its own amounts is refused (the server works them out)")

    # The exact payload of invoice#49: «2 coffees», sent in units.
    if validator.is_valid(line(2)):
        fail("`quantity: 2` (0,000002 units) is accepted — that is the 0,00 € invoice of invoice#49")
    else:
        ok("`quantity: 2` is refused by the schema (422 invalid_payload, no invoice is issued)")

    for quantity, label in ((2 * QUANTITY_SCALE, "2 units"), (QUANTITY_SCALE // 2, "0,5 units")):
        if validator.is_valid(line(quantity)):
            ok(f"`quantity: {quantity}` ({label}) is accepted")
        else:
            fail(f"`quantity: {quantity}` ({label}) must stay a legal quantity")


def main() -> int:
    print(f"invoice.create payload contract — {SCHEMA_PATH.relative_to(MODULE_DIR)}")
    check_declares_the_scale()
    check_the_caller_does_not_state_the_amounts()
    check_every_refusal_is_translatable()
    check_against_real_payloads()
    if failures:
        print(f"\n{len(failures)} failure(s)")
        return 1
    print("\nall green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
