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
  startTime: string,
  endTime: string,
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

  const startOfSeries = dayjs.tz(startDate, tz).startOf("day");
  const endBoundary = endDate ? dayjs.tz(endDate, tz).endOf("day") : null;

  const occurrences: Occurrence[] = [];
  let current = startOfSeries.clone();
  let created = 0;

  while (true) {
    if (count && created >= count) break;
    if (endBoundary && current.isAfter(endBoundary)) break;

    if (
      frequency === "weekly" &&
      Array.isArray(byWeekday) &&
      byWeekday.length
    ) {
      for (const weekday of byWeekday) {
        const next = current.startOf("week").add(weekday, "day");
        const startDT = next
          .hour(Number(startTime.split(":")[0]))
          .minute(Number(startTime.split(":")[1]))
          .second(0);
        const endDT = next
          .hour(Number(endTime.split(":")[0]))
          .minute(Number(endTime.split(":")[1]))
          .second(0);

        if (startDT.isSameOrAfter(startOfSeries)) {
          occurrences.push({ start: startDT.toDate(), end: endDT.toDate() });
          created++;
          if (count && created >= count) break;
        }
      }
      current = current.add(interval, "week");
    } else if (frequency === "daily") {
      const startDT = current
        .hour(Number(startTime.split(":")[0]))
        .minute(Number(startTime.split(":")[1]))
        .second(0);
      const endDT = current
        .hour(Number(endTime.split(":")[0]))
        .minute(Number(endTime.split(":")[1]))
        .second(0);

      occurrences.push({ start: startDT.toDate(), end: endDT.toDate() });
      created++;
      current = current.add(interval, "day");
    } else if (frequency === "monthly") {
      const startDT = current
        .hour(Number(startTime.split(":")[0]))
        .minute(Number(startTime.split(":")[1]))
        .second(0);
      const endDT = current
        .hour(Number(endTime.split(":")[0]))
        .minute(Number(endTime.split(":")[1]))
        .second(0);

      occurrences.push({ start: startDT.toDate(), end: endDT.toDate() });
      created++;
      current = current.add(interval, "month");
    } else {
      break;
    }
  }

  return occurrences;
}
