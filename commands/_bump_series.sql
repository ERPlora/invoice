-- Incrementa el contador de la serie (monotónico). Runtime inyecta :hub_id;
-- :code/:year/:source_type/:source_id los aporta el handler.
-- D2 (idempotencia): NO consume número si ya existe factura para este origen real
-- (source_id NOT NULL). Con source_id NULL (factura manual) el guard nunca encuentra
-- duplicado (source_id = NULL es siempre falso) y el contador avanza con normalidad.
-- Plain UPDATE: RHS sin cualificar es portable SQLite+Postgres (no hay ON CONFLICT).
UPDATE invoice_invoiceseries
SET current_number = current_number + 1
WHERE hub_id = :hub_id AND code = :code AND year = :year
  AND NOT EXISTS (
    SELECT 1 FROM invoice_invoice
    WHERE hub_id = :hub_id AND source_type = :source_type AND source_id = :source_id
  );
