// The colour of an `ion-*` element as INLINE custom properties, read from the theme token
// (ERPlora/pm#392). `color="…"` cannot be used in a module: Ionic resolves it through a global
// `.ion-color-*` rule that does not reach inside a shadow root. A `static styles` rule does not work
// either for the status chips of the tables, because `ok-data-table` renders its column cells inside
// ITS OWN shadow root. Custom properties set on the element itself paint the same in the component's
// shadow root and in the table's cell.

export type IonToneKind = 'solid' | 'outline';
export type IonTone = 'danger' | 'warning' | 'success' | 'medium' | 'primary';

/** Ionic 8's default palette: the fallback when the theme does not define the token. */
const PALETTE: Record<IonTone, { base: string; contrast: string; shade: string; tint: string }> = {
  danger: { base: '#c5000f', contrast: '#fff', shade: '#ad000d', tint: '#cb1a27' },
  warning: { base: '#ffc409', contrast: '#000', shade: '#e0ac08', tint: '#ffca22' },
  success: { base: '#2dd55b', contrast: '#000', shade: '#28bb50', tint: '#42d96b' },
  medium: { base: '#636469', contrast: '#fff', shade: '#57585c', tint: '#737478' },
  primary: { base: '#0054e9', contrast: '#fff', shade: '#004acd', tint: '#1a65eb' },
};

/**
 * The `style` value that paints an element in `tone`. `solid`: a filled `ion-badge` (background, its
 * pressed/focused/hover states and its text) — what `color=` does in Ionic. `outline`: an
 * `ion-button fill="outline"` — its text and border only (invoice#107, the buttons of a dialog that
 * `ion-modal` reparents to <body>, out of the component's `static styles`).
 */
export function ionTone(kind: IonToneKind, tone: IonTone): string {
  const p = PALETTE[tone];
  const token = (suffix: string, fallback: string) => `var(--ion-color-${tone}${suffix}, ${fallback})`;
  if (kind === 'outline') {
    return [`--color: ${token('', p.base)}`, `--border-color: ${token('', p.base)};`].join('; ');
  }
  return [
    `--background: ${token('', p.base)}`,
    `--background-activated: ${token('-shade', p.shade)}`,
    `--background-focused: ${token('-shade', p.shade)}`,
    `--background-hover: ${token('-tint', p.tint)}`,
    `--color: ${token('-contrast', p.contrast)};`,
  ].join('; ');
}
