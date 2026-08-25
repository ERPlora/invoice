-- Crea la factura rectificativa R1 con importes NEGADOS, copiando emisor/cliente de la original.
-- Runtime inyecta :new_id, :hub_id, :now; el resto (:year, :reason, :original_id | :sale_id,
-- :refund_ref, :total, :fully_refunded) viaja en el payload.
--
-- ⚠ RENDER — el mismo que `commands/_insert_invoice.sql` y `queries/series_peek_next.sql` (allí con
-- `current_number + 1`). TRES sitios; los pina `tests/number_format.postgres.test.py` §1. Si tocas
-- uno, toca los tres. invoice#40: la serie RECT deja de ser una subquery escalar y pasa a un JOIN,
-- porque el render necesita varias de sus columnas — y de paso la rectificativa **honra el formato
-- configurado de su serie** en vez del `RECT-YYYY-NNNNNN` cableado que tenía antes.
--
-- ── EL IMPORTE (invoice#63) ─────────────────────────────────────────────────────────────────────
-- Tres casos, un solo cálculo:
--   * manual (`invoice.rectify`, sin `:sale_id`): TODO el original (lo que era).
--   * devolución parcial: `:total` de la devolución, acotado a lo que QUEDA del original.
--   * el acto que cierra la devolución (`fully_refunded`): exactamente LO QUE QUEDA — nunca su propio
--     `:total`, o dos parciales dejarían ±1 céntimo huérfano en la cadena de VeriFactu.
-- «Lo que queda» es el original menos toda rectificativa viva que ya lo apunte, importe a importe y
-- CLAVE A CLAVE (`prior`): la segunda parcial se reparte sobre el resto, no sobre el original.
--
-- ── EL DESGLOSE (invoice#5 D2, prorrateado por invoice#63) ──────────────────────────────────────
-- Antes iba `'{}'`, y `'{}'` NO falla de forma ruidosa: `hub/crates/verifactu/src/aeat.rs`
-- `desglose()` cae a un ÚNICO detalle con el tipo EFECTIVO (`cuota/base`). Una factura de tipo único
-- salía bien por casualidad; una MIXTA (la caña al 21 % + la tapa al 10 %) daba un efectivo de
-- ~19,1 %, que no es un tipo legal de IVA, y la tumbaba el guard local `xsd.rs`.
--
-- Se parte del snapshot CONGELADO en la original y nunca se re-deriva (ADR-0210): la base fiscal es
-- de la TARIFA del documento, así que recalcular con la tarifa de hoy haría salir la rectificativa
-- de una factura vieja sobre otra base que la factura que rectifica. El contrato de redondeo:
--   1. la parte de cada clave = `bruto_clave_restante × importe / restante`, repartida por RESTO
--      MAYOR (suelo de todas, y los céntimos que faltan uno a uno a las mayores fracciones, empate
--      por orden) → Σ partes == importe, exacto;
--   2. base de la clave = `round(parte × base / bruto)` (HALF_UP, `round()` de numeric);
--   3. cuota POR DIFERENCIA (`parte − base`) — la regla de ADR-0123 §4 para el IVA incluido —, y
--      con recargo la cuota principal cierra por su tipo sobre esa base y el recargo se lleva el
--      resto. Así cada cuota cruza con su tipo al céntimo y Σ del desglose == importe devuelto;
--   4. si la parte es TODO lo que queda de la clave (rectificación entera o acto de cierre), se
--      copian sus importes tal cual, sin redondear nada: el documento entero sigue saliendo byte a
--      byte como antes, y dos parciales que suman el total suman el original clave a clave.
-- El TIPO no se niega (un 21 % rectificado sigue siendo un 21 %); tampoco `surcharge_rate`.
--
-- Dos formatos, porque el consumidor acepta los dos y una original vieja puede llevar el viejo:
-- ARRAY (una entrada por clave fiscal, formato actual, identificada por su posición) y OBJETO legacy
-- (`{"21": {"base":…, "tax":…}}`, identificada por su clave). Lo que no sea ni una cosa ni otra
-- —`'{}'` de las facturas anteriores al campo— sale como `'[]'` con la cabecera prorrateada sobre
-- base/total: el mismo fallback al tipo efectivo de siempre. No se inventa un desglose que nadie
-- registró.
--
-- ⚠️ `erplora validate` avisa de `jsonb_array_elements` / `jsonb_each` como «tabla sin el prefijo
-- `invoice_`» (ADR-0263). Son AVISOS y son falsos positivos conocidos: no son tablas, son funciones
-- que devuelven filas, y el propio linter dice que no puede distinguirlas. `jsonb_exists(v, k)` y no
-- el operador `v ? k`: son la MISMA función, pero `?` es también el placeholder posicional del estilo
-- portable, y `erplora validate` (ADR-0007) lo rechaza — con razón.
--
-- ── EL ORIGEN (invoice#5 D1) ────────────────────────────────────────────────────────────────────
-- Antes se copiaban `o.source_type, o.source_id` VERBATIM, y ahí murió la rectificación de todo
-- tiquet de TPV: `uq_invoice_source` ya tenía esa tupla ocupada por la ORIGINAL. Una rectificativa
-- no tiene origen externo del que ser idempotente: `source_id` NULL, `source_type` informativo, y
-- el «una por devolución» lo sostiene `ux_invoice_rectifies_ref` (migración 010).
WITH orig AS (
  SELECT o.*,
         o.total_amount + COALESCE((
           SELECT SUM(r.total_amount) FROM invoice_invoice r
           WHERE r.hub_id = o.hub_id AND r.rectifies_invoice_id = o.id AND r.is_deleted = 0
         ), 0) AS remaining,
         (SELECT count(*) FROM invoice_invoice r
           WHERE r.hub_id = o.hub_id AND r.rectifies_invoice_id = o.id AND r.is_deleted = 0) AS rect_count
  FROM invoice_invoice o
  WHERE o.hub_id = :hub_id AND o.invoice_type NOT LIKE 'R%' AND o.is_deleted = 0
    AND (o.id = CAST(:original_id AS TEXT)
         OR (CAST(:original_id AS TEXT) IS NULL
             AND CAST(:sale_id AS TEXT) IS NOT NULL
             AND o.source_type = 'sale'
             AND o.source_id = CAST(:sale_id AS TEXT)))
),
gate AS (
  -- The SAME guard as `rectify_bump.sql` (patrón ADR-0020): if the bump spent no number, this
  -- inserts nothing.
  SELECT orig.*,
         CASE WHEN CAST(:sale_id AS TEXT) IS NULL THEN orig.total_amount
              WHEN COALESCE(CAST(:fully_refunded AS INTEGER), 0) = 1 THEN orig.remaining
              ELSE LEAST(COALESCE(CAST(:total AS INTEGER), 0), orig.remaining) END AS amount
  FROM orig
  WHERE (CAST(:sale_id AS TEXT) IS NULL AND orig.rect_count = 0)
     OR (CAST(:sale_id AS TEXT) IS NOT NULL
         AND NULLIF(CAST(:refund_ref AS TEXT), '') IS NOT NULL
         AND (COALESCE(CAST(:fully_refunded AS INTEGER), 0) = 1
              OR COALESCE(CAST(:total AS INTEGER), 0) > 0)
         AND orig.remaining > 0
         AND NOT EXISTS (
           SELECT 1 FROM invoice_invoice rr
           WHERE rr.hub_id = :hub_id
             AND rr.rectifies_ref = NULLIF(CAST(:refund_ref AS TEXT), '')
             AND rr.is_deleted = 0
         ))
),
-- The original's entries, normalised: one row per fiscal key in either format.
ent AS (
  SELECT g.id AS oid, 'array' AS fmt, CAST(e.ord AS TEXT) AS ekey, e.ord AS ord, e.v AS obj,
         COALESCE((e.v->>'base')::numeric, 0) AS b,
         COALESCE((e.v->>'quota')::numeric, 0) AS qt,
         COALESCE((e.v->>'surcharge_quota')::numeric, 0) AS sq,
         jsonb_exists(e.v, 'surcharge_quota') AS has_sq,
         COALESCE((e.v->>'rate')::numeric, 0) AS rate
  FROM gate g, jsonb_array_elements(g.tax_breakdown::jsonb) WITH ORDINALITY AS e(v, ord)
  WHERE left(btrim(g.tax_breakdown), 1) = '[' AND jsonb_typeof(e.v) = 'object'
  UNION ALL
  SELECT g.id, 'object', e.k, 0, e.v,
         COALESCE((e.v->>'base')::numeric, 0),
         COALESCE((e.v->>'tax')::numeric, 0),
         0, false, 0
  FROM gate g, jsonb_each(g.tax_breakdown::jsonb) AS e(k, v)
  WHERE left(btrim(g.tax_breakdown), 1) = '{' AND jsonb_typeof(e.v) = 'object'
),
-- What the live rectifications already took from each key (negative figures), same identity.
prior AS (
  SELECT r.rectifies_invoice_id AS oid, CAST(e.ord AS TEXT) AS ekey,
         COALESCE((e.v->>'base')::numeric, 0) AS b,
         COALESCE((e.v->>'quota')::numeric, 0) AS qt,
         COALESCE((e.v->>'surcharge_quota')::numeric, 0) AS sq
  FROM invoice_invoice r
  JOIN gate g ON g.id = r.rectifies_invoice_id AND g.hub_id = r.hub_id,
       jsonb_array_elements(r.tax_breakdown::jsonb) WITH ORDINALITY AS e(v, ord)
  WHERE r.is_deleted = 0 AND left(btrim(r.tax_breakdown), 1) = '[' AND jsonb_typeof(e.v) = 'object'
  UNION ALL
  SELECT r.rectifies_invoice_id, e.k,
         COALESCE((e.v->>'base')::numeric, 0),
         COALESCE((e.v->>'tax')::numeric, 0),
         0
  FROM invoice_invoice r
  JOIN gate g ON g.id = r.rectifies_invoice_id AND g.hub_id = r.hub_id,
       jsonb_each(r.tax_breakdown::jsonb) AS e(k, v)
  WHERE r.is_deleted = 0 AND left(btrim(r.tax_breakdown), 1) = '{' AND jsonb_typeof(e.v) = 'object'
),
left_over AS (
  SELECT ent.*,
         ent.b + COALESCE((SELECT SUM(p.b) FROM prior p WHERE p.oid = ent.oid AND p.ekey = ent.ekey), 0) AS lb,
         ent.qt + COALESCE((SELECT SUM(p.qt) FROM prior p WHERE p.oid = ent.oid AND p.ekey = ent.ekey), 0) AS lqt,
         ent.sq + COALESCE((SELECT SUM(p.sq) FROM prior p WHERE p.oid = ent.oid AND p.ekey = ent.ekey), 0) AS lsq
  FROM ent
),
exact AS (
  SELECT l.*, (l.lb + l.lqt + l.lsq) AS lgross,
         CASE WHEN g.remaining = 0 THEN 0
              ELSE (l.lb + l.lqt + l.lsq) * g.amount / g.remaining END AS share_exact
  FROM left_over l JOIN gate g ON g.id = l.oid
),
floored AS (
  SELECT x.*, floor(x.share_exact) AS fl,
         row_number() OVER (PARTITION BY x.oid ORDER BY (x.share_exact - floor(x.share_exact)) DESC, x.ord, x.ekey) AS rk
  FROM exact x
),
residue AS (
  SELECT f.oid, g.amount - SUM(f.fl) AS res
  FROM floored f JOIN gate g ON g.id = f.oid
  GROUP BY f.oid, g.amount
),
share AS (
  SELECT f.*, f.fl + CASE WHEN f.rk <= r.res THEN 1 ELSE 0 END AS part
  FROM floored f JOIN residue r ON r.oid = f.oid
),
calc AS (
  SELECT s.*,
         CASE WHEN s.part = s.lgross THEN s.lb
              WHEN s.lgross = 0 THEN 0
              ELSE round(s.part * s.lb / s.lgross) END AS base2
  FROM share s
),
calc2 AS (
  SELECT c.*,
         CASE WHEN c.part = c.lgross THEN c.lqt
              WHEN c.has_sq THEN round(c.base2 * c.rate / 100)
              ELSE c.part - c.base2 END AS quota2
  FROM calc c
),
calc3 AS (
  SELECT c.*, (c.part - c.base2 - c.quota2) AS sq2 FROM calc2 c
),
totals AS (
  SELECT g.id AS oid, g.amount,
         (SELECT SUM(c.base2) FROM calc3 c WHERE c.oid = g.id) AS base_sum,
         (SELECT count(*) FROM calc3 c WHERE c.oid = g.id) AS n_entries,
         CASE WHEN g.total_amount = 0 THEN 0
              ELSE round(g.amount * g.base_amount::numeric / g.total_amount) END AS base_fallback
  FROM gate g
)
INSERT INTO invoice_invoice (
    id, hub_id, invoice_type, series, number, issue_date,
    issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, description,
    base_amount, tax_amount, total_amount, tax_breakdown, currency,
    source_type, source_id, rectifies_invoice_id, rectifies_ref, status, notes,
    is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
    :new_id, g.hub_id, 'R1', 'RECT',
    CASE WHEN s.format IS NULL OR s.format = ''
         THEN s.prefix || '-' || CAST(s.year AS TEXT) || '-' || erp_pad(s.current_number, 6)
         ELSE replace(replace(replace(replace(
              replace(replace(replace(replace(replace(replace(replace(replace(replace(
                s.format,
                '{seq:01d}', erp_pad(s.current_number, 1)),
                '{seq:02d}', erp_pad(s.current_number, 2)),
                '{seq:03d}', erp_pad(s.current_number, 3)),
                '{seq:04d}', erp_pad(s.current_number, 4)),
                '{seq:05d}', erp_pad(s.current_number, 5)),
                '{seq:06d}', erp_pad(s.current_number, 6)),
                '{seq:07d}', erp_pad(s.current_number, 7)),
                '{seq:08d}', erp_pad(s.current_number, 8)),
                '{seq:09d}', erp_pad(s.current_number, 9)),
                '{seq}',     CAST(s.current_number AS TEXT)),
                '{year}',    CAST(s.year AS TEXT)),
                '{code}',    s.code),
                '{prefix}',  s.prefix)
    END,
    COALESCE(NULLIF(CAST(:issue_date AS TEXT), ''), substr(CAST(:now AS TEXT), 1, 10)),
    g.issuer_nif, g.issuer_name, g.customer_tax_id, g.customer_name, g.customer_address, :reason,
    -CAST(COALESCE(t.base_sum, t.base_fallback) AS INTEGER),
    -CAST(t.amount - COALESCE(t.base_sum, t.base_fallback) AS INTEGER),
    -CAST(t.amount AS INTEGER),
    CASE
      WHEN t.n_entries = 0 THEN '[]'
      WHEN left(btrim(g.tax_breakdown), 1) = '[' THEN COALESCE((
        SELECT jsonb_agg(
                 c.obj
                 || jsonb_build_object('base', -c.base2, 'quota', -c.quota2)
                 || CASE WHEN c.has_sq THEN jsonb_build_object('surcharge_quota', -c.sq2)
                         ELSE '{}'::jsonb END
                 ORDER BY c.ord)
          FROM calc3 c WHERE c.oid = g.id
      ), '[]'::jsonb)::text
      ELSE COALESCE((
        SELECT jsonb_object_agg(c.ekey,
                 c.obj || jsonb_build_object('base', -c.base2, 'tax', -c.quota2))
          FROM calc3 c WHERE c.oid = g.id
      ), '[]'::jsonb)::text
    END,
    g.currency,
    'rectification', NULL, g.id, NULLIF(CAST(:refund_ref AS TEXT), ''), 'issued',
    'Rectifies ' || g.number || '. Reason: ' || :reason,
    0, :current_user_id, :current_user_id, :now, :now
FROM gate g
JOIN totals t ON t.oid = g.id
JOIN invoice_invoiceseries s
  ON s.hub_id = g.hub_id
 AND s.code = 'RECT'
 AND CAST(s.year AS TEXT) = COALESCE(CAST(:year AS TEXT), substr(CAST(:now AS TEXT), 1, 4))
 AND s.is_deleted = 0
-- A whole negation (manual door) is issued even for a 0,00 € document (a header-only or fully
-- comped invoice still gets its R1); the refund door only ever moves positive money.
WHERE (CAST(:sale_id AS TEXT) IS NULL OR t.amount > 0)
-- ── THE ATOMIC BACKSTOP, AND ONLY FOR WHAT IT IS NAMED FOR (invoice#62) ───────────────────────
-- Everything above is check-then-act: a `NOT EXISTS` read, then an INSERT. Only a unique index can
-- decide a race, and `ux_invoice_rectifies_ref` (migration 010) is the one that says «one document
-- per refund». This clause turns its verdict into the same silent no-op the guards produce, instead
-- of an abort that `transaction: true` would spread over the whole fiscal act. The target is narrow
-- on purpose: a bare `ON CONFLICT DO NOTHING` also swallowed a duplicate SERIES NUMBER, which is the
-- one thing a correlative fiscal series may never hide (see `tests/rectify_from_refund…` §8).
ON CONFLICT (hub_id, rectifies_ref)
  WHERE rectifies_ref IS NOT NULL AND rectifies_ref <> '' AND is_deleted = 0
  DO NOTHING;
