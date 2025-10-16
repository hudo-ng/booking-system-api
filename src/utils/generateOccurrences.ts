import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

interface Occurrence {
  start: Date;
  end: Date;
}

export function generateOccurrences(
  series: {
    startDate: Date;
    endDate?: Date | null;
    frequency: "daily" | "weekly" | "monthly";
    interval?: number;
    count?: number | null;
    byWeekday?: number[] | null;
  },
  startTimeISO: string,
  endTimeISO: string,
  tz: string
): Occurrence[] {
  const {
    startDate,
    endDate,
    frequency,
    interval = 1,
    count,
    byWeekday,
  } = series;

  const baseStart = dayjs(startTimeISO).tz(tz, true);
  const baseEnd = dayjs(endTimeISO).tz(tz, true);

  const seriesStartDay = dayjs.tz(startDate, tz).startOf("day");
  const seriesEndDay = endDate ? dayjs.tz(endDate, tz).endOf("day") : null;
  const now = dayjs().tz(tz);

  const out: Occurrence[] = [];
  let current = seriesStartDay.clone();
  let created = 0;

  while (true) {
    if (count && created >= count) break;
    if (seriesEndDay && current.isAfter(seriesEndDay)) break;

    if (
      frequency === "weekly" &&
      Array.isArray(byWeekday) &&
      byWeekday.length
    ) {
      for (const wd of byWeekday) {
        const next = current.startOf("week").add(wd, "day");
        const startDT = next
          .hour(baseStart.hour())
          .minute(baseStart.minute())
          .second(0);
        const endDT = next
          .hour(baseEnd.hour())
          .minute(baseEnd.minute())
          .second(0);

        if (startDT.isBefore(seriesStartDay)) continue;
        if (seriesEndDay && startDT.isAfter(seriesEndDay)) continue;

        if (endDT.isBefore(now)) continue;

        out.push({ start: startDT.toDate(), end: endDT.toDate() });
        created++;
        if (count && created >= count) break;
      }
      current = current.add(interval, "week");
      continue;
    }

    if (frequency === "daily") {
      const startDT = current
        .hour(baseStart.hour())
        .minute(baseStart.minute())
        .second(0);
      const endDT = current
        .hour(baseEnd.hour())
        .minute(baseEnd.minute())
        .second(0);

      if (
        !(seriesEndDay && startDT.isAfter(seriesEndDay)) &&
        !endDT.isBefore(now)
      ) {
        out.push({ start: startDT.toDate(), end: endDT.toDate() });
        created++;
      }
      current = current.add(interval, "day");
      continue;
    }

    if (frequency === "monthly") {
      const startDT = current
        .hour(baseStart.hour())
        .minute(baseStart.minute())
        .second(0);
      const endDT = current
        .hour(baseEnd.hour())
        .minute(baseEnd.minute())
        .second(0);

      if (
        !(seriesEndDay && startDT.isAfter(seriesEndDay)) &&
        !endDT.isBefore(now)
      ) {
        out.push({ start: startDT.toDate(), end: endDT.toDate() });
        created++;
      }
      current = current.add(interval, "month");
      continue;
    }
    break;
  }

  console.log("✅ generateOccurrences created", out.length, "items");
  return out;
}
