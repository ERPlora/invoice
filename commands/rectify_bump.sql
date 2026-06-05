UPDATE invoice_invoiceseries
SET current_number = current_number + 1
WHERE hub_id = :hub_id AND code = 'RECT' AND year = :year;
