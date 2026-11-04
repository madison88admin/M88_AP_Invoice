export function matchesReceivedTimeRange(timestamp: unknown, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const received = new Date(String(timestamp || '')).getTime();
  if (!Number.isFinite(received)) return false;
  const start = from ? new Date(from).getTime() : -Infinity;
  let end = to ? new Date(to).getTime() : Infinity;
  // The input displays minutes, so include the complete selected end minute.
  if (to && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(to)) end += 59999;
  return !Number.isNaN(start) && !Number.isNaN(end) && received >= start && received <= end;
}
