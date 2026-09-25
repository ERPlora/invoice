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
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
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

fn year_from(issue_date: &str) -> String {
    issue_date.split('-').next().filter(|y| y.len() == 4).unwrap_or("2026").to_string()
}

/// THE BUSINESS'S DATE (invoice#78): the day a document issued at `now` carries — and with it the
/// year of its series and the day its tax rules are read on. `now` is the runtime's instant in UTC
/// (`to_rfc3339`); `context.timezone` is the business zone the runtime already resolved (hub#1022,
/// `settings::timezone_of`: the declared one, else the country's). Cutting the date off `now` as
/// it came dated everything charged between local midnight and UTC midnight on the previous day:
/// «19/09» on the paper, «18-09-2026» in the invoice, its VeriFactu record and the QR — and on
/// 1 January, a number from last year's series.
///
/// Degrades to the UTC date — the runtime's own fallback (`timezone_name()` → `UTC`) — when the
/// hub sends no zone (a runtime older than hub#1022) or one this table cannot read: a wrong clock
/// by a known amount, never a guess.
fn business_date(input: &Value, now: &str) -> String {
    let tz = input
        .get("context")
        .and_then(|c| c.get("timezone"))
        .and_then(Value::as_str)
        .and_then(|name| name.parse::<chrono_tz::Tz>().ok())
        .unwrap_or(chrono_tz::UTC);
    match chrono::DateTime::parse_from_rfc3339(now) {
        Ok(instant) => instant.with_timezone(&tz).format("%Y-%m-%d").to_string(),
        Err(_) => now.split('T').next().unwrap_or(now).to_string(),
    }
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
///     de UN CÉNTIMO FIJO por clave (invoice#65): la cuota se cierra una vez por clave, y con
///     precios IVA-incluido va por diferencia (`bruto − base`), que difiere como mucho un céntimo
///     de `base × tipo`. Solo la copia VERBATIM de un tiquet antiguo (F3) conserva el céntimo por
///     línea que aquel redondeo necesitaba.
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
fn audit(breakdown: &[DesgloseLine], base_total: i64, tax_total: i64, inv_type: &str, closing: Closing) -> Option<DomainError> {
    let mut declared_base: i64 = 0;
    let mut declared_quota: i64 = 0;

    for e in breakdown {
        declared_base += e.base;
        declared_quota += e.quota + e.surcharge_quota;

        // invoice#75: only an `S1` line may declare a quota (AEAT validations §15.7, error 1237).
        // Reverse charge (`S2`, the customer self-assesses), not subject (`N1`/`N2`) and exempt
        // lines declare a base and nothing else. A catalog rule that qualifies the operation as
        // one of those but still carries a rate would seal a record the AEAT rejects.
        if e.key.class != "subject" && (e.quota != 0 || e.surcharge_quota != 0) {
            return Some(DomainError::new(
                "invoice.quota_on_non_subject_class",
                format!(
                    "the breakdown declares {} of quota on a `{}` line at {} %: only a subject \
                     line (S1) may carry a quota. The tax rule of that category qualifies the \
                     operation as `{}` but still charges a rate.",
                    e.quota + e.surcharge_quota,
                    e.key.class,
                    e.key.rate,
                    e.key.class
                ),
            ));
        }

        // invoice#65: with the key closed once per rate the tolerance is ONE cent, fixed — the
        // same criterion the downstream gates apply (verifactu#60 `013`, hub#1180). Only a
        // verbatim copy (an F3 of a ticket sealed per line) keeps the cent-per-line allowance the
        // old rounding needed: its figures are the ticket's, not this handler's.
        let tolerance = match closing {
            Closing::Verbatim => e.lines.max(1),
            Closing::PerKey { .. } => 1,
        };
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

/// How the quota of each fiscal key is CLOSED (invoice#65, ADR-0123 §4).
#[derive(Clone, Copy, PartialEq)]
enum Closing {
    /// The quota is computed ONCE per fiscal key, from the key's aggregate — never by summing
    /// per-line rounded quotas. `tax_included` picks the aggregate (art. 88.Uno LIVA):
    ///   * `false` (VAT on top: manual invoice, B2B till): `base = Σ line bases`,
    ///     `quota = round(base × rate)`; the key's quota is then handed back to its lines by largest
    ///     remainder so the printed concepts add up to the printed total;
    ///   * `true` (VAT inside, the B2C till): `gross = Σ (base + tax)` of the key — exactly what the
    ///     customer paid — `base = round(gross / (1 + rate))`, `quota = gross − base` by difference,
    ///     so `base + quota` IS the money in the drawer. The lines keep the sale's own figures
    ///     (they already add up to the gross).
    PerKey { tax_included: bool },
    /// The amounts are COPIED, quota per line included: an F3 substitutes an F2 and is the same
    /// operation, so its figures are the ticket's to the cent — even for a ticket sealed before the
    /// key was closed per rate. Recomputing here would make the F3 disagree with what it replaces.
    Verbatim,
}

/// A line once its money is settled; what `_insert_line` will persist.
struct LineCalc {
    qty: i64,
    unit_price: i64,
    base: i64,
    tax: i64,
    key: usize,
    line_rate: f64,
    line_surcharge_rate: f64,
}

/// Per-key aggregate while the lines are walked (invoice#65): nothing is rounded here.
struct KeyAcc {
    key: FiscalKey,
    base: i64,
    /// Σ (base + tax) of the key's lines: the money charged for that key.
    gross: i64,
    /// Σ of the lines' own quotas, for the `Verbatim` closing.
    tax: i64,
    lines: i64,
}

/// Splits `total` over `exact` shares (the unrounded per-line quota) by LARGEST REMAINDER: floor
/// every share, hand the leftover cents one by one to the biggest fractional parts, ties by
/// position. Deterministic, and Σ result == total by construction. Same rule `sales` applies to a
/// fixed-amount discount (34 + 34 + 33, not 3 × HALF_UP(33,67)).
fn largest_remainder(total: i64, exact: &[Decimal]) -> Vec<i64> {
    let floors: Vec<i64> = exact.iter().map(|d| d.floor().to_i64().unwrap_or(0)).collect();
    let mut out = floors.clone();
    let mut residue = total - floors.iter().sum::<i64>();
    let mut order: Vec<usize> = (0..exact.len()).collect();
    order.sort_by(|&a, &b| {
        let fa = exact[a] - Decimal::from(floors[a]);
        let fb = exact[b] - Decimal::from(floors[b]);
        fb.partial_cmp(&fa).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(&b))
    });
    // A negative residue (only reachable with negative shares) is handed back the same way.
    let step = if residue >= 0 { 1 } else { -1 };
    let mut i = 0;
    while residue != 0 && !order.is_empty() {
        out[order[i % order.len()]] += step;
        residue -= step;
        i += 1;
    }
    out
}

/// Construye las intenciones de una factura a partir de líneas ya normalizadas
/// (description, quantity, unit_price, tax_rate, product_id).
fn build_invoice(
    new_ids: &[Value],
    issue_date: &str,
    series_code: &str,
    invoice_type_override: Option<&str>,
    header: &Value,
    items: &[Value],
    fiscal: &FiscalContext,
    closing: Closing,
) -> Output {
    let invoice_id = new_ids.first().map(s).unwrap_or_default();
    let year = year_from(issue_date);
    let (def_type, def_name) = series_defaults(series_code);
    let inv_type = invoice_type_override.unwrap_or(def_type).to_string();

    let mut keys: Vec<KeyAcc> = Vec::new(); // una entrada por clave fiscal
    let mut calc: Vec<LineCalc> = Vec::with_capacity(items.len());
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

    // 3) líneas: el dinero de cada una y su clave fiscal. La CUOTA de la clave se cierra después,
    //    una sola vez (invoice#65) — aquí no se acumula nada redondeado por línea.
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
        let key = resolved.unwrap_or_else(|| FiscalKey::nacional(rate_hint, surcharge_hint));
        let charged_rate = key.rate + key.surcharge_rate;
        // Base/IVA por línea (céntimos). Si el origen ya extrajo la base y el IVA
        // (p.ej. `sale.completed` con precios IVA-INCLUIDO: net_amount/tax_amount ya
        // calculados por sales.calc_line), se RESPETAN — NO se vuelve a sumar IVA
        // sobre el bruto (bug D1). Solo cuando NO vienen (factura manual,
        // precios IVA-EXCLUIDO) se calcula base = qty*unit_price y tax = base*rate.
        let (base, tax) = match (item.get("base_amount"), item.get("tax_amount")) {
            (Some(b), Some(t)) => {
                let (base, tax) = (money::from_json(b, 0), money::from_json(t, 0));
                // invoice#65: an external line is checked against ITS OWN rate, to the cent. With
                // the key closed by this handler the header can no longer carry a forged quota —
                // but a line still can, and a line is what an F3 copies verbatim and what the paper
                // prints. One cent is honest rounding (a VAT-included line is split by difference);
                // two is a figure nobody charged.
                let expected = money::percent_of(base, Decimal::from_f64(charged_rate).unwrap_or(Decimal::ZERO));
                if (tax - expected).abs() > 1 {
                    return Output::new().with_error(DomainError::new(
                        "invoice.tax_quota_mismatch",
                        format!(
                            "line {} `{}` declares {} of quota over a base of {} at {} %, and that \
                             rate justifies {} (tolerance 1 cent of rounding). Charging one amount \
                             and declaring another is what breaks the AEAT cross-check.",
                            i + 1,
                            s(item.get("description").unwrap_or(&Value::Null)),
                            tax,
                            base,
                            charged_rate,
                            expected
                        ),
                    ));
                }
                (base, tax)
            }
            _ => {
                // Factura MANUAL (IVA no incluido): base = precio × cantidad, IVA encima.
                //
                // The rate CHARGED is the resolved rule's (main + surcharge components), not the
                // caller's hint (invoice#27, ADR-0223 single source): an exempt category sent with
                // `tax_rate: 21` used to charge 21 % and declare `exempt` with no quota, so
                // `CuotaTotal` no longer matched the declared quotas. Without a rule the hint is
                // all there is and it is honoured as before.
                //
                // El dinero se calcula con la cantidad LÓGICA exacta (raw/10⁶) — división de
                // enteros en Decimal, sin pasar por f64 (ADR-0123 §2 + ADR-0147 §2.3).
                let qd = Decimal::from(qty) / Decimal::from(QUANTITY_SCALE);
                let rd = Decimal::from_f64(charged_rate).unwrap_or(Decimal::ZERO);
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
                // The line's own quota is provisional: the key closes it (invoice#65) and, with
                // VAT on top, hands it back to the lines by largest remainder.
                let tax = money::percent_of(base, rd);
                (base, tax)
            }
        };

        // Frozen on the line BEFORE `key` moves into the aggregate (invoice#21, see the insert).
        let (line_rate, line_surcharge_rate) = (key.rate, key.surcharge_rate);
        let key_idx = match keys.iter().position(|k| k.key == key) {
            Some(idx) => {
                let k = &mut keys[idx];
                k.base += base;
                k.gross += base + tax;
                k.tax += tax;
                k.lines += 1;
                idx
            }
            None => {
                keys.push(KeyAcc { key, base, gross: base + tax, tax, lines: 1 });
                keys.len() - 1
            }
        };
        calc.push(LineCalc { qty, unit_price, base, tax, key: key_idx, line_rate, line_surcharge_rate });
    }

    // 4) EL CIERRE (invoice#65, ADR-0123 §4): una base y una cuota por clave fiscal, redondeadas
    //    UNA vez. Es lo único que el XML de VeriFactu sabe representar (`DetalleDesglose` es por
    //    tipo, máx. 12) y lo que la AEAT cruza (`cuota = base × tipo`); sumar cuotas ya redondeadas
    //    por línea acumula el error que censura el TEAC (RG 2233/2022): 4 líneas de 0,50 € al 21 %
    //    declaraban 44 sobre 200, que ningún tipo justifica.
    let mut breakdown: Vec<DesgloseLine> = Vec::with_capacity(keys.len());
    for (idx, k) in keys.iter().enumerate() {
        let rate = Decimal::from_f64(k.key.rate).unwrap_or(Decimal::ZERO);
        let surcharge_rate = Decimal::from_f64(k.key.surcharge_rate).unwrap_or(Decimal::ZERO);
        let (base, main_quota, surcharge_quota) = match closing {
            Closing::Verbatim => {
                // El recargo se separa de la cuota SIN recalcular el total: la cuota es la que se
                // cobró, y de ella sale el recargo por su tipo; el resto es el impuesto principal.
                // Así 2100 + 520 siguen sumando exactamente los 2620 cobrados.
                let sq = if k.key.has_surcharge { money::percent_of(k.base, surcharge_rate) } else { 0 };
                (k.base, k.tax - sq, sq)
            }
            Closing::PerKey { tax_included: true } => {
                // Lo cobrado por esta clave no se mueve ni un céntimo: base por división, cuota
                // por diferencia (`money::split_tax_included`). Con recargo, el principal cierra
                // por su tipo sobre esa base y el recargo se lleva el resto.
                let (base, taxsum) = money::split_tax_included(k.gross, rate + surcharge_rate);
                if k.key.has_surcharge {
                    let main = money::percent_of(base, rate);
                    (base, main, taxsum - main)
                } else {
                    (base, taxsum, 0)
                }
            }
            Closing::PerKey { tax_included: false } => {
                let main = money::percent_of(k.base, rate);
                let sq = if k.key.has_surcharge { money::percent_of(k.base, surcharge_rate) } else { 0 };
                (k.base, main, sq)
            }
        };
        if closing == (Closing::PerKey { tax_included: false }) {
            // La cuota de la clave vuelve a sus líneas por RESTO MAYOR sobre la cuota exacta de
            // cada una, para que los conceptos impresos sumen el total impreso (61 + 61 + 60 + 60 =
            // 242, no 4 × 61 = 244 bajo un total de 242).
            let pct = rate + surcharge_rate;
            let members: Vec<usize> = calc.iter().enumerate().filter(|(_, l)| l.key == idx).map(|(i, _)| i).collect();
            let exact: Vec<Decimal> = members
                .iter()
                .map(|&i| Decimal::from(calc[i].base) * pct / Decimal::from(100))
                .collect();
            for (m, share) in members.iter().zip(largest_remainder(main_quota + surcharge_quota, &exact)) {
                calc[*m].tax = share;
            }
        }
        breakdown.push(DesgloseLine { key: k.key.clone(), base, quota: main_quota, surcharge_quota, lines: k.lines });
    }
    let base_total: i64 = breakdown.iter().map(|l| l.base).sum(); // céntimos
    let tax_total: i64 = breakdown.iter().map(|l| l.quota + l.surcharge_quota).sum(); // céntimos

    // 5) las líneas, ya cerradas (ids new_ids[2..]).
    for (i, (item, l)) in items.iter().zip(calc.iter()).enumerate() {
        let line_id = new_ids.get(i + 2).map(s).unwrap_or_default();
        let mut p = Map::new();
        p.insert("line_id".into(), json!(line_id));
        p.insert("invoice_id".into(), json!(invoice_id));
        p.insert("line_number".into(), json!(i as i64 + 1));
        p.insert("description".into(), json!(s(item.get("description").unwrap_or(&Value::Null))));
        p.insert("quantity".into(), json!(l.qty)); // punto fijo 10⁶ (INTEGER, ADR-0147)
        p.insert("unit_price".into(), json!(l.unit_price)); // céntimos
        // invoice#21: the line freezes the MAIN rate and the surcharge apart. Under equivalence
        // surcharge the sale sends the combined 26.2 (21 + 5.2) — that is a sum, not a rate that
        // exists, and grouping by it reproduced the bug ADR-0186 fixed in the breakdown. What is
        // charged (`tax_amount`) does not move. `surcharge_rate` is ALWAYS written (0 when none):
        // NULL marks the legacy generation, whose `tax_rate` may still be a combined sum.
        p.insert("tax_rate".into(), json!(l.line_rate));                 // tasa % del impuesto principal (REAL)
        p.insert("surcharge_rate".into(), json!(l.line_surcharge_rate)); // tasa % del recargo (REAL, 0 = sin recargo)
        // Categoría fiscal congelada de la línea (ADR-0085); NULL en factura manual sin categoría.
        p.insert("tax_category_key".into(), item.get("tax_category_key").cloned().unwrap_or(Value::Null));
        p.insert("base_amount".into(), json!(l.base));          // céntimos
        p.insert("tax_amount".into(), json!(l.tax));            // céntimos
        p.insert("total_amount".into(), json!(l.base + l.tax)); // céntimos
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
    if let Some(err) = audit(&breakdown, base_total, tax_total, &inv_type, closing) {
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
    // ERPlora/hub#1967: where the customer is from (ISO 3166 alpha-2) and what their document is
    // (the AEAT `IDType`). With them the VeriFactu engine declares a foreign customer as the
    // foreigner they are (`IDOtro`); '' = unknown, the tax id's prefix decides.
    h.insert("customer_country".into(), json!(sor(header, "customer_country", "").trim().to_ascii_uppercase()));
    h.insert("customer_id_type".into(), json!(sor(header, "customer_id_type", "").trim()));
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
    /// ISO day of the issue — the business's, like the document's own date (invoice#78) — for
    /// the validity of the rules.
    date: String,
}

impl FiscalContext {
    fn from_input(input: &Value, issue_date: &str) -> Self {
        let context = input.get("context").cloned().unwrap_or(Value::Null);
        FiscalContext {
            // `&Value::Null` as the payload fallback ON PURPOSE: only `taxes.calculate` lets a
            // caller hand its own catalog for an ad-hoc calculation. What is DECLARED comes from
            // the hub's own rules or from nothing.
            rules: tax::rule_catalog(&context, &Value::Null).into_iter().cloned().collect(),
            country: s(context.get("country_code").unwrap_or(&Value::Null)),
            region: s(context.get("region_code").unwrap_or(&Value::Null)),
            date: issue_date.to_string(),
        }
    }
}

/// The ids the host minted and the business date of the issue (see [`business_date`]).
fn ctx_ids(input: &Value) -> (Vec<Value>, String) {
    let new_ids = input.get("context").and_then(|c| c.get("new_ids"))
        .and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let now = input.get("context").and_then(|c| c.get("now")).map(s).unwrap_or_default();
    (new_ids, business_date(input, &now))
}

/// create_invoice: payload con items + cabecera + series_code (default FACT/F1).
pub fn create_invoice_pure(input: Value) -> Output {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let (new_ids, issue_date) = ctx_ids(&input);
    let fiscal = FiscalContext::from_input(&input, &issue_date);
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

    build_invoice(&new_ids, &issue_date, &series_code, ty.as_deref(), &payload, items, &fiscal, Closing::PerKey { tax_included: false })
}

/// create_from_sale: adapta el evento sale.completed (líneas) a una F2 serie TICKET.
pub fn create_from_sale_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let (new_ids, issue_date) = ctx_ids(&input);
    let fiscal = FiscalContext::from_input(&input, &issue_date);

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
    // Failure channel (ERPlora/hub#1264): `Output.error` -> `RuntimeError::Domain` -> HTTP 409
    // with the stable, translatable code `invoice.sale_not_found` (ADR-0205), and NOTHING is
    // persisted (no invoice row, no number, no event) — same as the trap this replaced. Before
    // this it was a plain `Err(String)` -> WASM trap -> `RuntimeError::Wasm`, and hub#1074's
    // client-facing redaction gate (`may_reach_the_client`) denies EVERY `Wasm` message: an
    // external caller (the assistant, a future public API) saw only "the request could not be
    // completed" with no code to branch on — worse than the stale comment this replaces assumed,
    // since it never even leaked the detail. The domain-error channel is what every other
    // rejection in this file already uses (`invoice.f1_requires_customer_tax_id`,
    // `invoice.tax_quota_mismatch`…); this one had been left on the old channel since before
    // ADR-0205 landed on the hub's main branch.
    let sale_id = s(payload.get("sale_id").unwrap_or(&Value::Null));
    let sale_found = input
        .get("context")
        .and_then(|c| c.get("reads"))
        .and_then(|r| r.get("sales.get"))
        .and_then(|v| v.as_array())
        .map(|rows| !rows.is_empty())
        .unwrap_or(false);
    if !sale_id.is_empty() && !sale_found {
        return Ok(Output::new().with_error(DomainError::new(
            "invoice.sale_not_found",
            format!(
                "sale `{sale_id}` does not exist or is not invoiceable; refusing to issue an \
                 invoice for it"
            ),
        )));
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
    header.insert("customer_country".into(), payload.get("customer_country").cloned().unwrap_or(json!("")));
    header.insert("customer_id_type".into(), payload.get("customer_id_type").cloned().unwrap_or(json!("")));
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
    // invoice#65: the sale says whether its prices carried the VAT inside (`tax_included`, art.
    // 88.Uno LIVA); that decides how each fiscal key is closed. An event without it (a `sales`
    // older than the flag) is VAT on top, which is what its per-line figures then mean.
    let tax_included = payload.get("tax_included").and_then(|v| v.as_bool()).unwrap_or(false);
    Ok(build_invoice(&new_ids, &issue_date, series_code, Some(inv_type), &Value::Object(header), &items, &fiscal, Closing::PerKey { tax_included }))
}

/// substitute_from_invoice: "el cliente pide factura de un tiquet" (ADR-0140). Emite una F3
/// (factura COMPLETA en SUSTITUCIÓN de la simplificada F2 ya emitida), NUEVA e inmutable, en la
/// serie de facturas completas (FACT), enlazada a la F2 vía `substitutes_invoice_id` y con los
/// datos fiscales del cliente que la pide. La F2 original NO se toca (su estado "sustituida" se
/// deriva de que exista una F3 apuntándola). NO es rectificación: el tiquet era correcto. Los
/// importes son los del tiquet (misma operación) — las líneas llegan del F2 en el payload.
pub fn substitute_from_invoice_pure(input: Value) -> Output {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let (new_ids, issue_date) = ctx_ids(&input);
    let fiscal = FiscalContext::from_input(&input, &issue_date);
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
    header.insert("customer_country".into(), payload.get("customer_country").cloned().unwrap_or(json!("")));
    header.insert("customer_id_type".into(), payload.get("customer_id_type").cloned().unwrap_or(json!("")));
    header.insert("description".into(), payload.get("description").cloned().unwrap_or(json!("")));
    // source = substitution del original → idempotencia D2 (1 F3 por F2, sin huecos) + by_source.
    header.insert("source_type".into(), json!("substitution"));
    header.insert("source_id".into(), json!(original_id));
    // Enlace fiscal explícito F3→F2 (ADR-0140): lo lee verifactu para el bloque FacturasSustituidas.
    header.insert("substitutes_invoice_id".into(), json!(original_id));
    // F3 en la serie de facturas COMPLETAS (FACT); comparte numeración con las F1 (legal en ES).
    build_invoice(&new_ids, &issue_date, "FACT", Some("F3"), &Value::Object(header), &items, &fiscal, Closing::Verbatim)
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

    // ERPlora/hub#1967: where the customer is from and what their document is are part of the
    // fiscal snapshot — without them the AEAT receives a foreign customer as a Spanish NIF.

    fn items() -> Value {
        json!([{ "description": "Servicio", "quantity": 1_000_000, "unit_price": 10000, "tax_rate": 21.0 }])
    }

    #[test]
    fn a_manual_invoice_carries_the_customers_country_and_document() {
        let out = create_invoice_pure(inp(json!({
            "series_code": "FACT", "customer_name": "Client Inc", "customer_tax_id": "123456789",
            "customer_country": "us", "customer_id_type": "04", "items": items()
        }), 6));
        let inv = &out.operations[2].params;
        assert_eq!(inv["customer_country"], json!("US"), "ISO code, upper case");
        assert_eq!(inv["customer_id_type"], json!("04"));
    }

    #[test]
    fn a_sale_carries_the_customers_country_and_document() {
        let out = create_from_sale_pure(inp(json!({
            "sale_id": "sale-us", "document_type": "invoice", "customer_name": "Jane Doe",
            "customer_tax_id": "XA1234567", "customer_country": "US", "customer_id_type": "03",
            "items": [{ "product_name": "Corte", "quantity": 1_000_000, "unit_price": 1500, "tax_rate": 21.0 }]
        }), 6)).unwrap();
        let inv = &out.operations[2].params;
        assert_eq!(inv["customer_country"], json!("US"));
        assert_eq!(inv["customer_id_type"], json!("03"));
    }

    #[test]
    fn a_substitution_carries_the_customers_country_and_document() {
        let out = substitute_from_invoice_pure(inp(json!({
            "original_invoice_id": "inv-f2-us", "customer_name": "Client Ltd",
            "customer_tax_id": "GB220430231", "customer_country": " gb ",
            "items": [{ "description": "Menú", "quantity": 1_000_000, "unit_price": 121,
                        "tax_rate": 21.0, "base_amount": 100, "tax_amount": 21 }]
        }), 6));
        let inv = &out.operations[2].params;
        assert_eq!(inv["customer_country"], json!("GB"));
        assert_eq!(inv["customer_id_type"], json!(""), "unknown kind: the engine picks the default");
    }

    /// Every invoice issued before (and every Spanish customer) says nothing: '' — the engine
    /// reads the tax id's prefix, as it always did.
    #[test]
    fn an_invoice_without_them_stores_empty() {
        let out = create_invoice_pure(inp(json!({
            "series_code": "FACT", "customer_name": "ACME SL", "items": items()
        }), 6));
        let inv = &out.operations[2].params;
        assert_eq!(inv["customer_country"], json!(""));
        assert_eq!(inv["customer_id_type"], json!(""));
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
    ///
    /// Regression test for ERPlora/hub#1264: this used to assert `Err(String)` — a WASM trap that
    /// hub#1074's client-facing redaction gate (`may_reach_the_client`) turns into a bare "the
    /// request could not be completed" for every caller outside this process, no code to branch
    /// on. The stable, translatable `Output.error` code is what an external caller (the assistant,
    /// a future public API) actually sees.
    #[test]
    fn from_sale_rejects_nonexistent_sale_id() {
        let payload = json!({ "sale_id": "__missing_sale__", "customer_name": "X", "items": [] });
        let out = create_from_sale_pure(inp_no_sale(payload, 6)).unwrap();
        let err = out.error.expect("a nonexistent sale_id must set Output.error, not a WASM trap");
        assert_eq!(err.code, "invoice.sale_not_found");
        assert!(err.message.contains("__missing_sale__"), "{}", err.message);
    }

    /// invoice#8: the rejection is not a silent no-op — it must NOT produce any operation (no
    /// invoice row, no line, no series bump); the host discards `operations`/`events` whenever
    /// `Output.error` is set (hub#139), which is what makes the whole command roll back.
    #[test]
    fn from_sale_rejection_persists_nothing() {
        let payload = json!({
            "sale_id": "__missing_sale__",
            "items": [{ "product_name": "Café", "quantity": 1_000_000, "unit_price": 100, "tax_rate": 21.0 }]
        });
        let out = create_from_sale_pure(inp_no_sale(payload, 6)).unwrap();
        assert!(out.error.is_some(), "a missing sale must set Output.error");
        assert!(
            out.operations.is_empty(),
            "a missing sale must not yield any operation: {:?}",
            out.operations
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

    #[test]
    fn a_decimal_caller_rate_is_charged_and_declared_as_is() {
        // invoice#98: the manual form now sends IGIC 9.5 %; the rate is unscaled, never rounded.
        let out = create_invoice_pure(inp(manual_line("service.general", 9.5), 8));
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(out.operations[2].params["tax_amount"], json!(950));
        assert_eq!(out.operations[2].params["total_amount"], json!(10950));
        assert_eq!(out.operations[3].params["tax_rate"], json!(9.5));
        assert_eq!(desglose(&out)[0]["rate"], json!(9.5));
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
        // error: the line is accepted within one cent, and the key closes by difference over the
        // gross (invoice#65) — so the total IS the 6,60 € the till took. The sale says so with
        // `tax_included`, exactly as `sales` emits it.
        let mut inp = from_sale(
            json!([{ "product_name": "Café", "quantity": 1_000_000, "unit_price": 660, "tax_rate": 21,
                     "net_amount": 545, "tax_amount": 115 }]),
            6,
        );
        inp["payload"]["tax_included"] = json!(true);
        let out = create_from_sale_pure(inp).unwrap();
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
        // Three VAT-included lines aggregate into ONE breakdown row. Before invoice#65 the quota
        // was Σ of the lines' cents (345 over 1635, which 21 % does not justify) and the audit
        // needed a cent of slack PER LINE to let it through; now the key closes once over the
        // gross (1980 → base 1636, quota 344) and the tolerance is a flat cent — and a long ticket
        // still goes through, because the cent no longer accumulates.
        let line = json!({ "product_name": "Café", "quantity": 1_000_000, "unit_price": 660,
                           "tax_rate": 21, "net_amount": 545, "tax_amount": 115 });
        let mut inp = from_sale(json!([line, line, line]), 8);
        inp["payload"]["tax_included"] = json!(true);
        let out = create_from_sale_pure(inp).unwrap();
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

// ── invoice#65 — the quota closes ONCE per fiscal key, never per line (ADR-0123 §4) ──────────────
//
// `DetalleDesglose` is per rate, so the register can only carry one base and one quota per key,
// and the AEAT cross-checks `cuota = base × tipo` on THAT row. Summing per-line rounded quotas
// declared 44 on a base of 200 at 21 % (4 × HALF_UP(10,5)), which no rate justifies — and the
// downstream gates (verifactu#60 `013`, hub#1180) rightly refuse it. `sales` already closes per
// rate; this is the same rule applied where the document is actually sealed.
#[cfg(test)]
mod closing_per_key {
    use super::*;

    fn ctx(payload: Value, ids: usize, reads: Value) -> Value {
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        json!({
            "payload": payload,
            "context": { "new_ids": new_ids, "now": "2026-08-25T10:00:00+00:00", "reads": reads }
        })
    }

    fn header(out: &Output) -> &Map<String, Value> {
        assert!(out.error.is_none(), "unexpected refusal: {:?}", out.error);
        &out.operations[2].params
    }

    fn breakdown(out: &Output) -> Vec<Value> {
        serde_json::from_str(header(out)["tax_breakdown"].as_str().unwrap()).unwrap()
    }

    fn lines(out: &Output) -> Vec<&Map<String, Value>> {
        out.operations.iter().filter(|o| o.command == "invoice._insert_line").map(|o| &o.params).collect()
    }

    #[test]
    fn four_lines_at_one_rate_close_the_quota_once_per_key_and_the_lines_add_up() {
        // 4 × 0,50 € at 21 %: per line 10,5 → 11 each = 44; per key 200 × 21 % = 42.
        let items: Vec<Value> = (0..4)
            .map(|i| json!({ "description": format!("L{i}"), "quantity": 1_000_000, "unit_price": 50, "tax_rate": 21.0 }))
            .collect();
        let out = create_invoice_pure(ctx(json!({ "series_code": "FACT", "customer_tax_id": "B1", "items": items }), 8, json!({})));
        let d = breakdown(&out);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["base"], json!(200));
        assert_eq!(d[0]["quota"], json!(42), "200 × 21 % = 42, not 4 × HALF_UP(10,5) = 44");
        let h = header(&out);
        assert_eq!(h["base_amount"], json!(200));
        assert_eq!(h["tax_amount"], json!(42));
        assert_eq!(h["total_amount"], json!(242));
        // The lines carry the key's quota, split by largest remainder (deterministic), so the
        // printed concepts add up to the printed total.
        let taxes: Vec<i64> = lines(&out).iter().map(|l| l["tax_amount"].as_i64().unwrap()).collect();
        assert_eq!(taxes, vec![11, 11, 10, 10]);
        let totals: i64 = lines(&out).iter().map(|l| l["total_amount"].as_i64().unwrap()).sum();
        assert_eq!(totals, 242, "Σ line totals == header total");
    }

    #[test]
    fn a_sale_with_tax_included_declares_exactly_what_the_customer_paid() {
        // The TEAC example: 7 chewing gums at 0,05 € with VAT inside. `sales` splits each line
        // (base 4, tax 1) and the till takes 35. ADR-0123 §4 for VAT-included: base = round(35 /
        // 1,21) = 29, quota = 35 − 29 = 6 → base + quota IS what was charged, and 29 × 21 % = 6,09
        // → 6 cross-checks. Summing the lines declared 28 / 7, which 21 % does not justify.
        let items: Vec<Value> = (0..7)
            .map(|i| json!({ "product_name": format!("Chicle {i}"), "quantity": 1_000_000, "unit_price": 5,
                             "tax_rate": 21.0, "net_amount": 4, "tax_amount": 1 }))
            .collect();
        let out = create_from_sale_pure(ctx(
            json!({ "sale_id": "sale-1", "tax_included": true, "items": items }), 10,
            json!({ "sales.get": [{ "id": "sale-1" }] }),
        )).unwrap();
        let d = breakdown(&out);
        assert_eq!(d[0]["base"], json!(29));
        assert_eq!(d[0]["quota"], json!(6));
        let h = header(&out);
        assert_eq!(h["base_amount"], json!(29));
        assert_eq!(h["tax_amount"], json!(6));
        assert_eq!(h["total_amount"], json!(35), "what the till took, to the cent");
        // The lines are the sale's own figures (they already add up to what was charged).
        let totals: i64 = lines(&out).iter().map(|l| l["total_amount"].as_i64().unwrap()).sum();
        assert_eq!(totals, 35);
    }

    #[test]
    fn a_sale_without_tax_included_closes_over_the_aggregated_base_and_the_lines_follow() {
        // B2B till (VAT on top): `sales` sends 4 lines of base 50 with 11 of tax each.
        let items: Vec<Value> = (0..4)
            .map(|i| json!({ "product_name": format!("L{i}"), "quantity": 1_000_000, "unit_price": 50,
                             "tax_rate": 21.0, "net_amount": 50, "tax_amount": 11 }))
            .collect();
        let out = create_from_sale_pure(ctx(
            json!({ "sale_id": "sale-1", "tax_included": false, "items": items }), 8,
            json!({ "sales.get": [{ "id": "sale-1" }] }),
        )).unwrap();
        let h = header(&out);
        assert_eq!(h["base_amount"], json!(200));
        assert_eq!(h["tax_amount"], json!(42));
        assert_eq!(h["total_amount"], json!(242));
        let taxes: Vec<i64> = lines(&out).iter().map(|l| l["tax_amount"].as_i64().unwrap()).collect();
        assert_eq!(taxes.iter().sum::<i64>(), 42, "the lines follow the key: {taxes:?}");
    }

    #[test]
    fn a_mixed_ticket_with_tax_included_closes_each_key_over_its_own_gross() {
        // 3 beers at 21 % (2,00 € each, VAT inside) and 2 tapas at 10 % (3,00 € each).
        let mut items: Vec<Value> = (0..3)
            .map(|_| json!({ "product_name": "Caña", "quantity": 1_000_000, "unit_price": 200,
                             "tax_rate": 21.0, "net_amount": 165, "tax_amount": 35 }))
            .collect();
        items.extend((0..2).map(|_| json!({ "product_name": "Tapa", "quantity": 1_000_000, "unit_price": 300,
                                              "tax_rate": 10.0, "net_amount": 273, "tax_amount": 27 })));
        let out = create_from_sale_pure(ctx(
            json!({ "sale_id": "sale-1", "tax_included": true, "items": items }), 9,
            json!({ "sales.get": [{ "id": "sale-1" }] }),
        )).unwrap();
        let d = breakdown(&out);
        let at = |rate: f64| d.iter().find(|e| e["rate"] == json!(rate)).unwrap().clone();
        // 600 / 1,21 = 495,87 → 496; quota 104. 600 / 1,10 = 545,45 → 545; quota 55.
        assert_eq!(at(21.0)["base"], json!(496));
        assert_eq!(at(21.0)["quota"], json!(104));
        assert_eq!(at(10.0)["base"], json!(545));
        assert_eq!(at(10.0)["quota"], json!(55));
        assert_eq!(header(&out)["total_amount"], json!(1200));
    }

    #[test]
    fn a_substitution_copies_the_ticket_verbatim_even_when_it_was_rounded_per_line() {
        // An F3 is the SAME operation as the F2 it substitutes: its figures are the ticket's, to
        // the cent, even for a ticket sealed before this change (4 × 11 = 44). Recomputing per
        // key here would make the F3 disagree with the F2 it declares to replace.
        let items: Vec<Value> = (0..4)
            .map(|i| json!({ "description": format!("L{i}"), "quantity": 1_000_000, "unit_price": 61,
                             "tax_rate": 21.0, "base_amount": 50, "tax_amount": 11 }))
            .collect();
        let out = substitute_from_invoice_pure(ctx(
            json!({ "original_invoice_id": "f2-1", "customer_name": "ACME", "customer_tax_id": "B1", "items": items }),
            8, json!({}),
        ));
        let h = header(&out);
        assert_eq!(h["tax_amount"], json!(44), "the ticket's own quota, untouched");
        assert_eq!(h["total_amount"], json!(244));
        assert_eq!(breakdown(&out)[0]["quota"], json!(44));
    }

    #[test]
    fn external_line_amounts_are_checked_against_their_own_rate_to_the_cent() {
        // With the key closed by this handler, the header can no longer carry a forged quota —
        // but a line still can, and a line is what the F3 will copy verbatim. One cent of rounding
        // is honest (VAT-included lines split by difference); two is not.
        let line = |tax: i64| json!([{ "product_name": "x", "quantity": 1_000_000, "unit_price": 660,
                                        "tax_rate": 21.0, "net_amount": 545, "tax_amount": tax }]);
        let ok = create_from_sale_pure(ctx(json!({ "sale_id": "s", "tax_included": true, "items": line(115) }), 6,
                                           json!({ "sales.get": [{ "id": "s" }] }))).unwrap();
        assert!(ok.error.is_none(), "545 × 21 % = 114,45: 115 is one cent of rounding, accepted");
        let bad = create_from_sale_pure(ctx(json!({ "sale_id": "s", "tax_included": true, "items": line(116) }), 6,
                                            json!({ "sales.get": [{ "id": "s" }] }))).unwrap();
        assert_eq!(bad.error.as_ref().map(|e| e.code.as_str()), Some("invoice.tax_quota_mismatch"));
        assert!(bad.operations.is_empty(), "a refused invoice consumes no number");
    }
}

/// invoice#78 — THE ISSUE DATE IS THE BUSINESS'S DATE, not UTC's.
///
/// A bar in Madrid that charges at 01:50 on 19/09 printed «19/09» on the ticket while the stored
/// invoice, its VeriFactu record and the QR the customer scans said «18-09-2026»: the handler took
/// the date off `context.now`, which the runtime hands over in UTC. Two hours every summer night
/// (one in winter), and on 1 January the document numbered in LAST year's series. The runtime
/// already resolves the business zone and hands it to every command as `context.timezone`
/// (hub#1022); these tests pin that the date, the series year and the tax-rule validity day are
/// all read on that clock.
#[cfg(test)]
mod business_date_tests {
    use super::*;

    const MADRID: &str = "Europe/Madrid";

    fn ids() -> Value {
        json!((0..8).map(|i| format!("id-{i}")).collect::<Vec<_>>())
    }

    fn context(now: &str, timezone: Option<&str>) -> Value {
        let mut ctx = json!({ "new_ids": ids(), "now": now,
                              "reads": { "sales.get": [{ "id": "sale-1" }] } });
        if let Some(tz) = timezone {
            ctx["timezone"] = json!(tz);
        }
        ctx
    }

    /// A POS sale charged at `now` (the runtime's UTC instant) in a hub whose zone is `timezone`.
    fn sale_at(now: &str, timezone: Option<&str>) -> Output {
        let payload = json!({ "sale_id": "sale-1", "items": [
            { "product_name": "Caña", "quantity": 1_000_000, "unit_price": 250, "tax_rate": 10.0 }
        ]});
        create_from_sale_pure(json!({ "payload": payload, "context": context(now, timezone) }))
            .expect("the sale exists")
    }

    fn params<'a>(out: &'a Output, command: &str) -> &'a Map<String, Value> {
        &out.operations
            .iter()
            .find(|op| op.command == command)
            .unwrap_or_else(|| panic!("no `{command}` operation in {:?}", out.operations))
            .params
    }

    fn issue_date(out: &Output) -> Value {
        assert!(out.error.is_none(), "unexpected refusal: {:?}", out.error);
        params(out, "invoice._insert_invoice")["issue_date"].clone()
    }

    #[test]
    fn a_ticket_charged_after_local_midnight_carries_the_business_date() {
        // The QA case, with the instant exactly as the runtime writes it (`to_rfc3339`, nanos).
        let out = sale_at("2026-09-18T23:50:12.345678901+00:00", Some(MADRID));
        assert_eq!(issue_date(&out), json!("2026-09-19"), "01:50 on the 19th in Madrid");
    }

    #[test]
    fn the_date_flips_at_the_business_midnight_not_at_utc_midnight() {
        // Madrid in September is UTC+2: the local day starts at 22:00 UTC and 02:00 local is
        // 00:00 UTC. Both borders, on both sides.
        for (now, expected) in [
            ("2026-09-18T21:59:59+00:00", "2026-09-18"), // 23:59:59 local, still the 18th
            ("2026-09-18T22:00:00+00:00", "2026-09-19"), // 00:00 local
            ("2026-09-18T23:59:59+00:00", "2026-09-19"), // 01:59:59 local — UTC still says 18
            ("2026-09-19T00:00:00+00:00", "2026-09-19"), // 02:00 local
        ] {
            assert_eq!(issue_date(&sale_at(now, Some(MADRID))), json!(expected), "at {now}");
        }
    }

    #[test]
    fn a_zone_west_of_utc_moves_the_date_back_not_forward() {
        // 03:00 UTC on the 19th is 21:00 on the 18th in Mexico City (UTC-6): the fix is «read it
        // in the business zone», not «add two hours».
        let out = sale_at("2026-09-19T03:00:00+00:00", Some("America/Mexico_City"));
        assert_eq!(issue_date(&out), json!("2026-09-18"));
    }

    #[test]
    fn new_years_night_numbers_in_the_new_years_series() {
        // 23:30 UTC on 31/12 is 00:30 on 1 January in Madrid (UTC+1 in winter): the document is
        // dated 2027 and takes a number from the 2027 series — the series must exist for 2027,
        // the counter bumped is 2027's and the row carries 2027.
        let out = sale_at("2026-12-31T23:30:00+00:00", Some(MADRID));
        assert_eq!(issue_date(&out), json!("2027-01-01"));
        assert_eq!(params(&out, "invoice._ensure_series")["year"], json!(2027));
        assert_eq!(params(&out, "invoice._bump_series")["year"], json!(2027));
        assert_eq!(params(&out, "invoice._insert_invoice")["year"], json!(2027));
    }

    #[test]
    fn the_same_instant_is_still_old_year_in_the_canaries() {
        // The zone decides, not a fixed offset: the Canaries are UTC+0 in winter, so 23:30 UTC on
        // 31/12 is still 2026 there, while it is already 2027 in Madrid.
        let out = sale_at("2026-12-31T23:30:00+00:00", Some("Atlantic/Canary"));
        assert_eq!(issue_date(&out), json!("2026-12-31"));
        assert_eq!(params(&out, "invoice._bump_series")["year"], json!(2026));
    }

    #[test]
    fn the_october_clock_change_moves_the_border_with_it() {
        // 25/10/2026, 01:00 UTC: Madrid goes from UTC+2 to UTC+1 and the Canaries from UTC+1 to
        // UTC+0. The night before, the local day starts at 22:00 UTC in Madrid; the night after, at
        // 23:00 UTC — a fixed «+2 h» would date 23:30 local on the 25th as the 26th.
        for (now, zone, expected) in [
            ("2026-10-24T22:30:00+00:00", MADRID, "2026-10-25"), // 00:30 local, still summer time
            ("2026-10-25T22:30:00+00:00", MADRID, "2026-10-25"), // 23:30 local, winter time already
            ("2026-10-25T23:00:00+00:00", MADRID, "2026-10-26"), // 00:00 local
            ("2026-10-24T23:30:00+00:00", "Atlantic/Canary", "2026-10-25"), // 00:30 local (UTC+1)
            ("2026-10-25T23:30:00+00:00", "Atlantic/Canary", "2026-10-25"), // 23:30 local (UTC+0)
        ] {
            assert_eq!(issue_date(&sale_at(now, Some(zone))), json!(expected), "{zone} at {now}");
        }
    }

    #[test]
    fn without_a_usable_zone_the_date_stays_on_utc() {
        // A hub whose runtime predates hub#1022 sends no zone, and an unreadable name is a wrong
        // clock by a known amount — never a guess. Both keep today's behaviour: the UTC date,
        // exactly what the runtime's own `timezone_name()` falls back to.
        let now = "2026-09-18T23:50:00+00:00";
        assert_eq!(issue_date(&sale_at(now, None)), json!("2026-09-18"));
        assert_eq!(issue_date(&sale_at(now, Some("Mars/Olympus_Mons"))), json!("2026-09-18"));
        assert_eq!(issue_date(&sale_at(now, Some("UTC"))), json!("2026-09-18"));
    }

    #[test]
    fn an_instant_without_an_offset_keeps_its_own_date_never_an_empty_one() {
        // The runtime writes `to_rfc3339`, but an instant without an offset cannot be placed on
        // any clock. The document keeps the date the host wrote — the behaviour before
        // invoice#78 — because an EMPTY `issue_date` would be stored (the column only refuses
        // NULL) and handed to the tax authority as the date of the invoice.
        let out = sale_at("2026-09-18T23:50:00", Some(MADRID));
        assert_eq!(issue_date(&out), json!("2026-09-18"));
        assert_eq!(params(&out, "invoice._bump_series")["year"], json!(2026));
    }

    #[test]
    fn every_door_that_issues_reads_the_same_clock() {
        // The manual invoice (F1) and the substitution (F3) are the other two doors into
        // `build_invoice`. A fix on the POS door alone would leave the F3 that replaces an F2
        // dated one day before the ticket it replaces.
        let now = "2026-09-18T23:50:00+00:00";
        let manual = create_invoice_pure(json!({
            "payload": { "series_code": "FACT", "customer_tax_id": "B12345678", "items": [
                { "description": "Menú", "quantity": 1_000_000, "unit_price": 1500, "tax_rate": 10.0 }
            ]},
            "context": context(now, Some(MADRID)),
        }));
        assert_eq!(issue_date(&manual), json!("2026-09-19"), "manual F1");

        let substitution = substitute_from_invoice_pure(json!({
            "payload": { "original_invoice_id": "f2-1", "customer_name": "ACME",
                         "customer_tax_id": "B12345678", "items": [
                { "description": "Menú", "quantity": 1_000_000, "unit_price": 1500,
                  "tax_rate": 10.0, "base_amount": 1500, "tax_amount": 150 }
            ]},
            "context": context(now, Some(MADRID)),
        }));
        assert_eq!(issue_date(&substitution), json!("2026-09-19"), "F3 substitution");
    }

    #[test]
    fn the_tax_rule_in_force_is_the_one_of_the_business_day() {
        // A rate that changes on 1 January applies to what is charged at 00:30 on 1 January in
        // Madrid: the rule's validity is read on the SAME day the document is dated, or the
        // invoice would say «2027» and declare the 2026 rate.
        let mut ctx = context("2026-12-31T23:30:00+00:00", Some(MADRID));
        ctx["country_code"] = json!("ES");
        ctx["region_code"] = json!("");
        ctx["reads"]["taxes.rules.list"] = json!([
            {"id": "es-vat-21", "country_code": "ES", "region_code": null,
             "tax_category_key": "standard", "rate_pct": 21.0, "tax_type": "vat",
             "parent_id": null, "valid_from": "2012-09-01"},
            {"id": "es-vat-22", "country_code": "ES", "region_code": null,
             "tax_category_key": "standard", "rate_pct": 22.0, "tax_type": "vat",
             "parent_id": null, "valid_from": "2027-01-01"}
        ]);
        let out = create_invoice_pure(json!({
            "payload": { "series_code": "FACT", "customer_tax_id": "B12345678", "items": [
                { "description": "Item", "quantity": 1_000_000, "unit_price": 10000,
                  "tax_rate": 22.0, "tax_category_key": "standard" }
            ]},
            "context": ctx,
        }));
        let breakdown: Value = serde_json::from_str(
            params(&out, "invoice._insert_invoice")["tax_breakdown"].as_str().expect("string"),
        )
        .expect("tax_breakdown is JSON");
        assert_eq!(breakdown[0]["rate"], json!(22.0), "the rule in force on 01/01/2027");
    }
}

#[cfg(test)]
mod operation_class_tests {
    //! invoice#75: the operation class of a line travels from the sale to the frozen
    //! `tax_breakdown` — and from there to the fiscal record — without anybody rewriting it.
    //!
    //! The class is not a free field of the sale line: it is the qualification of the line's tax
    //! CATEGORY (`taxes` rule, hub#292), resolved here from the same catalog `sales` charged by.
    //! What these tests pin is the chain for the classes that are NOT `subject` (reverse charge,
    //! not subject, exempt) and the rule that goes with them: only an `S1` line may declare a
    //! quota (AEAT validations §15.7, error 1237). A breakdown that says `S2` with 21 % of quota
    //! is rejected by the AEAT with the invoice number already spent in the chain.
    use super::*;

    fn rule(cat: &str, class: &str, rate: f64) -> Value {
        json!({ "id": format!("r-{cat}"), "country_code": "ES", "region_code": null,
                "tax_category_key": cat, "rate_pct": rate, "tax_type": "vat",
                "parent_id": null, "is_active": 1, "operation_class": class, "regime_key": "01" })
    }

    fn rules() -> Value {
        json!([
            rule("product.generic", "subject", 21.0),
            rule("eu.b2b.reverse", "subject_reverse", 0.0),
            rule("outside.location", "not_subject_location", 0.0),
            rule("not.subject", "not_subject", 0.0),
        ])
    }

    fn from_sale(items: Value, rules: Value) -> Output {
        let new_ids: Vec<Value> = (0..8).map(|i| json!(format!("id-{i}"))).collect();
        create_from_sale_pure(json!({
            "payload": { "sale_id": "sale-1", "document_type": "invoice",
                         "customer_tax_id": "DE811569869", "items": items },
            "context": { "new_ids": new_ids, "now": "2026-09-23T10:00:00+00:00",
                         "country_code": "ES", "region_code": "",
                         "reads": { "sales.get": [{ "id": "sale-1" }], "taxes.rules.list": rules } }
        }))
        .expect("from_sale does not trap")
    }

    fn line(name: &str, cat: &str, rate: f64, net: i64, tax: i64) -> Value {
        json!({ "product_name": name, "quantity": 1_000_000, "unit_price": net + tax,
                "tax_rate": rate, "tax_category_key": cat, "net_amount": net, "tax_amount": tax })
    }

    fn breakdown(out: &Output) -> Vec<Value> {
        assert!(out.error.is_none(), "unexpected refusal: {:?}", out.error.as_ref().map(|e| &e.code));
        serde_json::from_str::<Vec<Value>>(out.operations[2].params["tax_breakdown"].as_str().unwrap()).unwrap()
    }

    fn entry<'a>(d: &'a [Value], class: &str) -> &'a Value {
        d.iter().find(|e| e["class"] == json!(class)).unwrap_or_else(|| panic!("no `{class}` entry in {d:?}"))
    }

    #[test]
    fn a_reverse_charge_sale_line_is_frozen_as_subject_reverse_without_quota() {
        let out = from_sale(json!([line("Consultoría", "eu.b2b.reverse", 0.0, 100_000, 0)]), rules());
        let d = breakdown(&out);
        assert_eq!(d.len(), 1);
        let e = entry(&d, "subject_reverse");
        assert_eq!(e["base"], json!(100_000));
        assert_eq!(e["quota"], json!(0), "S2: the customer self-assesses the quota");
        assert_eq!(out.operations[2].params["tax_amount"], json!(0));
        assert_eq!(out.operations[2].params["total_amount"], json!(100_000));
    }

    #[test]
    fn the_everyday_subject_sale_keeps_exactly_the_same_breakdown() {
        let d = breakdown(&from_sale(json!([line("Caña", "product.generic", 21.0, 1000, 210)]), rules()));
        assert_eq!(
            d,
            vec![json!({ "tax": "vat", "regime": "01", "class": "subject", "rate": 21.0,
                         "base": 1000, "quota": 210 })]
        );
    }

    #[test]
    fn lines_of_different_class_are_different_blocks_and_same_class_adds_up() {
        let d = breakdown(&from_sale(
            json!([
                line("A", "product.generic", 21.0, 1000, 210),
                line("B", "eu.b2b.reverse", 0.0, 2000, 0),
                line("C", "eu.b2b.reverse", 0.0, 3000, 0),
                line("D", "outside.location", 0.0, 400, 0),
                line("E", "not.subject", 0.0, 500, 0),
            ]),
            rules(),
        ));
        assert_eq!(d.len(), 4, "{d:?}");
        assert_eq!(entry(&d, "subject")["quota"], json!(210));
        assert_eq!(entry(&d, "subject_reverse")["base"], json!(5000));
        assert_eq!(entry(&d, "not_subject_location")["base"], json!(400));
        assert_eq!(entry(&d, "not_subject")["base"], json!(500));
        for class in ["subject_reverse", "not_subject_location", "not_subject"] {
            assert_eq!(entry(&d, class)["quota"], json!(0), "{class} carries no quota");
        }
    }

    /// A catalog rule that qualifies the operation as reverse charge but still carries 21 %
    /// (`taxes` accepts it today) would have charged the customer 21 % and declared an `S2` with
    /// quota — which the AEAT rejects (§15.7) after the number is spent. Refused before sealing.
    #[test]
    fn a_non_subject_class_that_would_carry_a_quota_is_refused() {
        for class in ["subject_reverse", "not_subject", "not_subject_location", "exempt"] {
            let out = from_sale(
                json!([line("X", "bad.rule", 21.0, 1000, 210)]),
                json!([rule("bad.rule", class, 21.0)]),
            );
            assert_eq!(
                out.error.as_ref().map(|e| e.code.as_str()),
                Some("invoice.quota_on_non_subject_class"),
                "{class} at 21 % was sealed with a quota"
            );
            assert!(out.operations.is_empty(), "{class}: a refusal persists nothing");
        }
    }

    /// The equivalence surcharge is a quota too: a reverse-charge rule at 0 % that still carries a
    /// surcharge component would declare an `S2` with `CuotaRecargoEquivalencia`.
    #[test]
    fn a_surcharge_on_a_non_subject_class_is_refused_too() {
        let mut rules = json!([rule("bad.rule", "subject_reverse", 0.0)]);
        rules.as_array_mut().unwrap().push(json!({
            "id": "r-bad-re", "country_code": "ES", "region_code": null,
            "tax_category_key": "bad.rule", "rate_pct": 5.2, "tax_type": "surcharge",
            "parent_id": "r-bad.rule", "is_active": 1, "component_label": "Recargo de equivalencia" }));
        let out = from_sale(json!([line("X", "bad.rule", 5.2, 1000, 52)]), rules);
        assert_eq!(out.error.as_ref().map(|e| e.code.as_str()), Some("invoice.quota_on_non_subject_class"));
    }

    /// The manual door (`invoice.create`) seals through the same guard.
    #[test]
    fn the_manual_door_refuses_it_too() {
        let new_ids: Vec<Value> = (0..8).map(|i| json!(format!("id-{i}"))).collect();
        let out = create_invoice_pure(json!({
            "payload": { "series_code": "FACT", "customer_tax_id": "DE811569869", "items": [
                { "description": "X", "quantity": 1_000_000, "unit_price": 1000,
                  "tax_rate": 21.0, "tax_category_key": "bad.rule" } ] },
            "context": { "new_ids": new_ids, "now": "2026-09-23T10:00:00+00:00",
                         "country_code": "ES", "region_code": "",
                         "reads": { "taxes.rules.list": [rule("bad.rule", "subject_reverse", 21.0)] } }
        }));
        assert_eq!(out.error.as_ref().map(|e| e.code.as_str()), Some("invoice.quota_on_non_subject_class"));
    }

    /// The verbatim door (`invoice.substitute`, an F3 copied from a ticket) seals through the same
    /// guard: a ticket line whose category qualifies as reverse charge but was charged 21 % is not
    /// copied into a full invoice the AEAT would reject.
    #[test]
    fn the_verbatim_f3_door_refuses_it_too() {
        let new_ids: Vec<Value> = (0..8).map(|i| json!(format!("id-{i}"))).collect();
        let out = substitute_from_invoice_pure(json!({
            "payload": { "original_invoice_id": "inv-f2-1", "customer_tax_id": "DE811569869", "items": [
                { "description": "X", "quantity": 1_000_000, "unit_price": 121, "tax_rate": 21.0,
                  "tax_category_key": "bad.rule", "base_amount": 100, "tax_amount": 21 } ] },
            "context": { "new_ids": new_ids, "now": "2026-09-23T10:00:00+00:00",
                         "country_code": "ES", "region_code": "",
                         "reads": { "taxes.rules.list": [rule("bad.rule", "subject_reverse", 21.0)] } }
        }));
        assert_eq!(out.error.as_ref().map(|e| e.code.as_str()), Some("invoice.quota_on_non_subject_class"));
        assert!(out.operations.is_empty(), "a refusal persists nothing");
    }

    /// The sign does not matter: a negative quota on a non-subject entry is a quota all the same
    /// (a returned line under reverse charge charged at 21 %). Refused with its own code, not as a
    /// negative total.
    #[test]
    fn a_negative_quota_on_a_non_subject_class_is_refused_with_its_own_code() {
        let new_ids: Vec<Value> = (0..8).map(|i| json!(format!("id-{i}"))).collect();
        let out = substitute_from_invoice_pure(json!({
            "payload": { "original_invoice_id": "inv-f2-2", "customer_tax_id": "DE811569869", "items": [
                { "description": "X", "quantity": 1_000_000, "unit_price": 1210, "tax_rate": 21.0,
                  "tax_category_key": "prod", "base_amount": 1000, "tax_amount": 210 },
                { "description": "Returned", "quantity": 1_000_000, "unit_price": -121, "tax_rate": 21.0,
                  "tax_category_key": "bad.rule", "base_amount": -100, "tax_amount": -21 } ] },
            "context": { "new_ids": new_ids, "now": "2026-09-23T10:00:00+00:00",
                         "country_code": "ES", "region_code": "",
                         "reads": { "taxes.rules.list": [
                             rule("prod", "subject", 21.0), rule("bad.rule", "subject_reverse", 21.0) ] } }
        }));
        assert_eq!(out.error.as_ref().map(|e| e.code.as_str()), Some("invoice.quota_on_non_subject_class"));
    }
}
