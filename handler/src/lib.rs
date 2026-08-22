//! Handler WASM (Tier 2) del módulo `invoice` — emitir una factura con líneas.
//! Portado de old_modules/m_invoice (InvoiceService.create_from_sale / create_manual,
//! InvoiceItem.calculate, get_next_number). Lógica pura, sin BD.
//!
//! Exporta:
//!  - `create_invoice`: factura manual/F1 o F2 desde payload con `items`. Calcula
//!    por línea base/tax/total (quantize 0.01) + tax_breakdown por tipo, y emite:
//!    ensure_series + bump_series + insert_invoice (lee el contador de serie por
//!    subquery, igual que el número atómico de sales) + N insert_line.
//!  - `create_from_sale`: adapta el payload del evento `sale.completed` (líneas con
//!    unit_price/tax_rate/description) a una F2 serie TICKET; misma mecánica.
//!
//! La numeración por serie+año es monotónica (current_number += 1). La rectificación
//! (R1, importes negados) NO está aquí: es SQL declarativo (INSERT...SELECT), no
//! necesita iterar arrays. La inmutabilidad fiscal la imponen los commands (no hay
//! update/delete de factura emitida; solo rectify).

use erplora_guest_sdk::money;
use erplora_guest_sdk::tax;
use erplora_guest_sdk::units::QUANTITY_SCALE;
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;
use erplora_guest_sdk::{DomainError, Event, Operation, Output};
use serde_json::{json, Map, Value};

#[cfg(feature = "guest")]
use extism_pdk::*;

