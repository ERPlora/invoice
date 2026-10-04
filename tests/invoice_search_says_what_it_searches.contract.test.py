#!/usr/bin/env python3
"""The Invoicing search box promises only what it really searches (ERPlora/invoice#117).

WHY THIS EXISTS. Invoicing › Invoices painted «Buscar número, cliente o estado…». Typing «Pagada»
(or «Pendiente») returned no invoice at all, with paid ones in the list: `invoice.list` searches
the number, the customer name and the customer tax ID — never the status. The owner read «no paid
invoices» when there were.

The market (Square, Toast, Odoo, Lightspeed, Holded) splits the two jobs, and Kitchen already
does it (ERPlora/kitchen#110): the box takes free text over what identifies the row (number,
customer, tax ID), and a closed domain such as the status is PICKED in its filter — which this
table already has, translated. Searching a translated status in SQL would need the server to
translate, so the box stops promising it instead.

What is checked, with both halves visible at once (the component's `vitest` stubs the query and
would "search" anything):

  1. every field `invoice.list` searches is a column the table SHOWS, or one the list
     deliberately keeps off the grid (`NAMED_HIDDEN`: the customer's tax ID, which people type
     from a letter or a phone call, and which the invoice detail shows) — a hit on any other
     hidden value is a row that matches for no visible reason;
  2. the number, the customer and the customer's tax ID are searched — it is what people type;
  3. no header of a shown-but-NOT-searched column appears in the placeholder, in `en` nor in `es`
     — that is the exact lie of invoice#117 («estado»);
  4. a placeholder that lists fields lists every searched one, in `en` AND in `es`: by its column
     header, or by the word in `SENTENCE_WORD` (the tax ID has no column header). A generic hint
     that names no field («Search invoices…», like Square and Shopify) is fine: on a phone the
     list of three fields does not fit the box and Ionic clips it mid-word (invoice#112, whose
     `invoice_list_fits_a_phone.contract.test.py` keeps the hint short);
  5. the status stays pickable in its column filter, offering EVERY status the table stores (the
     `draft|issued|paid|cancelled` domain of `001_init.sql`), each with a label in `en` and in
     `es` — that is where the box sends the person looking for «Pagada»;
  6. no ENUMERATED column (a `select` filter over codes the cell translates: status, type) is
     searched — the query would match the raw code (`paid`), never the «Pagada» the row shows, so
     «search status» plus «the box says status» would pass 1-4 and still find nothing
     (ERPlora/kitchen#113).

Usage: tests/invoice_search_says_what_it_searches.contract.test.py   (exit 0 = green). No Postgres.
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text(encoding="utf-8"))
COMPONENT = MODULE_DIR / "ui/components/erp-invoice-list/erp-invoice-list.ts"
QUERY = "invoice.list"

#: `{ key: 'x', header: t('ui.colX'), …` — possibly split over lines inside `columns`.
COLUMN_RE = re.compile(
    r"key:\s*'([a-z_]+)'\s*,\s*header:\s*t\(\s*'([^']+)'\s*\)", re.MULTILINE
)
PLACEHOLDER_RE = re.compile(
    r"\.searchPlaceholder\s*=\s*\$\{\s*(?:erploraT|t)\(\s*'([^']+)'"
)
#: Searched fields the grid does not show, but the box names so a hit is explainable.
NAMED_HIDDEN = {"customer_tax_id"}
#: (lang, field) → the word the box must use for a field with no column header.
SENTENCE_WORD = {("en", "customer_tax_id"): "tax ID", ("es", "customer_tax_id"): "NIF"}
MUST_SEARCH = ("number", "customer_name", "customer_tax_id")
#: `status TEXT … -- draft|issued|paid|cancelled`: the only place the status domain is declared.
STATUS_DOMAIN_RE = re.compile(
    r"^\s*status\s+TEXT\b[^\n]*--\s*([a-z_]+(?:\|[a-z_]+)+)", re.MULTILINE
)

failures: list[str] = []


def catalog(lang: str) -> dict:
    return json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text("utf-8"))


def lookup(cat: dict, dotted: str) -> str:
    node = cat
    for part in dotted.split("."):
        node = node[part]
    return str(node)


def names(text: str, word: str) -> bool:
    return (
        re.search(rf"(?<!\w){re.escape(word.lower())}(?!\w)", text.lower()) is not None
    )


def enumerated_columns(columns_block: str) -> set[str]:
    """Columns whose filter is a `select` over codes: their cell is a translated label."""
    starts = [
        (m.start(), m.group(1))
        for m in re.finditer(r"key:\s*'([a-z_]+)'", columns_block)
    ]
    out = set()
    for i, (pos, key) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(columns_block)
        if re.search(r"filterType:\s*'select'", columns_block[pos:end]):
            out.add(key)
    return out


def status_filter_keys(src: str, columns_block: str) -> list[str]:
    """The i18n keys of the status filter's option labels, or [] if the filter is gone."""
    status_col = re.search(r"key:\s*'status'[\s\S]*?\n\s*\},", columns_block)
    if not status_col:
        return []
    col = status_col.group(0)
    if not (
        re.search(r"filterable:\s*true", col)
        and re.search(r"filterType:\s*'select'", col)
        and re.search(
            r"options:\s*STATUS_CODES\.map\(\(?value\)?\s*=>\s*\(\{\s*value,\s*label:\s*statusLabel\(value\)",
            col,
        )
    ):
        return []
    codes = re.search(r"const STATUS_CODES = \[([^\]]*)\]", src)
    label_fn = re.search(r"function statusLabel\([\s\S]*?\n\}", src)
    if not codes or not label_fn:
        return []
    mapping = dict(re.findall(r"(\w+):\s*erploraT\('([^']+)'\)", label_fn.group(0)))
    code_list = re.findall(r"'([a-z_]+)'", codes.group(1))
    if not code_list or any(c not in mapping for c in code_list):
        return []
    domain = STATUS_DOMAIN_RE.search(
        (MODULE_DIR / "migrations/postgres/001_init.sql").read_text(encoding="utf-8")
    )
    # A filter that drops a status (say `paid`) leaves «Pagada» unreachable once the box stops
    # promising it; a stale domain comment must fail loudly, not pass for the wrong reason.
    if not domain or set(code_list) != set(domain.group(1).split("|")):
        return []
    return [mapping[c] for c in code_list]


