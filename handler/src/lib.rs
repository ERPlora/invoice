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
fn sor(p: &Value, k: &str, d: &str) -> String {
    let x = s(p.get(k).unwrap_or(&Value::Null));
    if x.is_empty() { d.to_string() } else { x }
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
) -> Output {
    let invoice_id = new_ids.first().map(s).unwrap_or_default();
    let year = year_from(now);
    let issue_date = now.split('T').next().unwrap_or(now).to_string();
    let (def_type, def_name) = series_defaults(series_code);
    let inv_type = invoice_type_override.unwrap_or(def_type).to_string();

    let mut base_total: i64 = 0; // céntimos
    let mut tax_total: i64 = 0;  // céntimos
    let mut breakdown: Vec<(String, i64, i64)> = Vec::new(); // (rate, base_cents, tax_cents)
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
        let qty = item.get("quantity").map(|v| f(v, 1.0)).unwrap_or(1.0); // cantidad fraccionable
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
                let qd = Decimal::from_f64(qty).unwrap_or(Decimal::ZERO);
                let rd = Decimal::from_f64(rate).unwrap_or(Decimal::ZERO);
                let base = money::mul_qty(unit_price, qd);
                let tax = money::percent_of(base, rd);
                (base, tax)
            }
        };
        let total = base + tax;
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

    let mut tb = Map::new();
    for (k, b, t) in &breakdown {
        // base/tax del desglose en céntimos (INTEGER) — contrato inter-módulo.
        tb.insert(k.clone(), json!({ "base": *b, "tax": *t }));
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
    h.insert("tax_breakdown".into(), json!(Value::Object(tb).to_string()));
    h.insert("source_type".into(), json!(sor(header, "source_type", "manual")));
    h.insert("source_id".into(), header.get("source_id").cloned().unwrap_or(Value::Null));
    h.insert("notes".into(), json!(sor(header, "notes", "")));
    ops[header_idx] = Operation::sql("invoice._insert_invoice", h);

    let event = Event::new("invoice.created", json!({
        "sender": "invoice", "invoice_id": invoice_id,
        "invoice_type": inv_type, "total": base_total + tax_total, // céntimos (contrato inter-módulo)
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
    // sale.completed con precios IVA-INCLUIDO (D1): la venta YA extrajo base imponible
    // (net_amount) e IVA (tax_amount) por línea — se pasan a build_invoice como
    // base_amount/tax_amount para que NO se vuelva a sumar IVA sobre el bruto. El
    // unit_price sigue siendo el bruto/unitario (display). Compat: si un evento viejo
    // no trae net/tax, se omiten y build_invoice cae al cálculo IVA-excluido.
    let items: Vec<Value> = raw.iter().map(|it| {
        let mut m = Map::new();
        m.insert("description".into(), json!(s(it.get("product_name").unwrap_or(&Value::Null))));
        m.insert("quantity".into(), it.get("quantity").cloned().unwrap_or(json!(1)));
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
    build_invoice(&new_ids, &now, series_code, Some(inv_type), &Value::Object(header), &items)
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
                { "description": "Servicio", "quantity": 1, "unit_price": 10000, "tax_rate": 21.0 },
                { "description": "Otro", "quantity": 2, "unit_price": 5000, "tax_rate": 10.0 }
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
                { "product_name": "Café", "quantity": 2, "unit_price": 100, "tax_rate": 21.0, "product_id": "p1" }
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
                { "product_name": "Café", "quantity": 1, "unit_price": 121, "tax_rate": 21.0,
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
                { "product_name": "Corte", "quantity": 1, "unit_price": 1500, "tax_rate": 21.0 }
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
            "items": [{ "product_name": "Café", "quantity": 1, "unit_price": 100, "tax_rate": 21.0 }]
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
            "items": [{ "product_name": "Servicio", "quantity": 1, "unit_price": 12100, "tax_rate": 21.0,
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
            "items": [{ "product_name": "Café", "quantity": 1, "unit_price": 100, "tax_rate": 21.0 }]
        });
        let out = create_from_sale_pure(inp(payload, 6));
        assert_eq!(out.operations[2].params["invoice_type"], json!("F2"));
        assert_eq!(out.operations[2].params["series"], json!("TICKET"));
    }
}
