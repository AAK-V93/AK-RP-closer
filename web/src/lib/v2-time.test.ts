import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bogotaDay,
  bogotaMonth,
  bogotaWeekStart,
  dateOnlyKey,
  dayRange,
  daysBetween,
  daysLeftInMonth,
  monthRange,
  startOfDayInstant,
} from "@/lib/time/bogota";

// Bogotá is UTC-5 all year: local 23:59 on Oct 31 = 04:59Z on Nov 1.
test("day cut: 23:59 and 00:01 around the first of the month", () => {
  assert.equal(bogotaDay(new Date("2026-11-01T04:59:00Z")), "2026-10-31");
  assert.equal(bogotaDay(new Date("2026-11-01T05:01:00Z")), "2026-11-01");
  assert.equal(bogotaMonth(new Date("2026-11-01T04:59:00Z")), "2026-10-01");
  assert.equal(bogotaMonth(new Date("2026-11-01T05:01:00Z")), "2026-11-01");
});

test("year cut: Dec 31 23:59 and Jan 1 00:01", () => {
  assert.equal(bogotaMonth(new Date("2027-01-01T04:59:59Z")), "2026-12-01");
  assert.equal(bogotaMonth(new Date("2027-01-01T05:00:00Z")), "2027-01-01");
});

test("ranges are half-open instants at local midnight", () => {
  const r = monthRange("2026-10-01");
  assert.equal(r.start.toISOString(), "2026-10-01T05:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-11-01T05:00:00.000Z");
  const feb = monthRange("2027-02-15"); // any day of the month works
  assert.equal(feb.month, "2027-02-01");
  assert.equal(feb.end.toISOString(), "2027-03-01T05:00:00.000Z");
  assert.equal(dayRange("2026-10-11").end.toISOString(), "2026-10-12T05:00:00.000Z");
  assert.equal(startOfDayInstant("2026-10-11", "UTC").toISOString(), "2026-10-11T00:00:00.000Z");
});

test("week runs Monday to Sunday in local time", () => {
  // Sun Oct 11 2026, 23:30 local = Mon 04:30Z: still Sunday → week of Mon Oct 5
  assert.equal(bogotaWeekStart(new Date("2026-10-12T04:30:00Z")), "2026-10-05");
  assert.equal(bogotaWeekStart(new Date("2026-10-12T05:00:00Z")), "2026-10-12");
});

test("days left and days between use local days", () => {
  assert.equal(daysLeftInMonth(new Date("2026-10-11T17:00:00Z")), 21); // Oct 11..31
  assert.equal(daysLeftInMonth(new Date("2026-11-01T04:59:00Z")), 1); // still Oct 31
  assert.equal(daysBetween(new Date("2026-10-10T04:59:00Z"), new Date("2026-10-10T05:01:00Z")), 1);
  assert.equal(dateOnlyKey(new Date("2026-10-12T00:00:00Z")), "2026-10-12");
});
