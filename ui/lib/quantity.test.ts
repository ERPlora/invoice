import { describe, it, expect } from 'vitest';
import {
  QUANTITY_SCALE,
  toMicro,
  fromMicro,
  parseQuantity,
  formatQuantity,
} from './quantity';

// ADR-0147: la cantidad es punto fijo entero con escala GLOBAL 10⁶ en TODO el cable (commands,
// filas, eventos). El exponente solo existe en las DOS fronteras: cuando un humano teclea
// (parseQuantity → µ) y cuando se pinta (formatQuantity ← µ). Copia local de la aduana de
// `sales/ui/lib/quantity.ts`; consolidarla en @erplora/module-sdk es decisión del humano.

describe('quantity — la frontera de la escala 10⁶ (ADR-0147)', () => {
  it('toMicro/fromMicro: 0,5 es 500000, y vuelve exacto', () => {
    expect(QUANTITY_SCALE).toBe(1_000_000);
    expect(toMicro(0.5)).toBe(500_000);
    expect(toMicro(3)).toBe(3_000_000);
    expect(fromMicro(500_000)).toBe(0.5);
    expect(fromMicro(3_000_000)).toBe(3);
  });

  it('parseQuantity: lo que teclea el humano → µ; coma o punto', () => {
    expect(parseQuantity('0.5')).toBe(500_000);
    expect(parseQuantity('0,5')).toBe(500_000);
    expect(parseQuantity(' 2 ')).toBe(2_000_000);
  });

  it('parseQuantity RECHAZA lo irrepresentable en vez de truncarlo', () => {
    expect(parseQuantity('0.1234567')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
  });

  it('formatQuantity: sin ceros de adorno — 2, no 2.000000', () => {
    expect(formatQuantity(2_000_000)).toBe('2');
    expect(formatQuantity(500_000)).toBe('0.5');
    expect(formatQuantity(1_250_000)).toBe('1.25');
  });
});
