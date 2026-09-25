// The currency `<ok-money>` paints after the number. The row keeps the ISO code (`EUR`); the screen
// shows the symbol the shell's formatter showed until now (`€`), so moving to `<ok-money>` does not
// change what the user reads.
import { describe, expect, it } from 'vitest';
import { currencySymbol } from './currency-symbol';

describe('currencySymbol', () => {
  it('EUR is €', () => {
    expect(currencySymbol('EUR', 'es')).toBe('€');
  });

  it('USD in English is $', () => {
    expect(currencySymbol('USD', 'en')).toBe('$');
  });

  it('a code Intl does not know is painted as it came, trimmed', () => {
    expect(currencySymbol(' XX1 ', 'es')).toBe('XX1');
  });

  it('no code, no symbol', () => {
    expect(currencySymbol('', 'es')).toBe('');
    expect(currencySymbol(undefined, 'es')).toBe('');
  });
});