/// Turns the pure core's `Result<Output, String>` into the host's `FnResult`: `Ok` -> JSON,
/// `Err(msg)` -> WASM trap with return code 1, which the runtime maps to `RuntimeError::Wasm` and
/// an HTTP 400 carrying `msg`. Same pattern as appointments/cart_checkout. Before invoice#8
/// (hub#108) `create_from_sale_pure` returned a bare `Output`, i.e. it had NO error channel at all
/// and therefore could not refuse a nonexistent sale.
///
/// The trap is deliberately the whole rejection: `persist_handler_output` never runs, so no
/// operation, no event and no series bump are written. It is a hard refusal, not a silent no-op.
/// Once ADR-0205 reaches the hub's `main` (today it lives on `develop`), this should move to the
/// guest `Output.error` channel so the UI gets a translatable `invoice.*` code and HTTP 409.
#[cfg(feature = "guest")]
fn guest_result(out: Result<Output, String>) -> FnResult<Json<Output>> {
    match out {
        Ok(o) => Ok(Json(o)),
        Err(e) => Err(WithReturnCode::new(Error::msg(e), 1)),
    }
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn create_invoice(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    Ok(Json(create_invoice_pure(input.into_inner().into_value())))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn create_from_sale(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(create_from_sale_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn substitute_from_invoice(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    Ok(Json(substitute_from_invoice_pure(input.into_inner().into_value())))
}

// El DINERO lo calcula `erplora_guest_sdk::money` (ADR-0123): una sola implementación, un solo
// modo de redondeo (HALF_UP). Este módulo tenía su propio `round_cents` (half-even sobre `f64`).
fn f(v: &Value, d: f64) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(d),
        Value::String(s) => s.trim().parse().unwrap_or(d),
        _ => d,
    }
}
fn s(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
/// Cantidad en punto fijo entero escala 10⁶ (ADR-0147): en el JSON viaja el ENTERO (`500000`
/// = 0,5). Un float ya no es una cantidad válida: cae al default (el schema lo rechaza en la
/// puerta; aquí solo cubre eventos antiguos re-entregados, igual que hace `sales::as_qty`).
fn as_qty(v: &Value, d: i64) -> i64 {
    match v {
        Value::Number(n) => n.as_i64().unwrap_or(d),
        Value::String(s) => s.trim().parse::<i64>().unwrap_or(d),
        _ => d,
    }
}
fn sor(p: &Value, k: &str, d: &str) -> String {
    let x = s(p.get(k).unwrap_or(&Value::Null));
    if x.is_empty() { d.to_string() } else { x }
}

// ── La CLAVE FISCAL de una línea (hub#292) ───────────────────────────────────
//
// El `tax_breakdown` de la cabecera es el contrato con el módulo de compliance: de ahí sale,
// verbatim, el `<Desglose>` del registro que se manda a Hacienda. Mientras la clave fue el TIPO,
// ese registro solo sabía decir una cosa —venta nacional sujeta y no exenta— porque no había
// dónde poner nada más. Ahora la clave es la clave fiscal COMPLETA.
//
// **La forma cambia de objeto a ARRAY** y es deliberado, por dos razones:
//   1. distingue las dos generaciones sin ambigüedad, y las facturas ya emitidas —encadenadas en
//      la huella fiscal— siguen generando su XML tal cual;
//   2. deja de COLISIONAR: con el objeto, una prestación exenta y un artículo al 0 % compartían
//      la clave `"0.00"` y se fundían en una línea que declaraba mal las dos.
//
// La calificación se resuelve del catálogo de reglas que el runtime pre-carga en
// `context.reads["taxes.rules.list"]` (mismo keystone de ADR-0085 que usa `sales` para el %),
// usando el país/región del HUB (`context.country_code`/`region_code`), no los del cliente. El
// TIPO no se recalcula: llega ya congelado en la línea (contrato D1) y se respeta.
//
// Sin catálogo, sin categoría o sin regla → venta nacional sujeta y no exenta, que es lo que
// significaban las facturas de antes. Nunca se rompe una emisión por no poder calificar.

/// La calificación fiscal de una línea, ya resuelta. `regime`/`exempt_reason` son códigos de la
/// jurisdicción y viajan OPACOS: este módulo no los interpreta, los copia.
#[derive(Clone, PartialEq)]
struct FiscalKey {
    /// Familia del impuesto: `vat` | `igic` | `ipsi` | … (la del `tax_type` de la regla raíz).
    kind: String,
    regime: String,
    /// `subject` | `subject_reverse` | `exempt` | `not_subject` | `not_subject_location`.
    class: String,
    exempt_reason: String,
    /// Tipo del impuesto PRINCIPAL, en tanto por ciento. Con recargo de equivalencia es el del
    /// IVA (21), no el combinado (26,2): 26,2 no es un tipo que exista.
    rate: f64,
    /// Tipo del recargo de equivalencia, si la regla lo lleva como componente.
    surcharge_rate: f64,
    has_surcharge: bool,
}

impl FiscalKey {
    /// La clave de una línea sin catálogo: venta nacional, régimen general, sujeta y no exenta.
    /// `surcharge_rate` is honoured when the item itself carries it (a new-generation line replayed
    /// into an F3, invoice#21): without a catalog it is the only source that says there was one.
    fn nacional(rate: f64, surcharge_rate: f64) -> Self {
        FiscalKey {
            kind: "vat".to_string(),
            regime: tax::DEFAULT_REGIME.to_string(),
            class: "subject".to_string(),
            exempt_reason: String::new(),
            rate,
            surcharge_rate,
            has_surcharge: surcharge_rate > 0.0,
        }
    }
}

/// Una línea del desglose: su clave fiscal y los importes acumulados (céntimos).
struct DesgloseLine {
    key: FiscalKey,
    base: i64,
    quota: i64,
    surcharge_quota: i64,
    /// How many invoice lines were aggregated here. It is the ROUNDING TOLERANCE of the audit
    /// (invoice#50): each line contributes at most one cent of its own rounding, so a row built
    /// from three lines may sit up to three cents away from `base × rate` and still be right.
    lines: i64,
}

// ── La regla de impuesto: UNA sola implementación (hub#295) ──────────────────
//
// Reading the catalog, resolving the root rule and qualifying the operation live in
// `erplora_guest_sdk::tax`. They used to be copied here, in `taxes` and in `sales`; WASM guests
// cannot call each other, so the three copies were kept in step by hand — and had already
// drifted: this module copied any `operation_class` verbatim into the breakdown while `taxes`
// clamped it to the closed list, which is exactly "charge one thing, declare another".

/// The fiscal key of a line WHEN a rule resolves for its category; `None` when there is no
/// catalog, no category or no matching rule (the caller falls back to `FiscalKey::nacional` with
/// the rate it charged). `rate_hint` is the rate frozen on the line, used only when the rule
/// carries no `rate_pct`. Returning `Option` lets the manual path tell "the rule says 0 %" from
/// "nobody said anything" (invoice#27): only the former overrides the caller's rate.
fn resolved_fiscal_key(item: &Value, rules: &[&Value], cc: &str, rc: &str, date: &str, rate_hint: f64) -> Option<FiscalKey> {
    let cat = s(item.get("tax_category_key").unwrap_or(&Value::Null));
    let root = if cat.is_empty() { None } else { tax::resolve_root(rules, cc, rc, &cat, date) }?;

    // El recargo de equivalencia es un COMPONENTE de la regla del IVA (`parent_id` = raíz): aporta
    // cuota sobre la misma base, pero no es otra operación ni otro tipo. Va DENTRO de la línea.
    let components = tax::rule_components(root, rules, date);
    let surcharge: f64 = components.iter().skip(1).map(|c| c.rate_pct).sum();

    let qualification = tax::rule_qualification(root);
    Some(FiscalKey {
        kind: qualification.tax_kind,
        regime: qualification.regime_key,
        class: qualification.operation_class,
        exempt_reason: qualification.exempt_reason,
        // The DECLARED rate is the root's. The sale sends the combined 21 + 5.2 = 26.2 (what the
        // customer was charged), but 26.2 is not a rate that exists — neither in the breakdown nor,
        // since invoice#21, on the persisted line (`tax_rate` = main, `surcharge_rate` apart).
        rate: tax::rule_rate_pct(root, rate_hint),
        surcharge_rate: surcharge,
        has_surcharge: surcharge > 0.0,
    })
}

/// Defaults de serie por code (fiel a on_install: TICKET=F2, FACT=F1, RECT=R1).
fn series_defaults(code: &str) -> (&'static str, &'static str) {
    match code {
        "FACT" => ("F1", "Complete Invoices"),
        "RECT" => ("R1", "Rectifying Invoices"),
        _ => ("F2", "POS Tickets"),
    }
}

fn year_from(now: &str) -> String {
    now.split('-').next().filter(|y| y.len() == 4).unwrap_or("2026").to_string()
}

/// Los tipos que NO admiten un total negativo: una factura ordinaria (F1), una simplificada (F2)
/// y una completa en sustitución de un tiquet (F3) documentan una venta. Lo negativo es una
/// RECTIFICATIVA (R1…R5), que no sale de este handler — la emite `invoice.rectify` en SQL.
const NON_NEGATIVE_TYPES: [&str; 3] = ["F1", "F2", "F3"];

/// Comprueba la aritmética de la factura ANTES de emitirla; `Some(err)` = no se emite nada.
///
/// Qué se puede comprobar y qué no, y por qué:
///
///   * **la cuota contra SU tipo declarado** — sí, y es la comprobación que faltaba: el desglose
///     dice `rate: 21.0` y `quota: 9999` sobre una base de 545 en la misma fila. La tolerancia es
///     de UN CÉNTIMO POR LÍNEA agregada, porque con precios IVA-incluido la cuota es
///     `bruto − base` (la regla de redondeo de `taxes`) y esa cuota difiere hasta un céntimo de
///     `base × tipo`. Ni un céntimo fijo (rechazaría un tiquet largo) ni un porcentaje.
///
///   * **la cuota contra el PRECIO de la línea** (`quantity × unit_price`) — NO, y no es un olvido:
///     cuando la factura viene de una venta, `sales` prorratea el descuento DENTRO de la línea
///     (net 372 + cuota 78 = 450 cobrados) y deja `unit_price` en el bruto sin descontar (500,
///     display). Comparar contra el precio rechazaría toda venta con descuento y toda invitación.
///     En el camino MANUAL el problema no existe porque ahí los importes ya no los pone el
///     llamante: los calcula este handler (ver `create_invoice_pure`).
///
///   * **`CuotaTotal` = Σ cuotas declaradas y `total = base + cuota`** — sí, como invariante. Se
///     cumplían por construcción; asertarlas aquí impide que un refactor las rompa en silencio,
///     que es justo el cruce que hace la AEAT.
///
///   * **el total negativo en un tipo que no lo admite** — sí. «≤ 0» no, deliberadamente: un
///     tiquet 100 % invitado suma 0,00 € honestamente y sigue siendo una venta que necesita su F2.
fn audit(breakdown: &[DesgloseLine], base_total: i64, tax_total: i64, inv_type: &str) -> Option<DomainError> {
    let mut declared_base: i64 = 0;
    let mut declared_quota: i64 = 0;

    for e in breakdown {
        declared_base += e.base;
        declared_quota += e.quota + e.surcharge_quota;

        let tolerance = e.lines.max(1);
        let expected = money::percent_of(e.base, Decimal::from_f64(e.key.rate).unwrap_or(Decimal::ZERO));
        if (e.quota - expected).abs() > tolerance {
            return Some(DomainError::new(
                "invoice.tax_quota_mismatch",
                format!(
                    "the breakdown declares {} of quota over a base of {} at {} %, and that rate \
                     justifies {} (tolerance {} cent(s) of rounding). Charging one amount and \
                     declaring another is what breaks the AEAT cross-check.",
                    e.quota, e.base, e.key.rate, expected, tolerance
                ),
            ));
        }
        if e.key.has_surcharge {
            let expected_surcharge =
                money::percent_of(e.base, Decimal::from_f64(e.key.surcharge_rate).unwrap_or(Decimal::ZERO));
            if (e.surcharge_quota - expected_surcharge).abs() > tolerance {
                return Some(DomainError::new(
                    "invoice.tax_quota_mismatch",
                    format!(
                        "the breakdown declares {} of equivalence surcharge over a base of {} at \
                         {} %, and that rate justifies {} (tolerance {} cent(s) of rounding).",
                        e.surcharge_quota, e.base, e.key.surcharge_rate, expected_surcharge, tolerance
                    ),
                ));
            }
        }
    }

    if declared_base != base_total || declared_quota != tax_total {
        return Some(DomainError::new(
            "invoice.totals_mismatch",
            format!(
                "the header declares base {} and quota {}, and its own breakdown adds up to base {} \
                 and quota {}. `CuotaTotal` must equal the sum of the declared quotas.",
                base_total, tax_total, declared_base, declared_quota
            ),
        ));
    }

    if base_total + tax_total < 0 && NON_NEGATIVE_TYPES.contains(&inv_type) {
        return Some(DomainError::new(
            "invoice.negative_total",
            format!(
                "an invoice of type {} cannot total {}: a negative amount is a corrective invoice \
                 (R1…R5), issued by `invoice.rectify`, not an ordinary one.",
                inv_type,
                base_total + tax_total
            ),
        ));
    }

    None
}

/// Construye las intenciones de una factura a partir de líneas ya normalizadas
/// (description, quantity, unit_price, tax_rate, product_id).
fn build_invoice(
    new_ids: &[Value],
    now: &str,
    series_code: &str,
    invoice_type_override: Option<&str>,
    header: &Value,
    items: &[Value],
    fiscal: &FiscalContext,
) -> Output {
    let invoice_id = new_ids.first().map(s).unwrap_or_default();
    let year = year_from(now);
    let issue_date = now.split('T').next().unwrap_or(now).to_string();
    let (def_type, def_name) = series_defaults(series_code);
    let inv_type = invoice_type_override.unwrap_or(def_type).to_string();

    let mut base_total: i64 = 0; // céntimos
    let mut tax_total: i64 = 0;  // céntimos
    let mut breakdown: Vec<DesgloseLine> = Vec::new(); // una entrada por clave fiscal
    let mut ops: Vec<Operation> = Vec::new();
    let rules: Vec<&Value> = fiscal.rules.iter().collect();

    // 1) asegurar la serie (idempotente) y 2) incrementar su contador.
    let mut ens = Map::new();
    ens.insert("new_id".into(), new_ids.get(1).cloned().unwrap_or(Value::Null));
    ens.insert("code".into(), json!(series_code));
    ens.insert("name".into(), json!(def_name));
    ens.insert("invoice_type".into(), json!(inv_type));
    ens.insert("year".into(), json!(year.parse::<i64>().unwrap_or(2026)));
    ens.insert("prefix".into(), json!(series_code));
    ops.push(Operation::sql("invoice._ensure_series", ens));

    // source_type/source_id viajan al bump y al insert para la idempotencia D2:
    // si ya existe una factura para este origen real, NO se consume número (bump no-op)
    // y el insert tampoco inserta (1 factura por venta, sin huecos de numeración).
    let src_type = sor(header, "source_type", "manual");
    let src_id = header.get("source_id").cloned().unwrap_or(Value::Null);
    let mut bump = Map::new();
    bump.insert("code".into(), json!(series_code));
    bump.insert("year".into(), json!(year.parse::<i64>().unwrap_or(2026)));
    bump.insert("source_type".into(), json!(src_type));
    bump.insert("source_id".into(), src_id.clone());
    ops.push(Operation::sql("invoice._bump_series", bump));

    let header_idx = ops.len();
    ops.push(Operation::sql("invoice._insert_invoice", Map::new())); // placeholder

    // 3) líneas (ids new_ids[2..]).
    for (i, item) in items.iter().enumerate() {
        // Punto fijo entero escala 10⁶ (ADR-0147): `500000` = 0,5. Ausente → 1 unidad.
        let qty = item.get("quantity").map(|v| as_qty(v, QUANTITY_SCALE)).unwrap_or(QUANTITY_SCALE);
        let unit_price = money::from_json(item.get("unit_price").unwrap_or(&Value::Null), 0);
        let rate_hint = item.get("tax_rate").map(|v| f(v, 0.0)).unwrap_or(0.0); // tasa % del llamante
        // invoice#21: a new-generation line (F3 replay of an F2 issued after this change) carries
        // its surcharge apart. Legacy lines / callers do not send it → 0 (the combined rate, if any,
        // is still inside `tax_rate` and only a resolved rule can split it).
        let surcharge_hint = item.get("surcharge_rate").map(|v| f(v, 0.0)).unwrap_or(0.0);
        // Clave fiscal de la línea (hub#292): qué impuesto, régimen y calificación. Se resuelve del
        // catálogo por la categoría fiscal congelada en la línea; sin catálogo/categoría/regla cae
        // a venta nacional sujeta y no exenta, que es lo que declaraban las facturas de antes.
        let resolved = resolved_fiscal_key(item, &rules, &fiscal.country, &fiscal.region, &fiscal.date, rate_hint);
        // Base/IVA por línea (céntimos). Si el origen ya extrajo la base y el IVA
        // (p.ej. `sale.completed` con precios IVA-INCLUIDO: net_amount/tax_amount ya
        // calculados por sales.calc_line), se RESPETAN — NO se vuelve a sumar IVA
        // sobre el bruto (bug D1). Solo cuando NO vienen (factura manual,
        // precios IVA-EXCLUIDO) se calcula base = qty*unit_price y tax = base*rate.
        let (base, tax) = match (item.get("base_amount"), item.get("tax_amount")) {
            (Some(b), Some(t)) => (money::from_json(b, 0), money::from_json(t, 0)),
            _ => {
                // Factura MANUAL (IVA no incluido): base = precio × cantidad, IVA encima.
                //
                // The rate CHARGED is the resolved rule's (main + surcharge components), not the
                // caller's hint (invoice#27, ADR-0223 single source): an exempt category sent with
                // `tax_rate: 21` used to charge 21 % and declare `exempt` with no quota, so
                // `CuotaTotal` no longer matched the declared quotas. Without a rule the hint is
                // all there is and it is honoured as before.
                let rate = match &resolved {
                    Some(k) => k.rate + k.surcharge_rate,
                    None => rate_hint + surcharge_hint,
                };
                //
                // OJO: aquí la cuota se sigue redondeando POR LÍNEA, no por tipo — y es DELIBERADO.
                // Cuando la factura viene de una venta, `base`/`tax` llegan YA calculados por
                // `sales` y este handler los RESPETA (contrato explícito, bug D1). Unificar esto al
                // desglose por tipo exige garantizar que NO diverja de lo que la venta ya declaró a
                // la AEAT → es un paso aparte, con su propio test (ADR-0123, seguimiento).
                // El dinero se calcula con la cantidad LÓGICA exacta (raw/10⁶) — división de
                // enteros en Decimal, sin pasar por f64 (ADR-0123 §2 + ADR-0147 §2.3).
                let qd = Decimal::from(qty) / Decimal::from(QUANTITY_SCALE);
                let rd = Decimal::from_f64(rate).unwrap_or(Decimal::ZERO);
                let base = money::mul_qty(unit_price, qd);
                // invoice#49: a priced line that ends up costing NOTHING is not a line, it is a
                // payload sent in the wrong scale. `quantity` travels as a fixed-point integer of
                // scale 10⁶ (ADR-0147), so a caller that means «2 coffees» and sends `2` is really
                // asking for 0,000002 units: 0,00066 cents, which rounds to 0 — and the invoice was
                // being ISSUED, numbered and chained in VeriFactu with base, quota and total at
                // zero. A fiscal document already issued is never deleted (ADR-0331) and
                // `invoice.rectify` is broken (invoice#5), so that mistake is irreversible for the
                // business. Refusing costs nothing; a zero-euro invoice costs a rectification that
                // does not exist.
                //
                // Only PRICED lines are judged (`unit_price > 0`): a comped/gift line honestly
                // costs 0,00 € and must keep going through.
                if unit_price > 0 && qty > 0 && base == 0 {
                    return Output::new().with_error(DomainError::new(
                        "invoice.line_amount_underflow",
                        format!(
                            "line {} `{}`: quantity {} at {} minor units each prices to 0, so the \
                             invoice would be issued for 0.00. Quantities are fixed-point integers \
                             of scale 1000000 (ADR-0147): one unit is 1000000, not 1.",
                            i + 1,
                            s(item.get("description").unwrap_or(&Value::Null)),
                            qty,
                            unit_price
                        ),
                    ));
                }
                let tax = money::percent_of(base, rd);
                (base, tax)
            }
        };
        let total = base + tax;
        base_total += base;
        tax_total += tax;

        let key = resolved.unwrap_or_else(|| FiscalKey::nacional(rate_hint, surcharge_hint));
        // Frozen on the line BEFORE `key` moves into the breakdown (invoice#21, see the insert below).
        let (line_rate, line_surcharge_rate) = (key.rate, key.surcharge_rate);
        // El recargo se separa de la cuota SIN recalcular el total: la cuota de la línea es la que
        // se cobró (contrato D1), y de ella sale el recargo por su tipo; el resto es el impuesto
        // principal. Así 2100 + 520 siguen sumando exactamente los 2620 cobrados.
        let surcharge_quota = if key.has_surcharge {
            money::percent_of(base, Decimal::from_f64(key.surcharge_rate).unwrap_or(Decimal::ZERO))
        } else {
            0
        };
        let main_quota = tax - surcharge_quota;

        if let Some(e) = breakdown.iter_mut().find(|e| e.key == key) {
            e.base += base;
            e.quota += main_quota;
            e.surcharge_quota += surcharge_quota;
            e.lines += 1;
        } else {
            breakdown.push(DesgloseLine { key, base, quota: main_quota, surcharge_quota, lines: 1 });
        }

        let line_id = new_ids.get(i + 2).map(s).unwrap_or_default();
        let mut p = Map::new();
        p.insert("line_id".into(), json!(line_id));
        p.insert("invoice_id".into(), json!(invoice_id));
        p.insert("line_number".into(), json!(i as i64 + 1));
        p.insert("description".into(), json!(s(item.get("description").unwrap_or(&Value::Null))));
        p.insert("quantity".into(), json!(qty)); // punto fijo 10⁶ (INTEGER, ADR-0147)
        p.insert("unit_price".into(), json!(unit_price)); // céntimos
        // invoice#21: the line freezes the MAIN rate and the surcharge apart. Under equivalence
        // surcharge the sale sends the combined 26.2 (21 + 5.2) — that is a sum, not a rate that
        // exists, and grouping by it reproduced the bug ADR-0186 fixed in the breakdown. What is
        // charged (`tax_amount`) does not move. `surcharge_rate` is ALWAYS written (0 when none):
        // NULL marks the legacy generation, whose `tax_rate` may still be a combined sum.
        p.insert("tax_rate".into(), json!(line_rate));                 // tasa % del impuesto principal (REAL)
        p.insert("surcharge_rate".into(), json!(line_surcharge_rate)); // tasa % del recargo (REAL, 0 = sin recargo)
        // Categoría fiscal congelada de la línea (ADR-0085); NULL en factura manual sin categoría.
        p.insert("tax_category_key".into(), item.get("tax_category_key").cloned().unwrap_or(Value::Null));
        p.insert("base_amount".into(), json!(base));      // céntimos
        p.insert("tax_amount".into(), json!(tax));        // céntimos
        p.insert("total_amount".into(), json!(total));    // céntimos
        p.insert("product_id".into(), item.get("product_id").cloned().unwrap_or(Value::Null));
        ops.push(Operation::sql("invoice._insert_line", p));
    }

    // Desglose por CLAVE FISCAL, en orden estable: el XML que sale de aquí no puede depender del
    // orden de las líneas de la factura. Dentro de la misma clave, tipo descendente.
    breakdown.sort_by(|a, b| {
        a.key.kind
            .cmp(&b.key.kind)
            .then_with(|| a.key.regime.cmp(&b.key.regime))
            .then_with(|| a.key.exempt_reason.cmp(&b.key.exempt_reason))
            .then_with(|| a.key.class.cmp(&b.key.class))
            .then_with(|| b.key.rate.partial_cmp(&a.key.rate).unwrap_or(std::cmp::Ordering::Equal))
    });
    let tb: Vec<Value> = breakdown
        .iter()
        .map(|l| {
            // Importes en céntimos (INTEGER) — contrato inter-módulo, igual que antes.
            let mut e = Map::new();
            e.insert("tax".into(), json!(l.key.kind));
            e.insert("regime".into(), json!(l.key.regime));
            e.insert("class".into(), json!(l.key.class));
            if !l.key.exempt_reason.is_empty() {
                e.insert("exempt_reason".into(), json!(l.key.exempt_reason));
            }
            e.insert("rate".into(), json!(l.key.rate));
            e.insert("base".into(), json!(l.base));
            e.insert("quota".into(), json!(l.quota));
            if l.key.has_surcharge {
                e.insert("surcharge_rate".into(), json!(l.key.surcharge_rate));
                e.insert("surcharge_quota".into(), json!(l.surcharge_quota));
            }
            Value::Object(e)
        })
        .collect();

    // ── LA AUDITORÍA (invoice#50): nada se sella sin cuadrar ────────────────────────────────
    //
    // Este módulo es el DUEÑO del documento y el que estampa `status: issued`. Lo que sale de aquí
    // lo copia `verifactu.records.ingest_invoice` VERBATIM en `BaseImponibleOimporteNoSujeto` /
    // `CuotaRepercutida` / `CuotaTotal`, y su `chain.validate` comprueba el ENCADENADO de hashes,
    // no la aritmética de lo que encadena. Si no cuadra aquí, no cuadra en ninguna parte.
    if let Some(err) = audit(&breakdown, base_total, tax_total, &inv_type) {
        return Output::new().with_error(err);
    }

    let mut h = Map::new();
    h.insert("invoice_id".into(), json!(invoice_id));
    h.insert("invoice_type".into(), json!(inv_type));
    h.insert("series".into(), json!(series_code));
    h.insert("year".into(), json!(year.parse::<i64>().unwrap_or(2026)));
    h.insert("prefix".into(), json!(series_code));
    h.insert("issue_date".into(), json!(issue_date));
    h.insert("issuer_nif".into(), json!(sor(header, "issuer_nif", "")));
    h.insert("issuer_name".into(), json!(sor(header, "issuer_name", "")));
    h.insert("customer_tax_id".into(), json!(sor(header, "customer_tax_id", "")));
    h.insert("customer_name".into(), json!(sor(header, "customer_name", "")));
    h.insert("customer_address".into(), json!(sor(header, "customer_address", "")));
    h.insert("description".into(), json!(sor(header, "description", "")));
    h.insert("base_amount".into(), json!(base_total));            // céntimos
    h.insert("tax_amount".into(), json!(tax_total));              // céntimos
    h.insert("total_amount".into(), json!(base_total + tax_total)); // céntimos
    h.insert("tax_breakdown".into(), json!(Value::Array(tb).to_string()));
    h.insert("source_type".into(), json!(sor(header, "source_type", "manual")));
    h.insert("source_id".into(), header.get("source_id").cloned().unwrap_or(Value::Null));
    // ADR-0140: enlace F3→F2 en las sustituciones (vacío en emisiones normales → NULL vía NULLIF
    // en _insert_invoice.sql). El SQL lo referencia siempre, así que TODA factura lo pasa.
    h.insert("substitutes_invoice_id".into(), json!(sor(header, "substitutes_invoice_id", "")));
    h.insert("notes".into(), json!(sor(header, "notes", "")));
    ops[header_idx] = Operation::sql("invoice._insert_invoice", h);

    let event = Event::new("invoice.created", json!({
        "sender": "invoice", "invoice_id": invoice_id,
        "invoice_type": inv_type, "total": base_total + tax_total, // céntimos (contrato inter-módulo)
    }));
    Output { operations: ops, events: vec![event], ..Default::default() }
}

/// Lo que hace falta para CALIFICAR una línea: el catálogo de reglas pre-cargado y la identidad
/// fiscal del hub (país/región), que el runtime inyecta en el contexto (keystone ADR-0085).
struct FiscalContext {
    rules: Vec<Value>,
    country: String,
    region: String,
    /// Día ISO de la emisión, para la vigencia de las reglas.
    date: String,
}

impl FiscalContext {
    fn from_input(input: &Value, now: &str) -> Self {
        let context = input.get("context").cloned().unwrap_or(Value::Null);
        FiscalContext {
            // `&Value::Null` as the payload fallback ON PURPOSE: only `taxes.calculate` lets a
            // caller hand its own catalog for an ad-hoc calculation. What is DECLARED comes from
            // the hub's own rules or from nothing.
            rules: tax::rule_catalog(&context, &Value::Null).into_iter().cloned().collect(),
            country: s(context.get("country_code").unwrap_or(&Value::Null)),
            region: s(context.get("region_code").unwrap_or(&Value::Null)),
            date: now.chars().take(10).collect(),
        }
    }
}

fn ctx_ids(input: &Value) -> (Vec<Value>, String) {
    let new_ids = input.get("context").and_then(|c| c.get("new_ids"))
        .and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let now = input.get("context").and_then(|c| c.get("now")).map(s).unwrap_or_default();
    (new_ids, now)
}

/// create_invoice: payload con items + cabecera + series_code (default FACT/F1).
pub fn create_invoice_pure(input: Value) -> Output {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let (new_ids, now) = ctx_ids(&input);
    let fiscal = FiscalContext::from_input(&input, &now);
    let empty: Vec<Value> = Vec::new();
    // invoice#50 — EL CLIENTE PROPONE, EL SERVIDOR DISPONE (lo mismo que `sales` hace con su
    // payload y que invoice#27 hizo con el TIPO). Una línea manual describe QUÉ se factura
    // (descripción, cantidad, precio, categoría); cuánto suma lo decide este handler. Mientras
    // `base_amount`/`tax_amount` se aceptaron del llamante, `invoice.create` sellaba 5,45 € de base
    // y 99,99 € de cuota sobre una línea de 6,60 €, y de ahí pasaban intactos al registro VeriFactu.
    //
    // Se IGNORAN, no se rechazan, porque el schema ya los rechaza en la puerta
    // (`additionalProperties: false`): esto es la segunda puerta, para cualquier camino que no pase
    // por el schema. Los importes recibidos SÍ son contrato en `create_from_sale` y en
    // `substitute_from_invoice`, donde vienen de una venta real o de un tiquet ya emitido — y ahí
    // los audita `audit()`.
    let items: Vec<Value> = payload
        .get("items")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
        .iter()
        .map(|it| match it.as_object() {
            Some(o) => {
                let mut m = o.clone();
                m.remove("base_amount");
                m.remove("tax_amount");
                Value::Object(m)
            }
            None => it.clone(),
        })
        .collect();
    let items = &items[..];
    let series_code = sor(&payload, "series_code", "FACT");
    let ty = payload.get("invoice_type").map(s).filter(|x| !x.is_empty());

    // invoice#52 — a document that would be sealed as F1 without `customer_tax_id` is refused
    // BEFORE it exists. A complete invoice needs an identified recipient: without it the AEAT
    // rejects the record with error 1189, and the VeriFactu engine covers for us by silently
    // degrading it to F2 (hub#1104) — leaving the paper saying «complete invoice» and the
    // register saying «simplified ticket», two truths about one document. The manual path has no
    // operator behind it excusing the choice (ADR-0140 opción A covers the POS path; see
    // `create_from_sale_pure` and its guard-rail test), so here the refusal is the honest answer:
    // issue with the customer's tax id, or in a simplified F2 series. Only the MANUAL path —
    // `substitute_from_invoice` (F3) already requires the tax id in its own schema.
    let effective_type = ty
        .clone()
        .unwrap_or_else(|| series_defaults(&series_code).0.to_string());
    let customer_tax_id = s(payload.get("customer_tax_id").unwrap_or(&Value::Null))
        .trim()
        .to_string();
    if effective_type == "F1" && customer_tax_id.is_empty() {
        return Output::new().with_error(DomainError::new(
            "invoice.f1_requires_customer_tax_id",
            "a complete invoice (F1) needs the customer's tax ID: without it the tax authority \
             rejects it (error 1189) and the document is really a simplified ticket. Issue it with \
             the customer's tax ID, or use a simplified-ticket series (F2).",
        ));
    }

    build_invoice(&new_ids, &now, &series_code, ty.as_deref(), &payload, items, &fiscal)
}

/// create_from_sale: adapta el evento sale.completed (líneas) a una F2 serie TICKET.
pub fn create_from_sale_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let (new_ids, now) = ctx_ids(&input);
    let fiscal = FiscalContext::from_input(&input, &now);

    // invoice#8 (hub#108): the invoice must reference a REAL sale. The manifest declares a `reads`
    // entry on `sales.get` parameterized with `payload.sale_id`, so the runtime preloads the sale
    // row into `context.reads["sales.get"]` (ADR-0069). An absent/empty read means the sale does
    // not exist (or is soft-deleted, i.e. not invoiceable) -> reject. Before this, a bogus
    // `sale_id` produced a zero invoice with a nonexistent origin, consuming a fiscal number and
    // contaminating numbering, totals and traceability.
    //
    // Runtime rule 3 (graceful reads): a read that fails is SKIPPED, not surfaced as an error, so
    // the check has to live here — we cannot rely on the read itself failing the command. This
    // covers the direct call path (public API / assistant with an arbitrary sale_id). On the
    // listener path (`sale.completed`) the sale row is committed in the same transaction that wrote
    // the outbox event, so the read finds it; if the sale was deleted meanwhile, rejecting is the
    // correct outcome.
    //
    // Failure channel: an `Err` here becomes a WASM trap -> `RuntimeError::Wasm` -> HTTP 400 with
    // the message below, and NOTHING is persisted (no invoice row, no number, no event). Once
    // ADR-0205 lands on the hub's main branch, this should become an `Output.error`
    // `{code: "invoice.sale_not_found"}` -> HTTP 409 with a translatable namespaced code.
    let sale_id = s(payload.get("sale_id").unwrap_or(&Value::Null));
    let sale_found = input
        .get("context")
        .and_then(|c| c.get("reads"))
        .and_then(|r| r.get("sales.get"))
        .and_then(|v| v.as_array())
        .map(|rows| !rows.is_empty())
        .unwrap_or(false);
    if !sale_id.is_empty() && !sale_found {
        return Err(format!(
            "sale_not_found: sale `{sale_id}` does not exist or is not invoiceable; refusing to issue an invoice for it"
        ));
    }

    let empty: Vec<Value> = Vec::new();
    let raw = payload.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
    // map líneas de venta → líneas de factura (description ← product_name).
    // sale.completed con precios IVA-INCLUIDO (D1): la venta YA extrajo base imponible
    // (net_amount) e IVA (tax_amount) por línea — se pasan a build_invoice como
    // base_amount/tax_amount para que NO se vuelva a sumar IVA sobre el bruto. El
    // unit_price sigue siendo el bruto/unitario (display). Compat: si un evento viejo
    // no trae net/tax, se omiten y build_invoice cae al cálculo IVA-excluido.
    let items: Vec<Value> = raw.iter().map(|it| {
        let mut m = Map::new();
        m.insert("description".into(), json!(s(it.get("product_name").unwrap_or(&Value::Null))));
        // sale.completed trae la cantidad YA en punto fijo 10⁶ (sales, ADR-0147); ausente = 1 ud.
        m.insert("quantity".into(), it.get("quantity").cloned().unwrap_or(json!(QUANTITY_SCALE)));
        m.insert("unit_price".into(), it.get("unit_price").cloned().unwrap_or(json!(0)));
        m.insert("tax_rate".into(), it.get("tax_rate").cloned().unwrap_or(json!(0)));
        // Categoría fiscal congelada (ADR-0085): traza la categoría en la línea de factura.
        m.insert("tax_category_key".into(), it.get("tax_category_key").cloned().unwrap_or(Value::Null));
        m.insert("product_id".into(), it.get("product_id").cloned().unwrap_or(Value::Null));
        if let (Some(net), Some(tax)) = (it.get("net_amount"), it.get("tax_amount")) {
            m.insert("base_amount".into(), net.clone());
            m.insert("tax_amount".into(), tax.clone());
        }
        Value::Object(m)
    }).collect();
    let mut header = Map::new();
    header.insert("customer_name".into(), payload.get("customer_name").cloned().unwrap_or(json!("")));
    // Snapshot fiscal del cliente asignado en el TPV (ADR-0132). Es una COPIA, no una
    // referencia: editar la ficha del cliente no puede reescribir una factura ya emitida.
    header.insert("customer_tax_id".into(), payload.get("customer_tax_id").cloned().unwrap_or(json!("")));
    header.insert("customer_address".into(), payload.get("customer_address").cloned().unwrap_or(json!("")));
    header.insert("source_type".into(), json!("sale"));
    header.insert("source_id".into(), payload.get("sale_id").cloned().unwrap_or(Value::Null));
    // ADR-0140: el tipo de documento VIAJA en sale.completed. 'invoice' → factura completa F1
    // (serie FACT); 'ticket'/ausente → simplificada F2 (serie TICKET). Antes se hardcodeaba F2, así
    // que una venta cobrada como factura salía como simplificada. La validación "F1 exige NIF" es
    // aguas abajo (verifactu/AEAT); aquí se respeta la elección del operario (ADR-0140 opción A).
    let (series_code, inv_type) = if sor(&payload, "document_type", "ticket") == "invoice" {
        ("FACT", "F1")
    } else {
        ("TICKET", "F2")
    };
    Ok(build_invoice(&new_ids, &now, series_code, Some(inv_type), &Value::Object(header), &items, &fiscal))
}

/// substitute_from_invoice: "el cliente pide factura de un tiquet" (ADR-0140). Emite una F3
/// (factura COMPLETA en SUSTITUCIÓN de la simplificada F2 ya emitida), NUEVA e inmutable, en la
/// serie de facturas completas (FACT), enlazada a la F2 vía `substitutes_invoice_id` y con los
/// datos fiscales del cliente que la pide. La F2 original NO se toca (su estado "sustituida" se
/// deriva de que exista una F3 apuntándola). NO es rectificación: el tiquet era correcto. Los
/// importes son los del tiquet (misma operación) — las líneas llegan del F2 en el payload.
pub fn substitute_from_invoice_pure(input: Value) -> Output {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let (new_ids, now) = ctx_ids(&input);
    let fiscal = FiscalContext::from_input(&input, &now);
    let empty: Vec<Value> = Vec::new();
    // Las líneas llegan YA como líneas de factura del F2 original (description/base_amount/
    // tax_amount/tax_rate/…): build_invoice las RESPETA (D1) y no re-suma IVA sobre el bruto, así
    // los importes de la F3 son IDÉNTICOS a los del tiquet (misma operación, sin inflar la base).
    let items: Vec<Value> = payload.get("items").and_then(|v| v.as_array()).unwrap_or(&empty).clone();
    let original_id = s(payload.get("original_invoice_id").unwrap_or(&Value::Null));

    let mut header = Map::new();
    // Datos fiscales del cliente que PIDE la factura (la F2 simplificada no los llevaba).
    header.insert("customer_name".into(), payload.get("customer_name").cloned().unwrap_or(json!("")));
    header.insert("customer_tax_id".into(), payload.get("customer_tax_id").cloned().unwrap_or(json!("")));
    header.insert("customer_address".into(), payload.get("customer_address").cloned().unwrap_or(json!("")));
    header.insert("description".into(), payload.get("description").cloned().unwrap_or(json!("")));
    // source = substitution del original → idempotencia D2 (1 F3 por F2, sin huecos) + by_source.
    header.insert("source_type".into(), json!("substitution"));
    header.insert("source_id".into(), json!(original_id));
    // Enlace fiscal explícito F3→F2 (ADR-0140): lo lee verifactu para el bloque FacturasSustituidas.
    header.insert("substitutes_invoice_id".into(), json!(original_id));
    // F3 en la serie de facturas COMPLETAS (FACT); comparte numeración con las F1 (legal en ES).
    build_invoice(&new_ids, &now, "FACT", Some("F3"), &Value::Object(header), &items, &fiscal)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inp(payload: Value, ids: usize) -> Value {
        // invoice#52: the MANUAL path refuses an F1 without `customer_tax_id`. The fixtures that
        // run through this helper exercise OTHER contracts (scale, breakdown, audit) while still
        // meaning an ordinary full invoice — so the helper stamps the recipient's tax id unless
        // the payload is a sale/substitution (whose own snapshots rule) or the test builds its
        // own input to talk about the tax id itself (f1_requires_customer_tax_id_tests).
        let mut payload = payload;
        let manual = !payload.as_object().map_or(true, |o| {
            o.contains_key("sale_id") || o.contains_key("original_invoice_id")
        });
        if manual && payload.get("customer_tax_id").is_none() {
            payload
                .as_object_mut()
                .expect("payload is an object")
                .insert("customer_tax_id".into(), json!("B12345678"));
        }
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        // Mimics the `reads` the runtime preloads: when the payload carries a `sale_id`, inject a
        // `sales.get` row (the sale exists), so the from_sale build tests do not trip over the
        // existence check (invoice#8). Tests that need a MISSING sale use `inp_no_sale`, or build
        // the payload without `sale_id`.
        let mut ctx = json!({ "new_ids": new_ids, "now": "2026-05-31T10:00:00+00:00" });
        if payload.get("sale_id").map(|v| !v.is_null()).unwrap_or(false) {
            ctx["reads"] = json!({ "sales.get": [{ "id": payload["sale_id"] }] });
        }
        json!({ "payload": payload, "context": ctx })
    }

    /// Same as `inp` but with an EMPTY `sales.get` (the sale does not exist) — for the rejection
    /// tests. An absent key behaves the same way; empty is the shape the runtime actually produces
    /// when the query runs and matches nothing.
    fn inp_no_sale(payload: Value, ids: usize) -> Value {
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        json!({
            "payload": payload,
            "context": { "new_ids": new_ids, "now": "2026-05-31T10:00:00+00:00",
                         "reads": { "sales.get": [] } }
        })
    }

    // NOTA (ADR-0147, 2026-07-19): las cantidades de estos tests pasaron de lógicas (1, 2) a
    // punto fijo escala 10⁶ (1_000_000, 2_000_000) porque el ADR cambió el contrato del cable
    // y `sales` ya emite escalado. Los importes esperados NO cambian: misma cantidad lógica.
    #[test]
    fn create_invoice_totals_and_ops() {
        let payload = json!({
            "series_code": "FACT", "issuer_nif": "B1", "customer_name": "ACME",
            "items": [
                { "description": "Servicio", "quantity": 1_000_000, "unit_price": 10000, "tax_rate": 21.0 },
                { "description": "Otro", "quantity": 2_000_000, "unit_price": 5000, "tax_rate": 10.0 }
            ]
        });
        let out = create_invoice_pure(inp(payload, 8));
        // ensure + bump + invoice + 2 líneas = 5 ops.
        assert_eq!(out.operations.len(), 5);
        assert_eq!(out.operations[0].command, "invoice._ensure_series");
        assert_eq!(out.operations[1].command, "invoice._bump_series");
        assert_eq!(out.operations[2].command, "invoice._insert_invoice");
        let inv = &out.operations[2].params;
        assert_eq!(inv["invoice_type"], json!("F1"));
        // Céntimos: 100€ + 100€ base = 20000; IVA 21€ + 10€ = 3100; total 23100.
        assert_eq!(inv["base_amount"], json!(20000));
        assert_eq!(inv["tax_amount"], json!(3100));
        assert_eq!(inv["total_amount"], json!(23100));
        assert_eq!(out.operations[3].params["invoice_id"], json!("id-0"));
        assert_eq!(out.events[0].name, "invoice.created");
    }

    #[test]
    fn from_sale_builds_f2_ticket() {
        let payload = json!({
            "sale_id": "sale1", "customer_name": "Bar Manolo",
            "items": [
                { "product_name": "Café", "quantity": 2_000_000, "unit_price": 100, "tax_rate": 21.0, "product_id": "p1" }
            ]
        });
        let out = create_from_sale_pure(inp(payload, 6)).unwrap();
        let inv = &out.operations[2].params;
        assert_eq!(inv["invoice_type"], json!("F2"));
        assert_eq!(inv["series"], json!("TICKET"));
        assert_eq!(inv["source_type"], json!("sale"));
        assert_eq!(inv["source_id"], json!("sale1"));
        // Sin net/tax pre-calculados (compat): cae al cálculo IVA-EXCLUIDO.
        // línea (céntimos): base 2*100=200, tax 21% = 42.
        let line = &out.operations[3].params;
        assert_eq!(line["description"], json!("Café"));
        assert_eq!(line["base_amount"], json!(200));
        assert_eq!(line["tax_amount"], json!(42));
    }

    #[test]
    fn from_sale_respects_tax_included_net_tax() {
        // D1: sale.completed (IVA-INCLUIDO) ya extrajo net/tax. unit_price es el BRUTO
        // (121 céntimos = 1.21€). invoice NO debe re-sumar IVA: usa net=100, tax=21.
        let payload = json!({
            "sale_id": "sale2", "customer_name": "Bar Manolo",
            "items": [
                { "product_name": "Café", "quantity": 1_000_000, "unit_price": 121, "tax_rate": 21.0,
                  "net_amount": 100, "tax_amount": 21, "product_id": "p1" }
            ]
        });
        let out = create_from_sale_pure(inp(payload, 6)).unwrap();
        let line = &out.operations[3].params;
        assert_eq!(line["base_amount"], json!(100)); // base extraída, NO 121
        assert_eq!(line["tax_amount"], json!(21));   // IVA NO re-sumado sobre bruto
        assert_eq!(line["total_amount"], json!(121));
        let inv = &out.operations[2].params;
        assert_eq!(inv["base_amount"], json!(100));
        assert_eq!(inv["tax_amount"], json!(21));
        assert_eq!(inv["total_amount"], json!(121)); // = bruto cobrado, sin inflar
    }

    #[test]
    fn from_sale_carries_customer_fiscal_snapshot() {
        // ADR-0132: una factura emitida desde el TPV con cliente asignado DEBE salir con su
        // NIF y su dirección. Antes se perdían: sale.completed los traía y from_sale solo
        // copiaba customer_name → factura sin NIF (inválida para el cliente que la pide).
        let payload = json!({
            "sale_id": "sale3",
            "customer_name": "Ana García",
            "customer_tax_id": "12345678Z",
            "customer_address": "Calle Mayor 1, 28013 Madrid, ES",
            "items": [
                { "product_name": "Corte", "quantity": 1_000_000, "unit_price": 1500, "tax_rate": 21.0 }
            ]
        });
        let out = create_from_sale_pure(inp(payload, 6)).unwrap();
        let inv = &out.operations[2].params;
        assert_eq!(inv["customer_name"], json!("Ana García"));
        assert_eq!(inv["customer_tax_id"], json!("12345678Z"));
        assert_eq!(inv["customer_address"], json!("Calle Mayor 1, 28013 Madrid, ES"));
    }

    #[test]
    fn from_sale_without_customer_stays_empty() {
        // Venta anónima (el caso normal en barra): sin cliente asignado, los campos fiscales
        // van vacíos — NO se inventan ni se heredan de otra venta.
        let payload = json!({
            "sale_id": "sale4",
            "items": [{ "product_name": "Café", "quantity": 1_000_000, "unit_price": 100, "tax_rate": 21.0 }]
        });
        let out = create_from_sale_pure(inp(payload, 6)).unwrap();
        let inv = &out.operations[2].params;
        assert_eq!(inv["customer_name"], json!(""));
        assert_eq!(inv["customer_tax_id"], json!(""));
        assert_eq!(inv["customer_address"], json!(""));
    }

    #[test]
    fn from_sale_builds_f1_when_document_type_invoice() {
        // ADR-0140: si la venta se cobró como factura completa (`document_type='invoice'`, que
        // ahora VIAJA en sale.completed), invoice emite F1 en la serie FACT — no la F2/TICKET
        // que antes estaba hardcodeada. El NIF del cliente viaja en el snapshot fiscal (ADR-0132).
        let payload = json!({
            "sale_id": "sale5", "document_type": "invoice",
            "customer_name": "ACME SL", "customer_tax_id": "B12345678",
            "items": [{ "product_name": "Servicio", "quantity": 1_000_000, "unit_price": 12100, "tax_rate": 21.0,
                        "net_amount": 10000, "tax_amount": 2100 }]
        });
        let out = create_from_sale_pure(inp(payload, 6)).unwrap();
        let inv = &out.operations[2].params;
        assert_eq!(inv["invoice_type"], json!("F1"), "cobrada como factura → F1");
        assert_eq!(inv["series"], json!("FACT"), "F1 va en la serie FACT, no TICKET");
        assert_eq!(inv["customer_tax_id"], json!("B12345678"));
    }

    #[test]
    fn from_sale_defaults_to_f2_ticket_with_document_type_ticket() {
        // Guardarraíl: con `document_type='ticket'` (o ausente) → simplificada F2/TICKET, el caso
        // mayoritario del TPV. ADR-0140 no cambia el default.
        let payload = json!({
            "sale_id": "sale6", "document_type": "ticket",
            "items": [{ "product_name": "Café", "quantity": 1_000_000, "unit_price": 100, "tax_rate": 21.0 }]
        });
        let out = create_from_sale_pure(inp(payload, 6)).unwrap();
        assert_eq!(out.operations[2].params["invoice_type"], json!("F2"));
        assert_eq!(out.operations[2].params["series"], json!("TICKET"));
    }

    #[test]
    fn substitute_builds_f3_linked_to_original_ticket() {
        // ADR-0140: "el cliente pide factura de un tiquet". Se emite una F3 (factura completa en
        // SUSTITUCIÓN de la F2 simplificada), NUEVA e inmutable, enlazada a la F2 original vía
        // substitutes_invoice_id, con los datos fiscales del cliente. La F2 NO se toca. Los importes
        // son los del tiquet (misma operación); las líneas llegan del F2 en el payload.
        let payload = json!({
            "original_invoice_id": "inv-f2-1",
            "customer_name": "ACME SL",
            "customer_tax_id": "B12345678",
            "customer_address": "Calle Mayor 1, Madrid",
            "items": [
                { "description": "Menú", "quantity": 1_000_000, "unit_price": 121, "tax_rate": 21.0,
                  "base_amount": 100, "tax_amount": 21 }
            ]
        });
        let out = substitute_from_invoice_pure(inp(payload, 6));
        let inv = &out.operations[2].params;
        assert_eq!(inv["invoice_type"], json!("F3"), "sustitución de simplificada → F3");
        assert_eq!(inv["series"], json!("FACT"), "F3 va en la serie de facturas completas");
        assert_eq!(inv["substitutes_invoice_id"], json!("inv-f2-1"), "enlaza a la F2 sustituida");
        assert_eq!(inv["source_type"], json!("substitution"));
        assert_eq!(inv["source_id"], json!("inv-f2-1"), "idempotencia D2: 1 F3 por F2 original");
        assert_eq!(inv["customer_tax_id"], json!("B12345678"), "lleva el NIF de quien pide factura");
        // importes IDÉNTICOS al tiquet (misma operación; net/tax ya extraídos, no se re-suma IVA).
        assert_eq!(inv["base_amount"], json!(100));
        assert_eq!(inv["tax_amount"], json!(21));
        assert_eq!(inv["total_amount"], json!(121));
        assert_eq!(out.events[0].name, "invoice.created");
    }

    #[test]
    fn quantities_travel_and_persist_fixed_point_10e6() {
        // ADR-0147: la cantidad viaja y se PERSISTE como punto fijo entero escala 10⁶.
        // sales ya emite `quantity: 2000000` (= 2 uds) en sale.completed; leerla como «2
        // millones de unidades lógicas» infla la base ×10⁶. El dinero se calcula con la
        // cantidad LÓGICA (raw/10⁶) y la línea guarda el raw ENTERO (nunca el lógico f64).
        let payload = json!({
            "series_code": "FACT",
            "items": [
                { "description": "Vino a granel", "quantity": 500_000, "unit_price": 1200, "tax_rate": 21.0 },
                { "description": "Menú", "quantity": 2_000_000, "unit_price": 5000, "tax_rate": 10.0 }
            ]
        });
        let out = create_invoice_pure(inp(payload, 8));
        // 0,5 × 12,00 € = 6,00 € → 600 céntimos; 2 × 50,00 € = 100,00 € → 10000.
        let l1 = &out.operations[3].params;
        assert_eq!(l1["quantity"], json!(500_000), "la línea persiste el punto fijo, no el lógico");
        assert_eq!(l1["base_amount"], json!(600));
        assert_eq!(l1["tax_amount"], json!(126)); // 21 % de 6,00 €
        let l2 = &out.operations[4].params;
        assert_eq!(l2["quantity"], json!(2_000_000));
        assert_eq!(l2["base_amount"], json!(10000));
        assert_eq!(out.operations[2].params["base_amount"], json!(10600));
    }

    #[test]
    fn from_sale_missing_quantity_defaults_to_one_unit_in_scale() {
        // Compat: un evento sin `quantity` significa «1 unidad» — en escala, 1_000_000, no 1.
        let payload = json!({
            "sale_id": "sale8",
            "items": [{ "product_name": "Café", "unit_price": 100, "tax_rate": 21.0 }]
        });
        let out = create_from_sale_pure(inp(payload, 6)).unwrap();
        let line = &out.operations[3].params;
        assert_eq!(line["quantity"], json!(1_000_000));
        assert_eq!(line["base_amount"], json!(100), "1 ud × 1,00 €");
    }

    #[test]
    fn normal_invoice_has_empty_substitution_link() {
        // Guardarraíl: una emisión normal (no sustitución) no lleva enlace (queda "" → NULL en BD).
        let payload = json!({
            "sale_id": "sale7",
            "items": [{ "product_name": "Café", "quantity": 1_000_000, "unit_price": 100, "tax_rate": 21.0 }]
        });
        let out = create_from_sale_pure(inp(payload, 6)).unwrap();
        assert_eq!(out.operations[2].params["substitutes_invoice_id"], json!(""));
    }

    /// invoice#8 (hub#108): a nonexistent sale (empty read) must be REJECTED, not turned into a
    /// zero invoice that burns a fiscal number.
    #[test]
    fn from_sale_rejects_nonexistent_sale_id() {
        let payload = json!({ "sale_id": "__missing_sale__", "customer_name": "X", "items": [] });
        let err = create_from_sale_pure(inp_no_sale(payload, 6)).unwrap_err();
        assert!(err.starts_with("sale_not_found:"), "expected a rejection, got: {err}");
    }

    /// invoice#8: the rejection is not a silent no-op — it must NOT produce any operation (no
    /// invoice row, no line, no series bump), which is what makes the whole command roll back.
    #[test]
    fn from_sale_rejection_persists_nothing() {
        let payload = json!({
            "sale_id": "__missing_sale__",
            "items": [{ "product_name": "Café", "quantity": 1_000_000, "unit_price": 100, "tax_rate": 21.0 }]
        });
        assert!(
            create_from_sale_pure(inp_no_sale(payload, 6)).is_err(),
            "a missing sale must not yield an Output with operations"
        );
    }

    /// invoice#8: without `sale_id` nothing is validated (manual/other origins do not require it).
    #[test]
    fn from_sale_without_sale_id_does_not_reject() {
        let payload = json!({ "customer_name": "X", "items": [] });
        assert!(create_from_sale_pure(inp(payload, 6)).is_ok());
    }

    // ── El desglose deja de ser «por tipo» y pasa a ser «por clave fiscal» (hub#292) ──────
    //
    // El `tax_breakdown` de la factura es el contrato con el módulo de compliance: de ahí sale,
    // verbatim, el `<Desglose>` del registro que se manda a Hacienda. Mientras la clave fue el
    // TIPO, ese registro solo sabía decir una cosa —venta nacional sujeta y no exenta— porque no
    // había dónde poner nada más. Ahora la clave es la clave fiscal COMPLETA: qué impuesto, bajo
    // qué régimen, con qué calificación y a qué tipo.
    //
    // La forma cambia de objeto a ARRAY, y eso es deliberado: distingue las dos generaciones sin
    // ambigüedad, y sobre todo deja de colisionar. Con el objeto, una prestación exenta y un
    // artículo al 0 % compartían la clave `"0.00"` y se fundían en una sola línea que declaraba
    // mal las dos.

    /// Igual que `inp`, pero con el catálogo de reglas fiscales pre-cargado por el runtime y la
    /// identidad fiscal del hub en el contexto (lo que hace el keystone de ADR-0085).
    fn inp_rules(payload: Value, ids: usize, rules: Value, region: &str) -> Value {
        let mut input = inp(payload, ids);
        let ctx = input["context"].as_object_mut().unwrap();
        ctx.insert("country_code".into(), json!("ES"));
        ctx.insert("region_code".into(), json!(region));
        // MERGE into the reads map, never replace it: `inp` may already have injected the
        // `sales.get` row that makes a `create_from_sale` payload valid (invoice#8). Overwriting
        // the whole map would silently turn every from_sale breakdown test into a `sale_not_found`
        // rejection.
        if !ctx.contains_key("reads") {
            ctx.insert("reads".into(), json!({}));
        }
        ctx["reads"]
            .as_object_mut()
            .expect("reads is an object")
            .insert("taxes.rules.list".into(), rules);
        input
    }

    /// El `tax_breakdown` de la cabecera, ya parseado como array.
    fn desglose(out: &Output) -> Vec<Value> {
        let tb = out.operations[2].params["tax_breakdown"].as_str().expect("string");
        serde_json::from_str::<Value>(tb)
            .expect("tax_breakdown es JSON")
            .as_array()
            .expect("tax_breakdown es un ARRAY (una entrada por clave fiscal)")
            .clone()
    }

    /// Sin catálogo de reglas —factura manual de un hub que no lo tiene, o un caller antiguo— el
    /// desglose sigue diciendo exactamente lo que decía: venta nacional, régimen general, sujeta y
    /// no exenta. Cambia la FORMA, no el significado ni los importes.
    #[test]
    fn sin_catalogo_el_desglose_sigue_siendo_venta_nacional_sujeta() {
        let payload = json!({
            "series_code": "FACT",
            "items": [{ "description": "Servicio", "quantity": 1_000_000, "unit_price": 10000, "tax_rate": 21.0 }]
        });
        let out = create_invoice_pure(inp(payload, 8));
        let d = desglose(&out);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["tax"], json!("vat"));
        assert_eq!(d[0]["regime"], json!("01"));
        assert_eq!(d[0]["class"], json!("subject"));
        assert_eq!(d[0]["rate"], json!(21.0));
        assert_eq!(d[0]["base"], json!(10000));
        assert_eq!(d[0]["quota"], json!(2100));
        // Los totales de cabecera no se mueven: son los que alimentan la huella fiscal.
        let inv = &out.operations[2].params;
        assert_eq!(inv["base_amount"], json!(10000));
        assert_eq!(inv["tax_amount"], json!(2100));
    }

    /// El ticket de bar: una caña al 21 % y una tapa al 10 %. Dos claves fiscales, dos entradas.
    #[test]
    fn un_ticket_mixto_produce_una_entrada_por_tipo() {
        let payload = json!({
            "series_code": "FACT",
            "items": [
                { "description": "Caña", "quantity": 1_000_000, "unit_price": 1000, "tax_rate": 21.0 },
                { "description": "Tapa", "quantity": 1_000_000, "unit_price": 500, "tax_rate": 10.0 }
            ]
        });
        let d = desglose(&create_invoice_pure(inp(payload, 8)));
        assert_eq!(d.len(), 2);
        let rates: Vec<f64> = d.iter().map(|e| e["rate"].as_f64().unwrap()).collect();
        assert!(rates.contains(&21.0) && rates.contains(&10.0), "{d:?}");
    }

    /// Un servicio EXENTO no es «sujeto al 0 %»: la calificación sale de la regla fiscal, con su
    /// causa. Es el caso del vertical de estética (tratamiento sanitario, art. 20 de la Ley del IVA).
    #[test]
    fn un_servicio_exento_lleva_su_calificacion_y_su_causa() {
        let rules = json!([
            { "id": "r-health", "country_code": "ES", "region_code": null,
              "tax_category_key": "service.health", "rate_pct": 0.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1,
              "operation_class": "exempt", "exempt_reason": "E1", "regime_key": "01" }
        ]);
        let payload = json!({
            "series_code": "FACT",
            "items": [{ "description": "Tratamiento", "quantity": 1_000_000, "unit_price": 5000,
                        "tax_rate": 0.0, "tax_category_key": "service.health" }]
        });
        let d = desglose(&create_invoice_pure(inp_rules(payload, 8, rules, "")));
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["class"], json!("exempt"));
        assert_eq!(d[0]["exempt_reason"], json!("E1"));
        assert_eq!(d[0]["quota"], json!(0));
        assert_eq!(d[0]["base"], json!(5000));
    }

    /// Un hub canario repercute IGIC, no IVA. El impuesto sale de la regla que resuelve por región.
    #[test]
    fn un_hub_canario_declara_igic() {
        let rules = json!([
            { "id": "r-es", "country_code": "ES", "region_code": null,
              "tax_category_key": "product.generic", "rate_pct": 21.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1 },
            { "id": "r-ic", "country_code": "ES", "region_code": "IC",
              "tax_category_key": "product.generic", "rate_pct": 7.0, "tax_type": "igic",
              "parent_id": null, "is_active": 1, "regime_key": "01" }
        ]);
        let payload = json!({
            "series_code": "FACT",
            "items": [{ "description": "Producto", "quantity": 1_000_000, "unit_price": 10000,
                        "tax_rate": 7.0, "tax_category_key": "product.generic" }]
        });
        let d = desglose(&create_invoice_pure(inp_rules(payload, 8, rules, "IC")));
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["tax"], json!("igic"));
        assert_eq!(d[0]["rate"], json!(7.0));
        assert_eq!(d[0]["quota"], json!(700));
    }

    /// El RECARGO DE EQUIVALENCIA es un componente de la regla del IVA: aporta cuota sobre la
    /// misma base, pero **no es otra línea del desglose**. Antes se le daba su propia clave y
    /// acababa declarándose como un `TipoImpositivo` del 5,20 %, que no existe en el IVA español.
    #[test]
    fn el_recargo_de_equivalencia_va_dentro_de_la_linea_del_iva() {
        let rules = json!([
            { "id": "r-21", "country_code": "ES", "region_code": null,
              "tax_category_key": "product.generic", "rate_pct": 21.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "regime_key": "01" },
            { "id": "r-21-re", "country_code": "ES", "region_code": null,
              "tax_category_key": "product.generic", "rate_pct": 5.2, "tax_type": "surcharge",
              "parent_id": "r-21", "is_active": 1, "component_label": "Recargo de equivalencia" }
        ]);
        // La venta llega con la tasa COMBINADA (26,2 %) y la cuota total ya calculada — es lo que
        // `sales` emite. invoice tiene que volver a separarlas para declararlas.
        let payload = json!({
            "series_code": "FACT",
            "items": [{ "description": "Producto", "quantity": 1_000_000, "unit_price": 10000,
                        "tax_rate": 26.2, "tax_category_key": "product.generic",
                        "base_amount": 10000, "tax_amount": 2620 }]
        });
        let out = create_invoice_pure(inp_rules(payload, 8, rules, ""));
        let d = desglose(&out);
        assert_eq!(d.len(), 1, "una línea, no dos: {d:?}");
        assert_eq!(d[0]["rate"], json!(21.0), "el tipo declarado es el del IVA, no el combinado");
        assert_eq!(d[0]["quota"], json!(2100));
        assert_eq!(d[0]["surcharge_rate"], json!(5.2));
        assert_eq!(d[0]["surcharge_quota"], json!(520));
        // Y el total no se mueve ni un céntimo: 2100 + 520 = 2620, lo que cobró la venta.
        assert_eq!(out.operations[2].params["tax_amount"], json!(2620));
    }

    /// La colisión que el objeto no sabía evitar: una prestación EXENTA y un artículo al 0 %
    /// compartían la clave `"0.00"` y se fundían en una línea que declaraba mal las dos.
    #[test]
    fn una_exenta_y_un_cero_por_ciento_no_se_funden() {
        let rules = json!([
            { "id": "r-health", "country_code": "ES", "region_code": null,
              "tax_category_key": "service.health", "rate_pct": 0.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "operation_class": "exempt",
              "exempt_reason": "E1", "regime_key": "01" },
            { "id": "r-zero", "country_code": "ES", "region_code": null,
              "tax_category_key": "product.generic", "rate_pct": 0.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "regime_key": "01" }
        ]);
        let payload = json!({
            "series_code": "FACT",
            "items": [
                { "description": "Tratamiento", "quantity": 1_000_000, "unit_price": 5000,
                  "tax_rate": 0.0, "tax_category_key": "service.health" },
                { "description": "Mascarilla", "quantity": 1_000_000, "unit_price": 1000,
                  "tax_rate": 0.0, "tax_category_key": "product.generic" }
            ]
        });
        let d = desglose(&create_invoice_pure(inp_rules(payload, 8, rules, "")));
        assert_eq!(d.len(), 2, "misma tasa, distinta calificación → dos líneas: {d:?}");
        let exenta = d.iter().find(|e| e["class"] == json!("exempt")).expect("la exenta");
        let sujeta = d.iter().find(|e| e["class"] == json!("subject")).expect("la sujeta al 0 %");
        assert_eq!(exenta["base"], json!(5000));
        assert_eq!(sujeta["base"], json!(1000));
    }

    /// Dos líneas de la MISMA clave fiscal sí se agregan: el desglose de la AEAT es por clave, no
    /// por artículo (y está limitado a 12 líneas).
    #[test]
    fn dos_lineas_de_la_misma_clave_fiscal_se_agregan() {
        let payload = json!({
            "series_code": "FACT",
            "items": [
                { "description": "Uno", "quantity": 1_000_000, "unit_price": 1000, "tax_rate": 21.0 },
                { "description": "Otro", "quantity": 1_000_000, "unit_price": 2000, "tax_rate": 21.0 }
            ]
        });
        let d = desglose(&create_invoice_pure(inp(payload, 8)));
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["base"], json!(3000));
        assert_eq!(d[0]["quota"], json!(630));
    }

    /// La venta desde el TPV (`create_from_sale`) va por el mismo camino: la categoría fiscal de la
    /// línea viaja en `sale.completed` y es la que resuelve la calificación.
    #[test]
    fn from_sale_tambien_califica_por_categoria() {
        let rules = json!([
            { "id": "r-health", "country_code": "ES", "region_code": null,
              "tax_category_key": "service.health", "rate_pct": 0.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "operation_class": "exempt",
              "exempt_reason": "E1", "regime_key": "01" }
        ]);
        let payload = json!({
            "sale_id": "sale-h",
            "items": [{ "product_name": "Tratamiento", "quantity": 1_000_000, "unit_price": 5000,
                        "tax_rate": 0.0, "tax_category_key": "service.health",
                        "net_amount": 5000, "tax_amount": 0 }]
        });
        let d = desglose(&create_from_sale_pure(inp_rules(payload, 6, rules, "")).unwrap());
        assert_eq!(d[0]["class"], json!("exempt"));
        assert_eq!(d[0]["exempt_reason"], json!("E1"));
    }

    // ── invoice#27: the charged amount and the declared qualification come from ONE resolution ──
    //
    // The MANUAL path of `invoice.create` used to trust the caller's `tax_rate` while the fiscal
    // key came from the resolved rule. An exempt category sent with `tax_rate: 21` charged 21 % and
    // declared `exempt` with no quota — and `CuotaTotal` stopped matching the sum of the quotas
    // declared, the cross-check the AEAT performs. ADR-0223 (single source): when a rule resolves,
    // ITS rate is what is charged; the caller's `tax_rate` is only a hint for lines without a rule.

    fn manual_line(cat: &str, rate: f64) -> Value {
        json!({
            "series_code": "FACT",
            "items": [{ "description": "Line", "quantity": 1_000_000, "unit_price": 10000,
                        "tax_rate": rate, "tax_category_key": cat }]
        })
    }

    fn quotas_add_up(out: &Output) {
        let inv = &out.operations[2].params;
        let declared: i64 = desglose(out)
            .iter()
            .map(|e| e["quota"].as_i64().unwrap_or(0) + e["surcharge_quota"].as_i64().unwrap_or(0))
            .sum();
        assert_eq!(inv["tax_amount"].as_i64().unwrap(), declared, "CuotaTotal must equal the sum of the declared quotas");
    }

    #[test]
    fn an_exempt_category_sent_with_21_percent_charges_nothing_and_declares_exempt() {
        let rules = json!([
            { "id": "r-health", "country_code": "ES", "region_code": null,
              "tax_category_key": "service.health", "rate_pct": 0.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "operation_class": "exempt",
              "exempt_reason": "E1", "regime_key": "01" }
        ]);
        let out = create_invoice_pure(inp_rules(manual_line("service.health", 21.0), 8, rules, ""));
        let d = desglose(&out);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["class"], json!("exempt"));
        assert_eq!(d[0]["rate"], json!(0.0));
        assert_eq!(d[0]["quota"], json!(0));
        // What was CHARGED follows the rule, not the caller's hint.
        assert_eq!(out.operations[2].params["tax_amount"], json!(0));
        assert_eq!(out.operations[2].params["total_amount"], json!(10000));
        let line = &out.operations[3].params;
        assert_eq!(line["tax_rate"], json!(0.0), "the persisted line rate is the applied one");
        assert_eq!(line["tax_amount"], json!(0));
        quotas_add_up(&out);
    }

    #[test]
    fn a_reduced_category_sent_with_the_standard_rate_charges_the_reduced_one() {
        let rules = json!([
            { "id": "r-10", "country_code": "ES", "region_code": null,
              "tax_category_key": "food.restaurant", "rate_pct": 10.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "regime_key": "01" }
        ]);
        let out = create_invoice_pure(inp_rules(manual_line("food.restaurant", 21.0), 8, rules, ""));
        let d = desglose(&out);
        assert_eq!(d[0]["rate"], json!(10.0));
        assert_eq!(d[0]["quota"], json!(1000));
        assert_eq!(out.operations[2].params["tax_amount"], json!(1000));
        assert_eq!(out.operations[3].params["tax_rate"], json!(10.0));
        quotas_add_up(&out);
    }

    #[test]
    fn a_manual_line_under_equivalence_surcharge_charges_the_combined_rate_from_the_rule() {
        let rules = json!([
            { "id": "r-21", "country_code": "ES", "region_code": null,
              "tax_category_key": "product.generic", "rate_pct": 21.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "regime_key": "01" },
            { "id": "r-21-re", "country_code": "ES", "region_code": null,
              "tax_category_key": "product.generic", "rate_pct": 5.2, "tax_type": "surcharge",
              "parent_id": "r-21", "is_active": 1, "component_label": "Recargo de equivalencia" }
        ]);
        // The caller sends the bare 21: the surcharge is a component of the rule, so it is charged too.
        let out = create_invoice_pure(inp_rules(manual_line("product.generic", 21.0), 8, rules, ""));
        let d = desglose(&out);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["rate"], json!(21.0));
        assert_eq!(d[0]["quota"], json!(2100));
        assert_eq!(d[0]["surcharge_quota"], json!(520));
        assert_eq!(out.operations[2].params["tax_amount"], json!(2620));
        // invoice#21: the LINE freezes the main rate and the surcharge apart — 26.2 is a sum, not a rate.
        assert_eq!(out.operations[3].params["tax_rate"], json!(21.0));
        assert_eq!(out.operations[3].params["surcharge_rate"], json!(5.2));
        quotas_add_up(&out);
    }

    // ── invoice#21: the line stores the main rate + `surcharge_rate`, never the combined sum ──
    //
    // The breakdown already separated 21 / 5.2 (ADR-0186) but `invoice_invoiceitem.tax_rate` kept
    // the combined 26.2 that arrives from the sale. 26.2 is not a rate that exists; any consumer
    // grouping by `line.tax_rate` reproduced the bug the breakdown had fixed. Lines issued before
    // this change carry `surcharge_rate = NULL` (legacy generation: `tax_rate` MAY be a sum); new
    // lines always carry a non-null `surcharge_rate` (0 when there is none) — that is how a reader
    // tells the two generations apart without rewriting a frozen fiscal row.

    fn surcharge_rules() -> Value {
        json!([
            { "id": "r-21", "country_code": "ES", "region_code": null,
              "tax_category_key": "product.generic", "rate_pct": 21.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "regime_key": "01" },
            { "id": "r-21-re", "country_code": "ES", "region_code": null,
              "tax_category_key": "product.generic", "rate_pct": 5.2, "tax_type": "surcharge",
              "parent_id": "r-21", "is_active": 1, "component_label": "Recargo de equivalencia" }
        ])
    }

    #[test]
    fn a_line_from_a_sale_under_surcharge_persists_the_main_rate_and_the_surcharge_apart() {
        // `sales` sends the combined 26.2 and the total quota (D1 contract). The breakdown splits
        // them; the LINE must persist the same split, not the sum.
        let payload = json!({
            "series_code": "FACT",
            "items": [{ "description": "Producto", "quantity": 1_000_000, "unit_price": 10000,
                        "tax_rate": 26.2, "tax_category_key": "product.generic",
                        "base_amount": 10000, "tax_amount": 2620 }]
        });
        let out = create_invoice_pure(inp_rules(payload, 8, surcharge_rules(), ""));
        let line = &out.operations[3].params;
        assert_eq!(line["tax_rate"], json!(21.0), "the line rate is the MAIN tax rate");
        assert_eq!(line["surcharge_rate"], json!(5.2), "the surcharge has its own column");
        assert_eq!(line["tax_amount"], json!(2620), "the charged quota does not move");
        quotas_add_up(&out);
    }

    #[test]
    fn a_line_without_surcharge_persists_surcharge_rate_zero_not_null() {
        // A non-null `surcharge_rate` is the marker of the new generation: NULL = legacy row whose
        // `tax_rate` may still be a combined sum.
        let out = create_invoice_pure(inp(
            json!({ "series_code": "FACT",
                    "items": [{ "description": "Servicio", "quantity": 1_000_000, "unit_price": 10000, "tax_rate": 21.0 }] }),
            8,
        ));
        let line = &out.operations[3].params;
        assert_eq!(line["tax_rate"], json!(21.0));
        assert_eq!(line["surcharge_rate"], json!(0.0));
    }

    #[test]
    fn a_new_generation_line_replayed_without_a_catalog_keeps_its_surcharge() {
        // F3 substitution (ADR-0140) replays the F2 lines as items. A new-generation line carries
        // `tax_rate: 21` + `surcharge_rate: 5.2`; without a catalog the fallback must NOT drop the
        // surcharge from the declaration (that would declare 21 % over a quota of 26.2 %).
        let payload = json!({
            "series_code": "FACT",
            "items": [{ "description": "Producto", "quantity": 1_000_000, "unit_price": 10000,
                        "tax_rate": 21.0, "surcharge_rate": 5.2,
                        "base_amount": 10000, "tax_amount": 2620 }]
        });
        let out = create_invoice_pure(inp(payload, 8));
        let d = desglose(&out);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["rate"], json!(21.0));
        assert_eq!(d[0]["surcharge_rate"], json!(5.2));
        assert_eq!(d[0]["quota"], json!(2100));
        assert_eq!(d[0]["surcharge_quota"], json!(520));
        let line = &out.operations[3].params;
        assert_eq!(line["tax_rate"], json!(21.0));
        assert_eq!(line["surcharge_rate"], json!(5.2));
        quotas_add_up(&out);
    }

    #[test]
    fn without_a_rule_the_caller_rate_is_still_honoured() {
        // No catalog: the hint is all there is (unchanged behaviour, national subject sale).
        let out = create_invoice_pure(inp(manual_line("service.health", 21.0), 8));
        assert_eq!(out.operations[2].params["tax_amount"], json!(2100));
        assert_eq!(desglose(&out)[0]["rate"], json!(21.0));
        quotas_add_up(&out);
    }

    /// El orden del array no puede depender del orden de las líneas de la factura: el XML que sale
    /// de aquí tiene que ser estable entre ejecuciones.
    #[test]
    fn el_orden_del_desglose_es_estable() {
        let items = |a: f64, b: f64| {
            json!({
                "series_code": "FACT",
                "items": [
                    { "description": "A", "quantity": 1_000_000, "unit_price": 1000, "tax_rate": a },
                    { "description": "B", "quantity": 1_000_000, "unit_price": 1000, "tax_rate": b }
                ]
            })
        };
        let d1 = desglose(&create_invoice_pure(inp(items(10.0, 21.0), 8)));
        let d2 = desglose(&create_invoice_pure(inp(items(21.0, 10.0), 8)));
        let rates = |d: &[Value]| d.iter().map(|e| e["rate"].as_f64().unwrap()).collect::<Vec<_>>();
        assert_eq!(rates(&d1), rates(&d2));
        assert_eq!(rates(&d1), vec![21.0, 10.0], "tipo descendente");
    }

    // ── El contrato COMPARTIDO de la regla (hub#295) ──────────────────────────
    //
    // The same fixture is replayed by `taxes` (the `taxes.calculate` contract) and by `sales`
    // (what the customer is CHARGED). The three entry points resolve it through
    // `erplora_guest_sdk::tax`, so what is charged there and what is DECLARED here cannot drift
    // apart any more — which is the whole failure mode: a ticket that says 21 % and a fiscal
    // record that says something else.

    /// The catalog the three entry points share in their tests (hub#295).
    fn shared_fixture_rules() -> Value {
        json!([
            {"id": "es-vat-21", "country_code": "ES", "region_code": null, "tax_category_key": "standard",
             "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "valid_from": "2012-09-01"},
            {"id": "es-vat-21-surcharge", "parent_id": "es-vat-21", "country_code": "ES", "region_code": null,
             "tax_category_key": "standard", "rate_pct": 5.2, "tax_type": "surcharge"},
            {"id": "es-cn-igic-7", "country_code": "ES", "region_code": "CN", "tax_category_key": "standard",
             "rate_pct": 7.0, "tax_type": "IGIC", "parent_id": null},
            {"id": "es-vat-10", "country_code": "ES", "region_code": null, "tax_category_key": "restaurant.food",
             "rate_pct": 10.0, "tax_type": "vat", "parent_id": null},
            {"id": "es-exempt-health", "country_code": "ES", "region_code": null,
             "tax_category_key": "health.treatment", "rate_pct": 0.0, "tax_type": "vat", "parent_id": null,
             "operation_class": "exempt", "exempt_reason": "e1"},
            {"id": "es-broken-class", "country_code": "ES", "region_code": null,
             "tax_category_key": "broken.class", "rate_pct": 21.0, "tax_type": "vat", "parent_id": null,
             "operation_class": "exent"}
        ])
    }

    /// Declares one 100,00 € net line of `category` in `region` against the shared fixture and
    /// returns its single breakdown entry.
    fn shared_declaration(category: &str, region: &str, rate_hint: f64) -> Value {
        let payload = json!({
            "series_code": "FACT",
            "items": [{ "description": "Item", "quantity": 1_000_000, "unit_price": 10000,
                        "tax_rate": rate_hint, "tax_category_key": category }]
        });
        let d = desglose(&create_invoice_pure(inp_rules(payload, 8, shared_fixture_rules(), region)));
        assert_eq!(d.len(), 1, "one fiscal key per scenario: {d:?}");
        d[0].clone()
    }

    #[test]
    fn the_shared_fixture_declares_what_the_other_entry_points_charge() {
        let peninsula = shared_declaration("standard", "", 26.2);
        assert_eq!(peninsula["tax"], json!("vat"));
        assert_eq!(peninsula["rate"], json!(21.0), "the DECLARED rate is the root's, not 26.2");
        assert_eq!(peninsula["surcharge_rate"], json!(5.2));
        assert_eq!(peninsula["class"], json!("subject"));

        let canaries = shared_declaration("standard", "CN", 7.0);
        assert_eq!(canaries["tax"], json!("igic"));
        assert_eq!(canaries["rate"], json!(7.0));

        let reduced = shared_declaration("restaurant.food", "", 10.0);
        assert_eq!(reduced["rate"], json!(10.0));

        let exempt = shared_declaration("health.treatment", "", 0.0);
        assert_eq!(exempt["class"], json!("exempt"));
        assert_eq!(exempt["exempt_reason"], json!("E1"), "the reason is normalised, not copied");
        assert_eq!(exempt["quota"], json!(0));
    }

    #[test]
    fn a_qualification_that_does_not_exist_is_never_declared() {
        // THE divergence hub#295 is about. `taxes` clamped anything outside the closed list to
        // `subject`; this module only defaulted the EMPTY value and copied any other string
        // verbatim into the breakdown. A typo in one rule row meant charging a plain domestic
        // sale and declaring a class the tax authority does not know — and the rejection arrives
        // with the invoice number already spent in the chain.
        let broken = shared_declaration("broken.class", "", 21.0);
        assert_eq!(broken["class"], json!("subject"));
        assert_eq!(broken["rate"], json!(21.0));
    }

    #[test]
    fn a_rule_catalog_delivered_under_the_alias_read_is_honoured() {
        // `taxes.rules.by_country` is a real query of the `taxes` module and `taxes.calculate`
        // read it. This module only looked at `taxes.rules.list`, so the same pre-load left the
        // invoice declaring a plain domestic sale from the line's frozen rate.
        let payload = json!({
            "series_code": "FACT",
            "items": [{ "description": "Item", "quantity": 1_000_000, "unit_price": 10000,
                        "tax_rate": 21.0, "tax_category_key": "standard" }]
        });
        let mut input = inp_rules(payload, 8, json!([]), "CN");
        input["context"]["reads"] =
            json!({ "taxes.rules.by_country": shared_fixture_rules() });
        let d = desglose(&create_invoice_pure(input));
        assert_eq!(d[0]["tax"], json!("igic"));
        assert_eq!(d[0]["rate"], json!(7.0));
    }
}

