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

fn round2(x: f64) -> f64 {
    let scaled = x * 100.0;
    let floor = scaled.floor();
    let diff = scaled - floor;
    let r = if (diff - 0.5).abs() < 1e-9 {
        if (floor as i64) % 2 == 0 { floor } else { floor + 1.0 }
    } else {
        scaled.round()
    };
    r / 100.0
}
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
fn sor(p: &Value, k: &str, d: &str) -> String {
    let x = s(p.get(k).unwrap_or(&Value::Null));
    if x.is_empty() { d.to_string() } else { x }
}
fn n(x: f64) -> Value { json!(round2(x)) }

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
) -> Output {
    let invoice_id = new_ids.first().map(s).unwrap_or_default();
    let year = year_from(now);
    let issue_date = now.split('T').next().unwrap_or(now).to_string();
    let (def_type, def_name) = series_defaults(series_code);
    let inv_type = invoice_type_override.unwrap_or(def_type).to_string();

    let mut base_total = 0.0;
    let mut tax_total = 0.0;
    let mut breakdown: Vec<(String, f64, f64)> = Vec::new();
    let mut ops: Vec<Operation> = Vec::new();

    // 1) asegurar la serie (idempotente) y 2) incrementar su contador.
    let mut ens = Map::new();
    ens.insert("new_id".into(), new_ids.get(1).cloned().unwrap_or(Value::Null));
    ens.insert("code".into(), json!(series_code));
    ens.insert("name".into(), json!(def_name));
    ens.insert("invoice_type".into(), json!(inv_type));
    ens.insert("year".into(), json!(year.parse::<i64>().unwrap_or(2026)));
    ens.insert("prefix".into(), json!(series_code));
    ops.push(Operation::sql("invoice._ensure_series", ens));

    let mut bump = Map::new();
    bump.insert("code".into(), json!(series_code));
    bump.insert("year".into(), json!(year.parse::<i64>().unwrap_or(2026)));
    ops.push(Operation::sql("invoice._bump_series", bump));

    let header_idx = ops.len();
    ops.push(Operation::sql("invoice._insert_invoice", Map::new())); // placeholder

    // 3) líneas (ids new_ids[2..]).
    for (i, item) in items.iter().enumerate() {
        let qty = item.get("quantity").map(|v| f(v, 1.0)).unwrap_or(1.0);
        let unit_price = f(item.get("unit_price").unwrap_or(&Value::Null), 0.0);
        let rate = item.get("tax_rate").map(|v| f(v, 0.0)).unwrap_or(0.0);
        let base = round2(qty * unit_price);
        let tax = round2(base * rate / 100.0);
        let total = round2(base + tax);
        base_total += base;
        tax_total += tax;

        let key = format!("{:.2}", rate);
        if let Some(e) = breakdown.iter_mut().find(|(k, _, _)| *k == key) {
            e.1 += base; e.2 += tax;
        } else {
            breakdown.push((key, base, tax));
        }

        let line_id = new_ids.get(i + 2).map(s).unwrap_or_default();
        let mut p = Map::new();
        p.insert("line_id".into(), json!(line_id));
        p.insert("invoice_id".into(), json!(invoice_id));
        p.insert("line_number".into(), json!(i as i64 + 1));
        p.insert("description".into(), json!(s(item.get("description").unwrap_or(&Value::Null))));
        p.insert("quantity".into(), json!(qty));
        p.insert("unit_price".into(), n(unit_price));
        p.insert("tax_rate".into(), n(rate));
        p.insert("base_amount".into(), n(base));
        p.insert("tax_amount".into(), n(tax));
        p.insert("total_amount".into(), n(total));
        p.insert("product_id".into(), item.get("product_id").cloned().unwrap_or(Value::Null));
        ops.push(Operation::sql("invoice._insert_line", p));
    }

    let mut tb = Map::new();
    for (k, b, t) in &breakdown {
        tb.insert(k.clone(), json!({ "base": round2(*b), "tax": round2(*t) }));
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
    h.insert("base_amount".into(), n(base_total));
    h.insert("tax_amount".into(), n(tax_total));
    h.insert("total_amount".into(), n(base_total + tax_total));
    h.insert("tax_breakdown".into(), json!(Value::Object(tb).to_string()));
    h.insert("source_type".into(), json!(sor(header, "source_type", "manual")));
    h.insert("source_id".into(), header.get("source_id").cloned().unwrap_or(Value::Null));
    h.insert("notes".into(), json!(sor(header, "notes", "")));
    ops[header_idx] = Operation::sql("invoice._insert_invoice", h);

    let event = Event::new("invoice.created", json!({
        "sender": "invoice", "invoice_id": invoice_id,
        "invoice_type": inv_type, "total": round2(base_total + tax_total),
    }));
    Output { operations: ops, events: vec![event] }
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
    let empty: Vec<Value> = Vec::new();
    let items = payload.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
    let series_code = sor(&payload, "series_code", "FACT");
    let ty = payload.get("invoice_type").map(s).filter(|x| !x.is_empty());
    build_invoice(&new_ids, &now, &series_code, ty.as_deref(), &payload, items)
}

/// create_from_sale: adapta el evento sale.completed (líneas) a una F2 serie TICKET.
pub fn create_from_sale_pure(input: Value) -> Output {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let (new_ids, now) = ctx_ids(&input);
    let empty: Vec<Value> = Vec::new();
    let raw = payload.get("items").and_then(|v| v.as_array()).unwrap_or(&empty);
    // map líneas de venta → líneas de factura (description ← product_name).
    let items: Vec<Value> = raw.iter().map(|it| json!({
        "description": s(it.get("product_name").unwrap_or(&Value::Null)),
        "quantity": it.get("quantity").cloned().unwrap_or(json!(1)),
        "unit_price": it.get("unit_price").cloned().unwrap_or(json!(0)),
        "tax_rate": it.get("tax_rate").cloned().unwrap_or(json!(0)),
        "product_id": it.get("product_id").cloned().unwrap_or(Value::Null),
    })).collect();
    let mut header = Map::new();
    header.insert("customer_name".into(), payload.get("customer_name").cloned().unwrap_or(json!("")));
    header.insert("source_type".into(), json!("sale"));
    header.insert("source_id".into(), payload.get("sale_id").cloned().unwrap_or(Value::Null));
    build_invoice(&new_ids, &now, "TICKET", Some("F2"), &Value::Object(header), &items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inp(payload: Value, ids: usize) -> Value {
        let new_ids: Vec<Value> = (0..ids).map(|i| json!(format!("id-{i}"))).collect();
        json!({ "payload": payload, "context": { "new_ids": new_ids, "now": "2026-05-31T10:00:00+00:00" } })
    }

    #[test]
    fn create_invoice_totals_and_ops() {
        let payload = json!({
            "series_code": "FACT", "issuer_nif": "B1", "customer_name": "ACME",
            "items": [
                { "description": "Servicio", "quantity": 1, "unit_price": 100.0, "tax_rate": 21.0 },
                { "description": "Otro", "quantity": 2, "unit_price": 50.0, "tax_rate": 10.0 }
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
        assert_eq!(inv["base_amount"], json!(200.0));     // 100 + 100
        assert_eq!(inv["tax_amount"], json!(31.0));        // 21 + 10
        assert_eq!(inv["total_amount"], json!(231.0));
        assert_eq!(out.operations[3].params["invoice_id"], json!("id-0"));
        assert_eq!(out.events[0].name, "invoice.created");
    }

    #[test]
    fn from_sale_builds_f2_ticket() {
        let payload = json!({
            "sale_id": "sale1", "customer_name": "Bar Manolo",
            "items": [
                { "product_name": "Café", "quantity": 2, "unit_price": 1.0, "tax_rate": 21.0, "product_id": "p1" }
            ]
        });
        let out = create_from_sale_pure(inp(payload, 6));
        let inv = &out.operations[2].params;
        assert_eq!(inv["invoice_type"], json!("F2"));
        assert_eq!(inv["series"], json!("TICKET"));
        assert_eq!(inv["source_type"], json!("sale"));
        assert_eq!(inv["source_id"], json!("sale1"));
        // línea: base 2*1=2, tax 21% = 0.42.
        let line = &out.operations[3].params;
        assert_eq!(line["description"], json!("Café"));
        assert_eq!(line["base_amount"], json!(2.0));
        assert_eq!(line["tax_amount"], json!(0.42));
    }
}
