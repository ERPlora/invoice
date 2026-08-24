#!/usr/bin/env python3
"""`sale.refunded` issues the rectifying invoice by itself — once, and only when the whole invoice
came back (invoice#62).

Runs against a REAL Postgres 18 in Docker, applying the module's `migrations/postgres/*.sql` the
way the runtime does and executing the manifest's `sql[]` chains bound like the runtime binds them
(`:hub_id`, `:current_user_id`, `:now`, `:new_id` injected; a `:param` absent from the payload is
NULL). The plumbing is shared with `substitution_unique.postgres.test.py`.

WHAT IS UNDER TEST — and what it is protecting.

1. THE LISTENER RESOLVES ITS OWN ORIGINAL. `sale.refunded` carries `sale_id`, never an invoice id.
   The chain finds the invoice through THIS module's own row (`source_type='sale'`,
   `source_id=<sale>`, the tuple `uq_invoice_source` already keeps unique), so the payload never
   gets to name which fiscal document is about to be cancelled.

2. FULLNESS, NOT DOCUMENT TYPE, IS THE GATE. `invoice.create_from_sale` issues a row for EVERY
   completed sale — F1 when the sale was taken as a full invoice, F2 (simplified) for a plain POS
   ticket — and both are ingested into the VeriFactu chain. So a refund of a TICKET needs its
   rectifying invoice exactly as much as a refund of an invoice does; the core turns the R1 into
   the R5 the AEAT asks for when there is no recipient NIF. What decides is whether the money came
   back IN FULL: `invoice.rectify` negates the whole original and cancels it, which is the truth
   only for a full return. A refund that leaves part of the invoice standing needs a rectificativa
   POR DIFERENCIAS over a prorated share of the original's frozen `tax_breakdown` — invoice#63.

3. NOTHING REACHES THE AEAT TWICE, AND NO NUMBER IS BURNED IN VAIN. A VeriFactu record is a link in
   a hash chain: emitting one for an operation that already has one is not a duplicate row, it is a
   second declaration of the same fact, and a rejected record has already spent its link. Two
   things hold that line here and BOTH are asserted:
     * the whole chain no-ops on a redelivery — `rectify_bump.sql` does not advance the counter, so
       the RECT series is where it was and the numbering ledger has one row, not two;
     * because no invoice row carries the fresh `:new_id`, the `invoice.rectified` the runtime
       emits from the outbox points at nothing, and `verifactu.records.ingest_invoice` reads the
       invoice by that id and returns empty. No record, no link, no XML.
   The atomic half is `ON CONFLICT DO NOTHING` on the insert (migration 010's partial unique index
   on `rectifies_ref`): the `NOT EXISTS` guards are what stop the number being spent, but only the
   index can decide a race, and a check-then-act between two relays would not.

4. THE OLD HUB IS UNTOUCHED. A hub whose `sales` predates v2.16.4 never emits `sale.refunded`, so
   the only thing that could break it is the shared SQL this change edits. The manual door
   (`invoice.rectify` with an explicit `original_id`, `year` and `issue_date`) is exercised
   side by side with the listener for exactly that reason.

Usage: tests/rectify_from_refund.postgres.test.py
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

_spec = importlib.util.spec_from_file_location(
    "invoice_pg_harness", HERE / "substitution_unique.postgres.test.py"
)
H = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(H)
H.DB = f"invoice_refund_test_{os.getpid()}"

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

LISTENER = "invoice._rectify_from_refund"

# A tenant that has never rectified anything. §3 needs one: on a hub whose RECT counter is
# already past 0, an insert that slipped its gate would collide with `uq_invoice_series_number`
# and be swallowed by `ON CONFLICT DO NOTHING` — the right outcome for the WRONG reason, and a
# gate that is only ever load-bearing by accident is a gate nobody notices losing.
FRESH_HUB = "hub-fresh"

# The mixed-rate ticket of a real till: a drink at 21 % and food at 10 %. CENTS (ADR-0007).
BREAKDOWN = [
    {
        "tax": "IVA",
        "regime": "01",
        "class": "S1",
        "rate": 21.0,
        "base": 1000,
        "quota": 210,
    },
    {
        "tax": "IVA",
        "regime": "01",
        "class": "S1",
        "rate": 10.0,
        "base": 500,
        "quota": 50,
    },
]
BASE, TAX, TOTAL = 1500, 260, 1760


# ── Fixtures ─────────────────────────────────────────────────────────────────────────────


def issue(
    invoice_id: str,
    *,
    invoice_type: str = "F2",
    series: str = "TICKET",
    source_type: str = "sale",
    source_id: str | None = None,
    customer_tax_id: str = "",
    hub: str = HUB,
) -> tuple[bool, str]:
    """`_ensure_series` → `_bump_series` → `_insert_invoice` (+ allocation): the chain the WASM
    handler emits for one invoice born from a sale."""
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


def add_line(invoice_id: str, line_id: str, hub: str = HUB) -> None:
    """One line on the original, so the rectification has something to copy (invoice#59)."""
    psql(
        [
            "-c",
            "INSERT INTO invoice_invoiceitem (id, hub_id, invoice_id, line_number, description, "
            "quantity, unit_price, tax_rate, surcharge_rate, tax_category_key, base_amount, "
            "tax_amount, total_amount, product_id, created_at) VALUES ("
            f"{literal(line_id)}, {literal(hub)}, {literal(invoice_id)}, 1, 'Menu', 1, {TOTAL}, "
            f"21, NULL, 'IVA/01/S1/21', {BASE}, {TAX}, {TOTAL}, NULL, {literal(NOW)})",
        ],
        db=H.DB,
    )


def refunded_event(
    sale_id: str,
    *,
    refund_ref: str,
    total: int = TOTAL,
    fully_refunded: bool = True,
    document_type: str = "ticket",
    reason: str = "Customer returned the order",
) -> dict:
    """The payload `sales.refund_sale` actually emits (sales v2.16.4, handler/src/lib.rs), copied
    field for field so this test breaks if the producer's shape drifts."""
    return {
        "sender": "sales",
        "sale_id": sale_id,
        "sale_number": "20260824-0007",
        "refund_id": refund_ref,
        "refund_ref": refund_ref,
        "total": total,
        "reason": reason,
        "refunded_by": USER,
        "refunded_at": NOW,
        "fully_refunded": fully_refunded,
        "document_type": document_type,
        "order_id": None,
        "payments": [
            {
                "payment_id": "pay-1",
                "payment_method_id": "pm-cash",
                "payment_method_name": "Cash",
                "payment_method_type": "cash",
                "amount": total,
            }
        ],
    }


def on_refund(
    payload: dict, hub: str = HUB, new_id: str | None = None
) -> tuple[bool, str]:
    """Deliver `sale.refunded` the way the outbox relay does: the event payload verbatim, plus the
    system params. Note what is NOT in it — no `original_id`, no `year`, no `issue_date`."""
    return run_command(
        LISTENER, {**payload, "new_id": new_id or str(uuid.uuid4())}, hub
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


def allocations(hub: str = HUB) -> int:
    return qi(
        "SELECT count(*) FROM invoice_number_allocation WHERE hub_id = "
        f"{literal(hub)} AND code = 'RECT'"
    )


def status_of(invoice_id: str, hub: str = HUB) -> str:
    return q(
        "SELECT status FROM invoice_invoice WHERE id = "
        f"{literal(invoice_id)} AND hub_id = {literal(hub)}"
    )


# ── 1. A refunded ticket gets its rectifying invoice, unassisted ─────────────────────────


def test_a_full_refund_issues_the_rectification_by_itself():
    print(
        "\n== 1. `sale.refunded` → the rectifying invoice, with nobody clicking anything =="
    )

    ok, err = issue("TCK-1", source_id="sale-1")
    check("a POS ticket is issued from the sale", True, ok)
    add_line("TCK-1", "TCK-1/L1")

    ok, err = on_refund(refunded_event("sale-1", refund_ref="rf-1"))
    check("the listener runs", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")

    check(
        "exactly one rectification exists for the ticket", 1, rectifications_of("TCK-1")
    )
    check(
        "the original is cancelled (fiscal immutability: rectified, never edited)",
        "cancelled",
        status_of("TCK-1"),
    )
    check(
        "the rectification carries the refund document as its idempotency key",
        "rf-1",
        q(
            "SELECT rectifies_ref FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND rectifies_invoice_id = 'TCK-1'"
        ),
    )
    check(
        "the money is the original's, negated",
        f"{-BASE}|{-TAX}|{-TOTAL}",
        q(
            "SELECT base_amount || '|' || tax_amount || '|' || total_amount "
            f"FROM invoice_invoice WHERE hub_id = {literal(HUB)} AND rectifies_invoice_id = 'TCK-1'"
        ),
    )
    check(
        "the operator's reason travels into the document's description",
        "Customer returned the order",
        q(
            "SELECT description FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND rectifies_invoice_id = 'TCK-1'"
        ),
    )
    check(
        "the lines of the original are copied, negated (invoice#59)",
        1,
        qi(
            "SELECT count(*) FROM invoice_invoiceitem l JOIN invoice_invoice r ON r.id = "
            f"l.invoice_id WHERE l.hub_id = {literal(HUB)} AND r.rectifies_invoice_id = 'TCK-1' "
            f"AND l.total_amount = {-TOTAL}"
        ),
    )
    check(
        "its number is booked in the numbering ledger (RD 1007/2023)", 1, allocations()
    )

    # The DATE and the YEAR are NOT in the event. If the chain did not derive them from `:now`,
    # the RECT series join would find nothing and this whole test would be a silent no-op.
    check(
        "the issue date is derived from the runtime clock, not from the payload",
        NOW[:10],
        q(
            "SELECT issue_date FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND rectifies_invoice_id = 'TCK-1'"
        ),
    )
    check(
        "...and so is the series year",
        int(YEAR),
        qi(
            "SELECT year FROM invoice_invoiceseries WHERE hub_id = "
            f"{literal(HUB)} AND code = 'RECT'"
        ),
    )


# ── 2. A redelivery declares nothing a second time ───────────────────────────────────────


def test_a_redelivered_refund_emits_no_second_document():
    print("\n== 2. the same refund twice: one document, one number, one AEAT record ==")

    before_counter, before_allocs = rect_counter(), allocations()

    ok, err = on_refund(refunded_event("sale-1", refund_ref="rf-1"))
    check(
        "a redelivered `sale.refunded` does NOT fail (it is a no-op, not an error)",
        True,
        ok,
    )
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check("...and creates no second rectification", 1, rectifications_of("TCK-1"))
    check("...and burns no number in the RECT series", before_counter, rect_counter())
    check("...and books no second allocation", before_allocs, allocations())

    # THE AEAT ARGUMENT, made mechanical. `verifactu.records.ingest_invoice` reads the invoice by
    # the id the event carries and returns empty when it finds none. So the second run emitting
    # `invoice.rectified` is harmless precisely because NO row carries that run's `:new_id`.
    ghost = str(uuid.uuid4())
    ok, _ = on_refund(refunded_event("sale-1", refund_ref="rf-1"), new_id=ghost)
    check("a third delivery is a no-op too", True, ok)
    check(
        "no invoice carries the id that delivery minted → `ingest_invoice` finds nothing to declare",
        0,
        qi(f"SELECT count(*) FROM invoice_invoice WHERE id = {literal(ghost)}"),
    )

    # And a DIFFERENT refund document against an already-rectified invoice must not open a second
    # one either: "one rectification per invoice" is the invariant migration 009 put in the schema.
    before_counter = rect_counter()
    ok, _ = on_refund(refunded_event("sale-1", refund_ref="rf-2"))
    check("a second refund document on a rectified invoice does not fail", True, ok)
    check("...still one rectification", 1, rectifications_of("TCK-1"))
    check("...still no number burned", before_counter, rect_counter())


# ── 3. A PARTIAL refund writes nothing — and says so by leaving everything where it was ──


def test_a_partial_refund_issues_nothing():
    print("\n== 3. a partial refund is not a full rectification, so it is not one ==")

    ok, _ = issue("TCK-2", source_id="sale-2")
    check("a second ticket is issued", True, ok)
    add_line("TCK-2", "TCK-2/L1")

    before_counter, before_allocs = rect_counter(), allocations()
    ok, err = on_refund(
        refunded_event("sale-2", refund_ref="rf-3", total=500, fully_refunded=False)
    )
    check("the listener runs without failing", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check("no rectification is issued", 0, rectifications_of("TCK-2"))
    check("no number is burned", before_counter, rect_counter())
    check("no allocation is booked", before_allocs, allocations())
    check(
        "the original is NOT cancelled: part of it still stands",
        "issued",
        status_of("TCK-2"),
    )
    check(
        "and no line was copied onto a document that does not exist",
        0,
        qi(
            "SELECT count(*) FROM invoice_invoiceitem l JOIN invoice_invoice r ON r.id = "
            f"l.invoice_id WHERE l.hub_id = {literal(HUB)} AND r.rectifies_invoice_id = 'TCK-2'"
        ),
    )

    # THE SAME CASE ON A HUB THAT HAS NEVER RECTIFIED. Above, `rectify_bump` refuses and the RECT
    # counter stays where the previous rectification left it, so an insert that had lost its own
    # gate would land on a number that is already taken and be swallowed. Here the counter is at
    # zero, nothing collides, and the ONLY thing standing between a partial refund and a rectifying
    # invoice for the FULL amount is the gate on `rectify_insert.sql` itself.
    ok, _ = issue("FR-1", source_id="sale-f1", hub=FRESH_HUB)
    check("a hub that has never rectified issues its first ticket", True, ok)
    add_line("FR-1", "FR-1/L1", hub=FRESH_HUB)
    ok, err = on_refund(
        refunded_event("sale-f1", refund_ref="rf-f1", total=500, fully_refunded=False),
        hub=FRESH_HUB,
    )
    check("its first ever refund is a partial one, and it runs", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check("no rectification is issued", 0, rectifications_of("FR-1", FRESH_HUB))
    check("the original still stands", "issued", status_of("FR-1", FRESH_HUB))
    check(
        "and no RECT series was even created for it",
        0,
        qi(
            "SELECT count(*) FROM invoice_invoiceseries WHERE hub_id = "
            f"{literal(FRESH_HUB)} AND code = 'RECT'"
        ),
    )


# ── 4. Returned in two acts: the document comes out when the last cent goes back ─────────


def test_a_sale_returned_in_two_acts_is_rectified_once_at_the_end():
    print("\n== 4. two refunds that add up: ONE rectification, and only at the end ==")

    # `sales` computes `fully_refunded` against the SALE TOTAL and everything already returned
    # (`already + total >= sale_total`), so the closing act arrives with the flag set even though
    # its own `total` is only part of the invoice. That is why fullness cannot be re-derived from
    # `:total` alone here, and why this case has to be pinned.
    check(
        "after the first, partial act there is still no document",
        0,
        rectifications_of("TCK-2"),
    )

    ok, err = on_refund(
        refunded_event(
            "sale-2", refund_ref="rf-4", total=TOTAL - 500, fully_refunded=True
        )
    )
    check("the closing act runs", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check(
        "exactly one rectification, now that the whole ticket came back",
        1,
        rectifications_of("TCK-2"),
    )
    check(
        "it is the closing act that is on the document",
        "rf-4",
        q(
            "SELECT rectifies_ref FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND rectifies_invoice_id = 'TCK-2'"
        ),
    )
    check(
        "and it rectifies the WHOLE invoice, not the closing act's amount",
        -TOTAL,
        qi(
            "SELECT total_amount FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND rectifies_invoice_id = 'TCK-2'"
        ),
    )
    check("the original is cancelled now", "cancelled", status_of("TCK-2"))


# ── 5. A refund with no document reference gets no document ──────────────────────────────


def test_a_refund_without_a_reference_is_refused():
    print("\n== 5. no `refund_ref` → no idempotency key → no fiscal document ==")

    ok, _ = issue("TCK-3", source_id="sale-3")
    check("a third ticket is issued", True, ok)

    before = rect_counter()
    ok, err = on_refund(refunded_event("sale-3", refund_ref=""))
    check("the listener does not blow up", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check(
        "nothing is issued: without a stable reference a redelivery could not be recognised",
        0,
        rectifications_of("TCK-3"),
    )
    check("and no number is burned", before, rect_counter())


# ── 6. The neighbour's till is not ours ──────────────────────────────────────────────────


def test_the_listener_never_leaves_its_hub():
    print("\n== 6. a sale id repeats across hubs; a rectification must not ==")

    # ORDER MATTERS HERE, and it is not decoration. The neighbour rectifies something of its own
    # FIRST, so that by the time the interesting case runs BOTH hubs already carry a live RECT
    # series with a counter of their own. Without that, a chain that had lost its `hub_id` filter
    # still came out right by accident — the neighbour's series did not exist yet when the insert
    # chose a row — and the mutant that removes the tenancy filter survived the whole suite. A test
    # that only catches a bug in one of the two orderings is a test that reports the other as safe.
    ok, _ = issue("NB-1", source_id="sale-1", hub=OTHER_HUB)
    check("the neighbour issues its own ticket for its own `sale-1`", True, ok)
    add_line("NB-1", "NB-1/L1", hub=OTHER_HUB)
    ok, err = on_refund(refunded_event("sale-1", refund_ref="rf-1"), hub=OTHER_HUB)
    check("the neighbour may reuse a reference we already used", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check(
        "the same `refund_ref` in two hubs is two documents, not a collision",
        2,
        qi("SELECT count(*) FROM invoice_invoice WHERE rectifies_ref = 'rf-1' AND is_deleted = 0"),
    )
    check("and ours is still the one it always was", 1, rectifications_of("TCK-1", HUB))

    # NOW the case the scoping is for: both hubs carry a live, UNRECTIFIED invoice for a sale with
    # the same id — ids are per tenant, so this is the ordinary case and not a contrived one — and
    # the NEIGHBOUR refunds it. If the chain resolved the original without `hub_id`, our ticket
    # would qualify too, and the neighbour's refund would write a rectifying invoice into OUR books
    # and cancel a document we never returned.
    ok, _ = issue("TCK-9", source_id="sale-9", hub=HUB)
    check("we issue a ticket for `sale-9` and do NOT refund it", True, ok)
    add_line("TCK-9", "TCK-9/L1", hub=HUB)
    ok, _ = issue("NB-9", source_id="sale-9", hub=OTHER_HUB)
    check("the neighbour issues its own ticket for its own `sale-9`", True, ok)
    add_line("NB-9", "NB-9/L1", hub=OTHER_HUB)

    ours_before = rect_counter(HUB)
    ok, err = on_refund(refunded_event("sale-9", refund_ref="rf-9"), hub=OTHER_HUB)
    check("the neighbour's refund runs", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check("the neighbour gets its own rectification", 1, rectifications_of("NB-9", OTHER_HUB))
    check(
        "the document it issued belongs to the neighbour, not to us",
        OTHER_HUB,
        q("SELECT COALESCE(string_agg(hub_id, ','), '<none>') FROM invoice_invoice "
          "WHERE rectifies_ref = 'rf-9' AND is_deleted = 0"),
    )
    check("OUR ticket for the same sale is NOT rectified", 0, rectifications_of("TCK-9", HUB))
    check("...and NOT cancelled", "issued", status_of("TCK-9", HUB))
    check(
        "no row in ANY hub rectifies our ticket",
        0,
        qi("SELECT count(*) FROM invoice_invoice WHERE rectifies_invoice_id = 'TCK-9'"),
    )
    check("our RECT counter did not move for the neighbour's refund", ours_before, rect_counter(HUB))
    check(
        "and no number of ours was booked for it",
        0,
        qi(
            "SELECT count(*) FROM invoice_number_allocation a JOIN invoice_invoice r ON "
            f"r.id = a.invoice_id WHERE a.hub_id = {literal(HUB)} AND r.rectifies_ref = 'rf-9'"
        ),
    )
    check(
        "and no line of ours was copied onto anybody's document",
        0,
        qi(
            "SELECT count(*) FROM invoice_invoiceitem WHERE hub_id = "
            f"{literal(OTHER_HUB)} AND id LIKE '%/TCK-9/%'"
        ),
    )

    # The invariant, asked of the WHOLE database rather than of one case: no rectifying invoice
    # anywhere points at an original belonging to a different tenant, and no copied line belongs to
    # a different tenant than the document it sits on. Cheap, and it catches a leak this suite did
    # not think to build a case for.
    check(
        "no rectifying invoice in the database crosses a tenant boundary",
        0,
        qi(
            "SELECT count(*) FROM invoice_invoice r JOIN invoice_invoice o "
            "ON o.id = r.rectifies_invoice_id WHERE r.hub_id <> o.hub_id"
        ),
    )
    check(
        "no invoice line sits on a document of another tenant",
        0,
        qi(
            "SELECT count(*) FROM invoice_invoiceitem l JOIN invoice_invoice i "
            "ON i.id = l.invoice_id WHERE l.hub_id <> i.hub_id"
        ),
    )


# ── 7. The manual door is exactly where it was (compatibility) ───────────────────────────


def test_the_manual_rectify_still_works_unchanged():
    print(
        "\n== 7. `invoice.rectify` by hand — the door an older hub is the only user of =="
    )

    ok, _ = issue(
        "MAN-1",
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        source_id=None,
        customer_tax_id="B12345678",
    )
    check("a manual invoice is issued", True, ok)
    add_line("MAN-1", "MAN-1/L1")

    ok, err = run_command(
        "invoice.rectify",
        {
            "original_id": "MAN-1",
            "new_id": str(uuid.uuid4()),
            "year": YEAR,
            "issue_date": NOW[:10],
            "reason": "Wrong amount",
        },
    )
    check("the manual chain still succeeds with an explicit original", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check("one rectification", 1, rectifications_of("MAN-1"))
    check("the original is cancelled", "cancelled", status_of("MAN-1"))
    check(
        "a manual rectification carries no refund reference (there is no refund behind it)",
        "",
        q(
            "SELECT COALESCE(rectifies_ref, '') FROM invoice_invoice WHERE hub_id = "
            f"{literal(HUB)} AND rectifies_invoice_id = 'MAN-1'"
        ),
    )
    check(
        "its number is booked too",
        1,
        qi(
            "SELECT count(*) FROM invoice_number_allocation a JOIN invoice_invoice r ON r.id = "
            f"a.invoice_id WHERE a.hub_id = {literal(HUB)} AND r.rectifies_invoice_id = 'MAN-1'"
        ),
    )

    # Two manual rectifications carrying NO reference must coexist: the new unique index is partial
    # on `rectifies_ref`, so a NULL must never be treated as a value.
    ok, _ = issue(
        "MAN-2",
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        source_id=None,
        customer_tax_id="B12345678",
    )
    ok, err = run_command(
        "invoice.rectify",
        {
            "original_id": "MAN-2",
            "new_id": str(uuid.uuid4()),
            "year": YEAR,
            "issue_date": NOW[:10],
            "reason": "Wrong amount",
        },
    )
    check("a second reference-less rectification is accepted", True, ok)
    if not ok:
        print(f"       ↳ {err.splitlines()[0] if err else ''}")
    check("...and exists", 1, rectifications_of("MAN-2"))


# ── 8. The invariant is in the SCHEMA, not only in the guards ────────────────────────────


def test_the_refund_reference_is_unique_in_the_database():
    print("\n== 8. `ux_invoice_rectifies_ref`: the half a guard cannot do (a race) ==")

    declared = MANIFEST.get("migrations", {}).get("postgres", [])
    check(
        "migration 010 is declared in the manifest (a file nobody lists never runs)",
        True,
        any("010_" in m and "rectifies_ref" in m for m in declared),
    )

    # Bypassing every guard, the way a flow, the assistant or a future command could: a raw INSERT
    # reusing a reference that is already on a live document.
    try:
        psql(
            [
                "-c",
                "INSERT INTO invoice_invoice (id, hub_id, invoice_type, series, number, issue_date, "
                "issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, "
                "description, base_amount, tax_amount, total_amount, tax_breakdown, currency, "
                "source_type, source_id, rectifies_invoice_id, rectifies_ref, status, notes, "
                "is_deleted, created_by, updated_by, created_at, updated_at) VALUES "
                f"('R-RACE', {literal(HUB)}, 'R1', 'RECT', 'RECT-2026-009999', '2026-08-24', "
                "'B00000000', 'Test SL', '', 'C', '', '', -1, -1, -2, '[]', 'EUR', "
                f"'rectification', NULL, 'TCK-3', 'rf-1', 'issued', '', 0, {literal(USER)}, "
                f"{literal(USER)}, {literal(NOW)}, {literal(NOW)})",
            ],
            db=H.DB,
        )
        raced, err = True, ""
    except RuntimeError as exc:
        raced, err = False, str(exc)

    check(
        "a second document for the same refund is REFUSED by the database", False, raced
    )
    check(
        "...by the index on the refund reference",
        True,
        "ux_invoice_rectifies_ref" in err,
    )

    # Re-entrancy: the runtime replays migrations on every boot.
    path = MODULE_DIR / "migrations" / "postgres" / "010_rectifies_ref.sql"
    check("the migration file exists", True, path.exists())
    if path.exists():
        # The same DDL shim `load_migrations` applies: the module ships the portable type names
        # (ADR-0007 §4b) and the runtime maps them to the native ones.
        sql = H.DDL_TOKEN.sub(
            lambda m: H.DDL_TYPES[m.group(1).upper()], path.read_text()
        )
        try:
            psql([], db=H.DB, stdin=sql)
            psql([], db=H.DB, stdin=sql)
            reentrant, err2 = True, ""
        except RuntimeError as exc:
            reentrant, err2 = False, str(exc).splitlines()[0]
        check("applying migration 010 twice is a no-op", True, reentrant)
        if not reentrant:
            print(f"       ↳ {err2}")


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
        test_a_full_refund_issues_the_rectification_by_itself()
        test_a_redelivered_refund_emits_no_second_document()
        test_a_partial_refund_issues_nothing()
        test_a_sale_returned_in_two_acts_is_rectified_once_at_the_end()
        test_a_refund_without_a_reference_is_refused()
        test_the_listener_never_leaves_its_hub()
        test_the_manual_rectify_still_works_unchanged()
        test_the_refund_reference_is_unique_in_the_database()
    finally:
        psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — a full refund rectifies itself, once; a partial one waits for invoice#63"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
