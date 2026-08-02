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
use erplora_guest_sdk::units::QUANTITY_SCALE;
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;
use erplora_guest_sdk::{Event, Operation, Output};
use serde_json::{json, Map, Value};

#[cfg(feature = "guest")]
use extism_pdk::*;

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn create_invoice(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    Ok(Json(create_invoice_pure(input.into_inner().into_value())))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn create_from_sale(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    Ok(Json(create_from_sale_pure(input.into_inner().into_value())))
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

/// Régimen por defecto: el general.
const DEFAULT_REGIME: &str = "01";

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
    fn nacional(rate: f64) -> Self {
        FiscalKey {
            kind: "vat".to_string(),
            regime: DEFAULT_REGIME.to_string(),
            class: "subject".to_string(),
            exempt_reason: String::new(),
            rate,
            surcharge_rate: 0.0,
            has_surcharge: false,
        }
    }
}

/// Una línea del desglose: su clave fiscal y los importes acumulados (céntimos).
struct DesgloseLine {
    key: FiscalKey,
    base: i64,
    quota: i64,
    surcharge_quota: i64,
}

/// Filas del catálogo de reglas fiscales pre-cargado por el runtime. Desenvuelve tanto el array
/// directo como la forma paginada `{"rows":[…]}` — misma tolerancia que `sales`.
fn rule_catalog(context: &Value) -> Vec<&Value> {
    let Some(node) = context.get("reads").and_then(|r| r.get("taxes.rules.list")) else {
        return Vec::new();
    };
    match node {
        Value::Array(a) => a.iter().collect(),
        Value::Object(_) => node
            .get("rows")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn rule_field(rule: &Value, k: &str) -> String {
    s(rule.get(k).unwrap_or(&Value::Null))
}

fn rule_active(rule: &Value) -> bool {
    match rule.get("is_active") {
        None | Some(Value::Null) => true,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(Value::String(x)) => matches!(x.as_str(), "1" | "true" | "True" | "yes"),
        _ => false,
    }
}

fn rule_valid_on(rule: &Value, date: &str) -> bool {
    if date.is_empty() {
        return true;
    }
    let from = rule_field(rule, "valid_from");
    let until = rule_field(rule, "valid_to");
    (from.is_empty() || from.as_str() <= date) && (until.is_empty() || until.as_str() >= date)
}

/// Resuelve la regla RAÍZ aplicable a `(cc, rc, cat, date)`. Precedencia: región exacta → regla de
/// país (región vacía/NULL). Dentro de un nivel, la `valid_from` más reciente, luego `id`.
///
/// Réplica de `taxes::resolve_root` / `sales::resolve_root` — los guests WASM no pueden llamarse
/// entre sí, así que la regla de precedencia vive escrita tres veces. Si diverge, divergen el
/// precio cobrado y el impuesto declarado, así que los tres tienen el mismo test de región.
fn resolve_root<'a>(rules: &[&'a Value], cc: &str, rc: &str, cat: &str, date: &str) -> Option<&'a Value> {
    let eligible: Vec<&Value> = rules
        .iter()
        .copied()
        .filter(|r| {
            rule_field(r, "parent_id").is_empty()
                && rule_active(r)
                && rule_valid_on(r, date)
                && rule_field(r, "country_code").eq_ignore_ascii_case(cc)
                && rule_field(r, "tax_category_key") == cat
        })
        .collect();
    let pick = |mut rows: Vec<&'a Value>| -> Option<&'a Value> {
        rows.sort_by(|a, b| {
            rule_field(b, "valid_from")
                .cmp(&rule_field(a, "valid_from"))
                .then_with(|| rule_field(a, "id").cmp(&rule_field(b, "id")))
        });
        rows.first().copied()
    };
    if !rc.is_empty() {
        if let Some(r) = pick(
            eligible.iter().copied()
                .filter(|r| rule_field(r, "region_code").eq_ignore_ascii_case(rc))
                .collect(),
        ) {
            return Some(r);
        }
    }
    pick(eligible.iter().copied().filter(|r| rule_field(r, "region_code").is_empty()).collect())
        .or_else(|| pick(eligible.clone()))
}

