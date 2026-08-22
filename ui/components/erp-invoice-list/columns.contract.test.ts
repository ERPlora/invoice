// Contrato de COLUMNAS del listado de facturas (invoice#51): TOTAL dentro del pliegue.
//
// QUÉ PASABA. A 1440 la columna TOTAL no se veía: `ok-data-table` desborda POR DISEÑO
// (`min-width: max-content`) y con las columnas por defecto (`minmax(8rem,1fr)`, sin `width`)
// la contribución max-content de cada pista es TODO su contenido — el nombre del cliente manda
// la tabla a 1794px y Total vivía 626px más allá del borde (medido en QA: scrollWidth=1794,
// clientWidth=1168). En móvil (390) la vista de tarjetas SÍ mostraba el total. En un facturador,
// el importe es lo primero que se mira.
//
// LA FIX (de layout, declarada): ok-data-table 0.1.44 no fija columnas de DATOS (solo la de
// acciones, outfitkit#67) ni tiene `priority`; lo que sí tiene es `width` por columna = la pista
// CSS del grid. Este módulo declara:
//   1. ORDEN por importancia de negocio: number · customer · TOTAL · status · date · type
//      (type la última: la primera en ceder, recuperable del selector «Columnas»).
//   2. WIDTH acotado en TODAS las columnas (`minmax(min,max)` en rem): un máximo fijo acota la
//      contribución max-content de la pista, así el pliegue es predecible y el texto largo
//      se corta con ellipsis (`.gcell > span`).
//
// ESTE TEST fija el contrato que hace posible la fix; el layout real (que nada quede tras el
// scroll en 1440/834/390) se verifica en navegador — happy-dom no computa layout.
//
// Presupuestos DECLARADOS y MEDIDOS (Chromium vía `erplora dev`, nombres de cliente largos —
// ver erp-invoice-list.ts `columns`):
//   - 1440 (escritorio): pliegue del scroller = 1168px = 73rem (QA invoice#51); con estos anchos
//     la tabla entera CABE (scrollWidth == clientWidth: cero scroll); acciones ≈ 7rem.
//   - 834 (tablet, peor caso con sidebar de 240px: área útil 562px): la tabla sigue siendo tabla
//     (el breakpoint de tarjetas de ok-data-table es 640), las acciones crecen a 44px táctiles;
//     el borde derecho de TOTAL cae a 512px medido (30rem de pistas) — dentro del pliegue.
//     Type es la que cede (952px, tras el scroll) — por diseño, es la última.
//   - 390 (móvil): vista de tarjetas de ok-data-table — la tarjeta pinta el total con moneda.
import { beforeEach, describe, expect, it } from 'vitest';

const SERIES = [
  { id: 'sr1', code: 'FACT', name: 'Facturas', invoice_type: 'F1', is_active: 1 },
];

const FACTURA = {
  id: 'i1', invoice_type: 'F1', series: 'FACT', number: 'FACT-2026-000002', issue_date: '2026-08-21',
  customer_name: 'ACME', customer_tax_id: 'B12345678', base_amount: 10000, tax_amount: 2100,
  total_amount: 12100, status: 'issued', source_type: 'manual',
};

beforeEach(() => {
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) => (name === 'invoice.series.list' ? SERIES : []),
    queryPage: async () => ({ rows: [FACTURA], total: 1 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    formatAmount: (units: number) => `${units.toFixed(2)} €`,
  };
});

type Column = { key: string; align?: string; width?: string; format?: (r: Record<string, unknown>) => string };

async function montar() {
  await import('./erp-invoice-list');
  const el = document.createElement('erp-invoice-list');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

async function columnas(): Promise<Column[]> {
  const el = await montar();
  const tabla = el.shadowRoot.querySelector('ok-data-table') as unknown as { columns: Column[] };
  expect(tabla, 'la vista no pintó su ok-data-table').toBeTruthy();
  return tabla.columns;
}

const REM = /^minmax\((\d+(?:\.\d+)?)rem, (\d+(?:\.\d+)?)rem\)$/;

/** [min, max] en rem de un width declarado, o null si no acota. */
function remBounds(width: string | undefined): [number, number] | null {
  const m = width?.match(REM);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

describe('la columna TOTAL está dentro del pliegue (invoice#51)', () => {
  it('el ORDEN es por importancia de negocio: number · customer · TOTAL · status · date · type', async () => {
    const cols = (await columnas()).map((c) => c.key);
    expect(cols, 'el orden de las columnas cambió — actualiza este contrato a conciencia').toEqual([
      'number', 'customer_name', 'total_amount', 'status', 'issue_date', 'invoice_type',
    ]);
  });

  it('total_amount va la TERCERA, no tras cliente+estado+fecha', async () => {
    const cols = (await columnas()).map((c) => c.key);
    expect(cols.indexOf('total_amount')).toBe(2);
  });

  it('type es la ÚLTIMA columna de datos: la primera en ceder espacio', async () => {
    const cols = (await columnas()).map((c) => c.key);
    expect(cols[cols.length - 1]).toBe('invoice_type');
  });

  it('TODAS las columnas declaran un width ACOTADO (minmax(min,max)rem) — sin él, el contenido manda el pliegue', async () => {
    for (const c of await columnas()) {
      const bounds = remBounds(c.width);
      expect(bounds, `la columna \`${c.key}\` no acota su ancho (\`width: ${c.width}\`)`).not.toBeNull();
      expect(bounds![1], `la columna \`${c.key}\` tiene max < min`).toBeGreaterThanOrEqual(bounds![0]);
    }
  });

  it('la suma de MÁXIMOS + acciones cabe en el pliegue de 1440 (clientWidth medido: 1168px = 73rem)', async () => {
    const cols = await columnas();
    const sumMax = cols.reduce((acc, c) => acc + (remBounds(c.width)?.[1] ?? Infinity), 0);
    // Acciones icon-only small (admin: ver + cobrar + rectificar) ≈ 7rem; presupuesto total 73rem.
    expect(sumMax + 7).toBeLessThanOrEqual(73);
  });

  it('el borde derecho de TOTAL queda a ≤ 31rem de pistas (medido: 512px en un pliegue útil de 562px a 834)', async () => {
    const cols = await columnas();
    const keys = cols.map((c) => c.key);
    const idx = keys.indexOf('total_amount');
    const through = cols
      .slice(0, idx + 1)
      .reduce((acc, c) => acc + (remBounds(c.width)?.[1] ?? Infinity), 0);
    expect(through).toBeLessThanOrEqual(31);
  });

  it('total sigue alineada a la derecha y con el símbolo de moneda (como la tarjeta en móvil)', async () => {
    const total = (await columnas()).find((c) => c.key === 'total_amount');
    expect(total?.align).toBe('right');
    expect(total?.format?.(FACTURA)).toBe('121.00 €');
  });
});
