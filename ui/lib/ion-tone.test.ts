// ionTone: the inline custom properties that replace `color=` on an ion-* (ERPlora/pm#392).
import { describe, expect, it } from 'vitest';
import { ionTone } from './ion-tone';

describe('ionTone: the inline custom properties, read from the theme token', () => {
  it('a solid badge paints its background, its states and its text from the tone', () => {
    const s = ionTone('solid', 'danger');
    expect(s).toContain('--background: var(--ion-color-danger, #c5000f)');
    expect(s).toContain('--background-activated: var(--ion-color-danger-shade, #ad000d)');
    expect(s).toContain('--background-focused: var(--ion-color-danger-shade, #ad000d)');
    expect(s).toContain('--background-hover: var(--ion-color-danger-tint, #cb1a27)');
    expect(s).toContain('--color: var(--ion-color-danger-contrast, #fff)');
  });

  it('each tone of the invoice and AEAT statuses resolves to its own token, with a readable contrast', () => {
    expect(ionTone('solid', 'medium')).toContain('--background: var(--ion-color-medium, #636469)');
    expect(ionTone('solid', 'primary')).toContain('--background: var(--ion-color-primary, #0054e9)');
    expect(ionTone('solid', 'primary')).toContain('--color: var(--ion-color-primary-contrast, #fff)');
    expect(ionTone('solid', 'success')).toContain('--background: var(--ion-color-success, #2dd55b)');
    // Ionic's success green and warning amber both carry BLACK text: white on them is unreadable.
    expect(ionTone('solid', 'success')).toContain('--color: var(--ion-color-success-contrast, #000)');
    expect(ionTone('solid', 'warning')).toContain('--background: var(--ion-color-warning, #ffc409)');
    expect(ionTone('solid', 'warning')).toContain('--color: var(--ion-color-warning-contrast, #000)');
  });

  // invoice#107 — the buttons of the rectify dialog: `ion-modal` reparents to <body>, out of the
  // component's `static styles`, so an outline button carries its tone inline too.
  it('an outline button paints its text and border from the tone, and no fill', () => {
    const s = ionTone('outline', 'medium');
    expect(s).toContain('--color: var(--ion-color-medium, #636469)');
    expect(s).toContain('--border-color: var(--ion-color-medium, #636469)');
    expect(s).not.toContain('--background:');
  });
});
