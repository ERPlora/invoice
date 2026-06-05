SELECT id, code, name, invoice_type, year, current_number, prefix, is_active, is_default
FROM invoice_invoiceseries
WHERE hub_id = :hub_id AND is_deleted = 0
ORDER BY year DESC, code ASC;
