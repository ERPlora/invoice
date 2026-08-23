-- Copia las LÍNEAS de la original a la rectificativa, con el DINERO negado (invoice#59).
--
-- EL DEFECTO. `invoice.rectify` escribía cabecera y nada más: la rectificativa nacía con cero filas
-- en `invoice_invoiceitem`. `invoice.lines` devolvía vacío, y el detalle en pantalla y el documento
-- IMPRESO salían con un total sin conceptos debajo. El art. 6 + art. 15 del RD 1619/2012 piden que
-- una rectificativa lleve el contenido de una factura, no solo su cabecera.
--
-- N FILAS SIN N IDS DEL RUNTIME. La issue prescribía pasar el command a un handler WASM porque
-- «N líneas necesitan N ids y un command declarativo recibe un solo `:new_id`». La primera mitad es
-- cierta; la segunda no se sigue: los ids NO tienen por qué venir del runtime. Un solo
-- `INSERT … SELECT` escribe N filas con ids DETERMINISTAS — exactamente el truco que
-- `_insert_allocation.sql` ya documenta en este módulo («it needs no id from the runtime»). Y
-- quedarse declarativo deja la cadena entera dentro del único gate que la ejecuta: el gate del
-- módulo no tiene checkout de ERPlora/hub, así que no compila el handler a wasm32 ni corre
-- `cargo test` de `handler/` —lo dice en voz alta, «handler WASM SIN VERIFICAR»— pero sí levanta un
-- Postgres real y corre `tests/rectify_lines.postgres.test.py`.
--
-- EL ID. `<id de la rectificativa>/<id de la línea original>`. Determinista (no hace falta id del
-- runtime), único por construcción (`l.id` es PK, `r.id` es PK) y legible: el id de la línea nueva
-- lleva dentro la línea que rectifica, que es la trazabilidad que un auditor pide. No se deriva de
-- `line_number` a propósito: la columna no es única en el esquema, así que una factura heredada con
-- dos líneas con el mismo `line_number` habría colisionado en la PK y, con `transaction: true`,
-- tumbado la rectificación entera.
--
-- QUÉ SE NIEGA: el DINERO de la línea (`base_amount`, `tax_amount`, `total_amount`) y su
-- `quantity`. Los importes, porque es lo que una rectificativa deshace y es lo que hace que Σ
-- líneas cuadre con la cabecera negada de `rectify_insert.sql`.
--
-- El RECUENTO, decidido contra el mercado (11 referencias + el XSD de Facturae), no por gusto. Los
-- productos se parten en dos campos: documento TIPADO, donde el signo vive en el tipo de documento
-- y la línea va siempre en positivo (notas de crédito de Stripe, SAP B1, Business Central, Xero,
-- Shopify), y documento FIRMADO, donde lo lleva la línea (WooCommerce, Lightspeed X-Series, la capa
-- de informes de Odoo, y lo que describen la guía Sorolla2 de la AEAT y las directrices
-- Facturae/UXXI-EC para una rectificativa). El campo tipado nos está cerrado: desde invoice#5
-- nuestra cabecera y nuestros importes de línea YA son negativos. Dentro del campo firmado el
-- mercado es unánime.
--
-- Y lo que decide es mecánico: la regla FE-R005 de Facturae exige por línea
-- `TotalCost = Quantity × UnitPriceWithoutTax` (±0,01). Dejar el recuento en positivo imprime y
-- emite `1 × 12,10 = −12,10`, que incumple esa regla en TODA rectificativa. Se firma EXACTAMENTE UN
-- factor: negar también `unit_price` devolvería el producto a positivo. (VeriFactu no lo ve —el
-- `RegistroAlta` solo lleva el `Desglose`, sin líneas—; el día que emitamos Facturae, sí.)
--
-- Es además la única opción que preserva el signo signifique lo que signifique la línea: en una
-- línea IVA-INCLUIDO nacida de una venta, `unit_price` es el precio BRUTO de display, así que lo que
-- se cumple en la original es `quantity × unit_price == total_amount` (2 × 605 == 1210) y no
-- `== base_amount`. Negar el recuento mantiene esa identidad cierta con los dos lados cambiados.
--
-- NO se niegan los descriptores: `tax_rate` y `surcharge_rate` (un 21 % rectificado sigue siendo un
-- 21 %, la misma regla que ya sigue el `tax_breakdown`) ni `unit_price` (el precio de lo vendido no
-- se vuelve negativo porque se devuelva). `surcharge_rate` se copia TAL CUAL, NULL incluido: NULL
-- marca la generación heredada cuyo `tax_rate` puede ser todavía un tipo combinado (migración 006),
-- y rellenarlo aquí falsearía la generación de una fila fiscal congelada.
--
-- ⚠️ EL DESGLOSE NO SE RE-DERIVA DE AQUÍ. `tax_breakdown` lo copia negado del snapshot de la
-- original `rectify_insert.sql`, y así se queda: la base fiscal es la de la TARIFA del documento
-- (ADR-0210) y el desglose se cierra una vez por TIPO, no por línea (ADR-0123 §4). Estas líneas
-- SUMAN ese desglose; no lo mandan. El test lo cruza en los dos sentidos.
--
-- LA GUARDA es la misma que la de `_insert_allocation.sql`, y por la misma razón: se busca la
-- rectificativa **por el id que ESTA petición acuñó** (`:new_id`). Si `rectify_insert.sql` fue
-- no-op —la original no existe, ya está rectificada, o es ella misma una rectificativa— ninguna fila
-- lleva ese id, el JOIN no encuentra nada y no se copia ninguna línea (patrón ADR-0020: la misma
-- precondición en todas las puertas de la cadena). El `NOT EXISTS` final cubre además el reintento
-- que repite el MISMO `:new_id`, que la guarda por id sola no vería.
--
-- `l.hub_id = r.hub_id` NO es decorativo: sin él, una fila de otro hub apuntando a nuestra factura
-- —la escriba quien la escriba— aterrizaría con su concepto y su dinero en la rectificativa de
-- nuestro cliente. Va en el test, con la fila del vecino plantada a mano.
--
-- Runtime inyecta :hub_id, :now, :new_id; el resto viaja en el payload.
INSERT INTO invoice_invoiceitem (
    id, hub_id, invoice_id, line_number, description, quantity, unit_price,
    tax_rate, surcharge_rate, tax_category_key,
    base_amount, tax_amount, total_amount, product_id, created_at
)
SELECT
    r.id || '/' || l.id,
    r.hub_id, r.id, l.line_number, l.description, -l.quantity, l.unit_price,
    l.tax_rate, l.surcharge_rate, l.tax_category_key,
    -l.base_amount, -l.tax_amount, -l.total_amount, l.product_id, :now
FROM invoice_invoice r
JOIN invoice_invoiceitem l
  ON l.hub_id = r.hub_id AND l.invoice_id = r.rectifies_invoice_id
WHERE r.hub_id = :hub_id
  AND r.id = :new_id
  AND NOT EXISTS (
      SELECT 1 FROM invoice_invoiceitem x
      WHERE x.hub_id = r.hub_id AND x.invoice_id = r.id
  );
