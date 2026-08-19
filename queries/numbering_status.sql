-- Estado de la NUMERACIÓN del hub (invoice#41). Alimenta el bloque `setup` del manifest, que el
-- runtime sirve como un ítem de `hub.setup.status` (ADR-0063 + hub#369/ADR-0222). Sustituye al
-- `invoice_series.series.status` que se retira con el módulo (ADR-0369 D3e): configurar la
-- numeración solo sirve de algo donde la numeración se usa.
--
-- UNA fila SIEMPRE: es un agregado, así que responde también en un hub que no tiene ni una serie.
-- El caso «sin fila ⇒ no configurado» de ADR-0063 aquí no ocurre nunca — quien decide son los
-- números, que además son lo que el asistente puede explicar («no tienes serie de rectificativas»
-- dice mucho más que «pendiente»).
--
-- DOS MITADES, y las dos hacen falta:
--   * `ordinary_series`   — F1/F2/F3 (factura completa, simplificada y sustitutiva);
--   * `rectifying_series` — R1..R5. La AEAT exige serie de rectificativas SEPARADA (art. 6.1.a
--     RD 1619/2012), y Holded y Sage la piden igual. Ninguna venta la crea sola: la serie F2
--     `TICKET` nace en la primera emisión (`_ensure_series`), pero la de rectificativas solo
--     aparece si alguien rectifica. Por eso el ítem sigue pendiente hasta que el usuario entra
--     en Ajustes — que es exactamente donde se le pide que revise el prefijo.
--
-- EJERCICIO EN CURSO, no «alguna vez»: la clave de negocio es `(hub_id, code, year)` y el contador
-- se reinicia solo cada 1 de enero, así que la serie del año pasado no responde por la de este. El
-- año sale de `:now` (el reloj del runtime; el SQL no tiene otro) — `substr` es portable
-- SQLite+Postgres, a diferencia de `EXTRACT`/`strftime` (ADR-0007).
--
-- QUÉ CUENTA COMO «HAY SERIE»: el predicado es el de la puerta que de verdad numera
-- (`commands/_bump_series.sql`: hub + code + año), más `is_deleted = 0`, que es lo que filtran
-- todos los lectores. **`is_active` NO se exige a propósito**: el asignador lo ignora hoy, así que
-- pedirlo aquí marcaría «pendiente» un hub que numera perfectamente — el mismo motivo por el que el
-- módulo retirado dejaba fuera su ventana de validez. Si `_bump_series` empieza a honrar
-- `is_active`, las dos condiciones se mueven JUNTAS o la checklist vuelve a mentir.
--
-- Las otras dos columnas son contexto, no condiciones: `default_series` dice si hay una
-- preseleccionada, y `total_series` separa «nunca creó ninguna» de «las creó para otro ejercicio»
-- — dos conversaciones muy distintas. Portable (CASE WHEN, sin funciones de dialecto).
SELECT
  CAST(substr(:now, 1, 4) AS INTEGER)                                    AS fiscal_year,
  COALESCE(SUM(CASE WHEN is_deleted = 0
                     AND CAST(year AS TEXT) = substr(:now, 1, 4)
                     AND invoice_type IN ('F1', 'F2', 'F3')
                    THEN 1 ELSE 0 END), 0)                               AS ordinary_series,
  COALESCE(SUM(CASE WHEN is_deleted = 0
                     AND CAST(year AS TEXT) = substr(:now, 1, 4)
                     AND invoice_type LIKE 'R%'
                    THEN 1 ELSE 0 END), 0)                               AS rectifying_series,
  COALESCE(SUM(CASE WHEN is_deleted = 0
                     AND CAST(year AS TEXT) = substr(:now, 1, 4)
                     AND is_default = 1
                    THEN 1 ELSE 0 END), 0)                               AS default_series,
  COALESCE(SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END), 0)           AS total_series
FROM invoice_invoiceseries
WHERE hub_id = :hub_id
