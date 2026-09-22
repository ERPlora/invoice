-- Inserta la factura, renderizando `number` desde la serie con el contador RECIÉN incrementado en la
-- MISMA transacción (sin read-back desde el guest).
--
-- ⚠ RENDER — el mismo que `queries/series_peek_next.sql` (allí con `current_number + 1`, porque el
-- número aún no se ha consumido) y que `commands/rectify_insert.sql`. TRES sitios; los pina
-- `tests/number_format.postgres.test.py` §1, que corre los tres caminos sobre la misma serie para
-- cada forma de plantilla y exige cadenas idénticas. Si tocas uno, toca los tres. Marcadores y
-- fallback documentados en `migrations/postgres/008_series_format.sql`. `erp_pad` (ADR-0007).
--
-- The width `erp_pad` receives is a MINIMUM, never a ceiling: a sequence that outgrows it is
-- rendered WHOLE (ERPlora/hub#1378). It used to be cut, which handed back a number already issued
-- and made `uq_invoice_series_number` refuse the emission — pinned now by
-- `tests/number_format.postgres.test.py` §6, border by border, with §6d as its control.
--
-- invoice#40: la serie pasa de subquery escalar a la fuente del SELECT — el render necesita varias
-- de sus columnas (`format`, `prefix`, `code`, `year`) y trece subqueries serían ilegibles. El
-- efecto sobre el no-op es NINGUNO: `_ensure_series` corre justo antes en la misma transacción, así
-- que la fila existe siempre; si no existiera, no habría número que dar y no insertar es correcto.
--
-- D2 (idempotencia): el `NOT EXISTS` — 1 factura por venta. Si ya existe una factura para este
-- origen real (source_id NOT NULL), no inserta (no-op), consistente con `_bump_series`, que tampoco
-- consumió número. Con source_id NULL (factura manual) el guard nunca encuentra duplicado y siempre
-- inserta.
INSERT INTO invoice_invoice (
    id, hub_id, invoice_type, series, number, issue_date,
    issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address,
    customer_country, customer_id_type, description,
    base_amount, tax_amount, total_amount, tax_breakdown, currency,
    source_type, source_id, substitutes_invoice_id, status, notes,
    is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
    :invoice_id, :hub_id, :invoice_type, :series,
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
    -- Emisor (obligado tributario): si la factura no lo trae, cae a la identidad de NEGOCIO GLOBAL del
    -- hub (hub_settings, inyectada por el runtime como :business_tax_id/:business_legal_name —
    -- ADR-0061). Fuente única país-agnóstica: el caller (POS, prueba VeriFactu) ya no pasa el NIF.
    COALESCE(NULLIF(:issuer_nif, ''), :business_tax_id),
    COALESCE(NULLIF(:issuer_name, ''), :business_legal_name),
    :customer_tax_id, :customer_name, :customer_address,
    -- ERPlora/hub#1967: absent from an older caller's payload = NULL; the column wants ''.
    COALESCE(:customer_country, ''), COALESCE(:customer_id_type, ''), :description,
    :base_amount, :tax_amount, :total_amount, :tax_breakdown, 'EUR',
    -- substitutes_invoice_id: ADR-0140, enlace F3→F2 (NULL en emisiones normales, la F2 que
    -- sustituye en un F3). NULLIF('' → NULL) para que el default vacío del guest no rompa el FK lógico.
    :source_type, :source_id, NULLIF(:substitutes_invoice_id, ''), 'issued', :notes,
    0, :current_user_id, :current_user_id, :now, :now
FROM invoice_invoiceseries s
WHERE s.hub_id = :hub_id
  AND s.code = :series
  AND CAST(s.year AS TEXT) = CAST(:year AS TEXT)
  AND s.is_deleted = 0
  AND NOT EXISTS (
    SELECT 1 FROM invoice_invoice
    WHERE hub_id = :hub_id AND source_type = :source_type AND source_id = :source_id
);
