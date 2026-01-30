import dayjs, { Dayjs } from "dayjs";

export const normalizeSignedDate = (raw: any): Dayjs | null => {
  if (!raw || typeof raw !== "string") return null;

  const value = raw.trim();

  // 1️⃣ ISO string with T (with or without timezone)
  if (value.includes("T")) {
    const d = dayjs(value);
    if (d.isValid()) return d;
  }

  // 2️⃣ Clean messy 12-hour / 24-hour inputs
  let cleaned = value.toLowerCase().replace(/\s+(am|pm)/, "$1");

  // If someone wrote 13:27 pm → drop am/pm
  cleaned = cleaned.replace(/(\d{1,2}):(\d{2})(am|pm)/, (_, h, m, meridian) => {
    const hour = parseInt(h, 10);
    return hour > 12 ? `${h}:${m}` : `${h}:${m}${meridian}`;
  });

  // 3️⃣ Try multiple common formats
  const formats = [
    "MM-DD-YYYY hh:mm a",
    "MM-DD-YYYY HH:mm",
    "MM-DD-YYYY h:mm a",
    "MM/DD/YYYY hh:mm a",
    "MM/DD/YYYY HH:mm",
  ];

  for (const fmt of formats) {
    const d = dayjs(cleaned, fmt, true);
    if (d.isValid()) return d;
  }

  // 4️⃣ Last resort
  const loose = dayjs(cleaned);
  return loose.isValid() ? loose : null;
};
