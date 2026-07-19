// quantity — la FRONTERA de la escala de cantidades (ADR-0147).
//
// La cantidad es un valor decimal EXACTO en una unidad de medida, persistida y transportada como
// punto fijo entero con escala GLOBAL 10⁶: 0,5 viaja como 500000 en el command, la fila y el
// evento. El exponente solo existe en DOS sitios: cuando un humano teclea y cuando se pinta.
//
// COPIA local de `sales/ui/lib/quantity.ts` (los módulos no se importan entre sí). Espejo TS de
// `hub/crates/guest-sdk/src/units.rs`. Consolidarla en @erplora/module-sdk es decisión del
// humano (API pública del SDK).

/** Escala global: seis decimales. `lógico = raw / QUANTITY_SCALE`. */
export const QUANTITY_SCALE = 1_000_000;

/** UI lógico → punto fijo µ. Redondea al µ más cercano: absorbe el ruido f64 de la UI. */
export function toMicro(qty: number): number {
  return Math.round(qty * QUANTITY_SCALE);
}

/** Punto fijo µ → UI lógico (para pintar y operar en pantalla). */
export function fromMicro(raw: number): number {
  return raw / QUANTITY_SCALE;
}

/**
 * Frontera de ENTRADA: lo que teclea un humano → µ, o `null` si no es una cantidad válida.
 * Rechaza más de 6 decimales en vez de truncarlos. Admite coma decimal (es-ES).
 */
export function parseQuantity(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const raw = Math.round(parseFloat(t) * QUANTITY_SCALE);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

/** Frontera de SALIDA: µ → texto sin ceros de adorno (`2`, no `2.000000`). */
export function formatQuantity(raw: number): string {
  return String(fromMicro(raw));
}
