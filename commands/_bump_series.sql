-- Incrementa el contador de la serie (monotónico). Runtime inyecta :hub_id.
UPDATE invoice_invoiceseries
SET current_number = current_number + 1
WHERE hub_id = :hub_id AND code = :code AND year = :year;
