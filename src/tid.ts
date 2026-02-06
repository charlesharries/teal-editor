/**
 * TID (Timestamp ID) parsing utilities
 *
 * TIDs are 13-character strings using base32-sortable encoding.
 * The first 11 characters encode a microsecond timestamp.
 * Format: TTTTTTTTTTTCC where T=timestamp, C=clock ID
 */

// Base32-sortable alphabet used by AT Protocol
const B32_CHARS = '234567abcdefghijklmnopqrstuvwxyz';

/**
 * Decode a base32-sortable character to its numeric value
 */
function decodeChar(char: string): number {
  const index = B32_CHARS.indexOf(char.toLowerCase());
  if (index === -1) {
    throw new Error(`Invalid base32 character: ${char}`);
  }
  return index;
}

/**
 * Extract timestamp from a TID
 * @param tid - 13-character TID string
 * @returns Date object representing the record creation time
 */
export function tidToDate(tid: string): Date {
  if (tid.length !== 13) {
    throw new Error(`Invalid TID length: ${tid.length}, expected 13`);
  }

  // First 11 characters encode the timestamp in microseconds
  const timestampPart = tid.slice(0, 11);

  let timestamp = BigInt(0);
  for (const char of timestampPart) {
    timestamp = timestamp * BigInt(32) + BigInt(decodeChar(char));
  }

  // Convert microseconds to milliseconds for Date
  const milliseconds = Number(timestamp / BigInt(1000));
  return new Date(milliseconds);
}

/**
 * Check if a TID falls within a time range
 * @param tid - 13-character TID string
 * @param start - Start of time range (inclusive)
 * @param end - End of time range (inclusive)
 */
export function tidInRange(tid: string, start: Date, end: Date): boolean {
  const date = tidToDate(tid);
  return date >= start && date <= end;
}

/**
 * Format a TID for display with its decoded timestamp
 */
export function formatTid(tid: string): string {
  try {
    const date = tidToDate(tid);
    return `${tid} (${date.toISOString()})`;
  } catch {
    return `${tid} (invalid)`;
  }
}
