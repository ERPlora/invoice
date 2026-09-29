#!/usr/bin/env python3
"""Manifest contract test (invoice#4 + invoice#32) — the manifest declares only what gates something.

Two silent holes, one root cause — keys the runtime does not read:

  * `invoice.manage_settings` (invoice#4) was listed in `permissions[]` and gated NOTHING: no table,
    no query, no command. A permission that guards nothing is noise in the roles UI and something an
    auditor has to rule out by hand. Everything configurable in this module is the numbering
    series, and that has its own wired permission (`invoice.manage_series`).

  * `navigation[].permission` (invoice#32) was not a field of the navigation contract yet
    (`hub/schemas/module.schema.json`, `NAV_FIELDS` in `hub/crates/runtime/src/manifest.rs`):
    serde dropped it silently, so the Settings tab was painted for EVERYONE while the manifest read
    as if it were protected. The key was removed until the contract caught up. It has (hub#1052
    filters it in `/api/navigation`; module-toolkit resynced the schema in PR #68), and invoice#47
    re-declares it — the real gate is still inside `erp-invoice-settings` (`hasPermission(
    'invoice.manage_series')` hides the editing) and, for real, the runtime on
    `invoice.series.create` / `.update` (`invoice.manage_series`); the nav filter is the third
    layer, and `tests/navigation_permission.contract.test.py` pins it.

  * The three commands that issue an invoice read the tax rules (and `create_from_sale` the sale)
    without `required` (invoice#133): a read the kernel could not make was silently omitted and
    the invoice was issued anyway, with a generic fiscal qualification. The Module gate does not
    run hub batteries, so this is where a manifest that drops `required` goes red;
    `tests/issuing_refuses_without_reads.hub.test.py` proves the behaviour against the kernel.

Rule under test: every declared permission is referenced by at least one query, command, or
`provides_slots` entry; navigation entries carry only contract keys; every read an invoice is
issued from is `required`.

Usage: tests/manifest.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

# Mirror of `NAV_FIELDS` (hub/crates/runtime/src/manifest.rs) and the closed object in
# `hub/schemas/module.schema.json`. `actions` is accepted by the parser but dead (ADR-0048).
# `permission` joined the contract with hub#1052 (served/filtered by `/api/navigation`).
NAV_FIELDS = {"id", "label", "icon", "component", "chrome", "actions", "permission"}

failures: list[str] = []


def check(label: str, expected, actual):
    if expected != actual:
        failures.append(f"{label} — expected [{expected}], got [{actual}]")
        print(f"  FAIL: {label} — expected [{expected}], got [{actual}]")
    else:
        print(f"  ok: {label} = {expected}")


def used_permissions() -> set[str]:
    used = set()
    for block in ("queries", "commands"):
        for entry in MANIFEST.get(block, {}).values():
            if entry.get("permission"):
                used.add(entry["permission"])
    for slot in MANIFEST.get("provides_slots", []):
        if slot.get("permission"):
            used.add(slot["permission"])
    setup = MANIFEST.get("setup")
    if isinstance(setup, dict) and setup.get("permission"):
        used.add(setup["permission"])
    return used


def test_every_declared_permission_gates_something():
    print("\n== 1. every declared permission is used by a query, command or slot ==")
    declared = set(MANIFEST.get("permissions", []))
    used = used_permissions()
    check("no dead permission in permissions[]", set(), declared - used)
    check(
        "`invoice.manage_settings` is gone (invoice#4)",
        False,
        "invoice.manage_settings" in declared,
    )
    for role, perms in MANIFEST.get("role_permissions", {}).items():
        stray = {p for p in perms if p != "*" and p not in declared}
        check(f"role `{role}` only maps declared permissions", set(), stray)


def test_navigation_only_carries_contract_keys():
    print(
        "\n== 2. navigation[] entries carry only keys the runtime reads (invoice#32) =="
    )
    for i, nav in enumerate(MANIFEST.get("navigation", [])):
        unknown = set(nav) - NAV_FIELDS
        check(
            f"navigation[{i}] (`{nav.get('id')}`) has no unknown keys", set(), unknown
        )


def test_settings_tab_gate_is_documented():
    """The tab is not gated by the manifest — the doc must say by what it IS gated."""
    print("\n== 3. the Settings tab's real gate is written down ==")
    limits = (MODULE_DIR / "docs" / "limits.md").read_text()
    check(
        "docs/limits.md no longer sells `manage_settings`",
        False,
        "manage_settings" in limits,
    )
    check(
        "docs/limits.md names the series permission as the Settings gate",
        True,
        "invoice.manage_series" in limits,
    )


# What an invoice is issued FROM. A read the kernel cannot make is OMITTED unless it is `required`
# (hub#701), and then the handler issues anyway: without the rules every line is declared
# "domestic VAT, subject", without the sale `create_from_sale` blames a sale that exists
# (`invoice.sale_not_found`). `required` makes the kernel abort with `read_unavailable` before
# anything is written (invoice#133) — same as `sales` at the till and `taxes.calculate` (taxes#82).
REQUIRED_READS = {"taxes.rules.list", "sales.get"}
ISSUING_COMMANDS = {
    "invoice.create": {"taxes.rules.list"},
    "invoice.create_from_sale": {"taxes.rules.list", "sales.get"},
    "invoice.substitute": {"taxes.rules.list"},
}


def read_query(read) -> str | None:
    """`enum ReadDef` (`#[serde(untagged)]`): a bare query name, or `{query, params, required}`."""
    if isinstance(read, str):
        return read
    if isinstance(read, dict):
        return read.get("query")
    return None


def test_issuing_reads_are_required():
    print(
        "\n== 4. an invoice is never issued from a read the kernel could not make (invoice#133) =="
    )
    commands = MANIFEST.get("commands", {})
    for name, needs in ISSUING_COMMANDS.items():
        reads = {read_query(r) for r in commands.get(name, {}).get("reads", [])}
        check(f"`{name}` reads what it issues from", set(), needs - reads)
    for name, cmd in commands.items():
        for i, read in enumerate(cmd.get("reads", [])):
            query = read_query(read)
            if not isinstance(read, (str, dict)):
                check(f"commands.{name}.reads[{i}] is a query name or an object", True, False)
                continue
            if query not in REQUIRED_READS:
                continue
            check(
                f"commands.{name}.reads[{i}] (`{query}`) is declared required",
                True,
                isinstance(read, dict) and read.get("required") is True,
            )


def main() -> int:
    test_every_declared_permission_gates_something()
    test_navigation_only_carries_contract_keys()
    test_settings_tab_gate_is_documented()
    test_issuing_reads_are_required()
    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — the manifest declares only what gates something and issues only from reads it made "
        "(invoice#4, invoice#32, invoice#133)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
