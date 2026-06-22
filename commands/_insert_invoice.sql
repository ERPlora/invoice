-- Inserta la factura. number = PREFIX-YYYY-NNNNNN leyendo el contador (recién
-- incrementado) en la MISMA transacción (sin read-back desde el guest). Padding
-- portable: erp_pad(valor, ancho) (ADR-0007) → printf/lpad por dialecto en el shim.
--
-- D2 (idempotencia): INSERT ... SELECT ... WHERE NOT EXISTS — 1 factura por venta.
-- Si ya existe una factura para este origen real (source_id NOT NULL), no inserta
-- (no-op), consistente con _bump_series que tampoco consumió número. Con source_id
-- NULL (factura manual) el guard nunca encuentra duplicado y siempre inserta.
-- INSERT...SELECT con WHERE NOT EXISTS es portable SQLite+Postgres.
INSERT INTO invoice_invoice (
    id, hub_id, invoice_type, series, number, issue_date,
    issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, description,
    base_amount, tax_amount, total_amount, tax_breakdown, currency,
    source_type, source_id, status, notes,
    is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
    :invoice_id, :hub_id, :invoice_type, :series,
    :prefix || '-' || :year || '-' || erp_pad((
        SELECT current_number FROM invoice_invoiceseries
        WHERE hub_id = :hub_id AND code = :series AND year = :year
    ), 6),
    :issue_date,
    :issuer_nif, :issuer_name, :customer_tax_id, :customer_name, :customer_address, :description,
    :base_amount, :tax_amount, :total_amount, :tax_breakdown, 'EUR',
    :source_type, :source_id, 'issued', :notes,
    0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (
    SELECT 1 FROM invoice_invoice
    WHERE hub_id = :hub_id AND source_type = :source_type AND source_id = :source_id
);
