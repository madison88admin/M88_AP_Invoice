const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export function getAuditActorDisplay(actor?: string | null, note?: string | null) {
  if (!actor || !UUID_PATTERN.test(actor)) return actor || 'Unknown';

  const nameFromNote = note?.match(/Invoice (?:edited|updated) by (.+?) \([A-Z_]+\)/i)?.[1]?.trim();
  return nameFromNote || actor;
}
