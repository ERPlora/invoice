-- Asegura la serie RECT del año en curso (R1). Runtime inyecta :new_id, :hub_id, :now, :year.
INSERT INTO invoice_invoiceseries
  (id, hub_id, code, name, invoice_type, year, current_number, prefix, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, 'RECT', 'Rectifying Invoices', 'R1', :year, 0, 'RECT', 1,
   0, :current_user_id, :current_user_id, :now, :now)
ON CONFLICT (hub_id, code, year) DO NOTHING;
