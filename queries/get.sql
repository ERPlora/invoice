SELECT id, invoice_type, series, number, issue_date, issuer_nif, issuer_name,
       customer_tax_id, customer_name, customer_address, description,
       base_amount, tax_amount, total_amount, tax_breakdown, currency,
       source_type, source_id, rectifies_invoice_id, status, paid_at, notes
FROM invoice_invoice
WHERE id = :invoice_id AND hub_id = :hub_id AND is_deleted = 0;
