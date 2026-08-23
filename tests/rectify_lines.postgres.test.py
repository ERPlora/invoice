#!/usr/bin/env python3
"""The rectifying invoice carries the ORIGINAL's LINES, negated — invoice#59.

Runs against a REAL Postgres 18 in Docker, applying the module's `migrations/postgres/*.sql` the
way the runtime does (portable types shimmed to native ones, ADR-0007 §4b) and executing the
manifest's `sql[]` chain bound like the runtime binds it (`:hub_id`, `:current_user_id`, `:now`,
`:new_id` injected; a `:param` absent from the payload is NULL).

Why the test exists
-------------------
`invoice.rectify` wrote a header and nothing else: the rectification was born with NO rows in
`invoice_invoiceitem`. `invoice.lines` came back empty, so the detail screen and the PRINTED
rectifying invoice showed a total with no concepts under it. Art. 6 + art. 15 of RD 1619/2012 ask a
rectifying invoice to carry the content of an invoice, not just its header.

Reproduced before the fix, on a mixed-rate ticket with two lines:

    original lines: 2
    rectify ok: True
    >>> LINES OF THE RECTIFICATION: 0

What was NOT wrong, and must stay that way: the header. Since invoice#5 the amounts are negated and
`tax_breakdown` is COPIED from the original's frozen snapshot with the amounts negated. It is never
re-derived — not from today's tax rules (ADR-0210: the tax basis is the one of the document's own
price list) and not from these lines either (ADR-0123 §4: the breakdown closes once per RATE, not
per line). So this test asserts the lines ADD UP to the header, never that the header follows them.

Why this is SQL and not a WASM handler
--------------------------------------
The issue originally prescribed moving `invoice.rectify` to a Tier-2 WASM handler, on the grounds
that N lines need N ids and a declarative command receives exactly one runtime-injected `:new_id`.
The premise is true and the conclusion does not follow: the ids do not have to come from the
runtime. One `INSERT … SELECT` writes N rows with DETERMINISTIC ids — the very trick
`commands/_insert_allocation.sql` already documents in this module ("it needs no id from the
runtime"). Staying declarative also keeps the whole chain inside the only gate that actually runs
it: the module gate has no checkout of ERPlora/hub, so it never compiles the handler to wasm32 nor
runs `cargo test` on `handler/` — it says so out loud ("handler WASM SIN VERIFICAR") — while it DOES
start a real Postgres and run this file.

Usage: tests/rectify_lines.postgres.test.py
  Uses the `erplora-test-pg-5433` container by default (override: INVOICE_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import uuid

HERE = pathlib.Path(__file__).resolve().parent
MODULE_DIR = HERE.parent

# The Postgres plumbing and the runtime-in-miniature (`bind`, `run_command`, `check`, the DDL shim)
# live in `substitution_unique.postgres.test.py` and are shared by every `*.postgres.test.py` here.
# Reused rather than copied: the `::`-is-a-cast rule these tests depend on had to be fixed once, in
# the shared copy, instead of drifting between six of them.
_spec = importlib.util.spec_from_file_location(
    "invoice_pg_harness", HERE / "substitution_unique.postgres.test.py"
)
H = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(H)
H.DB = f"invoice_rectify_lines_test_{os.getpid()}"

failures = H.failures
check = H.check
psql = H.psql
q = H.q
qi = H.qi
literal = H.literal
run_command = H.run_command
HUB = H.HUB
OTHER_HUB = H.OTHER_HUB
USER = H.USER
NOW = H.NOW
YEAR = NOW[:4]
MANIFEST = H.MANIFEST

UNIT = 1000000  # one unit in the fixed-point quantity scale (10⁶, ADR-0147)

# The mixed-rate ticket of the issue: a drink at 21 % and food at 10 %, VAT-inclusive prices, so
# base/tax come precomputed by `sales` exactly as `create_from_sale` passes them through. Amounts in
# CENTS. 1000 + 210 and 500 + 50 → base 1500, tax 260, total 1760.
LINES = [
    # description, quantity, unit_price, tax_rate, surcharge_rate, category, base, tax, product
    ("Beer",  2 * UNIT, 605,  21.0, 0.0,  "S1-21", 1000, 210, "prd-beer"),
    ("Tapa",  1 * UNIT, 550,  10.0, 0.0,  "S1-10", 500,   50, "prd-tapa"),
]
BREAKDOWN = [
    {"tax": "IVA", "regime": "01", "class": "S1", "rate": 21.0, "base": 1000, "quota": 210},
    {"tax": "IVA", "regime": "01", "class": "S1", "rate": 10.0, "base": 500, "quota": 50},
]
BASE, TAX, TOTAL = 1500, 260, 1760


# ── Fixtures ─────────────────────────────────────────────────────────────────────────────


def issue(
    invoice_id: str,
    *,
    invoice_type: str = "F2",
    series: str = "TICKET",
    source_type: str,
    source_id: str | None,
    lines=LINES,
    hub: str = HUB,
) -> tuple[bool, str]:
    """`_ensure_series` → `_bump_series` → `_insert_invoice` → N × `_insert_line`: the op chain the
    WASM handler emits for one invoice, replayed through the module's own private SQL."""
    base = {
        "code": series,
        "series": series,
        "name": series,
        "invoice_type": invoice_type,
        "year": YEAR,
        "prefix": series,
        "source_type": source_type,
        "source_id": source_id,
    }
    ok, err = run_command("invoice._ensure_series", {**base, "new_id": str(uuid.uuid4())}, hub)
    if not ok:
        return ok, err
    ok, err = run_command("invoice._bump_series", base, hub)
    if not ok:
        return ok, err
    ok, err = run_command(
        "invoice._insert_invoice",
        {
            **base,
            "invoice_id": invoice_id,
            "new_id": invoice_id,
            "issue_date": NOW[:10],
            "issuer_nif": "B00000000",
            "issuer_name": "Test SL",
            "customer_tax_id": "",
            "customer_name": "Customer",
            "customer_address": "",
            "description": "",
            "base_amount": sum(l[6] for l in lines),
            "tax_amount": sum(l[7] for l in lines),
            "total_amount": sum(l[6] + l[7] for l in lines),
            "tax_breakdown": json.dumps(BREAKDOWN, separators=(",", ":")),
            "substitutes_invoice_id": "",
            "notes": "",
            "business_tax_id": "B00000000",
            "business_legal_name": "Test SL",
        },
        hub,
    )
    if not ok:
        return ok, err
    for n, (desc, qty, price, rate, srate, cat, b, t, prd) in enumerate(lines, start=1):
        ok, err = run_command(
            "invoice._insert_line",
            {
                "line_id": f"{invoice_id}-L{n}",
                "invoice_id": invoice_id,
                "line_number": n,
                "description": desc,
                "quantity": qty,
                "unit_price": price,
                "tax_rate": rate,
                "surcharge_rate": srate,
                "tax_category_key": cat,
                "base_amount": b,
                "tax_amount": t,
                "total_amount": b + t,
                "product_id": prd,
            },
            hub,
        )
        if not ok:
            return ok, err
    return True, ""