#[cfg(test)]
mod quantity_scale_tests {
    //! invoice#49 — a `quantity` sent in UNITS must never be sealed as a zero-euro invoice.
    //!
    //! Quantities travel as fixed-point integers, scale 10⁶ (ADR-0147): `2` is 0,000002 units, not
    //! two. Read that way, «2 coffees at 3,30 €» is 0,00066 cents, which rounds to 0 — and the
    //! invoice was issued, numbered and chained in VeriFactu with base, quota and total at zero.
    //! A fiscal document already issued is not deleted (ADR-0331), so the mistake is irreversible
    //! for the business that makes it.
    use super::*;

    fn manual(items: Value, ids: usize) -> Value {
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        json!({
            "payload": { "customer_name": "Cliente QA", "customer_tax_id": "B12345678", "items": items },
            "context": { "new_ids": new_ids, "now": "2026-05-31T10:00:00+00:00" }
        })
    }

    #[test]
    fn a_quantity_sent_in_units_is_refused_instead_of_sealing_a_zero_euro_invoice() {
        let out = create_invoice_pure(manual(
            json!([{ "description": "Cafe con leche", "quantity": 2, "unit_price": 330, "tax_rate": 21.0 }]),
            6,
        ));
        let err = out.error.as_ref().expect("2 µ-units × 3,30 € rounds to 0,00 € — it must be refused");
        assert_eq!(err.code, "invoice.line_amount_underflow");
        assert!(
            err.message.contains("1000000"),
            "the refusal has to name the scale so the caller can fix the payload: {}",
            err.message
        );
        assert!(
            out.operations.is_empty() && out.events.is_empty(),
            "a refused invoice writes nothing: no series bump, no number, no `invoice.created`"
        );
    }

