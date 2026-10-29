/** Pure pricing helpers for the Tripseek+ screen (no StoreKit imports, so they're unit-testable). */

/**
 * How much the annual plan saves versus paying monthly for a year, as a whole percent.
 * Returns null when either price is unknown or there's no saving, so the badge is hidden
 * rather than showing a made-up number.
 */
export function annualSavingsPercent(
  monthlyPrice: number | null | undefined,
  annualPrice: number | null | undefined,
): number | null {
  if (!monthlyPrice || !annualPrice || monthlyPrice <= 0 || annualPrice <= 0) return null;
  const percent = Math.floor((1 - annualPrice / (monthlyPrice * 12)) * 100);
  return percent >= 1 ? percent : null;
}
