-- Vista previa del SIGUIENTE número de una serie, SIN consumirlo (invoice#40, ADR-0369 D3c).
-- Es una LECTURA: no toca el contador. Sirve para que el TPV y la pantalla de Ajustes enseñen qué
-- número saldrá antes de emitir, y para que quien configura un formato vea el resultado.
--
-- ⚠ RENDER — LEER ESTO ANTES DE TOCAR NADA.
-- El número se formatea en TRES sitios: aquí (con `current_number + 1`, porque el número aún no se
-- ha consumido), en `commands/_insert_invoice.sql` y en `commands/rectify_insert.sql` (ambos con
-- `current_number` ya incrementado en su transacción). En `invoice_series` esa duplicación vivía
-- bajo un comentario «mantener en sync» y NADA lo comprobaba. Aquí lo comprueba
-- `tests/number_format.postgres.test.py` §1, que ejecuta los TRES caminos sobre la MISMA serie para
-- cada forma de plantilla y exige que las tres cadenas sean idénticas. Si cambias el render, cambia
-- los tres y el test te dirá si te dejaste uno.
-- (Una vista SQL habría dejado un solo sitio, pero `export.rs::list_tables` enumera por
-- `information_schema.tables`, que INCLUYE vistas, y el exportador de plantillas la trataría como
-- una tabla más — la regresión hub#426/#533 otra vez.)
--
-- Marcadores: `{prefix}` `{code}` `{year}` `{seq}` `{seq:01d}`…`{seq:09d}`. Los `{seq:0Nd}` van
-- ANTES que `{seq}` por claridad (no colisionan: `{seq}` exige la llave justo después de `seq`).
-- Plantilla vacía o NULL → el fallback histórico `PREFIX-YYYY-NNNNNN`, que es lo que llevan todas
-- las series ya emitidas. Padding portable: `erp_pad(valor, ancho)` (ADR-0007).
SELECT id                   AS series_id,
       code,
       year,
       prefix,
       format,
       current_number,
       current_number + 1   AS next_sequence,
       CASE WHEN format IS NULL OR format = ''
            THEN prefix || '-' || CAST(year AS TEXT) || '-' || erp_pad(current_number + 1, 6)
            ELSE replace(replace(replace(replace(
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(
                   format,
                   '{seq:01d}', erp_pad(current_number + 1, 1)),
                   '{seq:02d}', erp_pad(current_number + 1, 2)),
                   '{seq:03d}', erp_pad(current_number + 1, 3)),
                   '{seq:04d}', erp_pad(current_number + 1, 4)),
                   '{seq:05d}', erp_pad(current_number + 1, 5)),
                   '{seq:06d}', erp_pad(current_number + 1, 6)),
                   '{seq:07d}', erp_pad(current_number + 1, 7)),
                   '{seq:08d}', erp_pad(current_number + 1, 8)),
                   '{seq:09d}', erp_pad(current_number + 1, 9)),
                   '{seq}',     CAST(current_number + 1 AS TEXT)),
                   '{year}',    CAST(year AS TEXT)),
                   '{code}',    code),
                   '{prefix}',  prefix)
       END                  AS next_number,
       -- Lo que la pantalla de Ajustes necesita para saber si aún puede ofrecer el campo: en cuanto
       -- la serie ha emitido algo, su forma queda congelada (la huella de VeriFactu).
       CASE WHEN current_number = 0 THEN 0 ELSE 1 END AS format_locked
FROM invoice_invoiceseries
WHERE id = :series_id AND hub_id = :hub_id AND is_deleted = 0