    #[test]
    fn a_fraction_of_a_unit_is_still_invoiceable() {
        // Guard-rail of the guard: 0,5 units of a 12,00 € wine is 6,00 € and stays legal.
        let out = create_invoice_pure(manual(
            json!([{ "description": "Vino a granel", "quantity": 500_000, "unit_price": 1200, "tax_rate": 21.0 }]),
            6,
        ));
        assert!(out.error.is_none(), "0,5 units is a real quantity: {:?}", out.error);
        assert_eq!(out.operations[2].params["base_amount"], json!(600));
    }

    #[test]
    fn a_line_given_away_for_free_is_not_an_underflow() {
        // A 0,00 € line (a gift/comp coming from the till) prices to zero HONESTLY — there is no
        // scale mistake to catch, and refusing it would break the invoice of a comped sale.
        let out = create_invoice_pure(manual(
            json!([
                { "description": "Invitacion", "quantity": 1_000_000, "unit_price": 0, "tax_rate": 21.0 },
                { "description": "Cafe", "quantity": 1_000_000, "unit_price": 330, "tax_rate": 21.0 }
            ]),
            8,
        ));
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(out.operations[2].params["base_amount"], json!(330));
    }

    #[test]
    fn the_refusal_names_the_line_that_is_wrong() {
        let out = create_invoice_pure(manual(
            json!([
                { "description": "Cafe", "quantity": 1_000_000, "unit_price": 330, "tax_rate": 21.0 },
                { "description": "Tostada", "quantity": 3, "unit_price": 250, "tax_rate": 21.0 }
            ]),
            8,
        ));
        let err = out.error.as_ref().expect("the second line underflows");
        assert!(err.message.contains("Tostada"), "the caller has to know WHICH line: {}", err.message);
    }

