/**
 * SLA working-days utilities.
 * SLA counts only working days (Monday–Friday), excluding weekends (Saturday & Sunday).
 * Hours are still counted 24h per working day — we just skip weekend hours entirely.
 */

/**
 * Calculate elapsed working hours between two dates, excluding weekends.
 * Each full weekend day contributes 0 hours. Partial days are prorated by the hour.
 */
export function calcWorkingHoursElapsed(start: Date, end: Date): number {
  if (end <= start) return 0;

  const msPerHour = 1000 * 60 * 60;
  let totalHours = 0;

  // Walk hour-by-hour from start to end, skipping weekend hours
  let cursor = new Date(start);
  while (cursor < end) {
    const nextHour = new Date(cursor.getTime() + msPerHour);
    const day = cursor.getDay(); // 0=Sun, 6=Sat

    if (day !== 0 && day !== 6) {
      // Weekday — count the actual elapsed portion (may be partial at the end)
      const actualEnd = nextHour > end ? end : nextHour;
      totalHours += (actualEnd.getTime() - cursor.getTime()) / msPerHour;
    }

    cursor = nextHour;
  }

  // Round to 2 decimal places to avoid floating point drift
  return Math.round(totalHours * 100) / 100;
}

/**
 * Check if an SLA is breached based on working-day elapsed time.
 * @param enteredAt - When the stage started
 * @param exitedAt - When the stage ended (defaults to now)
 * @param slaHours - SLA target in hours (based on working days)
 */
export function isSLABreached(
  enteredAt: Date,
  exitedAt: Date | null,
  slaHours: number
): boolean {
  const end = exitedAt || new Date();
  const elapsed = calcWorkingHoursElapsed(enteredAt, end);
  return elapsed > slaHours;
}

/**
 * Calculate remaining working hours before SLA breach.
 * Returns negative value if already breached.
 */
export function calcRemainingWorkingHours(
  enteredAt: Date,
  slaHours: number,
  now?: Date
): number {
  const current = now || new Date();
  const elapsed = calcWorkingHoursElapsed(enteredAt, current);
  return Math.round((slaHours - elapsed) * 100) / 100;
}
