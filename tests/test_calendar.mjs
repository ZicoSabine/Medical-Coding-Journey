import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendar, countLabel, dayKey, formatDay, levelFor, levelLabel,
  navigationIndex, parseDay, todayKey, validateActivity,
  caseUrl, caseTitle, validateCaseIndex, dateFromHash,
} from "../site/calendar.js";

test("rolling year is aligned Monday–Sunday, includes today, and uses real dates", () => {
  const calendar = buildCalendar({}, "2026-09-03");
  const days = calendar.cells.filter((cell) => cell.inRange);
  assert.equal(calendar.start, "2025-09-04");
  assert.equal(days.length, 365);
  assert.equal(calendar.weeks, 53);
  assert.equal(days.at(-1).key, "2026-09-03");
  assert.equal(days.at(-1).row, 3);
  assert.equal(calendar.cells[0].key, "2025-09-01");
  assert.equal(new Set(days.map((cell) => cell.key)).size, days.length);
  for (const cell of calendar.cells) assert.equal(cell.row, calendar.cells.indexOf(cell) % 7);
});

test("leap years and year boundaries remain continuous", () => {
  const leap = buildCalendar({}, "2024-03-01").cells.filter((cell) => cell.inRange);
  assert.equal(leap.length, 366);
  assert.ok(leap.some((cell) => cell.key === "2024-02-29"));
  assert.equal(buildCalendar({}, "2024-02-29").start, "2023-03-01");
  assert.equal(buildCalendar({}, "2025-02-28").start, "2024-02-29");
  const newYear = buildCalendar({}, "2026-01-01");
  assert.equal(newYear.start, "2025-01-02");
  assert.equal(newYear.cells.filter((cell) => cell.inRange).at(-2).key, "2025-12-31");
});

test("exact counts, fixed thresholds, and future padding", () => {
  const calendar = buildCalendar({ "2026-09-03": 7, "2026-09-04": 100 }, "2026-09-03");
  const today = calendar.cells.find((cell) => cell.key === "2026-09-03");
  assert.equal(today.count, 7);
  assert.equal(today.level, 4);
  const future = calendar.cells.find((cell) => cell.key === "2026-09-04");
  assert.equal(future.inRange, false);
  assert.equal(future.count, 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9, 10, 100].map(levelFor), [0, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(levelLabel(2), "2–3 cases");
  assert.equal(levelLabel(5), "10+ cases");
});

test("date-only handling is independent of the host timezone", () => {
  assert.equal(dayKey(parseDay("2026-09-03")), "2026-09-03");
  assert.equal(formatDay("2026-09-03"), "September 3, 2026");
  assert.equal(todayKey(new Date(2026, 8, 3, 0, 1)), "2026-09-03");
  for (const value of ["2026-02-29", "2026-09-03T00:00:00Z", "2026-9-3"]) {
    assert.throws(() => parseDay(value));
  }
});

test("month labels map to their columns and do not overlap", () => {
  for (const today of ["2026-01-30", "2026-09-03", "2024-02-29"]) {
    const calendar = buildCalendar({}, today);
    for (const [index, month] of calendar.months.entries()) {
      const day = calendar.cells.find((cell) => cell.key === month.key);
      assert.equal(month.column, day.column);
      if (index) assert.ok(month.column - calendar.months[index - 1].column >= 3);
    }
  }
});

test("empty data stays empty and malformed payloads fail instead of looking like zero", () => {
  assert.deepEqual(validateActivity({ activity: {} }), {});
  assert.ok(buildCalendar({}, "2026-09-03").cells.every((cell) => cell.count === 0));
  for (const payload of [{}, { activity: [] }, { activity: { "2026-09-03": -1 } },
                         { activity: { "2026-09-03": "7" } }, { activity: { invalid: 1 } }]) {
    assert.throws(() => validateActivity(payload));
  }
});

test("keyboard moves by day/week and stays within bounds", () => {
  const dates = buildCalendar({}, "2026-09-03").cells.filter((cell) => cell.inRange).map((cell) => cell.key);
  assert.equal(navigationIndex(14, "ArrowLeft", dates), 7);
  assert.equal(navigationIndex(14, "ArrowRight", dates), 21);
  assert.equal(navigationIndex(14, "ArrowUp", dates), 13);
  assert.equal(navigationIndex(14, "ArrowDown", dates), 15);
  assert.equal(navigationIndex(0, "ArrowLeft", dates), 0);
  assert.equal(navigationIndex(364, "ArrowDown", dates), 364);
  assert.equal(navigationIndex(14, "Home", dates, true), 0);
  assert.equal(navigationIndex(14, "End", dates, true), 364);
  assert.equal(navigationIndex(14, "Tab", dates), null);
});

test("case descriptions use singular and plural", () => {
  assert.equal(countLabel(0), "0 cases completed");
  assert.equal(countLabel(1), "1 case completed");
  assert.equal(countLabel(7), "7 cases completed");
});

test("case file links preserve spaces, Unicode, hash signs and ampersands", () => {
  const path = "Case Study/Simple/Case résumé #1 & review.md";
  assert.equal(caseUrl(path), "https://github.com/ZicoSabine/Medical-Coding-Journey/blob/main/Case%20Study/Simple/Case%20r%C3%A9sum%C3%A9%20%231%20%26%20review.md");
  assert.equal(caseTitle(path), "Case résumé #1 & review");
  for (const invalid of ["../private.md", "Case Study/../private.md", "Case Study\\case.md", "https://example.com/case.md", "Case Study//case.md"]) {
    assert.throws(() => caseUrl(invalid));
  }
});

test("case index matches counts and rejects missing or duplicate references", () => {
  const entry = { path: "Case Study/Simple/Case 001.md", difficulty: "simple" };
  const payload = { activity: { "2026-09-03": 1 }, cases: { "2026-09-03": [entry] } };
  assert.deepEqual(validateCaseIndex(payload), payload.cases);
  assert.deepEqual(validateCaseIndex({ activity: {}, cases: {} }), {});
  for (const invalid of [
    { activity: payload.activity, cases: {} },
    { activity: {}, cases: payload.cases },
    { activity: { "2026-09-03": 2 }, cases: { "2026-09-03": [entry, entry] } },
    { activity: payload.activity, cases: { "2026-09-03": [{ ...entry, difficulty: "easy" }] } },
  ]) assert.throws(() => validateCaseIndex(invalid));
});

test("shareable day links accept valid dates and ignore malformed fragments", () => {
  assert.equal(dateFromHash("#day=2026-09-03"), "2026-09-03");
  assert.equal(dateFromHash("#day=2024-02-29"), "2024-02-29");
  for (const hash of ["", "#day=2026-02-29", "#day=2026-9-3", "#day=<script>", "#other=2026-09-03"]) {
    assert.equal(dateFromHash(hash), null);
  }
});
