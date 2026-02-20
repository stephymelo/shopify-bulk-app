/**
 * Calculate unit price from pack price and units per pack.
 */
export function calculateUnitPrice(packPrice: number, unitsPerPack: number): number {
  if (!packPrice || !unitsPerPack || unitsPerPack <= 0) return 0;
  return packPrice / unitsPerPack;
}

/**
 * Calculate savings percentage vs buying individual units.
 */
export function calculateSavings(unitPrice: number, packUnitPrice: number): number {
  if (!unitPrice || unitPrice <= 0 || !packUnitPrice) return 0;
  return Math.round(((unitPrice - packUnitPrice) / unitPrice) * 100);
}

/**
 * Format a number as currency.
 */
export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}