    #[test]
    fn a_replayed_sale_that_carries_its_own_amounts_is_not_judged_by_this_guard() {
        // `create_from_sale`/`substitute` hand over base/tax ALREADY extracted (contract D1): those
        // lines are not priced here, so this guard does not apply to them. What checks THOSE is the
        // arithmetic audit (invoice#50).
        let new_ids: Vec<Value> = (0..6).map(|i| json!(format!("id-{i}"))).collect();
        let input = json!({
            "payload": { "sale_id": "sale-1", "items": [
                { "product_name": "Cafe", "quantity": 1_000_000, "unit_price": 100, "tax_rate": 21.0,
                  "net_amount": 83, "tax_amount": 17 }
            ]},
            "context": { "new_ids": new_ids, "now": "2026-05-31T10:00:00+00:00",
                         "reads": { "sales.get": [{ "id": "sale-1" }] } }
        });
        let out = create_from_sale_pure(input).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
    }
}

#[cfg(test)]
mod arithmetic_audit_tests {
    //! invoice#50 — nobody checked the arithmetic before sealing the document.
    //!
    //! `invoice.create` stamped the base and the quota it was given: not against the lines
    //! (`quantity × unit_price`), not against the rate it declares in its own breakdown row, not
    //! against the tax engine it already has in front of it. Whatever mismatch came from upstream
    //! entered the fiscal document intact and, from there, the VeriFactu record — which copies the
    //! amounts verbatim and validates the hash CHAIN, not the arithmetic it chains.
    //!
    //! Same principle `sales` already applies (the client proposes, the server disposes) and the
    //! one invoice#27 applied to the RATE: the number that goes into the document is the one the
    //! server works out, and what cannot be worked out here is at least checked before sealing.
    use super::*;

