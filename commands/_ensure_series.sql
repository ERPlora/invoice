-- Asegura (idempotente) la fila de serie para code+year. Runtime inyecta :hub_id, :now;
-- :new_id, :code, :name, :invoice_type, :year, :prefix los aporta el handler.
INSERT INTO invoice_invoiceseries
  (id, hub_id, code, name, invoice_type, year, current_number, prefix, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :code, :name, :invoice_type, :year, 0, :prefix, 1,
   0, :current_user_id, :current_user_id, :now, :now)
ON CONFLICT (hub_id, code, year) DO NOTHING;
