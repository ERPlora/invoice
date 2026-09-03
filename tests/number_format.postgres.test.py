#!/usr/bin/env python3
"""Configurable number format per series + peek without consuming (invoice#40, ADR-0369 D3a/D3c).

Runs against the REAL Postgres 18 test container, applying the module's `migrations/postgres/*.sql`
the way the runtime does and driving the module's own commands and queries bound the way the runtime
binds them.

Why the test exists, and what it is really guarding.

The number is FORMATTED in three places — `commands/_insert_invoice.sql` (ordinary emission),
`commands/rectify_insert.sql` (rectifications) and `queries/series_peek_next.sql` (the preview). In
`invoice_series` the same template lived duplicated in two SQL files under a comment that said "keep
both in sync", with NOTHING checking that they did. That is the debt this test refuses to inherit:
§ 1 below drives ALL THREE paths over the SAME series row, for every format shape, and demands the
three strings are identical. A preview that lies is worse than no preview — the number it shows is
the one the customer is told their invoice will carry.

And the format is IMMUTABLE once a series has emitted: the number goes into VeriFactu's chained
fingerprint (`hub/crates/verifactu/src/chain.rs` → `NumSerieFactura`), so re-shaping a live series
breaks the continuity of everything issued after it. Editable only while `current_number = 0`.

Usage: tests/number_format.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container by default (override: INVOICE_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import importlib.util
import json
import os
import pathlib
import re
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
H.DB = f"invoice_number_format_test_{os.getpid()}"

failures = H.failures
check = H.check
HUB = H.HUB
MANIFEST = H.MANIFEST
YEAR = H.NOW[:4]


# ── Helpers ──────────────────────────────────────────────────────────────────────────────


def make_series(code: str, invoice_type: str, fmt: str | None) -> str:
    """Create a series through its real command, then set the format the same way the UI would
    (`invoice.series.update` on a series that has not emitted yet)."""
    sid = str(uuid.uuid4())
    ok, err = H.run_command(
        "invoice.series.create",
        {
            "new_id": sid,
            "code": code,
            "name": code,
            "invoice_type": invoice_type,
            "year": YEAR,
            "prefix": code,
            "is_active": 1,
            "is_default": 0,
        },
    )
    if not ok:
        return f"<create failed: {err}>"
    if fmt is not None:
        ok, err = H.run_command(
            "invoice.series.update", {"series_id": sid, "format": fmt}
        )
        if not ok:
            return f"<format failed: {err}>"
    return sid


def peek(series_id: str) -> dict:
    sql = (
        H.bind(
            (MODULE_DIR / "queries" / "series_peek_next.sql").read_text(),
            {"series_id": series_id, "hub_id": HUB},
        )
        .rstrip()
        .rstrip(";")
    )
    raw = H.q(f"SELECT row_to_json(r) FROM ({sql}) AS r LIMIT 1")
    return json.loads(raw) if raw and "<sql error" not in raw else {"__error__": raw}


def counter(code: str) -> int:
    return H.qi(
        "SELECT current_number FROM invoice_invoiceseries "
        f"WHERE hub_id = {H.literal(HUB)} AND code = {H.literal(code)} AND year = {YEAR}"
    )


def series_format(series_id: str) -> str | None:
    raw = H.q(
        "SELECT COALESCE(format, '<NULL>') FROM invoice_invoiceseries "
        f"WHERE id = {H.literal(series_id)}"
    )
    return None if raw == "<NULL>" else raw


def emit(invoice_id: str, code: str, invoice_type: str = "F1") -> tuple[bool, str]:
    """The op chain of an ordinary emission: bump + insert (the series already exists)."""
    return H.issue(
        invoice_id,
        invoice_type=invoice_type,
        series=code,
        source_type="manual",
        source_id=None,
        substitutes=None,
    )


def number_of(invoice_id: str) -> str:
    return H.q(f"SELECT number FROM invoice_invoice WHERE id = {H.literal(invoice_id)}")


def booked(code: str, sequence: int) -> str:
    return H.q(
        "SELECT document_number FROM invoice_number_allocation "
        f"WHERE hub_id = {H.literal(HUB)} AND code = {H.literal(code)} "
        f"AND sequence = {sequence}"
    )


def allocation_id(code: str, sequence: int) -> str:
    return H.q(
        "SELECT id FROM invoice_number_allocation "
        f"WHERE hub_id = {H.literal(HUB)} AND code = {H.literal(code)} "
        f"AND sequence = {sequence}"
    )


def series_id_of(code: str) -> str:
    return H.q(
        "SELECT id FROM invoice_invoiceseries "
        f"WHERE hub_id = {H.literal(HUB)} AND code = {H.literal(code)} AND year = {YEAR}"
    )


def park_counter(code: str, value: int) -> None:
    """Park the series counter one short of the width border.

    Reaching invoice 1.000.000 by issuing 999.999 invoices is not a test, it is a night. The
    counter is the ONLY state the border depends on — everything the render reads (`format`,
    `prefix`, `code`, `year`) is already there — so moving it is the whole fixture."""
    H.psql(
        [],
        db=H.DB,
        stdin=(
            "UPDATE invoice_invoiceseries "
            f"SET current_number = {value} "
            f"WHERE hub_id = {H.literal(HUB)} AND code = {H.literal(code)} "
            f"AND year = {YEAR}"
        ),
    )


# ── 1. THE PIN: peek, ordinary emission and rectification render the SAME string ─────────

# One case per shape the template engine has to cover. `None` is the fallback (no format set),
# which is the shape every already-issued series in the wild carries and must never move.
FORMATS = [
    (None, "FB", "FB-{Y}-000001"),
    ("{prefix}-{year}-{seq:06d}", "FA", "FA-{Y}-000001"),
    ("{code}{year}/{seq:05d}", "FC", "FC{Y}/00001"),
    ("VFT{year}-A-{seq:04d}", "FD", "VFT{Y}-A-0001"),
    ("{prefix}{seq}", "FE", "FE1"),
]


def test_peek_equals_what_the_emission_actually_writes():
    print(
        "\n== 1. THE PIN: the preview is character-for-character the number that gets written =="
    )
    for fmt, code, expected in FORMATS:
        label = fmt if fmt is not None else "(no format → fallback PREFIX-YYYY-NNNNNN)"
        sid = make_series(code, "F1", fmt)
        if sid.startswith("<"):
            check(f"[{label}] the series is created", "ok", sid)
            continue

        previewed = peek(sid).get("next_number")
        check(
            f"[{label}] peek renders the expected shape",
            expected.replace("{Y}", YEAR),
            previewed,
        )
        check(f"[{label}] peeking consumed NOTHING", 0, counter(code))

        ok, err = emit(f"INV-{code}", code)
        check(f"[{label}] the invoice is issued", (True, ""), (ok, err))
        written = number_of(f"INV-{code}")
        # THE assertion of this file: preview == reality, for every shape.
        check(f"[{label}] peek == the number actually written", previewed, written)
        # ...and the book (invoice#39) copies that same string, so all three agree.
        booked = H.q(
            "SELECT document_number FROM invoice_number_allocation "
            f"WHERE hub_id = {H.literal(HUB)} AND code = {H.literal(code)} AND sequence = 1"
        )
        check(f"[{label}] the numbering book copied the same string", written, booked)


def test_the_rectification_path_renders_the_same_way():
    print(
        "\n== 2. the third render site: `rectify_insert.sql` follows the RECT series' format =="
    )
    sid = make_series("RECT", "R1", "{code}-{year}-{seq:04d}")
    check("the RECT series is created with its own format", False, sid.startswith("<"))
    previewed = peek(sid).get("next_number")
    check("peek on RECT", f"RECT-{YEAR}-0001", previewed)

    ok, err = emit("INV-TO-RECTIFY", "FB")
    check("an invoice to rectify is issued", (True, ""), (ok, err))
    ok, err = H.run_command(
        "invoice.rectify",
        {
            "new_id": "RECT-1",
            "original_id": "INV-TO-RECTIFY",
            "year": YEAR,
            "issue_date": H.NOW[:10],
            "reason": "Wrong customer",
        },
    )
    check("the rectification is issued", (True, ""), (ok, err))
    check("the rectification took the previewed number", previewed, number_of("RECT-1"))
    check(
        "...and the book agrees",
        previewed,
        H.q(
            "SELECT document_number FROM invoice_number_allocation "
            f"WHERE hub_id = {H.literal(HUB)} AND code = 'RECT' AND sequence = 1"
        ),
    )


# ── 3. Immutable once the series has emitted ─────────────────────────────────────────────


def test_the_format_is_frozen_once_the_series_has_emitted():
    print(
        "\n== 3. a series WITH emissions refuses a format change (VeriFactu's fingerprint) =="
    )
    sid = make_series("FF", "F1", "{prefix}-{year}-{seq:06d}")
    check(
        "a fresh series accepts a format",
        "{prefix}-{year}-{seq:06d}",
        series_format(sid),
    )

    # While current_number = 0 it is still a choice, not a fact.
    ok, err = H.run_command(
        "invoice.series.update", {"series_id": sid, "format": "{prefix}/{seq:03d}"}
    )
    check(
        "...and can still be re-shaped before the first invoice", (True, ""), (ok, err)
    )
    check("the new format took", "{prefix}/{seq:03d}", series_format(sid))

    ok, err = emit("INV-FF", "FF")
    check("the first invoice is issued", (True, ""), (ok, err))
    check("it used the format", "FF/001", number_of("INV-FF"))

    ok, err = H.run_command(
        "invoice.series.update", {"series_id": sid, "format": "{prefix}-{seq:09d}"}
    )
    check(
        "the update command still runs (partial update, like the other frozen fields)",
        True,
        ok,
    )
    check("but the format did NOT move", "{prefix}/{seq:03d}", series_format(sid))

    ok, err = emit("INV-FF2", "FF")
    check("the next invoice is issued", (True, ""), (ok, err))
    # The two shapes never coexist inside one series — which is the whole reason for the freeze.
    check("...and keeps the ORIGINAL shape", "FF/002", number_of("INV-FF2"))

    ok, err = H.run_command(
        "invoice.series.update", {"series_id": sid, "name": "Renamed"}
    )
    check("the mutable fields still update normally", (True, ""), (ok, err))
    check(
        "...the name did move",
        "Renamed",
        H.q(f"SELECT name FROM invoice_invoiceseries WHERE id = {H.literal(sid)}"),
    )


# ── 4. The payload schema refuses a template that cannot produce distinct numbers ────────


def test_a_format_without_a_sequence_is_rejected_by_the_schema():
    print(
        "\n== 4. a template with no sequence placeholder is refused BEFORE it reaches the DB =="
    )
    schema = json.loads((MODULE_DIR / "schemas" / "series_update.json").read_text())
    pattern = schema["properties"]["format"].get("pattern")
    check("the schema constrains `format` with a pattern", True, bool(pattern))
    if not pattern:
        return
    rx = re.compile(pattern)
    # A template with no `{seq}` renders the SAME string for every invoice — duplicate numbers,
    # which is the single worst thing this subsystem can do.
    for bad in ["{prefix}-{year}", "FIXED-2026", "", "{code}"]:
        check(f"refused: {bad!r}", False, bool(rx.search(bad)))
    for good in [
        "{prefix}-{year}-{seq:06d}",
        "{seq}",
        "VFT{year}-A-{seq:04d}",
        "{code}{seq:05d}",
    ]:
        check(f"accepted: {good!r}", True, bool(rx.search(good)))
    check(
        "and `invoice.series.create` is constrained the same way",
        pattern,
        json.loads((MODULE_DIR / "schemas" / "series_create.json").read_text())[
            "properties"
        ]["format"].get("pattern"),
    )


# ── 5. The manifest and the migration ────────────────────────────────────────────────────


def test_the_migration_and_the_manifest():
    print("\n== 5. migration 008 and the peek query are declared ==")
    check(
        "`format` exists, nullable (NULL = the shape every live series already has)",
        ("text", "YES"),
        (
            H.q(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'invoice_invoiceseries' AND column_name = 'format'"
            ),
            H.q(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'invoice_invoiceseries' AND column_name = 'format'"
            ),
        ),
    )
    check(
        "the manifest declares every migration on disk, in order (one linear head)",
        [
            f"migrations/postgres/{p.name}"
            for p in sorted((MODULE_DIR / "migrations" / "postgres").glob("*.sql"))
        ],
        MANIFEST["migrations"]["postgres"],
    )
    check(
        "the peek query is declared as a READ with the view permission",
        ("queries/series_peek_next.sql", "invoice.view_invoice"),
        (
            MANIFEST["queries"]["invoice.series.peek_next"]["sql"],
            MANIFEST["queries"]["invoice.series.peek_next"]["permission"],
        ),
    )
    check(
        "the series list exposes the format so the Settings screen can show it",
        True,
        "format" in (MODULE_DIR / "queries" / "series_list.sql").read_text(),
    )
    mig = MODULE_DIR / "migrations" / "postgres" / "008_series_format.sql"
    check("the migration file exists", True, mig.exists())
    if mig.exists():
        try:
            H.psql(
                [],
                db=H.DB,
                stdin=H.DDL_TOKEN.sub(
                    lambda m: H.DDL_TYPES[m.group(1).upper()], mig.read_text()
                ),
            )
            check("re-applying 008 does not fail", True, True)
        except RuntimeError as exc:
            check("re-applying 008 does not fail", True, str(exc).splitlines()[0])


# ── 6. The width is a MINIMUM, never a ceiling (invoice#70) ──────────────────────────────

# `erp_pad(value, width)` is a bridge function of the portable subset (ADR-0007 4a): the runtime
# lowers it to the dialect. The Postgres `lpad` imposes an EXACT width — it CUTS what does not fit —
# so the shim used to turn 1.000.000 into `100000`, a number ALREADY ISSUED. The emission did not
# come back wrong, it came back REFUSED: `uq_invoice_series_number` rejects the duplicate, the
# transaction rolls back and the business stops invoicing at a round number, mid-day, with an error
# no cashier can act on. The kernel made the width a floor (ERPlora/hub#1378,
# `lpad(v, greatest(width, length(v)), fill)`); this section is the CONSUMER side of that contract —
# what `invoice` must keep true once a sequence outgrows the width its template asked for.
#
# It is the same border for all FOUR places a number is rendered: the preview
# (`queries/series_peek_next.sql`), the ordinary emission (`commands/_insert_invoice.sql`), the
# rectification (`commands/rectify_insert.sql`) and — the one 1 above does not reach — the
# deterministic primary key of the numbering book (`commands/_insert_allocation.sql`, which pads the
# SEQUENCE to 6 whatever the series' own template says).
#
# Nothing already issued moves: only the next number past the width changes shape.


def test_the_narrowest_template_survives_its_tenth_invoice():
    print("\n== 6a. `{seq:01d}`: invoice 10 is `10`, not the `1` already issued ==")
    sid = make_series("FI", "F1", "{prefix}{seq:01d}")
    check("the series is created", False, sid.startswith("<"))

    ok, err = emit("INV-FI-1", "FI")
    check("the first invoice is issued", (True, ""), (ok, err))
    check("...as FI1", "FI1", number_of("INV-FI-1"))

    park_counter("FI", 9)
    previewed = peek(sid).get("next_number")
    check("peek shows the WHOLE number at the border", "FI10", previewed)

    ok, err = emit("INV-FI-10", "FI")
    # Truncated to `FI1` this INSERT dies on uq_invoice_series_number and no invoice exists.
    check("the tenth invoice is issued", (True, ""), (ok, err))
    check("...as FI10, not the FI1 already issued", "FI10", number_of("INV-FI-10"))
    check("peek == the number actually written", previewed, number_of("INV-FI-10"))
    check("the numbering book copied the same string", "FI10", booked("FI", 10))


def test_the_six_digit_fallback_survives_the_millionth_invoice():
    print("\n== 6b. the fallback shape: 999.999 -> 1.000.000 ==")
    sid = make_series("FJ", "F1", None)
    check("the series is created with NO format (the fallback)", False, sid.startswith("<"))

    park_counter("FJ", 999_999)
    previewed = peek(sid).get("next_number")
    check("peek shows seven digits", f"FJ-{YEAR}-1000000", previewed)

    ok, err = emit("INV-FJ-1M", "FJ")
    check("the millionth invoice is issued", (True, ""), (ok, err))
    written = number_of("INV-FJ-1M")
    check("...whole, not truncated back onto FJ-YYYY-100000", f"FJ-{YEAR}-1000000", written)
    check("peek == the number actually written", previewed, written)
    check("the numbering book copied the same string", written, booked("FJ", 1_000_000))
    # The book's PK is the FOURTH render site: it pads the SEQUENCE to 6 on its own. Truncated it
    # becomes the key of sequence 100.000 and the whole emission rolls back on the primary key.
    check(
        "the book's deterministic key kept the whole sequence",
        f"{HUB}/FJ/{YEAR}/1000000",
        allocation_id("FJ", 1_000_000),
    )


def test_the_rectification_path_survives_its_own_border():
    print("\n== 6c. the third render site at ITS border: `{seq:04d}` -> 10.000 ==")
    sid = series_id_of("RECT") or make_series("RECT", "R1", "{code}-{year}-{seq:04d}")
    check("the RECT series exists", False, sid.startswith("<"))

    ok, err = emit("INV-TO-RECTIFY-BORDER", "FB")
    check("an invoice to rectify is issued", (True, ""), (ok, err))

    park_counter("RECT", 9_999)
    previewed = peek(sid).get("next_number")
    check("peek on RECT shows five digits", f"RECT-{YEAR}-10000", previewed)

    ok, err = H.run_command(
        "invoice.rectify",
        {
            "new_id": "RECT-BORDER",
            "original_id": "INV-TO-RECTIFY-BORDER",
            "year": YEAR,
            "issue_date": H.NOW[:10],
            "reason": "Wrong customer",
        },
    )
    check("the ten-thousandth rectification is issued", (True, ""), (ok, err))
    check("...whole", f"RECT-{YEAR}-10000", number_of("RECT-BORDER"))
    check("peek == the number actually written", previewed, number_of("RECT-BORDER"))
    check("the numbering book agrees", previewed, booked("RECT", 10_000))


def test_the_control_proves_this_battery_can_still_see_the_bug():
    print("\n== 6d. THE CONTROL: put the old lowering back and the border must break again ==")
    # 6a-6c are green because the harness mirrors the kernel's shim. If that mirror ever drifts back
    # — it HAD drifted, which is why the three above could not see this bug before invoice#70 — every
    # green above becomes worthless without a single red to say so. So: install the lowering the
    # runtime emitted BEFORE hub#1378 and demand the same scenario dies exactly where it used to.
    H.install_erp_pad(H.ERP_PAD_TRUNCATING)
    try:
        check(
            "the control lowering truncates, like a bare `lpad`",
            ("00042", "1000", "100000"),
            tuple(
                H.q(
                    "SELECT erp_pad(42, 5) || '|' || erp_pad(10000, 4) || '|' || erp_pad(1000000, 6)"
                ).split("|")
            ),
        )
        sid = make_series("FK", "F1", "{prefix}{seq:01d}")
        check("the control series is created", False, sid.startswith("<"))
        ok, err = emit("INV-FK-1", "FK")
        check("its first invoice is issued", (True, ""), (ok, err))

        park_counter("FK", 9)
        check("...and the preview LIES, as it did", "FK1", peek(sid).get("next_number"))
        ok, err = emit("INV-FK-10", "FK")
        check("the tenth emission is REFUSED", False, ok)
        # The index is the one the business hits: the number is not merely wrong, it is unissuable.
        check(
            "...by the index that keeps a series' numbers unique",
            True,
            "uq_invoice_series_number" in err,
        )
        check("...and no tenth invoice exists", "", number_of("INV-FK-10"))
    finally:
        # Leave the mirror as the rest of the run (and any battery after it) expects to find it.
        H.install_erp_pad()

    check(
        "the mirror is restored: the width is a floor again",
        "1000000",
        H.q("SELECT erp_pad(1000000, 6)"),
    )


def main() -> int:
    running = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", H.CONTAINER],
        capture_output=True,
        text=True,
    )
    if "true" not in running.stdout:
        subprocess.run(["docker", "start", H.CONTAINER], capture_output=True)

    H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])
    H.psql(["-c", f"CREATE DATABASE {H.DB}"])
    try:
        H.load_migrations()
        test_peek_equals_what_the_emission_actually_writes()
        test_the_rectification_path_renders_the_same_way()
        test_the_format_is_frozen_once_the_series_has_emitted()
        test_a_format_without_a_sequence_is_rejected_by_the_schema()
        test_the_migration_and_the_manifest()
        test_the_narrowest_template_survives_its_tenth_invoice()
        test_the_six_digit_fallback_survives_the_millionth_invoice()
        test_the_rectification_path_survives_its_own_border()
        test_the_control_proves_this_battery_can_still_see_the_bug()
    finally:
        H.psql(["-c", f"DROP DATABASE IF EXISTS {H.DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — the preview is the number, and a live series' shape never moves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