def rectify(original_id: str, hub: str = HUB, new_id: str | None = None) -> tuple[bool, str]:
    return run_command(
        "invoice.rectify",
        {
            "original_id": original_id,
            "new_id": new_id or str(uuid.uuid4()),
            "year": YEAR,
            "issue_date": NOW[:10],
            "reason": "Customer returned the order",
        },
        hub,
    )


def rectification_of(original_id: str, hub: str = HUB) -> str:
    return q(
        "SELECT id FROM invoice_invoice WHERE hub_id = "
        f"{literal(hub)} AND rectifies_invoice_id = {literal(original_id)} AND is_deleted = 0"
    )


def lines_of(invoice_id: str, hub: str = HUB) -> list[dict]:
    raw = q(
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.line_number)::text, '[]') FROM ("
        "SELECT id, line_number, description, quantity, unit_price, tax_rate, surcharge_rate, "
        "tax_category_key, base_amount, tax_amount, total_amount, product_id "
        "FROM invoice_invoiceitem WHERE hub_id = "
        f"{literal(hub)} AND invoice_id = {literal(invoice_id)}) t"
    )
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return []


# ── 1. THE DEFECT: the rectification is born WITHOUT LINES ──────────────────────────────


def test_the_rectification_carries_the_originals_lines_negated():
    print("\n== 1. the rectifying invoice carries the original's lines, with the money negated ==")

    ok, err = issue("TCK-1", source_type="sale", source_id="sale-1")
    check("the mixed-rate ticket (21 % + 10 %) is issued with its two lines", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check("the original has its two lines", 2, len(lines_of("TCK-1")))

    ok, err = rectify("TCK-1")
    check("`invoice.rectify` succeeds", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")

    rid = rectification_of("TCK-1")
    got = lines_of(rid)

    # THE assertion of the issue. Before the fix this is 0 and everything below is moot.
    check("the rectification has ONE LINE PER LINE of the original", 2, len(got))
    if len(got) != 2:
        print("       ↳ the rectification was born with no concepts under its total")
        return

    for i, (desc, qty, price, rate, srate, cat, b, t, prd) in enumerate(LINES):
        line = got[i]
        n = i + 1
        check(f"line {n}: the concept is the original's", desc, line["description"])
        check(f"line {n}: `line_number` is preserved", n, line["line_number"])
        # THE MONEY is negated — that is what a rectification undoes.
        check(f"line {n}: base_amount is negated", -b, line["base_amount"])
        check(f"line {n}: tax_amount is negated", -t, line["tax_amount"])
        check(f"line {n}: total_amount is negated", -(b + t), line["total_amount"])
        # The DESCRIPTORS are not: a rectified 21 % is still a 21 %, and the unit price of the
        # thing sold does not become negative because it came back. Same rule the header follows
        # for `tax_breakdown` (invoice#5): negate `base`/`quota`, never `rate`.
        check(f"line {n}: the tax rate is NOT negated", rate, line["tax_rate"])
        check(f"line {n}: the surcharge rate is NOT negated", srate, line["surcharge_rate"])
        check(f"line {n}: `unit_price` is NOT negated", price, line["unit_price"])
        # Traceability: what came back, and under which frozen tax category (ADR-0085).
        check(f"line {n}: `product_id` is preserved", prd, line["product_id"])
        check(f"line {n}: `tax_category_key` is preserved", cat, line["tax_category_key"])
        check(f"line {n}: `quantity` is preserved as a count", qty, line["quantity"])
        check(f"line {n}: the line gets its OWN id, not the original's", True,
              line["id"] != f"TCK-1-L{n}")


# ── 2. The lines ADD UP to the header and to the breakdown ──────────────────────────────


def test_the_lines_add_up_to_the_header_and_the_breakdown():
    print("\n== 2. Σ lines == the header the module stamped == the copied breakdown ==")

    rid = rectification_of("TCK-1")
    got = lines_of(rid)

    check("Σ base of the lines == the rectification's base_amount", -BASE,
          sum(l["base_amount"] for l in got))
    check("Σ tax of the lines == the rectification's tax_amount", -TAX,
          sum(l["tax_amount"] for l in got))
    check("Σ total of the lines == the rectification's total_amount", -TOTAL,
          sum(l["total_amount"] for l in got))
    check(
        "...and that IS the header on the row",
        f"{-BASE}|{-TAX}|{-TOTAL}",
        q(
            "SELECT base_amount || '|' || tax_amount || '|' || total_amount FROM invoice_invoice "
            f"WHERE hub_id = {literal(HUB)} AND id = {literal(rid)}"
        ),
    )

    # And per RATE, against the breakdown the header carries — the array `verifactu` copies
    # verbatim. The breakdown is NOT re-derived from these lines (ADR-0210 / ADR-0123 §4); this
    # asserts the two agree, which is the cross-check the AEAT performs.
    raw = q(
        f"SELECT tax_breakdown FROM invoice_invoice WHERE hub_id = {literal(HUB)} AND id = {literal(rid)}"
    )
    breakdown = json.loads(raw) if raw.startswith("[") else []
    by_rate: dict[float, list[int]] = {}
    for l in got:
        acc = by_rate.setdefault(float(l["tax_rate"]), [0, 0])
        acc[0] += l["base_amount"]
        acc[1] += l["tax_amount"]
    for entry in breakdown:
        rate = float(entry["rate"])
        check(f"rate {rate:g}: Σ base of its lines == the breakdown's base",
              entry["base"], by_rate.get(rate, [None, None])[0])
        check(f"rate {rate:g}: Σ tax of its lines == the breakdown's quota",
              entry["quota"], by_rate.get(rate, [None, None])[1])


# ── 3. A retry does not duplicate the lines ─────────────────────────────────────────────


def test_a_retried_rectification_does_not_duplicate_the_lines():
    print("\n== 3. a retried `invoice.rectify` adds no second set of lines ==")

    rid = rectification_of("TCK-1")
    ok, err = rectify("TCK-1")
    check("the retry does not fail (the guard chain of invoice#39 makes it a no-op)", True, ok)
    check("...still exactly one rectification", 1, qi(
        "SELECT count(*) FROM invoice_invoice WHERE hub_id = "
        f"{literal(HUB)} AND rectifies_invoice_id = 'TCK-1' AND is_deleted = 0"))
    check("...and still exactly two lines, not four", 2, len(lines_of(rid)))
    check("...no orphan lines were written for the id the retry minted", 2, qi(
        "SELECT count(*) FROM invoice_invoiceitem i JOIN invoice_invoice r ON r.id = i.invoice_id "
        f"WHERE i.hub_id = {literal(HUB)} AND r.rectifies_invoice_id = 'TCK-1'"))


# ── 4. Tenancy: lines are copied within ONE hub ─────────────────────────────────────────


def test_lines_are_never_copied_across_hubs():
    print("\n== 4. the copy carries `hub_id`: a neighbour's line is not pulled in ==")

    ok, err = issue("TCK-2", source_type="sale", source_id="sale-2")
    check("a second ticket is issued", True, ok)

    # A row belonging to ANOTHER hub that points at OUR invoice. Nothing in the module writes this;
    # it is planted to prove the JOIN is scoped. If the copy joined on `invoice_id` alone, the
    # neighbour's concept — and its money — would land on our customer's rectifying invoice.
    psql(
        [
            "-c",
            "INSERT INTO invoice_invoiceitem (id, hub_id, invoice_id, line_number, description, "
            "quantity, unit_price, tax_rate, surcharge_rate, tax_category_key, base_amount, "
            "tax_amount, total_amount, product_id, created_at) VALUES "
            f"('NEIGHBOUR-L1', {literal(OTHER_HUB)}, 'TCK-2', 9, 'Neighbour secret', {UNIT}, "
            f"9999, 21.0, 0.0, NULL, 9999, 2100, 12099, NULL, {literal(NOW)})",
        ],
        db=H.DB,
    )
    check("the neighbour's row is planted", 1, qi(
        "SELECT count(*) FROM invoice_invoiceitem WHERE hub_id = "
        f"{literal(OTHER_HUB)} AND invoice_id = 'TCK-2'"))

    ok, err = rectify("TCK-2")
    check("the ticket is rectified", True, ok)
    rid = rectification_of("TCK-2")
    got = lines_of(rid)
    check("the rectification carries OUR two lines and only ours", 2, len(got))
    check("the neighbour's concept never appears", [], [
        l["description"] for l in got if l["description"] == "Neighbour secret"])
    check("Σ base is still ours alone", -BASE, sum(l["base_amount"] for l in got))
    check("nothing was written under the neighbour's hub_id", 1, qi(
        "SELECT count(*) FROM invoice_invoiceitem WHERE hub_id = " + literal(OTHER_HUB)))


# ── 5. An invoice with no lines still rectifies ─────────────────────────────────────────


def test_an_invoice_without_lines_still_rectifies():
    print("\n== 5. an invoice that never had lines rectifies into one that has none either ==")

    ok, err = issue(
        "MAN-1", invoice_type="F1", series="FACT", source_type="manual", source_id=None, lines=[]
    )
    check("a header-only invoice is issued", True, ok)
    check("it has no lines", 0, len(lines_of("MAN-1")))

    ok, err = rectify("MAN-1")
    check("it is rectified anyway (no line to copy is not an error)", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    rid = rectification_of("MAN-1")
    check("a rectification exists", True, bool(rid) and not rid.startswith("<"))
    check("...and no phantom line was invented for it", 0, len(lines_of(rid)))


# ── 6. The chain declares the step ──────────────────────────────────────────────────────


def test_the_command_declares_the_step_after_the_header():
    print("\n== 6. `invoice.rectify` declares the line copy, after the header that owns it ==")

    sqls = MANIFEST["commands"]["invoice.rectify"]["sql"]
    rel = "commands/rectify_lines.sql"
    check("the step is declared in module.json", True, rel in sqls)
    check("the file exists", True, (MODULE_DIR / rel).exists())
    if rel in sqls:
        check(
            "it runs AFTER `rectify_insert.sql` (the row it hangs the lines off must exist)",
            True,
            sqls.index(rel) > sqls.index("commands/rectify_insert.sql"),
        )
    check(
        "the command is still a transaction (header and lines commit together, or neither does)",
        True,
        MANIFEST["commands"]["invoice.rectify"].get("transaction") is True,
    )


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def main() -> int:
    running = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", H.CONTAINER],
        capture_output=True,
        text=True,
    )
    if "true" not in running.stdout:
        subprocess.run(["docker", "start", H.CONTAINER], capture_output=True)

    psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])
    psql(["-c", f"CREATE DATABASE {H.DB}"])
    try:
        H.load_migrations()
        test_the_rectification_carries_the_originals_lines_negated()
        test_the_lines_add_up_to_the_header_and_the_breakdown()
        test_a_retried_rectification_does_not_duplicate_the_lines()
        test_lines_are_never_copied_across_hubs()
        test_an_invoice_without_lines_still_rectifies()
        test_the_command_declares_the_step_after_the_header()
    finally:
        psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — the rectifying invoice carries the original's lines, with the money negated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
