-- Detección de HUECOS en la numeración (invoice#39). Una fila por hueco; NINGUNA fila = numeración
-- correlativa, que es lo que hay que poder afirmar ante una inspección (art. 6.1.a RD 1619/2012 y
-- «sin huecos, sin duplicados» del RD 1007/2023).
--
-- Lo que devuelve cada fila: la serie, el ejercicio, el último número que SÍ está en el libro antes
-- del hueco (`after_sequence`), el primero que falta (`missing_from`) y el siguiente que vuelve a
-- estar (`next_recorded`). `missing_count` = cuántos faltan de un tirón.
--
-- Un hueco se detecta DENTRO del rango registrado: `sequence` cuyo `sequence + 1` no está en el
-- libro, y que no es el último. El «no es el último» no es un detalle: el libro empieza el día que
-- llega la migración 007, y sin esa condición cada serie declararía un hueco permanente detrás de su
-- última asignación (el contador de la serie va por delante mientras no se emite nada más).
--
-- Por qué no `generate_series`: no es portable (ADR-0007). Este auto-EXISTS lo es, y devuelve el
-- hueco como intervalo —que es lo que se explica en una inspección— en vez de una fila por número.
SELECT a.code,
       a.year,
       a.sequence AS after_sequence,
       a.sequence + 1 AS missing_from,
       (SELECT MIN(n.sequence) FROM invoice_number_allocation n
         WHERE n.hub_id = a.hub_id AND n.code = a.code AND n.year = a.year
           AND n.is_deleted = 0 AND n.sequence > a.sequence) AS next_recorded,
       (SELECT MIN(n.sequence) FROM invoice_number_allocation n
         WHERE n.hub_id = a.hub_id AND n.code = a.code AND n.year = a.year
           AND n.is_deleted = 0 AND n.sequence > a.sequence) - a.sequence - 1 AS missing_count
FROM invoice_number_allocation a
WHERE a.hub_id = :hub_id
  AND a.is_deleted = 0
  AND NOT EXISTS (
      SELECT 1 FROM invoice_number_allocation b
      WHERE b.hub_id = a.hub_id AND b.code = a.code AND b.year = a.year
        AND b.is_deleted = 0 AND b.sequence = a.sequence + 1
  )
  AND EXISTS (
      SELECT 1 FROM invoice_number_allocation c
      WHERE c.hub_id = a.hub_id AND c.code = a.code AND c.year = a.year
        AND c.is_deleted = 0 AND c.sequence > a.sequence
  )
