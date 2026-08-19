-- El libro de asignaciones de numeración: una fila por número entregado (invoice#39, RD 1007/2023).
-- Base de una query `list` paginada: sin ORDER BY / LIMIT / `;` propios — el motor genérico los pone
-- (`architecture/hub/runtime-dispatcher.md`).
--
-- `invoice_id` NULL significa «número consumido sin documento detrás». Con las guardas de
-- `_bump_series`/`rectify_bump` no debería ocurrir; la columna existe para que, si ocurre, la
-- inspección lo VEA en vez de encontrarse un hueco sin explicación.
SELECT id,
       code,
       year,
       sequence,
       document_number,
       invoice_id,
       allocated_at
FROM invoice_number_allocation
WHERE hub_id = :hub_id AND is_deleted = 0
