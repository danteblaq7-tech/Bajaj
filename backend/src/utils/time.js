const EAT_MS = 3 * 3600 * 1000; // Africa/Nairobi is UTC+3 all year (no daylight saving)

// Monday 00:00 in Nairobi, as a Date. Weekly payouts cover everything completed before this moment.
function weekStart(now = new Date()) {
  const t = new Date(now.getTime() + EAT_MS);
  const sinceMonday = (t.getUTCDay() + 6) % 7;
  t.setUTCHours(0, 0, 0, 0);
  t.setUTCDate(t.getUTCDate() - sinceMonday);
  return new Date(t.getTime() - EAT_MS);
}
module.exports = { weekStart };
