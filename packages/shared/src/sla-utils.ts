/**
 * SLA calendar-day utilities.
 * SLA is measured in elapsed calendar hours. Weekends and holidays are not
 * excluded; this matches the AP procedure's calendar-day definition.
 */

/**
 * Calculate elapsed calendar hours between two dates.
 */
export function calcWorkingHoursElapsed(start: Date, end: Date): number {
  if (end <= start) return 0;
  const msPerHour = 1000 * 60 * 60;
  return Math.round(((end.getTime() - start.getTime()) / msPerHour) * 100) / 100;
}

/**
 * Check if an SLA is breached based on calendar-day elapsed time.
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
 * Calculate remaining calendar hours before SLA breach.
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
