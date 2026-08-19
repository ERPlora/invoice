-- Crea la factura rectificativa R1 con importes NEGADOS, copiando emisor/cliente de
-- la original (INSERT...SELECT — no necesita iterar líneas: la rectificación es a
-- nivel cabecera, fiel a InvoiceService.rectify). number desde la serie RECT.
-- tax_breakdown se deja '{}' (negar JSON en SQL no es práctico; el detalle de líneas
-- no se copia en el legacy tampoco). Runtime inyecta :new_id, :hub_id, :now, :year, :reason.
--
-- ⚠ RENDER — el mismo que `commands/_insert_invoice.sql` y `queries/series_peek_next.sql` (allí con
-- `current_number + 1`). TRES sitios; los pina `tests/number_format.postgres.test.py` §1. Si tocas
-- uno, toca los tres. invoice#40: la serie RECT deja de ser una subquery escalar y pasa a un JOIN,
-- porque el render necesita varias de sus columnas — y de paso la rectificativa **honra el formato
-- configurado de su serie** en vez del `RECT-YYYY-NNNNNN` cableado que tenía antes.
INSERT INTO invoice_invoice (
    id, hub_id, invoice_type, series, number, issue_date,
    issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, description,
    base_amount, tax_amount, total_amount, tax_breakdown, currency,
    source_type, source_id, rectifies_invoice_id, status, notes,
    is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
    :new_id, o.hub_id, 'R1', 'RECT',
    CASE WHEN s.format IS NULL OR s.format = ''
         THEN s.prefix || '-' || CAST(s.year AS TEXT) || '-' || erp_pad(s.current_number, 6)
         ELSE replace(replace(replace(replace(
              replace(replace(replace(replace(replace(replace(replace(replace(replace(
                s.format,
                '{seq:01d}', erp_pad(s.current_number, 1)),
                '{seq:02d}', erp_pad(s.current_number, 2)),
                '{seq:03d}', erp_pad(s.current_number, 3)),
                '{seq:04d}', erp_pad(s.current_number, 4)),
                '{seq:05d}', erp_pad(s.current_number, 5)),
                '{seq:06d}', erp_pad(s.current_number, 6)),
                '{seq:07d}', erp_pad(s.current_number, 7)),
                '{seq:08d}', erp_pad(s.current_number, 8)),
                '{seq:09d}', erp_pad(s.current_number, 9)),
                '{seq}',     CAST(s.current_number AS TEXT)),
                '{year}',    CAST(s.year AS TEXT)),
                '{code}',    s.code),
                '{prefix}',  s.prefix)
    END,
    :issue_date,
    o.issuer_nif, o.issuer_name, o.customer_tax_id, o.customer_name, o.customer_address, :reason,
    -o.base_amount, -o.tax_amount, -o.total_amount, '{}', o.currency,
    o.source_type, o.source_id, :original_id, 'issued',
    'Rectifies ' || o.number || '. Reason: ' || :reason,
    0, :current_user_id, :current_user_id, :now, :now
FROM invoice_invoice o
JOIN invoice_invoiceseries s
  ON s.hub_id = o.hub_id
 AND s.code = 'RECT'
 AND CAST(s.year AS TEXT) = CAST(:year AS TEXT)
 AND s.is_deleted = 0
WHERE o.id = :original_id AND o.hub_id = :hub_id AND o.invoice_type NOT LIKE 'R%'
  -- invoice#39: la MISMA guarda que `rectify_bump.sql` (patrón ADR-0020). Sin ella, un reintento
  -- emitía una segunda rectificativa de la misma factura con un número nuevo; con la guarda solo en
  -- el bump, el insert habría escrito con un número que el contador ya no había avanzado. Las dos
  -- puertas se mueven juntas. `is_deleted = 0` también se exige aquí: una original soft-borrada no
  -- se rectifica.
  AND o.is_deleted = 0
  AND NOT EXISTS (
    SELECT 1 FROM invoice_invoice r
    WHERE r.hub_id = :hub_id AND r.rectifies_invoice_id = :original_id AND r.is_deleted = 0
  );
