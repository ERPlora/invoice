-- ADR-0147 — `invoice_invoiceitem.quantity`: REAL lógico → punto fijo ENTERO escala 10⁶.
-- Ver migrations/sqlite/004 para el razonamiento completo (ventana mixta + umbral 100000).
-- Postgres respeta el tipo declarado: basta el ALTER, sin reconstruir la tabla.
ALTER TABLE invoice_invoiceitem
    ALTER COLUMN quantity TYPE BIGINT
    USING (CASE WHEN quantity >= 100000 THEN ROUND(quantity) ELSE ROUND(quantity * 1000000) END)::BIGINT;
ALTER TABLE invoice_invoiceitem ALTER COLUMN quantity SET DEFAULT 1000000;
