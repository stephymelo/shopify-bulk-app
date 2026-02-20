/**
 * Calculate unit price from case price and units per case.
 * Returns 0 if either value is invalid.
 */
export function calculateUnitPrice(casePrice: number, unitsPerCase: number): number {
  if (!casePrice || !unitsPerCase || unitsPerCase <= 0) return 0;
  return casePrice / unitsPerCase;
}

/**
 * Format a number as a money string (USD).
 */
export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}
