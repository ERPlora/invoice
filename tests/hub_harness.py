"""Plumbing shared by the `*.hub.test.py` batteries — the ones that talk to a REAL kernel.

`erplora test <dir> --against-hub` (module-toolkit#110) starts the published hub image with its
own Postgres, installs the module through `POST /api/modules/install` and hands the url over in
`ERPLORA_HUB_BASE_URL`. Everything below is the thin layer between a battery and that runtime:
the two doors (`/api/query`, `/api/command`), the error envelope, the event shape, the fiscal
identity setup `invoice` is gated on, and one piece of bookkeeping every battery needs — a
`check()` that records a failure instead of dying on it, so a red run names EVERY broken
assertion and not just the first.

Why HTTP and not a scratch Postgres: these batteries replace the hub's own `invoice_e2e.rs`
(ERPlora/hub#1264, contract «El Hub se CIERRA como KERNEL» §5). What they assert is what the WASM
handler does INSIDE the runtime — ids minted by the host, `reads` pre-loaded by the dispatcher
(`sales.get` for `create_from_sale`), the transaction, the outbox — and none of that exists in a
hand-written harness that binds `:hub_id` itself. The Postgres batteries next door
(`*.postgres.test.py`) keep proving the SQL in isolation; these prove the module against the
kernel that runs it.

Two facts of the runtime a battery has to know, both resolved here so no battery hard-codes them:

  * THE TENANT. Module seeds land under the RUNTIME's own `hub_id`, not under whatever `X-Hub-Id`
    a request carries (that is how hub#594 was found). `GET /api/hub/context` says which id that
    is, and every request goes out under it.
  * THE SESSION USER. Dev auth trusts `X-User-Id`. Each run mints its own, because batteries share
    one hub for the length of the run and a fixed id would mix this run's rows with a previous
    one's under the same shared hub.

`invoice` is gated by the kernel's fiscal precondition (ADR-0203, hub#328): no `invoice.*` command
that stamps the business identity runs before the hub has one. That gate is the KERNEL's contract
(proven by its own fixture, hub#1264 §5) — but `invoice`'s own behaviour cannot even be exercised
without satisfying it, so [`ensure_business_identity`] sets it once per run through the real admin
door (`PUT /api/settings`), exactly like the fiscal setup wizard would.

It refuses to skip. Without a runtime a battery FAILS: a check that excuses itself is the green
that proves nothing this whole toolkit exists to remove (module-toolkit#50).
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = (
    os.environ.get("INVOICE_HUB_BASE_URL")
    or os.environ.get("ERPLORA_HUB_BASE_URL")
    or ""
).rstrip("/")

# Quantities travel in 10^6 fixed point (ADR-0147); money in integer cents (ADR-0007/0123).
ONE = 1_000_000


def cents(value) -> int:
    """A money aggregate the way Postgres hands it back: `SUM(bigint)` is NUMERIC, so a total may
    arrive as a JSON string (`"5000"`) instead of a number. Either form is the same cents."""
    if isinstance(value, bool):
        raise AssertionError(f"not a money amount: {value!r}")
    if isinstance(value, (int, float)):
        return int(round(value))
    if isinstance(value, str):
        return int(round(float(value)))
    raise AssertionError(f"not a money amount: {value!r}")


class Hub:
    """One battery's view of the live runtime."""

    def __init__(
        self, battery: str, needs: tuple[str, ...] = ("taxes", "sales", "invoice")
    ):
        self.battery = battery
        self.failures: list[str] = []
        if not BASE:
            print(
                f"{battery}: no runtime at the other end (ERPLORA_HUB_BASE_URL is empty)."
            )
            print(
                "Run it with `erplora test <dir> --against-hub`; without a hub this is NOT a skip, "
                "it is a failure."
            )
            sys.exit(1)
        self.user = f"u-{uuid.uuid4().hex[:8]}"
        self.hub_id = self._runtime_hub_id()
        self._require_installed(needs)

    # ── transport ────────────────────────────────────────────────────────────────────────

    def _request(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(
            f"{BASE}{path}",
            data=data,
            headers={
                "content-type": "application/json",
                "x-hub-id": self.hub_id,
                "x-user-id": self.user,
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.status, json.loads(res.read().decode() or "null")
        except urllib.error.HTTPError as err:
            raw = err.read().decode()
            try:
                return err.code, json.loads(raw or "null")
            except json.JSONDecodeError:
                return err.code, {"raw": raw}

    def _runtime_hub_id(self) -> str:
        req = urllib.request.Request(f"{BASE}/api/hub/context", method="GET")
        with urllib.request.urlopen(req, timeout=60) as res:
            body = json.loads(res.read().decode())
        hub_id = body.get("hub_id")
        if not hub_id:
            print(
                f"{self.battery}: GET /api/hub/context did not say the hub_id: {body}"
            )
            sys.exit(1)
        return hub_id

    def _require_installed(self, needs: tuple[str, ...]) -> None:
        status, body = self._request("GET", "/api/modules")
        installed = (
            {m["id"] for m in (body or {}).get("data", [])} if status == 200 else set()
        )
        missing = [m for m in needs if m not in installed]
        if missing:
            print(
                f"{self.battery}: the runtime at {BASE} does not have {missing} installed "
                f"(installed: {sorted(installed)}). `invoice` declares `depends_on: "
                '["taxes", "sales"]`, so the harness has to install the whole chain through the '
                "same door before the module. Not a skip: nothing below can be trusted without it."
            )
            sys.exit(1)

    # ── the two doors ────────────────────────────────────────────────────────────────────

    def query(self, name: str, params: dict | None = None) -> list:
        """Rows of a query. A query with a `list` block answers `{rows,total,…}`; the rest answer
        the bare array. Both come back as the list of rows."""
        status, body = self._request(
            "POST", "/api/query", {"name": name, "params": params or {}}
        )
        if status != 200 or not (body or {}).get("ok"):
            raise AssertionError(f"query {name} answered {status}: {body}")
        data = body["data"]
        if isinstance(data, dict) and "rows" in data:
            return data["rows"]
        return data

    def command(self, name: str, payload: dict):
        """`(status, body)` of a command, whatever the runtime answered."""
        return self._request("POST", "/api/command", {"name": name, "payload": payload})

    def run(self, name: str, payload: dict) -> dict:
        """A command that MUST succeed. Its `data` (`operations`, `new_ids`, …)."""
        status, body = self.command(name, payload)
        if status != 200 or not (body or {}).get("ok"):
            raise AssertionError(f"command {name} answered {status}: {body}")
        return body["data"]

    def refused(self, label: str, name: str, payload: dict, code: str) -> None:
        """The runtime must REFUSE the command with exactly this domain code — the code, never the
        prose (ADR-0398 §6; hub#1074's client-facing redaction gate denies the `Display` of most
        runtime errors, so the message is not something an external caller could branch on even if
        it were stable): the till translates the code, nobody reads the sentence."""
        status, body = self.command(name, payload)
        got = (
            ((body or {}).get("error") or {}).get("code")
            if isinstance(body, dict)
            else None
        )
        if status == 200:
            self.failures.append(
                f"{label} — expected refusal `{code}`, the command SUCCEEDED: {body}"
            )
            print(f"  FAIL: {label} — expected refusal `{code}`, got success: {body}")
        elif got != code:
            self.failures.append(
                f"{label} — expected code [{code}], got [{got}] (HTTP {status}: {body})"
            )
            print(
                f"  FAIL: {label} — expected code [{code}], got [{got}] (HTTP {status})"
            )
        else:
            print(f"  ok: {label} refused with `{code}` (HTTP {status})")

    # ── what the hub says about its events ───────────────────────────────────────────────

    def event_shape(self, event_name: str) -> dict | None:
        """`GET /api/hub/events/shape?name=…` — the fields of the NEWEST events of that name in this
        hub, each with one sample unless withheld (hub#715). `None` when the hub has never heard of
        the event."""
        status, body = self._request(
            "GET", f"/api/hub/events/shape?name={event_name}&limit=1"
        )
        if status == 404:
            return None
        if status != 200 or not (body or {}).get("ok"):
            raise AssertionError(f"events/shape {event_name} answered {status}: {body}")
        return body["data"]

    # ── bookkeeping ──────────────────────────────────────────────────────────────────────

    def check(self, label: str, got, want) -> None:
        if got != want:
            self.failures.append(f"{label} — expected [{want!r}], got [{got!r}]")
            print(f"  FAIL: {label} — expected [{want!r}], got [{got!r}]")
        else:
            print(f"  ok: {label} = {got!r}")

    def check_true(self, label: str, condition: bool, detail="") -> None:
        if not condition:
            self.failures.append(f"{label} — {detail}" if detail else label)
            print(f"  FAIL: {label} {detail}")
        else:
            print(f"  ok: {label}")

    def finish(self, verdict: str) -> int:
        print()
        if self.failures:
            print(f"✗ {self.battery}: {len(self.failures)} failure(s):")
            for f in self.failures:
                print(f"  - {f}")
            return 1
        print(f"✓ {self.battery}: {verdict}")
        return 0


def ensure_business_identity(
    hub: Hub, tax_id="B12345674", legal_name="Mi Empresa SL"
) -> None:
    """Sets the hub's business identity through the real admin door (`PUT /api/settings`) —
    the fiscal precondition every `invoice.*` command that stamps the issuer is gated on
    (ADR-0203, hub#328; the KERNEL's contract, not `invoice`'s — hub#1264 §5). Dev auth grants
    admin to any `X-User-Id` (see `crates/server/src/auth.rs::require_admin_session`), so this is
    exactly the write the fiscal setup wizard would make. Idempotent: a battery run after another
    just re-asserts the same identity."""
    status, body = hub._request(
        "PUT",
        "/api/settings",
        {"business_tax_id": tax_id, "business_legal_name": legal_name},
    )
    if status != 200:
        print(
            f"{hub.battery}: PUT /api/settings (business identity) answered {status}: {body}"
        )
        sys.exit(1)


def cash_method_id(hub: Hub) -> str:
    """Id of the CASH method from the hub's seeded catalogue, through the public query — never
    composed by hand (sales#20: «the client proposes, the server disposes»)."""
    rows = hub.query("sales.payment_methods")
    cash = next((r for r in rows if r.get("type") == "cash"), None)
    if cash is None:
        raise AssertionError(
            f"the hub's catalogue must carry the `cash` method: {rows}"
        )
    return cash["id"]


def key(tag: str) -> str:
    """A charge-attempt key unique to THIS run (sales#20: `sales.complete_sale` requires one)."""
    return f"hub-battery-{tag}-{uuid.uuid4().hex[:8]}"


def unique_series(tag: str) -> str:
    """A series code unique to THIS run. `invoice`'s series are keyed `(hub_id, code, year)`
    (`commands/_ensure_series.sql`), so a fresh code always starts its counter at 0 — the only way
    to assert an exact `-000001`/`-000002` suffix against a hub SHARED with every other run this
    battery has ever had."""
    return f"HB{tag.upper()}{uuid.uuid4().hex[:6].upper()}"


def unique_tag(tag: str) -> str:
    """A string unique to THIS run, for a `customer_name` a battery can later find again through
    `invoice.list`'s `search` (module.json: `search: ["number", "customer_name", ...]`)."""
    return f"{tag}-{uuid.uuid4().hex[:8]}"


def wait_for_invoice_by_source(hub: Hub, source_id: str, timeout: float = 8.0) -> dict:
    """Polls `invoice.by_source` until the auto-F2 that `sale.completed` → `invoice.create_from_sale`
    mints for `source_id` lands, or raises naming the sale and what was last seen.

    The relay delivers a listener ASYNCHRONOUSLY (the outbox's own tick, `crates/server/src/lib.rs`)
    — there is no HTTP door to drain it on demand the way the hub's own e2e used
    `rt.drain_outbox()`. `invoice.by_source` is scoped to ONE `source_id` by its own SQL
    (`WHERE source_id = :source_id`, unique index `uq_invoice_source`), so polling it is safe on a
    hub SHARED with every other run this battery has ever had."""
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        rows = hub.query("invoice.by_source", {"source_id": source_id})
        if rows:
            return rows[0]
        last = rows
        time.sleep(0.1)
    raise AssertionError(
        f"timed out after {timeout}s waiting for the auto-F2 of sale {source_id}, "
        f"invoice.by_source last saw: {last}"
    )
