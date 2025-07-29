import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

const prisma = new PrismaClient();

dayjs.extend(utc);
dayjs.extend(timezone);

export async function trackAppoinmentHistory(
  appointmentId: string,
  oldData: Record<string, any>,
  newData: Record<string, any>,
  changedBy: string
) {
  const fields = ["startTime", "endTime", "status"];
  const changes = [];

  for (const field of fields) {
    const oldValue = oldData[field];
    const newValue = newData[field];

    if (!newValue || oldValue === undefined) continue;

    const oldString =
      oldValue instanceof Date
        ? dayjs.utc(oldValue).local().format("MMM D, YYYY h:mm A")
        : String(oldValue);
    const newString =
      newValue instanceof Date
        ? dayjs.utc(newValue).local().format("MMM D, YYYY h:mm A")
        : String(newValue);

    if (oldString !== newString) {
      changes.push({
        appointmentId,
        fieldChanged: field,
        oldValue: oldString,
        newValue: newString,
        changedBy,
      });
    }
  }

  if (changes.length > 0) {
    await prisma.appointmentHistory.createMany({ data: changes });
  }
}