/// Clave fiscal de una línea. `rate_hint` es el tipo congelado en la línea (el que se respeta
/// cuando no hay regla que resolver).
fn fiscal_key(item: &Value, rules: &[&Value], cc: &str, rc: &str, date: &str, rate_hint: f64) -> FiscalKey {
    let cat = s(item.get("tax_category_key").unwrap_or(&Value::Null));
    let Some(root) = (if cat.is_empty() { None } else { resolve_root(rules, cc, rc, &cat, date) })
    else {
        return FiscalKey::nacional(rate_hint);
    };

    // El recargo de equivalencia es un COMPONENTE de la regla del IVA (`parent_id` = raíz): aporta
    // cuota sobre la misma base, pero no es otra operación ni otro tipo. Va DENTRO de la línea.
    let root_id = rule_field(root, "id");
    let surcharge: f64 = rules
        .iter()
        .copied()
        .filter(|r| {
            !rule_field(r, "id").is_empty()
                && rule_field(r, "parent_id") == root_id
                && rule_active(r)
                && rule_valid_on(r, date)
        })
        .map(|r| f(r.get("rate_pct").unwrap_or(&Value::Null), 0.0))
        .sum();

    let class = {
        let c = rule_field(root, "operation_class").trim().to_ascii_lowercase();
        if c.is_empty() { "subject".to_string() } else { c }
    };
    let exempt_reason = if class == "exempt" {
        rule_field(root, "exempt_reason").trim().to_ascii_uppercase()
    } else {
        String::new()
    };
    let kind = {
        let k = rule_field(root, "tax_type").trim().to_ascii_lowercase();
        if k.is_empty() { "vat".to_string() } else { k }
    };
    let regime = {
        let r = rule_field(root, "regime_key").trim().to_string();
        if r.is_empty() { DEFAULT_REGIME.to_string() } else { r }
    };
    FiscalKey {
        kind,
        regime,
        class,
        exempt_reason,
        // El tipo DECLARADO es el de la raíz. La línea trae la tasa combinada (21 + 5,2 = 26,2)
        // porque es lo que se le cobró al cliente, pero 26,2 no es un tipo que exista.
        rate: f(root.get("rate_pct").unwrap_or(&Value::Null), rate_hint),
        surcharge_rate: surcharge,
        has_surcharge: surcharge > 0.0,
    }
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
        let rate = item.get("tax_rate").map(|v| f(v, 0.0)).unwrap_or(0.0); // tasa %
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
                let tax = money::percent_of(base, rd);
                (base, tax)
            }
        };
        let total = base + tax;
        base_total += base;
        tax_total += tax;

        // Clave fiscal de la línea (hub#292): qué impuesto, régimen y calificación. Se resuelve del
        // catálogo por la categoría fiscal congelada en la línea; sin catálogo/categoría/regla cae
        // a venta nacional sujeta y no exenta, que es lo que declaraban las facturas de antes.
        let key = fiscal_key(item, &rules, &fiscal.country, &fiscal.region, &fiscal.date, rate);
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
        } else {
            breakdown.push(DesgloseLine { key, base, quota: main_quota, surcharge_quota });
        }

        let line_id = new_ids.get(i + 2).map(s).unwrap_or_default();
        let mut p = Map::new();
        p.insert("line_id".into(), json!(line_id));
        p.insert("invoice_id".into(), json!(invoice_id));
        p.insert("line_number".into(), json!(i as i64 + 1));
        p.insert("description".into(), json!(s(item.get("description").unwrap_or(&Value::Null))));
        p.insert("quantity".into(), json!(qty)); // punto fijo 10⁶ (INTEGER, ADR-0147)
        p.insert("unit_price".into(), json!(unit_price)); // céntimos
        p.insert("tax_rate".into(), json!(rate));         // tasa % (REAL)
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
    Output { operations: ops, events: vec![event] }
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
            rules: rule_catalog(&context).into_iter().cloned().collect(),
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
    let items = payload.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
    let series_code = sor(&payload, "series_code", "FACT");
    let ty = payload.get("invoice_type").map(s).filter(|x| !x.is_empty());
    build_invoice(&new_ids, &now, &series_code, ty.as_deref(), &payload, items, &fiscal)
}

/// create_from_sale: adapta el evento sale.completed (líneas) a una F2 serie TICKET.
pub fn create_from_sale_pure(input: Value) -> Output {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let (new_ids, now) = ctx_ids(&input);
    let fiscal = FiscalContext::from_input(&input, &now);
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
    build_invoice(&new_ids, &now, series_code, Some(inv_type), &Value::Object(header), &items, &fiscal)
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
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        json!({ "payload": payload, "context": { "new_ids": new_ids, "now": "2026-05-31T10:00:00+00:00" } })
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
        let out = create_from_sale_pure(inp(payload, 6));
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
        let out = create_from_sale_pure(inp(payload, 6));
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
        let out = create_from_sale_pure(inp(payload, 6));
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
        let out = create_from_sale_pure(inp(payload, 6));
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
        let out = create_from_sale_pure(inp(payload, 6));
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
        let out = create_from_sale_pure(inp(payload, 6));
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
        let out = create_from_sale_pure(inp(payload, 6));
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
        let out = create_from_sale_pure(inp(payload, 6));
        assert_eq!(out.operations[2].params["substitutes_invoice_id"], json!(""));
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
        ctx.insert("reads".into(), json!({ "taxes.rules.list": rules }));
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
        let d = desglose(&create_from_sale_pure(inp_rules(payload, 6, rules, "")));
        assert_eq!(d[0]["class"], json!("exempt"));
        assert_eq!(d[0]["exempt_reason"], json!("E1"));
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
}
