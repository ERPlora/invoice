#!/usr/bin/env python3
"""Manifest contract test (invoice#4 + invoice#32) — the manifest declares only what gates something.

Two silent holes, one root cause — keys the runtime does not read:

  * `invoice.manage_settings` (invoice#4) was listed in `permissions[]` and gated NOTHING: no table,
    no query, no command. A permission that guards nothing is noise in the roles UI and something an
    auditor has to rule out by hand. Everything configurable in this module is the numbering
    series, and that has its own wired permission (`invoice.manage_series`).

  * `navigation[].permission` (invoice#32) is not a field of the navigation contract
    (`hub/schemas/module.schema.json`, `NAV_FIELDS` in `hub/crates/runtime/src/manifest.rs`).
    serde drops it silently, so the Settings tab was painted for EVERYONE while the manifest read
    as if it were protected. The real gate is inside `erp-invoice-settings` (`hasPermission(
    'invoice.manage_series')` hides the editing) and, for real, the runtime on
    `invoice.series.create` / `.update` (`invoice.manage_series`).

Rule under test: every declared permission is referenced by at least one query, command, or
`provides_slots` entry; navigation entries carry only contract keys.

Usage: tests/manifest.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

# Mirror of `NAV_FIELDS` (hub/crates/runtime/src/manifest.rs) and the closed object in
# `hub/schemas/module.schema.json`. `actions` is accepted by the parser but dead (ADR-0048).
NAV_FIELDS = {"id", "label", "icon", "component", "chrome", "actions"}

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


def main() -> int:
    test_every_declared_permission_gates_something()
    test_navigation_only_carries_contract_keys()
    test_settings_tab_gate_is_documented()
    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — the manifest declares only what gates something (invoice#4, invoice#32)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
