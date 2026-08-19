// Una factura emitida NO se edita: se rectifica.
//
// Es una decisión vieja del proyecto (decision-log: «Una factura emitida es inmutable: no se
// anula ni se borra. Para deshacer/devolver se emite una…») y el módulo ya la cumple de hecho —
// no existe ningún `invoice.update`, solo `invoice.rectify`. Lo que faltaba es DECLARARLA donde
// el core puede leerla: el bloque `records` de ADR-0331, cuyo vocabulario de motivos es cerrado
// precisamente para que el asistente pueda explicarlo.
//
// Sin esta declaración el asistente no tiene la regla, y cuando le preguntan qué no puede hacer
// se INVENTA una política (ERPlora/hub#1042). Un hecho que solo vive en la ausencia de un
// command no se lo puede explicar a nadie.
import { describe, expect, it } from 'vitest';
import manifest from '../../module.json';

type RecordDef = {
  mutable: boolean;
  reason?: string;
  correct_with?: string[];
  update?: string;
};
const m = manifest as unknown as {
  records?: Record<string, RecordDef>;
  commands: Record<string, unknown>;
};

describe('la factura se declara inmutable, y nombra su puerta de corrección', () => {
  it('declara el registro `invoice` como no editable', () => {
    expect(m.records?.invoice?.mutable).toBe(false);
  });

  it('da el motivo con el vocabulario CERRADO de ADR-0331', () => {
    expect(['fiscal', 'ledger', 'identity', 'audit']).toContain(m.records?.invoice?.reason);
  });

  it('apunta a la corrección que existe de verdad', () => {
    expect(m.records?.invoice?.correct_with).toContain('invoice.rectify');
    // El control contra el que se afirma: la puerta declarada tiene que ser un command real de
    // este manifest, no un nombre bonito. Una corrección que no existe es peor que ninguna.
    for (const cmd of m.records?.invoice?.correct_with ?? []) {
      expect(Object.keys(m.commands)).toContain(cmd);
    }
  });

  it('no declara un `update`, porque no lo hay (lo prohíbe el propio schema)', () => {
    expect(m.records?.invoice?.update).toBeUndefined();
    expect(Object.keys(m.commands)).not.toContain('invoice.update');
  });
});
