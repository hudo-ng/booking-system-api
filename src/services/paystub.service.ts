import dayjs from "dayjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const getReceptionWeekData = async (
  userId: string,
  fromDate: string,
  toDate: string,
) => {
  const start = dayjs(fromDate).startOf("day");
  const end = dayjs(toDate).endOf("day");

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  const shifts = await prisma.workShift.findMany({
    where: {
      userId,
      clockIn: { gte: start.toDate(), lte: end.toDate() },
      clockOut: { not: null },
    },
    orderBy: { clockIn: "asc" },
  });

  let totalMilliseconds = 0;

  for (const shift of shifts) {
    if (!shift.clockOut) continue;

    const shiftStart = dayjs(shift.clockIn);
    const shiftEnd = dayjs(shift.clockOut);

    const effectiveStart = shiftStart.isBefore(start) ? start : shiftStart;
    const effectiveEnd = shiftEnd.isAfter(end) ? end : shiftEnd;

    if (effectiveEnd.isAfter(effectiveStart)) {
      totalMilliseconds += effectiveEnd.diff(effectiveStart);
    }
  }

  const totalHours = Number((totalMilliseconds / (1000 * 60 * 60)).toFixed(2));

  return {
    totalHours,
    user,
  };
};
