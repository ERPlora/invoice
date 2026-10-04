#!/usr/bin/env python3
"""On a phone, the invoice list reads whole: a search hint that fits and the number once per card
(ERPlora/invoice#112).

WHY THIS EXISTS. On a phone, Invoicing › Invoices painted the search hint cut mid-word with no
ellipsis («Buscar número, cliente o esta») and every card said its number twice: as the card title
and again as a «Número» row.

  1. The search hint. `ion-searchbar` never adds an ellipsis to its placeholder: whatever does not
     fit is clipped. Measured on the bench (hub image + this module, real Ionic, 16 px system font)
     the room the input leaves for the text is 170 px in `md` at 360 px wide (the common Android
     width; Ionic `md` reserves the clear button's place even when the box is empty), 185 px at
     375 px, and 226 px at most on a desktop. «Buscar número, cliente o NIF…» needs 220 px and
     «Search number, customer or tax ID…» 264 px. The market (Square «Search invoices», Shopify
     «Search orders», Odoo «Search…») uses a short hint; «Buscar facturas…» needs 127 px. The
     budget below is a character count with margin for wide letters: 20 characters stay under
     170 px in that font.
  2. The number once per card. The shared table (`ok-data-table`, outfitkit#205) drops from a
     card's body the column whose cell reads exactly like the card title — but only a column with
     no `render`/`format` of its own, and only when the title is that same plain text. The list
     keeps both halves of that deal: the title is the raw `number` and the `number` column is
     painted as is. Giving it a `render` (or titling the card with anything else) brings the
     duplicate back without any table change.

Usage: tests/invoice_list_fits_a_phone.contract.test.py   (exit 0 = green). No Postgres.
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
COMPONENT = MODULE_DIR / "ui/components/erp-invoice-list/erp-invoice-list.ts"

#: Characters the hint may take so that it fits 170 px (`md`, 360 px wide) — see the docstring.
MAX_HINT_CHARS = 20

PLACEHOLDER_RE = re.compile(
    r"\.searchPlaceholder\s*=\s*\$\{\s*(?:erploraT|t)\(\s*'([^']+)'"
)
CARD_TITLE_RE = re.compile(
    r"\.cardTitle\s*=\s*\$\{\s*\((\w+)(?:\s*:[^)]*)?\)\s*=>\s*String\(\s*\1\.number\s*\?\?\s*'[^']*'\s*\)\s*\}"
)


def lookup(lang: str, dotted: str) -> str:
    node = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text("utf-8"))
    for part in dotted.split("."):
        node = node[part]
    return str(node)


def number_column(src: str) -> str | None:
    """The source of the `number` column object inside `get columns()`, or None."""
    block = src[src.index("private get columns()") : src.index("get rowActions()")]
    m = re.search(r"\{\s*key:\s*'number'[^\n]*", block)
    return m.group(0) if m else None


def main() -> int:
    src = COMPONENT.read_text(encoding="utf-8")
    failures: list[str] = []

    placeholder = PLACEHOLDER_RE.search(src)
    if not placeholder:
        print(
            "FAIL: parsing went stale — no `.searchPlaceholder=${erploraT('…')}` on the list"
        )
        return 1
    for lang in ("en", "es"):
        hint = lookup(lang, placeholder.group(1))
        if not hint.strip():
            failures.append(f"[{lang}] the search hint is empty")
        elif len(hint) > MAX_HINT_CHARS:
            failures.append(
                f"[{lang}] the search hint «{hint}» has {len(hint)} characters: on a phone the "
                f"box clips it past {MAX_HINT_CHARS} (invoice#112)"
            )

    if not CARD_TITLE_RE.search(src):
        failures.append(
            "the card title is no longer the raw invoice number: the shared table cannot tell it "
            "is the «Number» column and paints the number twice on every card (invoice#112)"
        )
    col = number_column(src)
    if col is None:
        print("FAIL: parsing went stale — no `number` column in `get columns()`")
        return 1
    if re.search(r"\b(render|format)\s*:", col):
        failures.append(
            "the `number` column paints its own cell (`render`/`format`): the shared table only "
            "drops a plain column from the card body, so the number shows twice (invoice#112)"
        )

    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "OK: the search hint fits a phone in en and es, and a card says its number once"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
