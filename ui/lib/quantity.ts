// quantity — the BOUNDARY of the quantity scale (ADR-0147).
//
// A quantity is an EXACT decimal value in a unit of measure, stored and carried as a fixed-point
// integer on the GLOBAL 10⁶ scale: 0.5 travels as 500000 in the command, the row and the event.
// The exponent only exists in TWO places: when a person types and when it is painted.
//
// Local COPY of `sales/ui/lib/quantity.ts` (modules do not import each other). TS mirror of
// `hub/crates/guest-sdk/src/units.rs`.
import { numberFormat } from './number-format';

/** Global scale: six decimals. `logical = raw / QUANTITY_SCALE`. */
export const QUANTITY_SCALE = 1_000_000;

/** Logical UI value → µ fixed point. Rounds to the nearest µ: absorbs the UI's f64 noise. */
export function toMicro(qty: number): number {
  return Math.round(qty * QUANTITY_SCALE);
}

/** µ fixed point → logical UI value (to paint and to operate on screen). */
export function fromMicro(raw: number): number {
  return raw / QUANTITY_SCALE;
}

/**
 * INPUT boundary: what a person types → µ, or `null` if it is not a valid quantity.
 * Rejects more than 6 decimals instead of truncating them. Accepts a decimal comma (es-ES).
 */
export function parseQuantity(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const raw = Math.round(parseFloat(t) * QUANTITY_SCALE);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

/** OUTPUT boundary: µ → text in the person's language, without padding zeros (`2`, not
 *  `2.000000`) and with all six decimals of the scale when they are there: «1,5» in es, «1.5» in
 *  en (invoice#125). Grouped from four digits like the amounts of the same line («1.234,5»,
 *  hub#1090), not by CLDR's es default («1234,5»). */
export function formatQuantity(raw: number, locale: string | undefined): string {
  return numberFormat(locale, { maximumFractionDigits: 6, useGrouping: true }).format(fromMicro(raw));
}
