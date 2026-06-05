SELECT id, invoice_type, series, number, issue_date, customer_name, customer_tax_id,
       base_amount, tax_amount, total_amount, status, source_type
FROM invoice_invoice
WHERE hub_id = :hub_id AND is_deleted = 0
ORDER BY issue_date DESC, number DESC
LIMIT 100;
