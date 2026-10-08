const DAY_INDEX = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const WEEKDAY_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const COMPLEX = /sunrise|sunset|dawn|dusk|week|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|easter|\bph\b|\bsh\b/i;

export function zonedNow(timeZone = "America/Sao_Paulo", date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_SHORT[parts.weekday];
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { weekday, minutes };
}

function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0) return 24 * 60;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function covers(start, end, now) {
  if (start === end) return false;
  if (end > start) return now >= start && now < end;
  return now >= start || now < end;
}

function daysInToken(token) {
  const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)$/.exec(token);
  if (range) {
    const start = DAY_INDEX[range[1]];
    const end = DAY_INDEX[range[2]];
    const days = [];
    for (let cursor = start; cursor !== end; cursor = (cursor + 1) % 7) days.push(cursor);
    days.push(end);
    return days;
  }
  if (DAY_INDEX[token] === undefined) return null;
  return [DAY_INDEX[token]];
}

export function evaluateOpeningHours(raw, now = zonedNow()) {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || COMPLEX.test(text)) return null;
  if (text === "24/7" || text === "00:00-24:00") return true;

  let parsed = false;
  for (const chunk of text.split(";")) {
    const rule = chunk.trim();
    if (!rule) continue;
    const match = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,\s*)?)+)\s+(.+)$/.exec(rule);
    if (!match) return null;
    const dayTokens = match[1].split(",").map((token) => token.trim()).filter(Boolean);
    const days = [];
    for (const token of dayTokens) {
      const expanded = daysInToken(token);
      if (!expanded) return null;
      days.push(...expanded);
    }
    parsed = true;
    if (!days.includes(now.weekday)) continue;
    for (const span of match[2].split(",")) {
      const times = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(span.trim());
      if (!times) return null;
      const start = toMinutes(times[1]);
      const end = toMinutes(times[2]);
      if (start === null || end === null) return null;
      if (covers(start, end, now.minutes)) return true;
    }
  }
  return parsed ? false : null;
}

export function openFromClockRanges(ranges, timeZone = "America/Sao_Paulo") {
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  const now = zonedNow(timeZone);
  let decided = false;
  for (const range of ranges) {
    const start = toMinutes(String(range.opens || ""));
    const end = toMinutes(String(range.closes || ""));
    if (start === null || end === null) continue;
    decided = true;
    if (covers(start, end === 0 ? 24 * 60 : end, now.minutes)) return true;
  }
  return decided ? false : null;
}
