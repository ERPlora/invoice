#!/usr/bin/env python3
"""One F3 per F2 — the substitution link is unique IN THE SCHEMA (invoice#34, ADR-0140).

Runs against a REAL Postgres 18 in Docker, applying the module's `migrations/postgres/*.sql` the
way the runtime does (portable types shimmed to native ones, ADR-0007 §4b) and inserting invoices
through the module's OWN private SQL (`invoice._insert_invoice`), bound like the runtime binds
(`:hub_id`, `:current_user_id`, `:now` injected; a `:param` absent from the payload is NULL).

Why the test exists: `substitutes_invoice_id` (`003_substitution.sql`) was a loose column. Two F3
pointing at the same F2 were only stopped by guards that live SOMEWHERE ELSE — the sales
idempotency index `uq_invoice_source` (because `substitute_from_invoice` happens to write
`source_type='substitution'`, `source_id=<F2>`) and the one-shot claim redemption of the public
door (hub#963). Neither is the substitution invariant. Since hub#963 the redemption is done by the
customer from a phone with nobody watching, so the guarantee has to be in the data: this test
inserts two invoices linking the same F2 under DIFFERENT source keys (so `uq_invoice_source` does
not apply) and demands that the second INSERT fails in the database.

Before applying the migration on a LIVE hub, check for duplicates first — a unique index that
cannot be built aborts the hub boot:

    SELECT hub_id, substitutes_invoice_id, count(*)
      FROM invoice_invoice
     WHERE substitutes_invoice_id IS NOT NULL AND is_deleted = 0
     GROUP BY hub_id, substitutes_invoice_id
    HAVING count(*) > 1;

Usage: tests/substitution_unique.postgres.test.py
  Uses the `erplora-test-pg-5433` container by default (override: INVOICE_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("INVOICE_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"invoice_substitution_unique_test_{os.getpid()}"
HUB = "hub-test"
OTHER_HUB = "hub-neighbour"
USER = "u-cashier"
NOW = "2026-08-18T10:00:00+00:00"

MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

failures: list[str] = []


# ── Postgres plumbing ────────────────────────────────────────────────────────────────────


def psql(args: list[str], db: str | None = None, stdin: str | None = None) -> str:
    cmd = [
        "docker",
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
    ]
    if db:
        cmd += ["-d", db]
    cmd += args
    res = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    return res.stdout


def q(sql: str) -> str:
    try:
        return psql(["-tAc", sql], db=DB).strip()
    except RuntimeError as exc:
        return f"<sql error: {str(exc).splitlines()[0]}>"


def qi(sql: str) -> int:
    raw = q(sql)
    try:
        return int(raw)
    except ValueError:
        return -1


# ── The runtime, in miniature ────────────────────────────────────────────────────────────

PARAM = re.compile(r":([a-z_][a-z0-9_]*)", re.IGNORECASE)
DDL_TYPES = {
    "INTEGER": "BIGINT",
    "REAL": "DOUBLE PRECISION",
    "BLOB": "BYTEA",
    "TEXT": "TEXT",
}
DDL_TOKEN = re.compile(r"\b(INTEGER|REAL|BLOB)\b", re.IGNORECASE)


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        value = json.dumps(value, separators=(",", ":"))
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    """Single pass over `:name` placeholders; placeholders inside comments are left alone."""

    def comment_spans(text: str) -> list[tuple[int, int]]:
        spans, i, n = [], 0, len(text)
        while i < n:
            if text.startswith("--", i):
                j = text.find("\n", i)
                j = n if j < 0 else j
                spans.append((i, j))
                i = j
            elif text.startswith("/*", i):
                j = text.find("*/", i)
                j = n if j < 0 else j + 2
                spans.append((i, j))
                i = j
            else:
                i += 1
        return spans

    comments = comment_spans(sql)

    def in_comment(pos: int) -> bool:
        return any(a <= pos < b for a, b in comments)

    def replace(m: re.Match) -> str:
        # `::` is the Postgres CAST operator, never a parameter — `(x)::numeric` is not a `:numeric`
        # bind. `hub/crates/db/src/lib.rs::translate` special-cases it as its FIRST rule; this
        # miniature did not, so `rectify_insert.sql` (which negates a JSONB breakdown, invoice#5)
        # came out as `(x):NULL` and every test that walked through it died with a syntax error.
        # A miniature that is wrong where the runtime is right does not test the runtime.
        if m.start() > 0 and sql[m.start() - 1] == ":":
            return m.group(0)
        if in_comment(m.start()):
            return m.group(0)
        return literal(params.get(m.group(1)))

    return PARAM.sub(replace, sql)


def run_command(name: str, payload: dict, hub: str = HUB) -> tuple[bool, str]:
    """Execute a manifest command's `sql[]` like the runtime: one transaction, system params
    injected. Returns (ok, error)."""
    cmd = MANIFEST["commands"].get(name)
    if cmd is None:
        return False, f"command `{name}` is not declared in module.json"
    files = cmd.get("sql")
    if not files:
        return False, f"command `{name}` declares no sql[]"
    params = dict(payload)
    params.setdefault("hub_id", hub)
    params.setdefault("current_user_id", USER)
    params.setdefault("now", NOW)
    script = ["BEGIN;"]
    for rel in files:
        path = MODULE_DIR / rel
        if not path.exists():
            return False, f"`{name}` declares `{rel}`, which does not exist"
        script.append(bind(path.read_text(), params))
    script.append("COMMIT;")
    try:
        psql([], db=DB, stdin="\n".join(script))
        return True, ""
    except RuntimeError as exc:
        return False, str(exc)


# ── Assertions ───────────────────────────────────────────────────────────────────────────


def check(label: str, expected, actual):
    if expected != actual:
        failures.append(f"{label} — expected [{expected}], got [{actual}]")
        print(f"  FAIL: {label} — expected [{expected}], got [{actual}]")
    else:
        print(f"  ok: {label} = {expected}")


# ── Fixtures: the three sub-steps the WASM handler returns as intentions ─────────────────


def issue(
    invoice_id: str,
    *,
    invoice_type: str,
    series: str,
    source_type: str,
    source_id: str | None,
    substitutes: str | None,
    hub: str = HUB,
) -> tuple[bool, str]:
    """`_ensure_series` → `_bump_series` → `_insert_invoice`, exactly the op chain the handler
    emits for one invoice."""
    year = "2026"
    base = {
        "code": series,
        "series": series,
        "name": series,
        "invoice_type": invoice_type,
        "year": year,
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
            "issue_date": NOW[:10],
            "issuer_nif": "B00000000",
            "issuer_name": "Test SL",
            "customer_tax_id": "12345678Z",
            "customer_name": "Customer",
            "customer_address": "",
            "description": "",
            "base_amount": 1000,
            "tax_amount": 210,
            "total_amount": 1210,
            "tax_breakdown": "[]",
            "substitutes_invoice_id": substitutes,
            "notes": "",
            "business_tax_id": "B00000000",
            "business_legal_name": "Test SL",
        },
        hub,
    )


def count_linking(f2: str, hub: str = HUB) -> int:
    return qi(
        "SELECT count(*) FROM invoice_invoice WHERE hub_id = "
        f"{literal(hub)} AND substitutes_invoice_id = {literal(f2)} AND is_deleted = 0"
    )


# ── 1. The invariant: one F3 per F2, enforced by the schema ─────────────────────────────


def test_second_f3_for_the_same_f2_is_refused_by_the_database():
    print(
        "\n== 1. two F3 linking the same F2 under DIFFERENT source keys: the second one dies in the DB =="
    )

    ok, err = issue(
        "F2-A",
        invoice_type="F2",
        series="TICKET",
        source_type="sale",
        source_id="sale-A",
        substitutes=None,
    )
    check("the F2 ticket is issued", True, ok)

    ok, err = issue(
        "F3-A1",
        invoice_type="F3",
        series="FACT",
        source_type="substitution",
        source_id="F2-A",
        substitutes="F2-A",
    )
    check("the first F3 substituting the ticket is issued", True, ok)
    check("exactly one invoice links the ticket", 1, count_linking("F2-A"))

    # A second F3 that does NOT reuse the `substitution/<F2>` source key: `uq_invoice_source` is
    # blind to it, and `_insert_invoice`'s NOT EXISTS guard (keyed on the source) lets it through.
    # Only a unique index on the substitution link itself can stop it.
    ok, err = issue(
        "F3-A2",
        invoice_type="F3",
        series="FACT",
        source_type="manual",
        source_id=None,
        substitutes="F2-A",
    )
    check("the second F3 pointing at the same F2 is REFUSED", False, ok)
    check(
        "...by the unique index on the substitution link",
        True,
        "ux_invoice_substitutes" in err,
    )
    check("still exactly one invoice links the ticket", 1, count_linking("F2-A"))


# ── 2. What the index must NOT block ─────────────────────────────────────────────────────


def test_the_index_is_scoped_and_partial():
    print("\n== 2. the index is per hub, ignores NULL links and soft-deleted rows ==")

    # Another hub may have an F2 with the same id (ids are per hub-DB in practice, but the row
    # contract is (hub_id, …) and the index must follow it).
    ok, err = issue(
        "F3-N1",
        invoice_type="F3",
        series="FACT",
        source_type="substitution",
        source_id="F2-A",
        substitutes="F2-A",
        hub=OTHER_HUB,
    )
    check("a neighbouring hub can link its own F2-A", True, ok)

    # Plenty of invoices with NO link coexist (NULL is not a duplicate).
    ok, _ = issue(
        "F1-B",
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        source_id=None,
        substitutes=None,
    )
    ok2, _ = issue(
        "F1-C",
        invoice_type="F1",
        series="FACT",
        source_type="manual",
        source_id=None,
        substitutes=None,
    )
    check("two ordinary invoices without a link coexist", (True, True), (ok, ok2))

    # A soft-deleted F3 frees the slot: the partial index only counts live rows.
    psql(
        [
            "-c",
            f"UPDATE invoice_invoice SET is_deleted = 1, deleted_at = '{NOW}' WHERE id = 'F3-A1' AND hub_id = '{HUB}'",
        ],
        db=DB,
    )
    ok, err = issue(
        "F3-A3",
        invoice_type="F3",
        series="FACT",
        source_type="manual",
        source_id=None,
        substitutes="F2-A",
    )
    check("after soft-deleting the F3, the F2 can be substituted again", True, ok)
    check("one LIVE invoice links the ticket", 1, count_linking("F2-A"))


# ── 3. The migration is idempotent (IF NOT EXISTS) ────────────────────────────────────────


def test_migration_is_reentrant():
    print("\n== 3. re-applying the migration is a no-op ==")
    mig = MODULE_DIR / "migrations" / "postgres" / "005_substitution_unique.sql"
    check("the migration file exists", True, mig.exists())
    if mig.exists():
        try:
            psql(
                [],
                db=DB,
                stdin=DDL_TOKEN.sub(
                    lambda m: DDL_TYPES[m.group(1).upper()], mig.read_text()
                ),
            )
            check("re-applying 005 does not fail", True, True)
        except RuntimeError as exc:
            check("re-applying 005 does not fail", True, str(exc).splitlines()[0])
    check(
        "the migration is declared in module.json",
        True,
        "migrations/postgres/005_substitution_unique.sql"
        in MANIFEST["migrations"]["postgres"],
    )


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def load_migrations() -> None:
    # `erp_pad` is a runtime bridge function (hub/crates/db/src/lib.rs, ADR-0007) — the shim
    # translates it to `lpad((v)::text, w, '0')`. Same semantics here as a SQL function.
    psql(
        [],
        db=DB,
        stdin="CREATE FUNCTION erp_pad(v bigint, w int) RETURNS text LANGUAGE sql AS $$ SELECT lpad(v::text, w, '0') $$;",
    )
    for mig in sorted((MODULE_DIR / "migrations" / "postgres").glob("*.sql")):
        sql = DDL_TOKEN.sub(lambda m: DDL_TYPES[m.group(1).upper()], mig.read_text())
        psql([], db=DB, stdin=sql)


def main() -> int:
    running = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
        capture_output=True,
        text=True,
    )
    if "true" not in running.stdout:
        subprocess.run(["docker", "start", CONTAINER], capture_output=True)

    psql(["-c", f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)"])
    psql(["-c", f"CREATE DATABASE {DB}"])
    try:
        load_migrations()
        test_second_f3_for_the_same_f2_is_refused_by_the_database()
        test_the_index_is_scoped_and_partial()
        test_migration_is_reentrant()
    finally:
        psql(["-c", f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)"])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — one F3 per F2, enforced by the schema (invoice#34)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