def main() -> int:
    src = COMPONENT.read_text(encoding="utf-8")
    columns_block = src[
        src.index("private get columns()") : src.index("get rowActions()")
    ]
    shown = dict(COLUMN_RE.findall(columns_block))  # key → header i18n key
    placeholder = PLACEHOLDER_RE.search(src)
    searched = (MANIFEST["queries"][QUERY].get("list") or {}).get("search") or []

    # Check the check: a fixture this thin would pass everything below for the wrong reason.
    if len(shown) < 5 or "status" not in shown or not placeholder or not searched:
        print(
            f"FAIL: parsing went stale — shown={shown} placeholder={placeholder} search={searched}"
        )
        return 1

    for col in searched:
        if col not in shown and col not in NAMED_HIDDEN:
            failures.append(
                f"`{QUERY}` searches `{col}`, which the invoice table does not show nor the box "
                f"names: a row would match for no visible reason (invoice#117)"
            )
    enumerated = enumerated_columns(columns_block)
    if "status" not in enumerated:
        print(f"FAIL: parsing went stale — enumerated={enumerated}")
        return 1
    for col in searched:
        if col in enumerated:
            failures.append(
                f"`{QUERY}` searches `{col}`, an enumerated column: it would match the raw code, "
                f"never the translated label the row shows — pick it in its filter (kitchen#113)"
            )
    for col in MUST_SEARCH:
        if col not in searched:
            failures.append(f"`{QUERY}` does not search `{col}` (invoice#117)")

    status_keys = status_filter_keys(src, columns_block)
    if not status_keys:
        failures.append(
            "the status column lost its translated select filter (or it no longer offers every "
            "stored status): the box no longer promises the status, so the filter is the only "
            "way to find «Pagada» (invoice#117)"
        )

    for lang in ("en", "es"):
        cat = catalog(lang)
        promise = lookup(cat, placeholder.group(1))
        for col, header_key in shown.items():
            header = lookup(cat, header_key)
            if col not in searched and names(promise, header):
                failures.append(
                    f"[{lang}] the box says «{promise}» — it names «{header}» (`{col}`), which "
                    f"`{QUERY}` does not search (invoice#117)"
                )
        words = {}
        for col in searched:
            word = SENTENCE_WORD.get((lang, col))
            if word is None and col in shown:
                word = lookup(cat, shown[col])
            words[col] = word
        named = [col for col, word in words.items() if word and names(promise, word)]
        if named:
            for col, word in words.items():
                if col not in named:
                    failures.append(
                        f"[{lang}] the box says «{promise}» but does not name «{word}» (`{col}`), "
                        f"which it does search: a list of fields names them all"
                    )
        for key in status_keys:
            try:
                label = lookup(cat, key)
            except KeyError:
                label = ""
            if not label.strip():
                failures.append(
                    f"[{lang}] the status filter option `{key}` has no label"
                )

    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"OK: the invoice box searches {searched} and promises exactly that")
    return 0


if __name__ == "__main__":
    sys.exit(main())
