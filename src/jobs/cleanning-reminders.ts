import { PrismaClient } from "@prisma/client";
import { sendPushAsync } from "../services/push";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
const ZONE = "America/Chicago";

export async function runCleaningReminder() {
  const tomorrow = dayjs().tz(ZONE).add(1, "day").startOf("day");
  const weekday = tomorrow.day();

  const schedules = await prisma.cleanSchedule.findMany({
    where: { weekday },
    include: { user: { select: { id: true, name: true } } },
  });

  if (!schedules.length) {
    console.log("No cleaning schedules found for", tomorrow.format("dddd"));
    return { count: 0, date: tomorrow.format("YYYY-MM-DD") };
  }

  let notified = 0;

  for (const s of schedules) {
    const tokens = await prisma.deviceToken.findMany({
      where: { userId: s.userId, enabled: true },
      select: { token: true },
    });

    if (!tokens.length) continue;

    try {
      await sendPushAsync(tokens.map((t) => t.token), {
        title: "🧹 Cleaning Reminder",
        body: `Hi ${s.user.name}, you’re scheduled for cleaning tomorrow (${tomorrow.format("dddd")}).`,
        data: {
          type: "cleaningReminder",
          date: tomorrow.format("YYYY-MM-DD"),
        },
      });
      notified++;
    } catch (err) {
      console.error(`Push send error for user ${s.user.name}:`, err);
    }
  }

  console.log(`✅ Cleaning reminders sent to ${notified} users.`);
  return { count: notified, date: tomorrow.format("YYYY-MM-DD") };
}
