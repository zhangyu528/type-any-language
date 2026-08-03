/**
 * Calendar date formatting helpers.
 *
 * All parsing is done on the ISO string itself (split on "-"), never
 * via `new Date(iso)`. The backend emits `YYYY-MM-DD` as a *calendar
 * date*, but `new Date("2026-08-04")` parses as UTC midnight and then
 * renders in local time — so anyone west of UTC would see the whole
 * grid shifted back by a day. String parsing keeps the date the
 * backend meant.
 */

export interface IsoParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** `"2026-08-04"` → `{year: 2026, month: 8, day: 4}`. Null if malformed. */
export function parseIsoDate(iso: string): IsoParts | null {
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  return { year: y, month: m, day: d };
}

/** `"2026-08-04"` → `"2026年8月4日"`. Falls back to the raw string. */
export function formatFullCn(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return `${p.year}年${p.month}月${p.day}日`;
}

/** `"2026-08-04"` → `"8月4日"`. Falls back to the raw string. */
export function formatMonthDayCn(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return `${p.month}月${p.day}日`;
}

/**
 * Render the grid's span as one line, eliding whatever the two ends
 * share:
 *   same year + month → "2026年8月4日 – 30日"
 *   same year         → "2026年7月8日 – 8月4日"
 *   different years    → "2025年12月29日 – 2026年1月25日"
 */
export function formatRangeCn(startIso: string, endIso: string): string {
  const a = parseIsoDate(startIso);
  const b = parseIsoDate(endIso);
  if (!a || !b) return `${startIso} – ${endIso}`;
  const left = `${a.year}年${a.month}月${a.day}日`;
  if (a.year !== b.year) {
    return `${left} – ${b.year}年${b.month}月${b.day}日`;
  }
  if (a.month !== b.month) {
    return `${left} – ${b.month}月${b.day}日`;
  }
  return `${left} – ${b.day}日`;
}

/** True on the 1st — the cell that gets a "8/1" month marker. */
export function isFirstOfMonth(iso: string): boolean {
  const p = parseIsoDate(iso);
  return p ? p.day === 1 : false;
}

/** `"2026-08"` → `"2026年8月"`. Falls back to the raw string. */
export function formatYearMonthCn(yearMonth: string): string {
  const parts = yearMonth.split('-');
  if (parts.length !== 2) return yearMonth;
  const [y, m] = parts.map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return `${y}年${m}月`;
}
