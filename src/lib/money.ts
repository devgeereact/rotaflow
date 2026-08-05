/**
 * Money formatting, from integer pence.
 *
 * Every amount in the schema is an integer number of pence, and this is the
 * only place it becomes a decimal. Two divisions by 100 in two components is
 * how a total ends up a penny out from the rows above it.
 */

/** "£1,240" — no pence, for headline figures where the pence are noise. */
export function formatMoney(pence: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(pence / 100);
}

/** "£1,240.00" — for a line item on an invoice, where they are not. */
export function formatMoneyExact(pence: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pence / 100);
}

/**
 * "£12.4k" / "£1.2m" — for a tile where the exact figure would not fit.
 *
 * Only used where the precise number is available elsewhere on the same
 * screen. A rounded figure that appears nowhere in full is one nobody can
 * reconcile.
 */
export function formatMoneyShort(pence: number, currency = 'GBP'): string {
  const pounds = pence / 100;
  const symbol = currency === 'GBP' ? '£' : '';
  if (Math.abs(pounds) >= 1_000_000)
    return `${symbol}${(pounds / 1_000_000).toFixed(1)}m`;
  if (Math.abs(pounds) >= 1_000) return `${symbol}${(pounds / 1_000).toFixed(1)}k`;
  return `${symbol}${Math.round(pounds)}`;
}
