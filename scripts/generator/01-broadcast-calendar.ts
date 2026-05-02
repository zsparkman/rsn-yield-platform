import {
  DEMO_YEAR,
  isoDate,
  monthName,
  mondayOfWeek,
  quarterOf,
  writeJson,
} from "./_shared";
import type { BroadcastDate } from "../../src/lib/types";

export function buildBroadcastCalendar(): BroadcastDate[] {
  const rows: BroadcastDate[] = [];
  // Full demo year: Feb 1 through Oct 31.
  const start = isoDate(DEMO_YEAR, 2, 1);
  const end = isoDate(DEMO_YEAR, 10, 31);
  let cursor = start;
  while (cursor <= end) {
    rows.push({
      date: cursor,
      broadcast_month: monthName(cursor),
      broadcast_year: DEMO_YEAR,
      broadcast_qtr: quarterOf(cursor),
      week_start: mondayOfWeek(cursor),
    });
    const d = new Date(`${cursor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return rows;
}

export function run(): void {
  const rows = buildBroadcastCalendar();
  writeJson("broadcast_calendar.json", rows);
  console.log(`broadcast_calendar.json: ${rows.length} rows`);
}

if (require.main === module) run();
