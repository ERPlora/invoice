-- Inserta la factura. number = PREFIX-YYYY-NNNNNN leyendo el contador (recién
-- incrementado) en la MISMA transacción (sin read-back desde el guest). printf()
-- es de SQLite; Postgres usaría lpad() (portabilidad SQL §14).
INSERT INTO invoice_invoice (
    id, hub_id, invoice_type, series, number, issue_date,
    issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, description,
    base_amount, tax_amount, total_amount, tax_breakdown, currency,
    source_type, source_id, status, notes,
    is_deleted, created_by, updated_by, created_at, updated_at
) VALUES (
    :invoice_id, :hub_id, :invoice_type, :series,
    :prefix || '-' || :year || '-' || printf('%06d', (
        SELECT current_number FROM invoice_invoiceseries
        WHERE hub_id = :hub_id AND code = :series AND year = :year
    )),
    :issue_date,
    :issuer_nif, :issuer_name, :customer_tax_id, :customer_name, :customer_address, :description,
    :base_amount, :tax_amount, :total_amount, :tax_breakdown, 'EUR',
    :source_type, :source_id, 'issued', :notes,
    0, :current_user_id, :current_user_id, :now, :now
);