    fn manual(items: Value, ids: usize) -> Value {
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        json!({
            "payload": { "customer_name": "QA", "customer_tax_id": "B12345678", "items": items },
            "context": { "new_ids": new_ids, "now": "2026-05-31T10:00:00+00:00" }
        })
    }

    /// A `sale.completed` payload whose lines already carry base/quota (contract D1).
    fn from_sale(items: Value, ids: usize) -> Value {
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        json!({
            "payload": { "sale_id": "sale-1", "items": items },
            "context": { "new_ids": new_ids, "now": "2026-05-31T10:00:00+00:00",
                         "reads": { "sales.get": [{ "id": "sale-1" }] } }
        })
    }

    fn header(out: &Output) -> &Map<String, Value> {
        &out.operations[2].params
    }

    // ── The manual path: the server disposes ────────────────────────────────────────────────

    #[test]
    fn case_a_the_amounts_the_caller_sends_are_not_what_gets_sealed() {
        // invoice#50 case A — the sales#124 mismatch, inherited verbatim: a 6,60 € line sealed as
        // base 5,45 + quota 1,14 = 6,59 €. The caller does not get to say what the line costs.
        let out = create_invoice_pure(manual(
            json!([{ "description": "x", "quantity": 1_000_000, "unit_price": 660, "tax_rate": 21,
                     "base_amount": 545, "tax_amount": 114 }]),
            6,
        ));
        assert!(out.error.is_none(), "a payload with forged amounts is not refused, it is DISPOSED: {:?}", out.error);
        let h = header(&out);
        assert_eq!(h["base_amount"], json!(660), "the base is the server's: 1 × 6,60 €");
        assert_eq!(h["tax_amount"], json!(139), "the quota is the server's: 21 % of 6,60 €");
        assert_eq!(h["total_amount"], json!(799));
        assert_eq!(out.operations[3].params["base_amount"], json!(660), "the LINE stops carrying the forged base too");
    }

