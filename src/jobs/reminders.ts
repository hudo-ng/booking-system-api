import { PrismaClient } from "@prisma/client";
import { sendPushAsync } from "../services/push";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const ZONE = "America/Edmonton";
const prisma = new PrismaClient();

export async function runDailyReminder(opts?: {
  zone?: string;
  includeStatuses?: "accepted"[];
  dryRun?: boolean;
}) {
  const zone = opts?.zone ?? ZONE;
  const startLocal = dayjs().tz(zone).add(1, "day").startOf("day");
  const endLocal = startLocal.add(1, "day");
  const startUTC = startLocal.utc().toDate();
  const endUTC = endLocal.utc().toDate();

  const statuses = opts?.includeStatuses ?? ["accepted"];

  const appts = await prisma.appointment.findMany({
    where: {
      startTime: { gte: startUTC, lt: endUTC, not: null },
      status: { in: statuses as any },
    },
    select: { id: true, employeeId: true, startTime: true },
    orderBy: { startTime: "asc" },
  });

  const byEmployee = new Map<string, { ids: string[]; startTimes: Date[] }>();
  for (const a of appts) {
    const g = byEmployee.get(a.employeeId) ?? { ids: [], startTimes: [] };
    g.ids.push(a.id);
    if (a.startTime) g.startTimes.push(a.startTime);
    byEmployee.set(a.employeeId, g);
  }

  const report: Array<{ employeeId: string; count: number; tokens: number }> =
    [];

  for (const [employeeId, group] of byEmployee) {
    const count = group.ids.length;
    const first = group.startTimes[0];
    const firstStr = dayjs(first).tz(zone).format("h:mm A");

    const tokens = (
      await prisma.deviceToken.findMany({
        where: { userId: employeeId, enabled: true },
        select: { token: true },
      })
    ).map((t) => t.token);

    const title = "Tomorrow’s schedule";
    const body =
      count === 1
        ? `You have 1 appointment tomorrow at ${firstStr}.`
        : `You have ${count} appointments tomorrow. First at ${firstStr}.`;

    if (!opts?.dryRun && tokens.length) {
      try {
        await sendPushAsync(tokens, {
          title,
          body,
          data: {
            type: "tomorrowDigest",
            date: startLocal.format("YYYY-MM-DD"),
          },
        });
      } catch (e) {
        console.error("Reminder push error (employee:", employeeId, "):", e);
      }
    }

    report.push({ employeeId, count, tokens: tokens.length });
  }

  return {
    windowLocal: `${startLocal.format()} to ${endLocal.format()}`,
    totalAppointments: appts.length,
    employeesNotified: report.length,
    detail: report,
  };
}
