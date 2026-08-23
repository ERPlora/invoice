#!/usr/bin/env python3
"""Rectifying an invoice BORN FROM A SALE — invoice#5 D1/D2.

Runs against a REAL Postgres 18 in Docker, applying the module's `migrations/postgres/*.sql` the
way the runtime does (portable types shimmed to native ones, ADR-0007 §4b) and executing the
manifest's `sql[]` chains bound like the runtime binds them (`:hub_id`, `:current_user_id`, `:now`,
`:new_id` injected; a `:param` absent from the payload is NULL).

Why the test exists
-------------------
`invoice.rectify` was only ever exercised against a MANUAL invoice — the one shape where
`source_id` is NULL. Every invoice the POS issues is born from a sale (`source_type='sale'`,
`source_id=<sale>`), and `rectify_insert.sql` copied `source_type, source_id` VERBATIM from the
original, so the rectifying invoice tried to insert the SAME tuple as the invoice it rectifies:

    CREATE UNIQUE INDEX uq_invoice_source ON invoice_invoice (hub_id, source_type, source_id)
      WHERE source_id IS NOT NULL;                          -- 001_init.sql

`invoice.rectify` declares `transaction: true`, so the violation aborted the whole chain: no
rectifying invoice, and — worse — the guard chain of invoice#39 made the number NOT be consumed,
so the failure was silent to the operator and total to the customer. **Every POS ticket was
irrectifiable**, which is the normal path of a refund. The e2e was green because it rectified a
manual invoice.

Two things had to be true for the fix to be a fix, and both are asserted below:

1. The rectifying invoice must NOT occupy the sale's idempotency slot. `uq_invoice_source` is the
   *sales* index — "one invoice per sale" — and hanging a fiscal invariant off it is precisely the
   fragility invoice#34 removed for substitutions. The R carries `source_type='rectification'` with
   a NULL `source_id`, and "one rectification per invoice" gets its OWN partial unique index on the
   fiscal link (`009_rectification_unique.sql`), mirroring `ux_invoice_substitutes` (005).
2. The R's `tax_breakdown` must be the ORIGINAL's, negated — not `'{}'`. `'{}'` does not fail
   loudly: `hub/crates/verifactu/src/aeat.rs::desglose()` falls back to a SINGLE line at the
   EFFECTIVE rate (`cuota/base`). A single-rate invoice then happens to come out right; a MIXED
   one (the beer at 21 % + the tapa at 10 %) yields an effective ~19.1 %, which is not a legal VAT
   rate, and the local guard `xsd.rs` rejects it. ADR-0210: the breakdown is COPIED from the
   snapshot frozen on the original, never re-derived from today's settings or price list, or a
   rectification of an old invoice would come out on a different tax basis than the invoice it
   rectifies. ADR-0123 §4: the breakdown closes once per RATE, not per line.

Not covered here (and deliberately so — see invoice#5): the R still carries no LINES
(`invoice_invoiceitem`), which needs `invoice.rectify` to become a WASM handler because N lines
need N ids and a declarative command receives exactly one `:new_id`. And `TipoRectificativa` /
`FacturasRectificadas` are emitted by the hub, not here (hub#1023).

Usage: tests/rectify_sale_born.postgres.test.py
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
# Reused rather than copied: the `::`-is-a-cast rule this test depends on had to be fixed once, in
# the shared copy, instead of drifting between five of them.
_spec = importlib.util.spec_from_file_location(
    "invoice_pg_harness", HERE / "substitution_unique.postgres.test.py"
)
H = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(H)
H.DB = f"invoice_rectify_sale_test_{os.getpid()}"

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

# The mixed-rate ticket of the issue: a drink at 21 % and food at 10 %. Amounts in CENTS
# (integers — money contract). 1000 + 210 and 500 + 50 → base 1500, tax 260, total 1760.
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
    customer_tax_id: str = "",
    hub: str = HUB,
) -> tuple[bool, str]:
    """`_ensure_series` → `_bump_series` → `_insert_invoice` (+ its allocation) — the op chain the
    handler emits for one invoice."""
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
    ok, err = run_command(
        "invoice._ensure_series", {**base, "new_id": str(uuid.uuid4())}, hub
    )
    if not ok:
        return ok, err
    ok, err = run_command("invoice._bump_series", base, hub)
    if not ok:
        return ok, err
    return run_command(
        "invoice._insert_invoice",
        {
            **base,
            "invoice_id": invoice_id,
            "new_id": invoice_id,
            "issue_date": NOW[:10],
            "issuer_nif": "B00000000",
            "issuer_name": "Test SL",
            "customer_tax_id": customer_tax_id,
            "customer_name": "Customer",
            "customer_address": "",
            "description": "",
            "base_amount": BASE,
            "tax_amount": TAX,
            "total_amount": TOTAL,
            "tax_breakdown": json.dumps(BREAKDOWN, separators=(",", ":")),
            "substitutes_invoice_id": "",
            "notes": "",
            "business_tax_id": "B00000000",
            "business_legal_name": "Test SL",
        },
        hub,
    )


def rectify(
    original_id: str, hub: str = HUB, new_id: str | None = None
) -> tuple[bool, str]:
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


def rectifications_of(original_id: str, hub: str = HUB) -> int:
    return qi(
        "SELECT count(*) FROM invoice_invoice WHERE hub_id = "
        f"{literal(hub)} AND rectifies_invoice_id = {literal(original_id)} AND is_deleted = 0"
    )


def rect_counter(hub: str = HUB) -> int:
    return qi(
        "SELECT COALESCE(max(current_number), -1) FROM invoice_invoiceseries WHERE hub_id = "
        f"{literal(hub)} AND code = 'RECT' AND year = {YEAR}"
    )


# ── 1. THE BLOCKER: a ticket born from a sale can be rectified at all ───────────────────


def test_a_sale_born_invoice_can_be_rectified():
    print("\n== 1. rectifying an invoice born from a sale (every POS ticket) ==")

    ok, err = issue("TCK-1", source_type="sale", source_id="sale-1")
    check("the ticket is issued from the sale", True, ok)

    ok, err = rectify("TCK-1")
    check("`invoice.rectify` SUCCEEDS on a sale-born invoice", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check(
        "exactly one rectification exists for the ticket", 1, rectifications_of("TCK-1")
    )
    check(
        "the original is cancelled (immutability: it is rectified, never edited)",
        "cancelled",
        q(
            "SELECT status FROM invoice_invoice WHERE id = 'TCK-1' AND hub_id = "
            + literal(HUB)
        ),
    )
    check(
        "the rectification is issued in the RECT series",
        "RECT",
        q(
            "SELECT series FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND rectifies_invoice_id = 'TCK-1'"
        ),
    )
    check(
        "its number is booked in the numbering ledger (RD 1007/2023)",
        1,
        qi(
            "SELECT count(*) FROM invoice_number_allocation a JOIN invoice_invoice r "
            "ON r.id = a.invoice_id WHERE a.hub_id = "
            f"{literal(HUB)} AND r.rectifies_invoice_id = 'TCK-1'"
        ),
    )


# ── 2. The R must not squat the SALE's idempotency slot ─────────────────────────────────


def test_the_rectification_does_not_take_the_sales_source_key():
    print(
        "\n== 2. `uq_invoice_source` stays the SALES index, not a fiscal invariant =="
    )

    check(
        "the rectification carries no source id (the sale already claimed its slot)",
        "rectification|",
        q(
            "SELECT source_type || '|' || COALESCE(source_id, '') FROM invoice_invoice "
            f"WHERE hub_id = {literal(HUB)} AND rectifies_invoice_id = 'TCK-1'"
        ),
    )
    check(
        "exactly one row still holds the sale's key (`sale`/`sale-1`)",
        1,
        qi(
            "SELECT count(*) FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND source_type = 'sale' AND source_id = 'sale-1'"
        ),
    )
    # And the sale's own idempotency still works: a redelivered `sale.completed` is a no-op,
    # not a second invoice — the fix must not have opened THAT door while closing this one.
    ok, _ = issue("TCK-1-DUP", source_type="sale", source_id="sale-1")
    check("a redelivered sale still does not create a second invoice", True, ok)
    check(
        "...it is a silent no-op: still one invoice for the sale",
        1,
        qi(
            "SELECT count(*) FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND source_type = 'sale' AND source_id = 'sale-1'"
        ),
    )


# ── 3. One rectification per invoice, enforced by the SCHEMA ────────────────────────────


def test_one_rectification_per_invoice_is_enforced_by_the_database():
    print(
        "\n== 3. the 'one rectification per invoice' invariant lives in the schema =="
    )

    # a) Through the front door: the guard chain of invoice#39 makes the retry a clean no-op,
    #    and — the part that matters for a correlative series — it burns NO number.
    before = rect_counter()
    ok, _ = rectify("TCK-1")
    check("a retried `invoice.rectify` does not fail", True, ok)
    check("...and creates no second rectification", 1, rectifications_of("TCK-1"))
    check("...and burns no number in the RECT series", before, rect_counter())

    # b) Bypassing the guard, the way a flow / the assistant / the public API could: a raw INSERT
    #    with a different id. Only an index on the fiscal link itself can stop this one.
    try:
        psql(
            [
                "-c",
                "INSERT INTO invoice_invoice (id, hub_id, invoice_type, series, number, issue_date, "
                "issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, "
                "description, base_amount, tax_amount, total_amount, tax_breakdown, currency, "
                "source_type, source_id, rectifies_invoice_id, status, notes, is_deleted, "
                "created_by, updated_by, created_at, updated_at) VALUES "
                f"('R-SNEAK', {literal(HUB)}, 'R1', 'RECT', 'RECT-2026-000999', '2026-08-24', "
                "'B00000000', 'Test SL', '', 'C', '', '', -1, -1, -2, '[]', 'EUR', "
                f"'manual', NULL, 'TCK-1', 'issued', '', 0, {literal(USER)}, {literal(USER)}, "
                f"{literal(NOW)}, {literal(NOW)})",
            ],
            db=H.DB,
        )
        sneaked, err = True, ""
    except RuntimeError as exc:
        sneaked, err = False, str(exc)

    check(
        "a second rectification of the same invoice is REFUSED by the database",
        False,
        sneaked,
    )
    check(
        "...by the index on the rectification link", True, "ux_invoice_rectifies" in err
    )
    check("still exactly one rectification", 1, rectifications_of("TCK-1"))


# ── 4. What that index must NOT block ───────────────────────────────────────────────────


def test_the_index_is_scoped_and_partial():
    print("\n== 4. the index is per hub, ignores NULL links and soft-deleted rows ==")

    # `id` is the PRIMARY KEY, so a second hub cannot literally reuse `TCK-1` — but the LINK value
    # can repeat across hubs, and that is what the index has to tolerate. A neighbour row pointing
    # at the same `rectifies_invoice_id` under a different `hub_id` must be accepted: if the index
    # were global instead of per hub, one tenant could make another tenant's invoice unrectifiable.
    # (The link is dangling here on purpose — the index is what is under test, not referential
    # integrity, which the module keeps logical rather than as an FK.)
    try:
        psql(
            [
                "-c",
                "INSERT INTO invoice_invoice (id, hub_id, invoice_type, series, number, issue_date, "
                "issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, "
                "description, base_amount, tax_amount, total_amount, tax_breakdown, currency, "
                "source_type, source_id, rectifies_invoice_id, status, notes, is_deleted, "
                "created_by, updated_by, created_at, updated_at) VALUES "
                f"('R-NEIGHBOUR', {literal(OTHER_HUB)}, 'R1', 'RECT', 'RECT-2026-000001', "
                "'2026-08-24', 'B00000000', 'Other SL', '', 'C', '', '', -1, -1, -2, '[]', 'EUR', "
                f"'rectification', NULL, 'TCK-1', 'issued', '', 0, {literal(USER)}, "
                f"{literal(USER)}, {literal(NOW)}, {literal(NOW)})",
            ],
            db=H.DB,
        )
        neighbour_ok, neighbour_err = True, ""
    except RuntimeError as exc:
        neighbour_ok, neighbour_err = False, str(exc).splitlines()[0]

    check(
        "a neighbouring hub may point at the same link value: the index carries `hub_id`",
        True,
        neighbour_ok,
    )
    if not neighbour_ok:
        print(f"       ↳ {neighbour_err}")
    check(
        "the neighbour has its own single rectification",
        1,
        rectifications_of("TCK-1", OTHER_HUB),
    )
    check("and ours is untouched", 1, rectifications_of("TCK-1", HUB))

    # Ordinary invoices carry a NULL link and must coexist by the thousand.
    ok1, _ = issue(
        "MAN-1", invoice_type="F1", series="FACT", source_type="manual", source_id=None
    )
    ok2, _ = issue(
        "MAN-2", invoice_type="F1", series="FACT", source_type="manual", source_id=None
    )
    check("two invoices without a rectification link coexist", (True, True), (ok1, ok2))

    # A soft-deleted rectification frees the slot — a partial index only counts live rows. This is
    # the manual-repair path, not a business flow: nothing in the module soft-deletes an issued
    # invoice, but the index must not turn a repaired hub into an unrectifiable one.
    psql(
        [
            "-c",
            "UPDATE invoice_invoice SET is_deleted = 1, deleted_at = "
            + literal(NOW)
            + f" WHERE hub_id = {literal(HUB)} AND rectifies_invoice_id = 'TCK-1'",
        ],
        db=H.DB,
    )
    ok, err = rectify("TCK-1")
    check(
        "after soft-deleting the rectification, the invoice can be rectified again",
        True,
        ok,
    )
    check("one LIVE rectification", 1, rectifications_of("TCK-1"))


# ── 5. The breakdown is the ORIGINAL's, negated — never re-derived (ADR-0210) ────────────


def test_the_breakdown_is_copied_negated_from_the_original():
    print(
        "\n== 5. `tax_breakdown`: copied from the frozen snapshot, with the amounts negated =="
    )

    ok, _ = issue("TCK-2", source_type="sale", source_id="sale-2")
    check("a mixed-rate ticket (21 % + 10 %) is issued", True, ok)
    ok, err = rectify("TCK-2")
    check("it is rectified", True, ok)

    raw = q(
        "SELECT tax_breakdown FROM invoice_invoice WHERE hub_id = "
        f"{literal(HUB)} AND rectifies_invoice_id = 'TCK-2'"
    )
    try:
        got = json.loads(raw)
    except (ValueError, TypeError):
        got = None

    check(
        "the breakdown is a JSON ARRAY, not the empty object `{}`",
        True,
        isinstance(got, list),
    )
    if not isinstance(got, list):
        print(f"       ↳ got: {raw!r}")
        return

    check("it keeps ONE entry per tax rate (ADR-0123 §4)", 2, len(got))
    by_rate = {float(e.get("rate", -1)): e for e in got}
    check(
        "the two rates of the original survive verbatim", [10.0, 21.0], sorted(by_rate)
    )
    for rate, base, quota in ((21.0, -1000, -210), (10.0, -500, -50)):
        e = by_rate.get(rate, {})
        check(f"rate {rate:g}: base negated", base, e.get("base"))
        check(f"rate {rate:g}: quota negated", quota, e.get("quota"))
        check(
            f"rate {rate:g}: the RATE itself is NOT negated",
            rate,
            float(e.get("rate", 0)),
        )
        check(
            f"rate {rate:g}: the tax key is preserved",
            ("IVA", "01", "S1"),
            (e.get("tax"), e.get("regime"), e.get("class")),
        )

    # The audit that makes it a breakdown and not decoration: it has to add up to the header the
    # module itself stamped. This is what `verifactu.records.ingest_invoice` copies verbatim.
    check(
        "Σ base of the breakdown == the rectification's base_amount",
        -BASE,
        sum(int(e.get("base", 0)) for e in got),
    )
    check(
        "Σ quota of the breakdown == the rectification's tax_amount",
        -TAX,
        sum(int(e.get("quota", 0)) for e in got),
    )
    check(
        "...and that IS the header the rectification carries",
        f"{-BASE}|{-TAX}|{-TOTAL}",
        q(
            "SELECT base_amount || '|' || tax_amount || '|' || total_amount FROM invoice_invoice "
            f"WHERE hub_id = {literal(HUB)} AND rectifies_invoice_id = 'TCK-2'"
        ),
    )


# ── 5b. The two shapes a stored breakdown can have ──────────────────────────────────────


def test_the_legacy_and_empty_breakdown_shapes():
    print("\n== 5b. legacy object breakdown, and the invoices that never had one ==")

    # The LEGACY shape (`{"<rate>": {"base":…, "tax":…}}`) is still accepted by
    # `aeat.rs::desglose()`, so an invoice issued before the array format must still rectify into a
    # correct breakdown — not be silently flattened to the effective-rate fallback.
    psql(
        [
            "-c",
            "UPDATE invoice_invoice SET tax_breakdown = "
            + literal(
                '{"21": {"base": 1000, "tax": 210}, "10": {"base": 500, "tax": 50}}'
            )
            + f" WHERE hub_id = {literal(HUB)} AND id = 'MAN-1'",
        ],
        db=H.DB,
    )
    ok, err = rectify("MAN-1")
    check("an invoice with a LEGACY object breakdown is rectified", True, ok)
    raw = q(
        "SELECT tax_breakdown FROM invoice_invoice WHERE hub_id = "
        f"{literal(HUB)} AND rectifies_invoice_id = 'MAN-1'"
    )
    try:
        got = json.loads(raw)
    except (ValueError, TypeError):
        got = None
    check(
        "the legacy SHAPE is preserved (an object keyed by rate)",
        True,
        isinstance(got, dict),
    )
    if isinstance(got, dict):
        check("both rates survive as keys", ["10", "21"], sorted(got))
        check(
            "21 %: base and tax negated",
            (-1000, -210),
            (got.get("21", {}).get("base"), got.get("21", {}).get("tax")),
        )
        check(
            "10 %: base and tax negated",
            (-500, -50),
            (got.get("10", {}).get("base"), got.get("10", {}).get("tax")),
        )

    # And the invoices that predate the field carry `'{}'`. There is no breakdown to copy and none
    # is invented: it comes out `'[]'`, which lands on exactly the same effective-rate fallback in
    # `aeat.rs::desglose()` that `'{}'` did. Correct for a single-rate invoice, which is all those
    # rows can be, and honest for anything else — a fabricated breakdown would be invented evidence.
    psql(
        [
            "-c",
            "UPDATE invoice_invoice SET tax_breakdown = '{}' WHERE hub_id = "
            f"{literal(HUB)} AND id = 'MAN-2'",
        ],
        db=H.DB,
    )
    ok, err = rectify("MAN-2")
    check("an invoice from before the field ('{}') still rectifies", True, ok)
    check(
        "...and its rectification says so, with an empty array",
        "[]",
        q(
            "SELECT tax_breakdown FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND rectifies_invoice_id = 'MAN-2'"
        ),
    )


# ── 6. The migration ────────────────────────────────────────────────────────────────────


def test_migration_is_declared_and_reentrant():
    print(
        "\n== 6. the migration is declared in the manifest and re-applying it is a no-op =="
    )
    rel = "migrations/postgres/009_rectification_unique.sql"
    mig = MODULE_DIR / rel
    check("the migration file exists", True, mig.exists())
    check(
        "it is declared in module.json", True, rel in MANIFEST["migrations"]["postgres"]
    )
    if mig.exists():
        try:
            psql(
                [],
                db=H.DB,
                stdin=H.DDL_TOKEN.sub(
                    lambda m: H.DDL_TYPES[m.group(1).upper()], mig.read_text()
                ),
            )
            check("re-applying 009 does not fail", True, True)
        except RuntimeError as exc:
            check("re-applying 009 does not fail", True, str(exc).splitlines()[0])


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
        test_a_sale_born_invoice_can_be_rectified()
        test_the_rectification_does_not_take_the_sales_source_key()
        test_one_rectification_per_invoice_is_enforced_by_the_database()
        test_the_index_is_scoped_and_partial()
        test_the_breakdown_is_copied_negated_from_the_original()
        test_the_legacy_and_empty_breakdown_shapes()
        test_migration_is_declared_and_reentrant()
    finally:
        psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — a sale-born invoice can be rectified, once, with the original's negated breakdown"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
