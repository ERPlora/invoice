-- Línea de factura (importes precalculados por el handler). Runtime inyecta :hub_id, :now.
-- D2 (idempotencia): solo inserta la línea si la factura padre (:invoice_id) existe.
-- Si _insert_invoice fue no-op por duplicado de venta, su :invoice_id NO está en la
-- tabla → la línea tampoco se inserta (no quedan ítems huérfanos). En la primera
-- emisión el padre existe en la MISMA transacción → la línea se inserta normal.
-- INSERT...SELECT con WHERE EXISTS es portable SQLite+Postgres.
INSERT INTO invoice_invoiceitem
  (id, hub_id, invoice_id, line_number, description, quantity, unit_price, tax_rate,
   base_amount, tax_amount, total_amount, product_id, created_at)
SELECT
   :line_id, :hub_id, :invoice_id, :line_number, :description, :quantity, :unit_price, :tax_rate,
   :base_amount, :tax_amount, :total_amount, :product_id, :now
WHERE EXISTS (
    SELECT 1 FROM invoice_invoice WHERE id = :invoice_id AND hub_id = :hub_id
);
