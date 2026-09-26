#!/usr/bin/env python3
"""Every tab says who it is for, or the menu shows a door that opens on a 403 (hub#1052).

WHY THIS FILE EXISTS. Until hub#1052 a `navigation[]` entry had nowhere to write «this tab is of
the admins»: the manifest schema's items were closed over {id,label,icon,component,chrome,actions},
so `/api/navigation` served EVERY tab to EVERY user. This module re-learned that the hard way
(invoice#32): it declared `settings.permission` before the field existed, serde dropped it
silently, and the Settings tab was painted for everyone while the manifest read as if it were
protected. The key was removed then — the honest move with the runtime of that day.

That changed: hub#1052 implements `navigation[].permission` (filtered in `/api/navigation`) and
module-toolkit PR #68 resynced `module.schema.json` (byte-identical to the hub's), so the key is
part of the contract a module's own gate validates against. invoice#47 re-declares it, and this
gate pins that it never silently rots back to the fake protection of invoice#32:

  1. every `navigation[]` entry of this module declares a `permission`;
  2. that permission is one THIS module declares (not another module's, not the core's);
  3. it is the permission the tab's own screen is FOR — the one its writes gate — so the menu and
     the door cannot disagree about who may enter;
  4. the manifest is serializable against the toolkit's own `module.schema.json`, the schema that
     the module gate runs — if that ever forgets the key again, `permission` stops being a gate
     and becomes invoice#32's false protection all over (this time silently ACCEPTED, which is
     worse).

The mapping, per tab (the divergence from whatsapp_inbox's primary-QUERY rule is deliberate and
documented here):

  invoice  → erp-invoice-list     → invoice.list            → invoice.view_invoice
  settings → erp-invoice-settings → invoice.series.create/update → invoice.manage_series

The Series tab's first READ (`invoice.series.list`) gates only `invoice.view_invoice` because
that same query feeds the series selector of the manual invoice form — it is a shared read, not
the door. What the tab is FOR is the series CRUD, and both writes gate `invoice.manage_series`;
the screen itself hides the form without it (`hasPermission`), and the runtime revalidates every
command regardless. The nav filter is the third layer, not the only one.

Usage: tests/navigation_permission.contract.test.py   (exit 0 = green). No Postgres, no Docker.
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

# Tab → (component, [commands/queries the tab exists for], the permission those gate).
# The screen's writes name the surface the tab is FOR; its `permission` in the manifest is the
# gate the runtime enforces on them.
TAB_TO_SURFACE = {
    "invoice": ("erp-invoice-list", ["invoice.list"], "invoice.view_invoice"),
    "settings": ("erp-invoice-settings", ["invoice.series.create", "invoice.series.update"],
                 "invoice.manage_series"),
}

failures: list[str] = []


def component_source(component: str) -> str:
    base = MODULE_DIR / "ui" / "components" / component / f"{component}.ts"
    return base.read_text() if base.exists() else ""


def schema_allows_navigation_permission() -> tuple[bool, str]:
    """The vendored toolkit schema — the one `module-gate.yml@main` validates against — must
    know `navigation[].permission`. A manifest the schema rejects never reaches the runtime,
    and a schema that stopped allowing the key would turn this gate's green into invoice#32's
    false protection (this time silently accepted)."""
    candidates = [
        MODULE_DIR.parent.parent.parent / "module-toolkit" / "schemas" / "module.schema.json",
    ]
    schema = next((p for p in candidates if p.exists()), None)
    if schema is None:
        return True, "toolkit schema not found on this machine (CI validates it anyway)"
    doc = json.loads(schema.read_text())
    props = (
        doc.get("properties", {}).get("navigation", {}).get("items", {}).get("properties", {})
    )
    if "permission" not in props:
        return False, f"{schema} does not allow `permission` in navigation[] items"
    return True, str(schema)


def main() -> int:
    print("· every navigation tab declares the permission that opens it (hub#1052, invoice#47)")
    declared_permissions = set(MANIFEST.get("permissions", []))
    queries = MANIFEST.get("queries", {})
    commands = MANIFEST.get("commands", {})
    entries = {entry["id"]: entry for entry in MANIFEST.get("navigation", [])}

    for tab, (component, surface, expected) in TAB_TO_SURFACE.items():
        entry = entries.get(tab)
        if entry is None:
            failures.append(f"the `{tab}` tab disappeared from `navigation` — rewrite this gate")
            continue

        permission = entry.get("permission")
        if not permission:
            failures.append(
                f"`navigation[{tab}]` declares no `permission`: `/api/navigation` serves it to "
                "every user, and anyone without the screen's own permission lands on a 403 the "
                "menu itself offered (hub#1052)"
            )
            continue
        if permission != expected:
            failures.append(
                f"`navigation[{tab}].permission` is `{permission}`, expected `{expected}` (the "
                "one the tab's screen is for)"
            )
            continue
        if permission not in declared_permissions:
            failures.append(
                f"`navigation[{tab}].permission` is `{permission}`, which this module does not "
                "declare in `permissions`"
            )
            continue

        # The menu and the door must agree: every surface the tab exists for gates the SAME
        # permission the menu declares. A tab declared more permissive than its screen is the
        # 403 all over again; one declared stricter hides a screen people could use.
        for name in surface:
            manifest_block = queries.get(name) or commands.get(name)
            surface_permission = (manifest_block or {}).get("permission")
            if surface_permission != permission:
                failures.append(
                    f"`navigation[{tab}].permission` is `{permission}` but `{name}` gates "
                    f"`{surface_permission}` — the menu and the door disagree"
                )
                continue

        # And the surface is REALLY the screen's own — otherwise the mapping above went stale
        # when the screen changed.
        source = component_source(component)
        for name in surface:
            if name not in source:
                failures.append(
                    f"`{component}` no longer calls `{name}`: the tab→surface mapping of this "
                    "gate is stale, rewrite it"
                )
                continue
        print(f"  ok: `{tab}` opens with `{permission}` (the one {surface} gates)")

    # Absent = visible-to-all is the field's contract for PRE-EXISTING manifests; this module
    # has no tab that is honestly for everybody, so a third entry without a permission would be
    # a decision somebody made — and it deserves to be made here, out loud, not by omission.
    for tab in entries.keys() - TAB_TO_SURFACE.keys():
        if not entries[tab].get("permission"):
            failures.append(
                f"`navigation[{tab}]` is unknown to this gate and declares no `permission`: add "
                "the mapping (and the reason) or the permission"
            )

    ok, where = schema_allows_navigation_permission()
    if not ok:
        failures.append(where)

    if failures:
        print(f"\nFAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nOK: both tabs say who they are for; nobody is offered a 403")
    return 0


if __name__ == "__main__":
    sys.exit(main())
