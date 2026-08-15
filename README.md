# Módulo `invoice` — facturación

Convierte ventas completadas en **documentos fiscales numerados por serie** (F1/F2/F3, R1–R5) e
impone la **inmutabilidad fiscal** (RD 1007/2023): una factura emitida **no se modifica ni se
borra** — se corrige con una **rectificativa** (R1, importes negados) o se completa con una
**sustitutiva** (F3, «el cliente pide factura de un tiquet»). Numeración monotónica por serie+año.

> **Module id:** `invoice`. **Depende de:** `taxes`, `sales` (instalar invoice los auto-instala).
> Módulo híbrido: SQL + handler WASM (`create_invoice`, `create_from_sale`, `substitute_from_invoice`).

## Documentación de usuario — [`docs/`](docs/)

Viaja **dentro** del módulo y se versiona con él: el asistente del hub (ADR-0282) la indexa por
versión instalada y cita la de TU versión, no la de la última publicada. En inglés (idioma fuente).

| Fichero | Para qué |
| ------- | -------- |
| [`docs/overview.md`](docs/overview.md) | Qué hace y qué NO hace; los tipos F1/F2/F3/R1–R5 |
| [`docs/screens.md`](docs/screens.md) | Invoices y Settings (series): emitir, marcar pagada, rectificar, sustituir |
| [`docs/concepts.md`](docs/concepts.md) | **Rectificar vs sustituir**, inmutabilidad, numeración por serie+año, 1 factura por origen, desglose con DOS ejes |
| [`docs/limits.md`](docs/limits.md) | Huecos conocidos (F3 sin botón, todo sale F2), permisos por acción y diagnóstico |

## Qué expone hoy

| Tipo | Nombre | Permiso |
| ---- | ------ | ------- |
| query | `invoice.list` / `.get` / `.lines` / `.by_source` / `.series.list` | `invoice.view_invoice` |
| command | `invoice.create` (WASM) | `invoice.add_invoice` |
| command | `invoice.create_from_sale` (WASM, listener) | `invoice.add_invoice` |
| command | `invoice.substitute` (WASM, ADR-0140) | `invoice.add_invoice` |
| command | `invoice.mark_paid` | `invoice.add_invoice` |
| command | `invoice.rectify` | `invoice.rectify_invoice` |
| command | `invoice.series.create` / `.update` | `invoice.manage_series` |
| escucha | `sale.completed` → `invoice.create_from_sale` | — |
| emite | `invoice.created`, `invoice.rectified` | — |

Navegación: `erp-invoice-list` («Invoices») y `erp-invoice-settings` («Settings» = gestor de series).

> 🧩 **ADR-0223:** la resolución de la regla fiscal vive UNA vez en `erplora_guest_sdk::tax`, no aquí.

## Layout

```text
module.json                   # manifest (contrato técnico)
migrations/postgres/          # esquema §2.5 (hub_id + soft-delete + auditoría)
queries/*.sql                 # lecturas declarativas (:hub_id inyectado)
commands/*.sql                # escrituras declarativas (las `_` son intenciones del WASM)
schemas/*.json                # JSON Schemas de input (draft 2020-12)
handler/                      # WASM Tier 2 → dist/handler.wasm
ui/                           # Web Components (Lit/Ionic/OutfitKit)
docs/                         # documentación de usuario + corpus del asistente
```

## Estado y trabajo abierto

El estado vive en las **Issues de este repo**, no aquí. Huecos conocidos y documentados en
`docs/limits.md`: la UI no invoca `invoice.substitute` todavía, y `document_type` no viaja en
`sale.completed`, así que toda venta se factura como F2 (ADR-0140).

Doc de arquitectura: `architecture/modules/invoice.md` (cargarlo antes de tocar el módulo).
