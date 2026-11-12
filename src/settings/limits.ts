// Storage limits as the owner types them on People: an amount and a unit,
// such as 10 GB, which the server takes in bytes.

/** The units a limit can be in, in bytes, as file sizes count them. */
export const LIMIT_UNITS = [
  ["MB", 1e6],
  ["GB", 1e9],
  ["TB", 1e12],
] as const;

/** A limit in the largest unit that shows it as at least 1, with up to one
 * decimal place, such as 1.5 TB. A new limit starts at 10 GB. */
export function limitParts(bytes: number | null): { amount: string; unit: number } {
  if (bytes === null) return { amount: "10", unit: 1 };
  for (let unit = LIMIT_UNITS.length - 1; unit > 0; unit -= 1) {
    const tenths = (bytes / LIMIT_UNITS[unit]![1]) * 10;
    if (tenths >= 10 && Math.abs(tenths - Math.round(tenths)) < 1e-6) {
      return { amount: String(Math.round(tenths) / 10), unit };
    }
  }
  return { amount: String(Math.max(0.1, Math.round((bytes / 1e6) * 10) / 10)), unit: 0 };
}

/** The bytes for an amount typed in `unit`, to one decimal place, or null
 * if it isn't a number of at least 0.1. */
export function limitBytes(amount: string, unit: number): number | null {
  const value = Math.round(Number(amount) * 10) / 10;
  if (amount.trim() === "" || !Number.isFinite(value) || value < 0.1) return null;
  return Math.round(value * LIMIT_UNITS[unit]![1]);
}
