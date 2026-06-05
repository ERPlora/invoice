-- Crea la factura rectificativa R1 con importes NEGADOS, copiando emisor/cliente de
-- la original (INSERT...SELECT — no necesita iterar líneas: la rectificación es a
-- nivel cabecera, fiel a InvoiceService.rectify). number desde la serie RECT.
-- tax_breakdown se deja '{}' (negar JSON en SQL no es práctico; el detalle de líneas
-- no se copia en el legacy tampoco). Runtime inyecta :new_id, :hub_id, :now, :year, :reason.
INSERT INTO invoice_invoice (
    id, hub_id, invoice_type, series, number, issue_date,
    issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, description,
    base_amount, tax_amount, total_amount, tax_breakdown, currency,
    source_type, source_id, rectifies_invoice_id, status, notes,
    is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
    :new_id, hub_id, 'R1', 'RECT',
    'RECT-' || :year || '-' || printf('%06d', (
        SELECT current_number FROM invoice_invoiceseries
        WHERE hub_id = :hub_id AND code = 'RECT' AND year = :year
    )),
    :issue_date,
    issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, :reason,
    -base_amount, -tax_amount, -total_amount, '{}', currency,
    source_type, source_id, :original_id, 'issued',
    'Rectifies ' || number || '. Reason: ' || :reason,
    0, :current_user_id, :current_user_id, :now, :now
FROM invoice_invoice
WHERE id = :original_id AND hub_id = :hub_id AND invoice_type NOT LIKE 'R%';
