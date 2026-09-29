// number-format — `Intl.NumberFormat` in the person's language, safe against the tag the shell
// hands over (invoice#125). An unreadable tag («es_ES») throws a RangeError in `Intl`; the number
// is then written with the runtime default rather than leaving the screen unpainted
// (rv-outfitkit-245). Amounts never come through here: they are painted by `<ok-money>`.

export function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale || undefined, options);
  } catch {
    return new Intl.NumberFormat(undefined, options);
  }
}
