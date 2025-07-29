import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

const prisma = new PrismaClient();

dayjs.extend(utc);
dayjs.extend(timezone);

export async function trackAppointmentHistory(
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

    if (newValue === undefined) continue;
    let oldString = "";
    let newString = "";

    if (field === "startTime" || field === "endTime") {
      const oldDate = dayjs(oldValue);
      const newDate = dayjs(newValue);

      if (!oldDate.isValid() || !newDate.isValid()) continue;

      if (oldDate.valueOf() === newDate.valueOf()) continue;

      oldString = oldDate.local().format("MMM D, YYYY h:mm A");
      newString = newDate.local().format("MMM D, YYYY h:mm A");
    } else {
      if (oldValue === newValue) continue;
      oldString = String(oldValue);
      newString = String(newValue);
    }

    changes.push({
      appointmentId,
      fieldChanged: field,
      oldValue: oldString,
      newValue: newString,
      changedBy,
    });
  }

  if (changes.length > 0) {
    await prisma.appointmentHistory.createMany({ data: changes });
  }
}
