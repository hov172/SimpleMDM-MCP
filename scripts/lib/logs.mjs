// Pure helpers for the logs-audit engine. No network, no fs.

// "MM/DD/YY HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS". Same wall-clock, NO timezone
// shift and NO UTC claim (the /logs API does not stamp an offset). "" if unparseable.
export function toIso(at) {
  if (typeof at !== "string") return "";
  const m = at.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return "";
  const [, mo, d, y, hh, mm, ss] = m;
  return `20${y}-${mo}-${d}T${hh}:${mm}:${ss}`;
}
