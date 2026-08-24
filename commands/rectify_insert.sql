-- Crea la factura rectificativa R1 con importes NEGADOS, copiando emisor/cliente de
-- la original (INSERT...SELECT — no necesita iterar líneas: la rectificación es a
-- nivel cabecera, fiel a InvoiceService.rectify). number desde la serie RECT.
-- tax_breakdown se deja '{}' (negar JSON en SQL no es práctico; el detalle de líneas
-- no se copia en el legacy tampoco). Runtime inyecta :new_id, :hub_id, :now, :year, :reason.
--
-- ⚠ RENDER — el mismo que `commands/_insert_invoice.sql` y `queries/series_peek_next.sql` (allí con
-- `current_number + 1`). TRES sitios; los pina `tests/number_format.postgres.test.py` §1. Si tocas
-- uno, toca los tres. invoice#40: la serie RECT deja de ser una subquery escalar y pasa a un JOIN,
-- porque el render necesita varias de sus columnas — y de paso la rectificativa **honra el formato
-- configurado de su serie** en vez del `RECT-YYYY-NNNNNN` cableado que tenía antes.
INSERT INTO invoice_invoice (
    id, hub_id, invoice_type, series, number, issue_date,
    issuer_nif, issuer_name, customer_tax_id, customer_name, customer_address, description,
    base_amount, tax_amount, total_amount, tax_breakdown, currency,
    source_type, source_id, rectifies_invoice_id, rectifies_ref, status, notes,
    is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
    :new_id, o.hub_id, 'R1', 'RECT',
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
    o.issuer_nif, o.issuer_name, o.customer_tax_id, o.customer_name, o.customer_address, :reason,
    -o.base_amount, -o.tax_amount, -o.total_amount,
    -- ── EL DESGLOSE (invoice#5 D2) ───────────────────────────────────────────────────────────
    -- Antes iba `'{}'`, y `'{}'` NO falla de forma ruidosa: `hub/crates/verifactu/src/aeat.rs`
    -- `desglose()` cae a un ÚNICO detalle con el tipo EFECTIVO (`cuota/base`). Una factura de tipo
    -- único salía bien por casualidad; una MIXTA (la caña al 21 % + la tapa al 10 %) daba un
    -- efectivo de ~19,1 %, que no es un tipo legal de IVA, y la tumbaba el guard local `xsd.rs`.
    --
    -- Se COPIA del snapshot congelado en la original y se NIEGAN solo los importes. Nunca se
    -- re-deriva (ADR-0210): la base fiscal es de la TARIFA del documento, así que recalcular con
    -- los ajustes o la tarifa de hoy haría salir la rectificativa de una factura vieja sobre otra
    -- base que la factura que rectifica. Y el desglose se cierra una vez por TIPO, no por línea
    -- (ADR-0123 §4), así que copiar el array es exactamente lo que hay que hacer.
    --
    -- El TIPO no se niega (un 21 % rectificado sigue siendo un 21 %); tampoco `surcharge_rate`.
    -- Se niegan `base`, `quota` y, si viene, `surcharge_quota`.
    --
    -- Dos formatos, porque el consumidor acepta los dos y una original vieja puede llevar el
    -- viejo: ARRAY (una entrada por clave fiscal, formato actual) y OBJETO legacy
    -- (`{"21": {"base":…, "tax":…}}`). Lo que no sea ni una cosa ni otra —`'{}'` de las facturas
    -- anteriores al campo, o texto ilegible— sale como `'[]'`, que es donde ya estaba: el mismo
    -- fallback al tipo efectivo. No se inventa un desglose que nadie registró.
    --
    -- ⚠️ `erplora validate` avisa de `jsonb_array_elements` / `jsonb_each` como «tabla sin el
    -- prefijo `invoice_`» (ADR-0263). Son AVISOS y son falsos positivos conocidos: no son tablas,
    -- son funciones que devuelven filas, y el propio linter dice que no puede distinguirlas. No
    -- hay nada que arreglar aquí — se deja escrito para que no se vuelva a investigar.
    CASE
      WHEN o.tax_breakdown IS NULL OR btrim(o.tax_breakdown) = '' THEN '[]'
      WHEN left(btrim(o.tax_breakdown), 1) = '[' THEN COALESCE((
        SELECT jsonb_agg(
                 CASE WHEN jsonb_typeof(e.v) = 'object'
                      THEN e.v
                           || jsonb_build_object(
                                'base',  (- COALESCE((e.v->>'base')::numeric, 0)),
                                'quota', (- COALESCE((e.v->>'quota')::numeric, 0)))
                           -- `jsonb_exists(v, k)` y no el operador `v ? k`: son la MISMA función,
                           -- pero `?` es también el placeholder posicional del estilo portable, y
                           -- `erplora validate` (ADR-0007) lo rechaza — con razón, porque un
                           -- linter léxico no puede saber cuál de los dos es.
                           || CASE WHEN jsonb_exists(e.v, 'surcharge_quota')
                                   THEN jsonb_build_object('surcharge_quota',
                                          (- COALESCE((e.v->>'surcharge_quota')::numeric, 0)))
                                   ELSE '{}'::jsonb END
                      ELSE e.v END
                 ORDER BY e.ord)
          FROM jsonb_array_elements(o.tax_breakdown::jsonb) WITH ORDINALITY AS e(v, ord)
      ), '[]'::jsonb)::text
      WHEN left(btrim(o.tax_breakdown), 1) = '{' THEN COALESCE((
        SELECT jsonb_object_agg(e.k,
                 e.v || jsonb_build_object(
                          'base', (- COALESCE((e.v->>'base')::numeric, 0)),
                          'tax',  (- COALESCE((e.v->>'tax')::numeric, 0))))
          FROM jsonb_each(o.tax_breakdown::jsonb) AS e(k, v)
         WHERE jsonb_typeof(e.v) = 'object'
      ), '[]'::jsonb)::text
      ELSE '[]'
    END,
    o.currency,
    -- ── EL ORIGEN (invoice#5 D1) ─────────────────────────────────────────────────────────────
    -- Antes se copiaban `o.source_type, o.source_id` VERBATIM, y ahí murió la rectificación de
    -- todo tiquet de TPV: `uq_invoice_source (hub_id, source_type, source_id) WHERE source_id IS
    -- NOT NULL` ya tenía esa tupla ocupada por la ORIGINAL, la unicidad reventaba y
    -- `transaction: true` abortaba la cadena entera. Solo se podía rectificar la factura MANUAL
    -- (`source_id NULL`, el índice parcial no aplica) — que es justo la única que probaba el e2e.
    --
    -- Una rectificativa no tiene origen externo del que ser idempotente: no nace de una venta, nace
    -- de esta orden. `source_id` NULL, y el «una rectificativa por factura» lo sostiene su propio
    -- índice sobre el enlace fiscal (`ux_invoice_rectifies`, migración 009) en vez de tomar
    -- prestado el índice de ventas. `source_type` se queda informativo.
    'rectification', NULL, o.id, NULLIF(CAST(:refund_ref AS TEXT), ''), 'issued',
    'Rectifies ' || o.number || '. Reason: ' || :reason,
    0, :current_user_id, :current_user_id, :now, :now
FROM invoice_invoice o
JOIN invoice_invoiceseries s
  ON s.hub_id = o.hub_id
 AND s.code = 'RECT'
 AND CAST(s.year AS TEXT) = COALESCE(CAST(:year AS TEXT), substr(CAST(:now AS TEXT), 1, 4))
 AND s.is_deleted = 0
WHERE o.hub_id = :hub_id AND o.invoice_type NOT LIKE 'R%'
  -- ── WHICH ORIGINAL (invoice#62) ────────────────────────────────────────────────────────────
  -- Two doors walk this one chain. `invoice.rectify` names the document (`:original_id`); the
  -- listener of `sale.refunded` cannot — an event carries the SALE, so the original is resolved
  -- from this module's own row through the tuple `uq_invoice_source` already keeps unique per hub.
  -- The payload therefore never names the fiscal document it is about to cancel. The value written
  -- into `rectifies_invoice_id` is `o.id`, the row that was actually matched, not the parameter:
  -- on the refund path the parameter is NULL, and on the manual path the two are the same thing.
  AND (o.id = CAST(:original_id AS TEXT)
       OR (CAST(:original_id AS TEXT) IS NULL
           AND o.source_type = 'sale'
           AND o.source_id = CAST(:sale_id AS TEXT)))
  -- The refund path only issues when the WHOLE invoice came back, and only with a stable refund
  -- reference to be idempotent about. Both conditions are spelled out in `rectify_bump.sql`, which
  -- is the door that decides whether a NUMBER is spent; they are repeated here because a guard that
  -- is not on every door is not a guard (ADR-0020).
  AND (CAST(:sale_id AS TEXT) IS NULL
       OR (COALESCE(CAST(:fully_refunded AS INTEGER), 0) = 1
           AND NULLIF(CAST(:refund_ref AS TEXT), '') IS NOT NULL))
  -- invoice#39: la MISMA guarda que `rectify_bump.sql` (patrón ADR-0020). Sin ella, un reintento
  -- emitía una segunda rectificativa de la misma factura con un número nuevo; con la guarda solo en
  -- el bump, el insert habría escrito con un número que el contador ya no había avanzado. Las dos
  -- puertas se mueven juntas. `is_deleted = 0` también se exige aquí: una original soft-borrada no
  -- se rectifica.
  AND o.is_deleted = 0
  AND NOT EXISTS (
    SELECT 1 FROM invoice_invoice r
    WHERE r.hub_id = :hub_id AND r.rectifies_invoice_id = o.id AND r.is_deleted = 0
  )
  -- ...and the same again for the REFUND document (invoice#62). Redundant with the line above
  -- while one invoice may carry only one rectification, and deliberately kept: the day a partial
  -- refund gets its own rectificativa por diferencias (invoice#63) one invoice carries N of them,
  -- one per refund, and this is the guard that still holds. Placed on all three doors so that a
  -- redelivery spends no number, exactly like the guard above.
  AND NOT EXISTS (
    SELECT 1 FROM invoice_invoice rr
    WHERE rr.hub_id = :hub_id
      AND rr.rectifies_ref = NULLIF(CAST(:refund_ref AS TEXT), '')
      AND rr.is_deleted = 0
  )
-- ── THE ATOMIC BACKSTOP, AND ONLY FOR WHAT IT IS NAMED FOR (invoice#62) ───────────────────────
-- Everything above is check-then-act: a `NOT EXISTS` read, then an INSERT. Only a unique index can
-- decide a race, and `ux_invoice_rectifies_ref` (migration 010) is the one that says «one document
-- per refund». This clause turns its verdict into the same silent no-op the guards produce, instead
-- of an abort that `transaction: true` would spread over the whole fiscal act — on a redelivery
-- that was supposed to be uneventful.
--
-- THE TARGET IS NARROW ON PURPOSE, and it was a bare `ON CONFLICT DO NOTHING` until a mutation run
-- showed what that costs: with no target it also swallowed a duplicate SERIES NUMBER, and a
-- deliberately broken tenancy filter — a neighbouring hub's refund reaching into our books — came
-- out of the test suite GREEN, because the stray row happened to collide on the number and vanish.
-- A conflict this chain cannot explain must abort loudly: `uq_invoice_series_number` firing means
-- the counter and the document have gone out of step, which is the one thing a correlative fiscal
-- series may never hide. Naming the index requires repeating its predicate — that is how Postgres
-- infers a PARTIAL index — and the repetition is checked by `tests/rectify_from_refund…` §8, which
-- reaches the index by a raw INSERT past every guard above.
--
-- Honest about its reach: walking THIS chain twice never gets here. `transaction: true` plus the
-- row lock `rectify_bump` takes on the series serialises two relays, so the second re-evaluates its
-- guards after the first commits and refuses before reaching the insert (asserted in §2). What this
-- covers is the other direction — a concurrent writer that reaches `invoice_invoice` without
-- walking the bump, which is the runtime this module is written for (see migration 009).
ON CONFLICT (hub_id, rectifies_ref)
  WHERE rectifies_ref IS NOT NULL AND rectifies_ref <> '' AND is_deleted = 0
  DO NOTHING;
