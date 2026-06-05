-- Línea de factura (importes precalculados por el handler). Runtime inyecta :hub_id, :now.
INSERT INTO invoice_invoiceitem
  (id, hub_id, invoice_id, line_number, description, quantity, unit_price, tax_rate,
   base_amount, tax_amount, total_amount, product_id, created_at)
VALUES
  (:line_id, :hub_id, :invoice_id, :line_number, :description, :quantity, :unit_price, :tax_rate,
   :base_amount, :tax_amount, :total_amount, :product_id, :now);
