import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { sendPushAsync } from "../services/push";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { SquareClient, SquareEnvironment } from "square";
import crypto from "crypto";

dayjs.extend(utc);
dayjs.extend(timezone);

const ZONE = "America/Chicago";

const prisma = new PrismaClient();

const squareClient = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Sandbox,
});

function removeBigInts(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

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
    deposit_amount,
    quote_amount,
    extra_deposite_category,
    deposit_category,
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
    deposit_amount: number;
    quote_amount: number;
    extra_deposite_category: string;
    deposit_category: string;
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
          deposit_category: deposit_category ?? "",
          extra_deposit_category: extra_deposite_category ?? "",
          deposit_amount: deposit_amount,
          quote_amount: quote_amount,
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
        const relevantUsers = await prisma.user.findMany({
          where: {
            OR: [{ isOwner: true }, { isAdmin: true }, { is_reception: true }],
          },
          select: { id: true },
        });

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

export const bookWithPayment = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const { amount, sourceId, method, booking } = req.body as {
    amount: number | string;
    sourceId: string;
    method: "Debit/Credit" | "Apple Pay";
    booking: {
      date: string;
      startTime: string;
      endTime: string;
      customerName: string;
      email: string;
      phone: string;
      detail?: string;
      dob?: string;
      address?: string;
      attachments?: IncomingAttachment[];
      deposit_amount: number;
      quote_amount: number;
    };
  };

  if (!["Debit/Credit", "Apple Pay"].includes(method)) {
    return res.status(400).json({ message: "Invalid payment method" });
  }

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
    attachments,
    deposit_amount,
    quote_amount,
  } = booking;

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

  if (conflict) {
    return res.status(400).json({ message: "Time slot already booked!" });
  }

  let dobDate: Date | null = null;
  if (dob) {
    const d = dayjs(dob, "YYYY-MM-DD", true);
    if (!d.isValid() || d.isAfter(dayjs())) {
      return res.status(400).json({ message: "Invalid date of birth" });
    }
    dobDate = d.toDate();
  }

  try {
    const idempotencyKey = crypto.randomUUID();
    const paymentResp = await squareClient.payments.create({
      idempotencyKey,
      amountMoney: {
        amount: BigInt(Math.round(Number(amount) * 100)),
        currency: "USD",
      },
      sourceId,
      locationId: process.env.SQUARE_LOCATION_ID!,
    });

    const safePayment = removeBigInts(paymentResp.payment);

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
          paidWith: method,
          deposit_amount,
          quote_amount,
          payment_id: safePayment.id,
          payment_status: "PAID",
          deposit_category: method,
          extra_deposit_category: `${method}:${safePayment.id}`,
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
        const relevantUsers = await prisma.user.findMany({
          where: {
            OR: [{ isOwner: true }, { isAdmin: true }, { is_reception: true }],
          },
          select: { id: true },
        });

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
            title: `New booking (${method} paid)`,
            body: `${customerName} paid and requested ${start
              .tz(ZONE)
              .format("MMM D, HH:mm")}–${end.tz(ZONE).format("HH:mm")}`,
            data: { bookingId: created.id },
          });
        }
      } catch (pushErr) {
        console.error("Push send error:", pushErr);
      }
    })();

    return res.status(201).json({
      appointment: created,
      payment: safePayment,
    });
  } catch (err: any) {
    console.error("bookWithPayment error:", err);
    return res.status(500).json({
      message: err?.message || "Failed to complete payment + booking",
    });
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
