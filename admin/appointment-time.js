const { DateTime, IANAZone } = require("luxon");

function assertTimezone(timezone) {
  return typeof timezone === "string" && IANAZone.isValidZone(timezone);
}

function storeWeekday(value) {
  return value.weekday % 7;
}

function storeDay(value, timezone) {
  return DateTime.fromISO(String(value || ""), { zone: timezone }).startOf("day");
}

function utcInstant(value) {
  return DateTime.fromISO(String(value || ""), { setZone: true }).toUTC();
}

function businessWindow(date, startTime, endTime, timezone) {
  return {
    start: DateTime.fromISO(`${date}T${String(startTime).slice(0, 5)}`, { zone: timezone }),
    end: DateTime.fromISO(`${date}T${String(endTime).slice(0, 5)}`, { zone: timezone })
  };
}

function isSlotAligned(candidate, windowStart, intervalMinutes) {
  const delta = candidate.diff(windowStart, "milliseconds").milliseconds;
  return delta >= 0 && delta % (Number(intervalMinutes) * 60_000) === 0;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

module.exports = { DateTime, assertTimezone, businessWindow, isSlotAligned, overlaps, storeDay, storeWeekday, utcInstant };
