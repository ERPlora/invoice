#!/usr/bin/env python3
"""The tab the Home task opens is named after what it shows, not «Settings» (invoice#105).

WHY THIS FILE EXISTS. The Home checklist item «Your invoice numbering» opens `setup.route`
(`/m/invoice/settings`). That tab's screen is the table of invoice SERIES — yet the manifest
labelled it «Settings» / «Ajustes» with the gear icon. The shell reserves exactly that label and
that icon for a module's settings FORM (the synthetic tab it builds from a `settings` block,
`moduleSettings.tab` in the hub's i18n): so the person landed on a gear tab called «Ajustes» and
found a list of series. Tab and content disagreed (reported from the recorded manual, hub#2200).

The route id stays `settings` on purpose: it is the address the Home task, bookmarks and the
recorded manual already use, and renaming it would turn them into «this page does not exist».
What this gate pins is what the person SEES:

  1. `setup.route` opens a tab this module declares;
  2. that tab carries a label in `en` (manifest) and in `es` (locale);
  3. no tab of this module wears the shell's reserved settings label or gear icon while the module
     declares no `settings` block — none of its screens is a settings form.

Usage: tests/setup_tab_label.contract.test.py   (exit 0 = green). No Postgres, no Docker.
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())
LOCALE_ES = json.loads((MODULE_DIR / "locales" / "es.json").read_text())

# The hub shell's own label and icon for a module's settings-form tab (`moduleSettings.tab`,
# `apps/web/src/views/ModuleView.vue`). A tab that is not that form must not borrow them.
RESERVED_LABELS = {"en": "Settings", "es": "Ajustes"}
RESERVED_ICON = "settings-outline"

failures: list[str] = []


def main() -> int:
    print("· the tab the Home task opens is named after what it shows (invoice#105)")
    entries = {entry["id"]: entry for entry in MANIFEST.get("navigation", [])}
    es_nav = LOCALE_ES.get("navigation", {})

    route = (MANIFEST.get("setup") or {}).get("route", "")
    prefix = f"/m/{MANIFEST['id']}/"
    if not route.startswith(prefix):
        failures.append(
            f"`setup.route` is `{route}`, expected a tab of this module ({prefix}…)"
        )
    else:
        tab = route[len(prefix) :]
        entry = entries.get(tab)
        if entry is None:
            failures.append(
                f"`setup.route` opens `{tab}`, a tab `navigation` does not declare"
            )
        else:
            if not entry.get("label"):
                failures.append(f"`navigation[{tab}]` has no `en` label")
            if not (es_nav.get(tab) or {}).get("label"):
                failures.append(
                    f"`navigation.{tab}.label` is missing from locales/es.json"
                )
            print(
                f"  setup task opens `{tab}`: en «{entry.get('label')}» · "
                f"es «{(es_nav.get(tab) or {}).get('label')}»"
            )

    if not MANIFEST.get("settings"):
        for tab, entry in entries.items():
            es_label = (es_nav.get(tab) or {}).get("label")
            if entry.get("label") == RESERVED_LABELS["en"]:
                failures.append(
                    f"`navigation[{tab}].label` is the shell's reserved "
                    f"«{RESERVED_LABELS['en']}», but `{entry.get('component')}` is "
                    "not a settings form"
                )
            if es_label == RESERVED_LABELS["es"]:
                failures.append(
                    f"`navigation.{tab}.label` (es) is the shell's reserved "
                    f"«{RESERVED_LABELS['es']}», but `{entry.get('component')}` is "
                    "not a settings form"
                )
            if entry.get("icon") == RESERVED_ICON:
                failures.append(
                    f"`navigation[{tab}].icon` is the shell's settings gear "
                    f"`{RESERVED_ICON}`, but `{entry.get('component')}` is not a "
                    "settings form"
                )

    if failures:
        print(f"\nFAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nOK: the Home task lands on a tab whose name matches its screen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
