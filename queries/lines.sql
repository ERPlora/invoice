SELECT id, line_number, description, quantity, unit_price, tax_rate,
       base_amount, tax_amount, total_amount, product_id
FROM invoice_invoiceitem
WHERE invoice_id = :invoice_id AND hub_id = :hub_id
ORDER BY line_number ASC;
