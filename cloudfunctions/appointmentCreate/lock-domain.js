const crypto = require("crypto");

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function releasedBooked(value) {
  return Math.max(0, Number(value || 0) - 1);
}

function intervalBucketIds(storeId, advisorId, startAt, endAt) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("INVALID_INTERVAL");
  const ids = [];
  for (let cursor = Math.floor(start / 900000) * 900000; cursor < end; cursor += 900000) {
    ids.push(hash(`interval|${storeId}|${advisorId}|${cursor}`).slice(0, 32));
  }
  return ids;
}

function ownsLock(lock, appointmentNumber) {
  return Boolean(lock && appointmentNumber && lock.appointmentNumber === appointmentNumber);
}

module.exports = { releasedBooked, intervalBucketIds, ownsLock };
