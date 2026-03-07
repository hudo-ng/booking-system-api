import { PrismaClient } from "@prisma/client";
import { sendPushAsync } from "../services/push";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
const ZONE = "America/Chicago";

export async function runPendingAppointmentReminder() {
  const now = dayjs().tz(ZONE);

  const hour = now.hour();
  if (hour < 9 || hour > 22) {
    return { skipped: "outside working hours" };
  }

  const TWO_HOURS_AGO = now.subtract(2, "hours").toDate();

  const appts = await prisma.appointment.findMany({
    where: {
      status: "pending",
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
      OR: [
        { lastReminderSentAt: null },
        { lastReminderSentAt: { lt: TWO_HOURS_AGO } },
      ],
    },
    select: {
      id: true,
      employeeId: true,
    },
  });

  const grouped = new Map<string, string[]>();

  for (const a of appts) {
    const list = grouped.get(a.employeeId) ?? [];
    list.push(a.id);
    grouped.set(a.employeeId, list);
  }

  const report = [];

  for (const [employeeId, ids] of grouped) {
    const user = await prisma.user.findUnique({
      where: { id: employeeId },
      select: { isOwner: true },
    });

    if (!user || user.isOwner) continue;

    const tokens = (
      await prisma.deviceToken.findMany({
        where: {
          userId: employeeId,
          enabled: true,
        },
        select: { token: true },
      })
    ).map((t) => t.token);

    const count = ids.length;

    if (tokens.length) {
      await sendPushAsync(tokens, {
        title: "Pending booking requests",
        body:
          count === 1
            ? "You have 1 booking waiting for approval."
            : `You have ${count} bookings waiting for approval.`,
        data: {
          type: "PENDING_APPOINTMENTS",
        },
      });

      await prisma.appointment.updateMany({
        where: {
          id: { in: ids },
        },
        data: {
          lastReminderSentAt: new Date(),
        },
      });
    }

    report.push({
      employeeId,
      reminders: count,
      tokens: tokens.length,
    });
  }

  return {
    employeesNotified: report.length,
    totalAppointments: appts.length,
    detail: report,
  };
}
