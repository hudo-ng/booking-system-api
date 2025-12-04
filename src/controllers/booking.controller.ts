import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { sendPushAsync } from "../services/push";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const ZONE = "America/Chicago";

const prisma = new PrismaClient();

type IncomingAttachment = {
  fileId: string;
  url: string;
  filename: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
};

export const requestBooking = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const {
    date,
    startTime,
    endTime,
    customerName,
    email,
    phone,
    detail,
    dob,
    address,
    paidWith,
    attachments,
  } = req.body as {
    date: string;
    startTime: string;
    endTime: string;
    customerName: string;
    email: string;
    phone: string;
    detail: string | undefined;
    dob?: string;
    address?: string;
    paidWith?: string;
    attachments?: IncomingAttachment[];
  };

  const employee = await prisma.user.findUnique({ where: { id: employeeId } });
  if (!employee || employee.role !== "employee") {
    return res.status(404).json({ message: "Employee not found" });
  }

  const start = dayjs(startTime);
  const end = dayjs(endTime);
  if (!start.isValid() || !end.isValid()) {
    return res.status(400).json({ message: "Invalid start or end time" });
  }
  if (start.isBefore(dayjs())) {
    return res.status(400).json({ message: "Cannot book past times" });
  }
  if (!end.isAfter(start)) {
    return res
      .status(400)
      .json({ message: "End time must be after start time" });
  }
  // if (date) {
  //   const reqDay = dayjs(date).startOf("day");
  //   if (!reqDay.isValid() || !reqDay.isSame(start.startOf("day"))) {
  //     return res
  //       .status(400)
  //       .json({ message: "Date does not match selected time" });
  //   }
  // }

  const dayStartLocal = dayjs.tz(date, "YYYY-MM-DD", ZONE).startOf("day");
  const dayEndLocal = dayStartLocal.add(1, "day");
  const dayStartUTC = dayStartLocal.utc();
  const dayEndUTC = dayEndLocal.utc();

  const off = await prisma.timeOff.findFirst({
    where: {
      employeeId,
      date: {
        gte: dayStartUTC.toDate(),
        lt: dayEndUTC.toDate(),
      },
    },
  });

  if (off) {
    console.log(off);
    return res.status(400).json({ message: "Employee is off on that day" });
  }

  const conflict = await prisma.appointment.findFirst({
    where: {
      employeeId,
      status: "accepted",
      startTime: { lt: end.toDate() },
      endTime: { gt: start.toDate() },
    },
  });
  if (conflict)
    return res.status(400).json({ message: "Time slot already booked!" });

  let dobDate: Date | null = null;
  if (dob) {
    const d = dayjs(dob, "YYYY-MM-DD", true);
    if (!d.isValid() || d.isAfter(dayjs()))
      return res.status(400).json({ message: "Invalid date of birth" });
    dobDate = d.toDate();
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          employeeId,
          customerName,
          email,
          phone,
          detail: detail ?? "",
          status: "pending",
          startTime: start.toDate(),
          endTime: end.toDate(),
          dob: dobDate,
          address: address || null,
          paidWith: paidWith || null,
        },
      });

      if (attachments?.length) {
        await tx.appointmentAttachment.createMany({
          data: attachments.map((a) => ({
            appointmentId: appt.id,
            fileId: a.fileId,
            url: a.url,
            filename: a.filename,
            mime: a.mime,
            size: a.size,
            width: a.width ?? null,
            height: a.height ?? null,
          })),
        });
      }

      return appt;
    });

    (async () => {
      try {
        // 1️⃣ Get all admins and receptionists
        const relevantUsers = await prisma.user.findMany({
          where: {
            OR: [{ isOwner: true }, { isAdmin: true }, { is_reception: true }],
          },
          select: { id: true },
        });

        // 2️⃣ Combine with the selected employeeId
        const targetUserIds = Array.from(
          new Set([employeeId, ...relevantUsers.map((u) => u.id)])
        );

        const tokens = (
          await prisma.deviceToken.findMany({
            where: { userId: { in: targetUserIds }, enabled: true },
            select: { token: true },
          })
        ).map((d) => d.token);

        if (tokens.length) {
          await sendPushAsync(tokens, {
            title: "New booking request",
            body: `${customerName} requested ${start
              .tz(ZONE)
              .format("MMM D, HH:mm")}–${end.tz(ZONE).format("HH:mm")}`,
            data: { bookingId: created.id },
          });
        }
      } catch (pushErr) {
        console.error("Push send error:", pushErr);
      }
    })();

    return res.status(201).json(created);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to create booking" });
  }
};

export const listAttachments = async (req: Request, res: Response) => {
  const { id: appointmentId } = req.params;
  try {
    const items = await prisma.appointmentAttachment.findMany({
      where: { appointmentId },
      select: {
        id: true,
        url: true,
        fileId: true,
        mime: true,
        size: true,
        width: true,
        height: true,
      },
      orderBy: { createdAt: "asc" },
    });
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load attachments" });
  }
};
