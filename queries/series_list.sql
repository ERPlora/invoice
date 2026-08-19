-- Series de numeración del hub. Base de una query `list` paginada (sin ORDER BY/LIMIT/`;`).
-- invoice#40: `format` (NULL = `PREFIX-YYYY-NNNNNN`) y `format_locked`, que es lo que la
-- pantalla de Ajustes necesita para saber si aún puede ofrecer el campo: en cuanto la serie ha
-- emitido algo, su forma queda congelada (entra en la huella de VeriFactu).
SELECT id, code, name, invoice_type, year, current_number, prefix, format,
       CASE WHEN current_number = 0 THEN 0 ELSE 1 END AS format_locked,
       is_active, is_default
FROM invoice_invoiceseries
WHERE hub_id = :hub_id AND is_deleted = 0
