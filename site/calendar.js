// One stable scale: the minimum count for each intensity level.
export const LEVEL_THRESHOLDS = Object.freeze([0, 1, 2, 4, 6, 10]);
const DAY_MS = 86_400_000;

export function parseDay(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error("Expected a calendar date in YYYY-MM-DD format.");
  }
  const [year, month, day] = key.split("-").map(Number);
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  if (dayKey(result) !== key) throw new Error("Invalid calendar date.");
  return result;
}

export function dayKey(day) {
  return `${String(day.getUTCFullYear()).padStart(4, "0")}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
}

export function todayKey(now = new Date()) {
  // Read the viewer's local calendar once; all calendar arithmetic then uses UTC.
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addDays(day, amount) {
  return new Date(day.getTime() + amount * DAY_MS);
}

export function mondayRow(day) {
  return (day.getUTCDay() + 6) % 7;
}

export function levelFor(count) {
  let level = 0;
  LEVEL_THRESHOLDS.forEach((threshold, index) => {
    if (count >= threshold) level = index;
  });
  return level;
}

export function levelLabel(index) {
  const minimum = LEVEL_THRESHOLDS[index];
  const next = LEVEL_THRESHOLDS[index + 1];
  if (next === undefined) return `${minimum}+ cases`;
  if (next === minimum + 1) return `${minimum} ${minimum === 1 ? "case" : "cases"}`;
  return `${minimum}–${next - 1} cases`;
}

export function countLabel(count) {
  return `${count} ${count === 1 ? "case" : "cases"} completed`;
}

export function formatDay(key, options = { month: "long", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(parseDay(key));
}

export function validateActivity(payload) {
  if (!payload || typeof payload.activity !== "object" || payload.activity === null
      || Array.isArray(payload.activity)) throw new Error("Invalid activity data.");
  for (const [key, count] of Object.entries(payload.activity)) {
    parseDay(key);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid case count.");
  }
  return payload.activity;
}

export function buildCalendar(activity, today = todayKey()) {
  const end = parseDay(today);
  const anniversary = new Date(end);
  // Clamp February 29 to February 28 before stepping past last year's anniversary.
  anniversary.setUTCDate(1);
  anniversary.setUTCFullYear(end.getUTCFullYear() - 1);
  const monthEnd = new Date(anniversary);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  anniversary.setUTCDate(Math.min(end.getUTCDate(), monthEnd.getUTCDate()));
  const start = addDays(anniversary, 1);
  const gridStart = addDays(start, -mondayRow(start));
  const gridEnd = addDays(end, 6 - mondayRow(end));
  const cells = [];
  const months = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    const key = dayKey(cursor);
    const inRange = cursor >= start && cursor <= end;
    const index = cells.length;
    const column = Math.floor(index / 7);
    const count = inRange ? (activity[key] ?? 0) : 0;
    cells.push({ key, count, level: levelFor(count), row: mondayRow(cursor), column, inRange });
    if (inRange && (key === dayKey(start) || cursor.getUTCDate() === 1)) {
      // Avoid overlapping the first label when the range starts near a month end.
      if (months.length && column - months.at(-1).column < 3) months.pop();
      months.push({ key, column, label: formatDay(key, { month: "short" }) });
    }
  }
  return { cells, months, start: dayKey(start), end: today, weeks: cells.length / 7 };
}

export function navigationIndex(index, key, dates, control = false) {
  const day = parseDay(dates[index]);
  const moves = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
  if (key in moves) return Math.max(0, Math.min(dates.length - 1, index + moves[key]));
  if (key === "Home") return control ? 0 : Math.max(0, index - mondayRow(day));
  if (key === "End") return control ? dates.length - 1 : Math.min(dates.length - 1, index + 6 - mondayRow(day));
  return null;
}