    #[test]
    fn case_c_a_quota_the_rate_cannot_justify_never_reaches_the_document() {
        // 99,99 € of quota on a base of 5,45 € with `rate: 21.0` in the very same breakdown row.
        let out = create_invoice_pure(manual(
            json!([{ "description": "x", "quantity": 1_000_000, "unit_price": 660, "tax_rate": 21,
                     "base_amount": 545, "tax_amount": 9999 }]),
            6,
        ));
        assert_eq!(header(&out)["tax_amount"], json!(139), "9999 is not a quota anybody can declare");
    }

    // ── The paths where the amounts DO come from outside: they get audited ───────────────────

    #[test]
    fn a_quota_that_does_not_match_its_declared_rate_is_refused() {
        // `create_from_sale`/`substitute` hand over base/quota already extracted (contract D1), so
        // there is nothing to recompute — but there IS something to check: the rate declared in the
        // breakdown row has to justify the quota in that same row, give or take the rounding cent.
        let out = create_from_sale_pure(from_sale(
            json!([{ "product_name": "x", "quantity": 1_000_000, "unit_price": 660, "tax_rate": 21,
                     "net_amount": 545, "tax_amount": 9999 }]),
            6,
        ))
        .unwrap();
        let err = out.error.as_ref().expect("quota 9999 over a base of 545 at 21 % must be refused");
        assert_eq!(err.code, "invoice.tax_quota_mismatch");
        assert!(
            out.operations.is_empty() && out.events.is_empty(),
            "a refused invoice consumes no number and emits no `invoice.created`"
        );
    }

