-- Invoice · 002 — ADR-0085: traza de la CATEGORÍA fiscal en la línea de factura. La factura ya
-- congela `tax_rate` (%) e importes; añadimos `tax_category_key` para conservar la categoría
-- resuelta en la venta (snapshot inmutable). Migración ADITIVA. NULL en factura manual sin categoría.
ALTER TABLE invoice_invoiceitem ADD COLUMN tax_category_key TEXT;
