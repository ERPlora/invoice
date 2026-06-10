-- Alta manual de una serie de numeración (invoice.manage_series). Runtime inyecta
-- :new_id, :hub_id, :current_user_id, :now. La unicidad (hub_id, code, year) la
-- garantiza el índice uq_invoice_series (un duplicado falla y revierte la tx).
-- current_number arranca en 0 (monotónico, lo incrementa la emisión, nunca este command).
INSERT INTO invoice_invoiceseries
  (id, hub_id, code, name, invoice_type, year, current_number, prefix,
   is_active, is_default,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :code, COALESCE(:name, ''), :invoice_type, :year, 0,
   COALESCE(:prefix, :code),
   COALESCE(:is_active, 1), COALESCE(:is_default, 0),
   0, :current_user_id, :current_user_id, :now, :now);
