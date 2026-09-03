#!/usr/bin/env python3
"""The format hint tells the truth about the width — it is a MINIMUM (invoice#72, from invoice#70).

WHY THIS EXISTS. The number of a series is rendered with the portable bridge function `erp_pad`
(ADR-0007), and since ERPlora/hub#1378 `erp_pad(value, width)` pads to a MINIMUM width: a sequence
that outgrows the width is written WHOLE, never cut. `commands/_insert_invoice.sql` says so in a
comment — but the only person who has to make a decision about it, the one typing `{seq:04d}` into
the Format field, reads `ui.formatHint`, and that text listed the placeholders without ever saying
what the width means. Reading it, invoice 10,000 under `{seq:04d}` could just as well come out
whole, come out cut, or fail. It comes out whole, and truncation would be a fiscal bug: two
invoices sharing a number breaks the VeriFactu chain.

WHAT IS PINNED. Three things, in the order they can break:

  1. The render really is minimum-width — all three paths that print a number use `erp_pad`. This is
     the fact the hint documents. If a render is ever swapped for one that truncates, the hint
     becomes a lie and this test fails FIRST, on the premise, instead of blessing the prose.
  2. Every locale's `ui.formatHint` states it. Per ADR-0055 the assertion is on the load-bearing
     word, not on the sentence: a rewrite is free, silence is not.
  3. The bundle the hub actually serves carries the same text. The catalog is inlined into
     `dist/invoice.esm.js` at build time, so a locale edit that is not rebuilt ships the OLD,
     silent hint to every hub while the repo reads as fixed. `erplora validate` catches the stale
     stamp; this catches the string the user ends up reading.

Usage: tests/format_hint_min_width.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
LOCALES_DIR = MODULE_DIR / "locales"
BUNDLE = MODULE_DIR / "dist" / "invoice.esm.js"

# The three places a series number is rendered. Kept in sync by
# `tests/number_format.postgres.test.py` §1; here they are only checked for the padding function.
RENDER_PATHS = (
    "queries/series_peek_next.sql",
    "commands/_insert_invoice.sql",
    "commands/rectify_insert.sql",
)

# The word that carries the fact, per locale. Alternatives so a reword stays green; the point is
# that the hint cannot go back to being SILENT about the width.
MIN_WIDTH_WORDS = {
    "en": ("minimum",),
    "es": ("mínimo", "minimo"),
}

failures: list[str] = []


def check(label: str, expected, actual):
    if expected != actual:
        failures.append(f"{label} — expected [{expected}], got [{actual}]")
        print(f"  FAIL: {label} — expected [{expected}], got [{actual}]")
    else:
        print(f"  ok: {label} = {expected}")


def format_hint(locale: str) -> str:
    catalog = json.loads((LOCALES_DIR / f"{locale}.json").read_text())
    return catalog.get("ui", {}).get("formatHint", "")


def unescape_js(source: str) -> str:
    """Decode the `\\uXXXX` / `\\xNN` escapes esbuild writes for non-ASCII bundle literals.

    Without this, searching the bundle for a Spanish string never matches — `Déjalo` is emitted as
    `D\\xE9jalo` — and the check would pass by being unable to look, which is the failure mode this
    test is here to prevent.
    """
    return re.sub(
        r"\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})",
        lambda m: chr(int(m.group(1) or m.group(2), 16)),
        source,
    )


def test_the_render_pads_to_a_minimum_width():
    """The premise: what the hint promises is what the SQL does."""
    print("\n== 1. all three renders pad with `erp_pad` (minimum width, hub#1378) ==")
    for path in RENDER_PATHS:
        sql = (MODULE_DIR / path).read_text()
        check(f"`{path}` renders `{{seq:0Nd}}` with erp_pad", True, "erp_pad(" in sql)


def test_every_locale_says_the_width_is_a_minimum():
    print("\n== 2. every locale's `ui.formatHint` says the width is a minimum ==")
    locales = sorted(p.stem for p in LOCALES_DIR.glob("*.json"))
    check("the catalog ships at least `en` and `es`", True, {"en", "es"} <= set(locales))
    for locale in locales:
        words = MIN_WIDTH_WORDS.get(locale)
        if words is None:
            # A new locale must decide its own wording — it cannot inherit a green.
            failures.append(
                f"locale `{locale}` has no MIN_WIDTH_WORDS entry — add its word for «minimum»"
            )
            print(f"  FAIL: locale `{locale}` has no MIN_WIDTH_WORDS entry")
            continue
        hint = format_hint(locale)
        check(f"`{locale}` declares ui.formatHint", True, bool(hint.strip()))
        check(
            f"`{locale}` hint names the width placeholders it is talking about",
            True,
            "{seq:0" in hint,
        )
        check(
            f"`{locale}` hint says the width is a minimum ({'/'.join(words)})",
            True,
            any(word in hint.lower() for word in words),
        )


def test_the_shipped_bundle_carries_the_same_hint():
    """The catalog is inlined at build time: a locale edit without `erplora build` ships the old
    text to every hub while the repo reads as fixed."""
    print("\n== 3. dist/invoice.esm.js carries the hint the locales declare ==")
    check("the bundle is on disk", True, BUNDLE.is_file())
    if not BUNDLE.is_file():
        return
    bundle = unescape_js(BUNDLE.read_text())
    # The control must be able to find the positive: a string the bundle certainly carries.
    check(
        "the search finds a hint the bundle certainly has (control)",
        True,
        format_hint("en").split(".")[0] != "" and "Placeholders:" in bundle,
    )
    for locale in MIN_WIDTH_WORDS:
        check(f"`{locale}` hint is inlined verbatim in the bundle", True, format_hint(locale) in bundle)


def main() -> int:
    test_the_render_pads_to_a_minimum_width()
    test_every_locale_says_the_width_is_a_minimum()
    test_the_shipped_bundle_carries_the_same_hint()
    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — the format hint states the width is a minimum, and the bundle ships it (invoice#72)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