    #[test]
    fn case_d_an_ordinary_invoice_cannot_come_out_negative() {
        // A total below zero is a rectification (R1…), never an F1/F2/F3. This one was issued as a
        // plain F2 with base −5,00 €, quota −1,00 € and total −6,00 €.
        let out = create_from_sale_pure(from_sale(
            json!([{ "product_name": "x", "quantity": 1_000_000, "unit_price": 660, "tax_rate": 21,
                     "net_amount": -500, "tax_amount": -105 }]),
            6,
        ))
        .unwrap();
        let err = out.error.as_ref().expect("an F2 with a negative total must be refused");
        assert_eq!(err.code, "invoice.negative_total");
        assert!(out.operations.is_empty() && out.events.is_empty());
    }

    #[test]
    fn an_exempt_line_that_carries_a_quota_is_refused() {
        // The other half of invoice#27: the qualification says «exempt, 0 %» and the amounts say
        // «21 % charged». Declaring one thing and charging another is what breaks `CuotaTotal`.
        let rules = json!([
            { "id": "r-health", "country_code": "ES", "region_code": null,
              "tax_category_key": "service.health", "rate_pct": 0.0, "tax_type": "vat",
              "parent_id": null, "is_active": 1, "operation_class": "exempt",
              "exempt_reason": "E1", "regime_key": "01" }
        ]);
        let mut input = from_sale(
            json!([{ "product_name": "Tratamiento", "quantity": 1_000_000, "unit_price": 5000,
                     "tax_rate": 0.0, "tax_category_key": "service.health",
                     "net_amount": 5000, "tax_amount": 1050 }]),
            6,
        );
        input["context"]["reads"]["taxes.rules.list"] = rules;
        let out = create_from_sale_pure(input).unwrap();
        assert_eq!(
            out.error.as_ref().map(|e| e.code.as_str()),
            Some("invoice.tax_quota_mismatch"),
            "an exempt line with a 10,50 € quota was sealed as exempt with a quota"
        );
    }

    // ── What the till really sends has to keep going through ────────────────────────────────

    #[test]
    fn a_discounted_sale_still_invoices() {
        // sales prorates the discount INTO the line (net 3,72 € + quota 0,78 € = 4,50 € charged)
        // while `unit_price` stays the undiscounted gross (5,00 €, display). Any check comparing
        // the amounts against `quantity × unit_price` would refuse every discounted sale in the
        // house — which is why the audit judges the quota against its RATE, not against the price.
        let out = create_from_sale_pure(from_sale(
            json!([{ "product_name": "Menú", "quantity": 1_000_000, "unit_price": 500, "tax_rate": 21,
                     "net_amount": 372, "tax_amount": 78 }]),
            6,
        ))
        .unwrap();
        assert!(out.error.is_none(), "a discounted sale must still be invoiceable: {:?}", out.error);
        assert_eq!(header(&out)["total_amount"], json!(450));
    }

    #[test]
    fn a_tax_included_ticket_still_invoices() {
        // With VAT-included prices the quota is `gross − base` (6,60 − 5,45 = 1,15), which differs
        // by one cent from `base × rate` (114,45 → 114). That cent is the rounding rule, not an
        // error: the tolerance is one cent per line aggregated into the breakdown row.
        let out = create_from_sale_pure(from_sale(
            json!([{ "product_name": "Café", "quantity": 1_000_000, "unit_price": 660, "tax_rate": 21,
                     "net_amount": 545, "tax_amount": 115 }]),
            6,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(header(&out)["total_amount"], json!(660));
    }

    #[test]
    fn a_comped_line_still_invoices() {
        // A gift/comp line is 0,00 € honestly (`is_gift` in the till): it is not a mismatch, and a
        // fully comped ticket is a real sale that still needs its F2. That is why the refusal is
        // «negative», not «zero or less».
        let out = create_from_sale_pure(from_sale(
            json!([{ "product_name": "Invitación", "quantity": 1_000_000, "unit_price": 500, "tax_rate": 21,
                     "net_amount": 0, "tax_amount": 0 }]),
            6,
        ))
        .unwrap();
        assert!(out.error.is_none(), "a comped sale must still be invoiceable: {:?}", out.error);
        assert_eq!(header(&out)["total_amount"], json!(0));
    }

    #[test]
    fn many_lines_of_the_same_rate_get_one_cent_of_slack_each() {
        // Three VAT-included lines aggregate into ONE breakdown row, each contributing up to a cent
        // of rounding. The tolerance follows the number of lines; it is not a flat cent that would
        // refuse a long ticket.
        let line = json!({ "product_name": "Café", "quantity": 1_000_000, "unit_price": 660,
                           "tax_rate": 21, "net_amount": 545, "tax_amount": 115 });
        let out = create_from_sale_pure(from_sale(json!([line, line, line]), 8)).unwrap();
        assert!(out.error.is_none(), "three legal lines must not add up to a refusal: {:?}", out.error);
        assert_eq!(header(&out)["total_amount"], json!(1980));
    }

    #[test]
    fn the_declared_quotas_always_add_up_to_the_total_quota() {
        // The cross-check the AEAT performs: `CuotaTotal` = Σ declared quotas. It held by
        // construction; now it is asserted before sealing, so a future refactor cannot break it
        // silently.
        let out = create_invoice_pure(manual(
            json!([
                { "description": "a", "quantity": 1_000_000, "unit_price": 10000, "tax_rate": 21 },
                { "description": "b", "quantity": 2_000_000, "unit_price": 5000, "tax_rate": 10 }
            ]),
            8,
        ));
        assert!(out.error.is_none(), "{:?}", out.error);
        let h = header(&out);
        let declared: i64 = serde_json::from_str::<Vec<Value>>(h["tax_breakdown"].as_str().unwrap())
            .unwrap()
            .iter()
            .map(|e| e["quota"].as_i64().unwrap_or(0) + e["surcharge_quota"].as_i64().unwrap_or(0))
            .sum();
        assert_eq!(h["tax_amount"].as_i64().unwrap(), declared);
        assert_eq!(
            h["total_amount"].as_i64().unwrap(),
            h["base_amount"].as_i64().unwrap() + h["tax_amount"].as_i64().unwrap()
        );
    }
}

#[cfg(test)]
mod f1_requires_customer_tax_id_tests {
    //! invoice#52 — a complete invoice (F1) without an identified recipient is a document the
    //! AEAT rejects (error 1189), not an invoice.
    //!
    //! The MANUAL path of `invoice.create` stamped `invoice_type: "F1"` always: the series default
    //! (FACT) decides, and `customer_tax_id` was never asked for. The VeriFactu engine knows the
    //! rule and silently degrades the record to F2 (hub#1104) — so the business ends up with two
    //! truths: the paper it handed out says «complete invoice» and the register it declared says
    //! «simplified ticket». A big F1 degraded that way can also blow the 3.000 € §15.8 ceiling of
    //! a simplified invoice (hub#297).
    //!
    //! The POS path is EXEMPT on purpose (ADR-0140, opción A): there the operator CHOSE a full
    //! invoice at the till and the NIF travels in the customer snapshot; the AEAT check stays
    //! downstream. The manual path has nobody behind it making that choice — the caller IS the
    //! issuer — so here the document is refused BEFORE it exists, with a code the UI translates.
    use super::*;

    fn manual(payload_extra: Value, ids: usize) -> Value {
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        let mut payload = json!({
            "customer_name": "Cliente sin NIF",
            "items": [{ "description": "Servicio", "quantity": 1_000_000, "unit_price": 10000,
                        "tax_rate": 21.0, "tax_category_key": "product.generic" }]
        });
        payload.as_object_mut().unwrap().extend(
            payload_extra.as_object().cloned().unwrap_or_default(),
        );
        json!({
            "payload": payload,
            "context": { "new_ids": new_ids, "now": "2026-08-21T20:46:00+00:00" }
        })
    }

    /// invoice#52's exact reproduction: default series (FACT → F1), no `customer_tax_id`.
    #[test]
    fn a_manual_f1_without_customer_tax_id_is_refused() {
        let out = create_invoice_pure(manual(json!({ "series_code": "FACT" }), 6));
        let err = out.error.as_ref().expect("an F1 without a customer tax id must be refused");
        assert_eq!(err.code, "invoice.f1_requires_customer_tax_id");
        assert!(
            out.operations.is_empty() && out.events.is_empty(),
            "a refused invoice writes nothing: no series bump, no number, no `invoice.created`"
        );
    }

    #[test]
    fn an_explicit_f1_without_customer_tax_id_is_refused_too() {
        // Saying `invoice_type: "F1"` out loud does not make a recipient-less document legal.
        let out = create_invoice_pure(manual(json!({ "invoice_type": "F1" }), 6));
        assert_eq!(
            out.error.as_ref().map(|e| e.code.as_str()),
            Some("invoice.f1_requires_customer_tax_id")
        );
    }

    #[test]
    fn a_whitespace_tax_id_is_as_good_as_none() {
        let out = create_invoice_pure(manual(json!({ "series_code": "FACT", "customer_tax_id": "   " }), 6));
        assert_eq!(
            out.error.as_ref().map(|e| e.code.as_str()),
            Some("invoice.f1_requires_customer_tax_id"),
            "spaces are not a tax id"
        );
    }

    #[test]
    fn an_f1_with_the_customer_tax_id_still_invoices() {
        // The guard must not overfire: a complete invoice WITH its recipient keeps going through.
        let out = create_invoice_pure(manual(
            json!({ "series_code": "FACT", "customer_tax_id": "87654321X" }),
            6,
        ));
        assert!(out.error.is_none(), "{:?}", out.error);
        let inv = &out.operations[2].params;
        assert_eq!(inv["invoice_type"], json!("F1"));
        assert_eq!(inv["customer_tax_id"], json!("87654321X"));
    }

    #[test]
    fn a_ticket_series_without_a_tax_id_still_invoices() {
        // The bar case is LEGAL: an anonymous sale is a simplified F2 and needs no recipient.
        let out = create_invoice_pure(manual(json!({ "series_code": "TICKET" }), 6));
        assert!(out.error.is_none(), "an F2 without a NIF is the normal ticket: {:?}", out.error);
        assert_eq!(out.operations[2].params["invoice_type"], json!("F2"));
    }

    #[test]
    fn the_pos_path_keeps_respecting_the_operators_choice() {
        // ADR-0140 opción A: at the till the OPERATOR chose a full invoice and the AEAT check is
        // downstream. This guard is for the manual path only — pin that it did not leak.
        let new_ids: Vec<Value> = (0..6).map(|i| json!(format!("id-{i}"))).collect();
        let input = json!({
            "payload": {
                "sale_id": "sale-f1",
                "document_type": "invoice",
                "customer_name": "Cliente que elige factura",
                "items": [{ "product_name": "Servicio", "quantity": 1_000_000, "unit_price": 12100,
                            "tax_rate": 21.0, "net_amount": 10000, "tax_amount": 2100 }]
            },
            "context": { "new_ids": new_ids, "now": "2026-08-21T20:46:00+00:00",
                         "reads": { "sales.get": [{ "id": "sale-f1" }] } }
        });
        let out = create_from_sale_pure(input).unwrap();
        assert!(out.error.is_none(), "the POS path is not this guard's business: {:?}", out.error);
        assert_eq!(out.operations[2].params["invoice_type"], json!("F1"));
    }
}
