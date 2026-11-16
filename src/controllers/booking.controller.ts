import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { sendPushAsync } from "../services/push";
import axios from "axios";
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
  environment: SquareEnvironment.Production,
});

function removeBigInts(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
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
    slug,
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
    slug?: string;
  };

  const employee = await prisma.user.findUnique({ where: { id: employeeId } });
  if (!employee || employee.role !== "employee") {
    return res.status(404).json({ message: "Employee not found" });
  }
  const asigneePerson = await prisma.user.findFirst({ where: { slug: slug } });
  let assigneeId = asigneePerson ? asigneePerson.id : undefined;
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
  // const dayStartUTC = dayStartLocal.utc();
  // const dayEndUTC = dayEndLocal.utc();

  // const off = await prisma.timeOff.findFirst({
  //   where: {
  //     employeeId,
  //     date: {
  //       gte: dayStartUTC.toDate(),
  //       lt: dayEndUTC.toDate(),
  //     },
  //   },
  // });

  // if (off) {
  //   console.log(off);
  //   return res.status(400).json({ message: "Employee is off on that day" });
  // }

  // const conflict = await prisma.appointment.findFirst({
  //   where: {
  //     employeeId,
  //     status: "accepted",
  //     startTime: { lt: end.toDate() },
  //     endTime: { gt: start.toDate() },
  //   },
  // });
  // const conflict = await prisma.appointment.findFirst({
  //   where: {
  //     employeeId,
  //     status: "accepted",
  //     startTime: { lte: start.toDate() },
  //     endTime: { gt: start.toDate() },
  //   },
  // });
  // if (conflict)
  //   return res.status(400).json({ message: "Time slot already booked!" });

  // const MAX_DURATION_MINUTES = 8 * 60;

  // if (end.diff(start, "minute") > MAX_DURATION_MINUTES) {
  //   return res.status(400).json({
  //     message: "Booking duration exceeds maximum allowed time.",
  //   });
  // }

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
          source_booking: "web",
          deposit_category: deposit_category ?? "",
          extra_deposit_category: extra_deposite_category ?? "",
          deposit_amount: deposit_amount,
          quote_amount: quote_amount,
          deposit_status: deposit_amount > 0 ? "pending" : "ignored",
          ...(assigneeId ? { assignedById: assigneeId } : {}),
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
      if (deposit_amount > 0) {
        await tx.depositAppointment.create({
          data: {
            appointment_id: appt.id,
            status: "pending",
            deposit_amount,
            deposit_category: appt.deposit_category,
            extra_deposit_category: appt.extra_deposit_category,
            updatedAt: new Date(),
            createdAt: new Date(),
          },
        });
      }

      await tx.notification.create({
        data: {
          created_by: employee.id,
          title: "has new booking",
          description: detail ?? "No description provided",
          customer_name: customerName ?? "No name provided",
          quote_amount,
          deposit_amount,
          deposit_category,
          extra_deposit_category: extra_deposite_category,
          appointment_start_time: startTime ? new Date(startTime) : new Date(),
          appointment_end_time: endTime ? new Date(endTime) : new Date(),
          appointment_id: appt.id,
        },
      });
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
          new Set([employeeId, ...relevantUsers.map((u) => u.id)]),
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
            data: { bookingId: created.id, type: "BOOKING" },
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
    method: "Debit/Credit" | "Apple Pay" | "Cash App Pay";
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
      slug?: string;
    };
  };
  const asigneePerson = await prisma.user.findFirst({
    where: { slug: booking.slug },
  });
  let assigneeId = asigneePerson ? asigneePerson.id : undefined;
  if (!["Debit/Credit", "Apple Pay", "Cash App Pay"].includes(method)) {
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
  // const dayStartUTC = dayStartLocal.utc();
  // const dayEndUTC = dayEndLocal.utc();

  // const off = await prisma.timeOff.findFirst({
  //   where: {
  //     employeeId,
  //     date: {
  //       gte: dayStartUTC.toDate(),
  //       lt: dayEndUTC.toDate(),
  //     },
  //   },
  // });

  // if (off) {
  //   return res.status(400).json({ message: "Employee is off on that day" });
  // }

  // const conflict = await prisma.appointment.findFirst({
  //   where: {
  //     employeeId,
  //     status: "accepted",
  //     startTime: { lt: end.toDate() },
  //     endTime: { gt: start.toDate() },
  //   },
  // });
  // const conflict = await prisma.appointment.findFirst({
  //   where: {
  //     employeeId,
  //     status: "accepted",
  //     startTime: { lte: start.toDate() },
  //     endTime: { gt: start.toDate() },
  //   },
  // });

  // if (conflict) {
  //   return res.status(400).json({ message: "Time slot already booked!" });
  // }

  // const MAX_DURATION_MINUTES = 8 * 60;

  // if (end.diff(start, "minute") > MAX_DURATION_MINUTES) {
  //   return res.status(400).json({
  //     message: "Booking duration exceeds maximum allowed time.",
  //   });
  // }

  let dobDate: Date | null = null;
  if (dob) {
    const d = dayjs(dob, "YYYY-MM-DD", true);
    if (!d.isValid() || d.isAfter(dayjs())) {
      return res.status(400).json({ message: "Invalid date of birth" });
    }
    dobDate = d.toDate();
  }

  try {
    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`${sourceId}:${employeeId}`)
      .digest("hex")
      .slice(0, 45);

    const paymentResp = await squareClient.payments.create({
      idempotencyKey,
      amountMoney: {
        amount: BigInt(Math.round(Number(amount) * 100)),
        currency: "USD",
      },
      sourceId,
      locationId: process.env.SQUARE_LOCATION_ID!,
    });

    const payment = paymentResp.payment;

    if (!payment || payment.status !== "COMPLETED") {
      return res
        .status(402)
        .json({ message: "Payment not completed", payment });
    }

    const avs = payment.cardDetails?.avsStatus;

    if (avs && !["AVS_ACCEPTED", "AVS_NOT_CHECKED"].includes(avs)) {
      console.warn("AVS failed:", avs);
    }

    const safePayment = removeBigInts(payment);

    const created = await prisma.$transaction(async (tx) => {
      const amountWithoutFees = Number(amount) / (1 + 0.035);
      const dbPayment = await tx.webPaymentTracking.create({
        data: {
          provider: "SQUARE",
          providerPaymentId: payment.id!,
          method,
          amount: Number(amount),
          currency: "USD",
          status: payment.status!,
          avsStatus: payment.cardDetails?.avsStatus ?? null,
          cvvStatus: payment.cardDetails?.cvvStatus ?? null,
          rawResponse: safePayment,
        },
      });

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
          deposit_amount: amountWithoutFees,
          quote_amount,
          deposit_category: method,
          extra_deposit_category: `${method}:${safePayment.id}`,
          deposit_status: "accepted",
          source_booking: "web",
          ...(assigneeId ? { assignedById: assigneeId } : {}),
        },
      });
      await tx.notification.create({
        data: {
          created_by: employee.id,
          title: "has new booking",
          description: detail ?? "No description provided",
          customer_name: customerName ?? "No name provided",
          quote_amount,
          deposit_amount,
          deposit_category: method,
          extra_deposit_category: `${method}:${safePayment.id}`,
          appointment_start_time: startTime ? new Date(startTime) : new Date(),
          appointment_end_time: endTime ? new Date(endTime) : new Date(),
          appointment_id: appt.id,
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

      await tx.webPaymentTracking.update({
        where: { id: dbPayment.id },
        data: { bookingId: appt.id },
      });

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
          new Set([employeeId, ...relevantUsers.map((u) => u.id)]),
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
            data: { bookingId: created.id, type: "BOOKING" },
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

export const bookWithStorePayment = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const { booking } = req.body as {
    booking?: {
      date: string;
      startTime: string;
      endTime: string;
      customerName: string;
      email?: string;
      phone: string;
      detail?: string;
      dob?: string;
      address?: string;
      attachments?: IncomingAttachment[];
      deposit_amount: number;
      quote_amount: number;
    };
  };

  if (
    !booking ||
    !booking.customerName?.trim() ||
    !booking.phone?.trim() ||
    !booking.startTime ||
    !booking.endTime
  ) {
    return res.status(400).json({ message: "Invalid booking details" });
  }

  const depositAmount = Number(booking.deposit_amount);
  const quoteAmount = Number(booking.quote_amount);
  if (
    !Number.isFinite(depositAmount) ||
    depositAmount <= 0 ||
    !Number.isFinite(quoteAmount) ||
    quoteAmount <= 0
  ) {
    return res.status(400).json({
      message: "Deposit and quote amounts must be greater than zero",
    });
  }

  const employee = await prisma.user.findUnique({ where: { id: employeeId } });
  if (!employee || employee.role !== "employee") {
    return res.status(404).json({ message: "Employee not found" });
  }
  const authenticatedUserId = (req as any).user?.userId as string | undefined;
  if (!authenticatedUserId) {
    return res.status(401).json({ message: "Authenticated user not found" });
  }
  const assignedBy = await prisma.user.findUnique({
    where: { id: authenticatedUserId },
    select: { id: true },
  });
  if (!assignedBy) {
    return res.status(401).json({ message: "Authenticated user not found" });
  }

  const start = dayjs(booking.startTime);
  const end = dayjs(booking.endTime);
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

  let dobDate: Date | null = null;
  if (booking.dob) {
    const dob = dayjs(booking.dob);
    if (!dob.isValid() || dob.isAfter(dayjs())) {
      return res.status(400).json({ message: "Invalid date of birth" });
    }
    dobDate = dob.toDate();
  }

  const Tpn = process.env.DEJAVOO_TPN_SECOND;
  const Authkey = process.env.DEJAVOO_AUTH_KEY_SECOND;
  const RegisterId = process.env.DEJAVOO_REGISTER_ID_SECOND;
  const MerchantNumber = process.env.DEJAVOO_MERCHANT_NUMBER;
  if (!Tpn || !Authkey || !RegisterId || !MerchantNumber) {
    return res
      .status(500)
      .json({ message: "Missing in-store terminal credentials" });
  }

  const chargeAmount = depositAmount;
  const dayStart = dayjs().tz(ZONE).startOf("day").toDate();
  const dayEnd = dayjs().tz(ZONE).endOf("day").toDate();

  try {
    const lastPaymentToday = await prisma.trackingPayment.findFirst({
      where: {
        createdAt: { gte: dayStart, lte: dayEnd },
        device_number: "terminal_2",
      },
      orderBy: { createdAt: "desc" },
    });
    const referenceId = lastPaymentToday
      ? (parseInt(lastPaymentToday.referenceId, 10) + 1)
          .toString()
          .padStart(3, "0")
      : "001";

    const terminalResponse = await axios.post(
      "https://spinpos.net/v2/Payment/Sale",
      {
        Amount: chargeAmount,
        PaymentType: "Credit",
        ReferenceId: referenceId,
        Tpn,
        RegisterId,
        Authkey,
        MerchantNumber,
        PrintReceipt: "No",
        GetReceipt: "No",
        CaptureSignature: true,
        CallbackInfo: { Url: "" },
        GetExtendedData: true,
        IsReadyForIS: true,
        CustomFields: { booking_employee_id: employeeId },
        SPInProxyTimeout: 240,
      },
      { headers: { "Content-Type": "application/json" }, timeout: 240000 },
    );

    let terminalPayment = terminalResponse.data;
    if (
      terminalPayment?.GeneralResponse?.StatusCode === "1999" &&
      terminalPayment?.GeneralResponse?.DetailedMessage ===
        "Request format error"
    ) {
      const lastApprovedPayment = await prisma.trackingPayment.findFirst({
        where: {
          createdAt: { gte: dayStart, lte: dayEnd },
          statusCode: "0000",
          device_number: "terminal_2",
        },
        orderBy: { createdAt: "desc" },
      });
      const transactionIndex =
        Number(lastApprovedPayment?.transactionNumber || 0) + 1;

      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const statusResponse = await axios.post(
            "https://spinpos.net/v2/Payment/StatusList",
            {
              PaymentType: "Credit",
              Tpn,
              Authkey,
              RegisterId,
              MerchantNumber,
              TransactionFromIndex: transactionIndex,
              TransactionToIndex: transactionIndex,
            },
            { timeout: 240000 },
          );
          const recoveredPayment = statusResponse.data?.Transactions?.find(
            (transaction: any) => transaction?.ReferenceId === referenceId,
          );
          if (recoveredPayment?.GeneralResponse?.StatusCode === "0000") {
            terminalPayment = recoveredPayment;
            break;
          }
        } catch (statusError) {
          console.error("Terminal payment status lookup failed:", statusError);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const paymentRecord = await prisma.trackingPayment.create({
      data: {
        referenceId,
        paymentType: "Credit",
        transactionType: terminalPayment?.TransactionType ?? "CardPayment",
        invoiceNumber: terminalPayment?.InvoiceNumber,
        batchNumber: terminalPayment?.BatchNumber,
        transactionNumber: terminalPayment?.TransactionNumber,
        authCode: terminalPayment?.AuthCode,
        voided: terminalPayment?.Voided ?? false,
        pnReferenceId: terminalPayment?.PNReferenceId,
        totalAmount: terminalPayment?.Amounts?.TotalAmount,
        amount: terminalPayment?.Amounts?.Amount,
        tipAmount: terminalPayment?.Amounts?.TipAmount,
        feeAmount: terminalPayment?.Amounts?.FeeAmount,
        taxAmount: terminalPayment?.Amounts?.TaxAmount,
        cardType: terminalPayment?.CardData?.CardType,
        entryType: terminalPayment?.CardData?.EntryType,
        last4: terminalPayment?.CardData?.Last4,
        first4: terminalPayment?.CardData?.First4,
        BIN: terminalPayment?.CardData?.BIN,
        name: terminalPayment?.CardData?.Name,
        emvApplicationName: terminalPayment?.EMVData?.ApplicationName,
        emvAID: terminalPayment?.EMVData?.AID,
        emvTVR: terminalPayment?.EMVData?.TVR,
        emvTSI: terminalPayment?.EMVData?.TSI,
        emvIAD: terminalPayment?.EMVData?.IAD,
        emvARC: terminalPayment?.EMVData?.ARC,
        hostResponseCode:
          terminalPayment?.GeneralResponse?.HostResponseCode,
        hostResponseMessage:
          terminalPayment?.GeneralResponse?.HostResponseMessage,
        resultCode: terminalPayment?.GeneralResponse?.ResultCode,
        statusCode: terminalPayment?.GeneralResponse?.StatusCode,
        message: terminalPayment?.GeneralResponse?.Message,
        detailedMessage: terminalPayment?.GeneralResponse?.DetailedMessage,
        artist: employee.name,
        payment_method: "Card in Store",
        item_service: "Appointment Booking",
        service_price: depositAmount,
        customer_name: booking.customerName,
        customer_phone: booking.phone,
        device_number: "terminal_2",
      },
    });

    if (terminalPayment?.GeneralResponse?.StatusCode !== "0000") {
      return res.status(402).json({
        message:
          terminalPayment?.GeneralResponse?.Message ||
          "The in-store card payment was not approved.",
        paymentId: paymentRecord.id,
      });
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const appointment = await tx.appointment.create({
          data: {
            employeeId,
            customerName: booking.customerName.trim(),
            email: booking.email ?? "",
            phone: booking.phone.trim(),
            detail: booking.detail ?? "",
            status: "pending",
            startTime: start.toDate(),
            endTime: end.toDate(),
            dob: dobDate,
            address: booking.address || null,
            paidWith: "Card in Store",
            deposit_amount: depositAmount,
            quote_amount: quoteAmount,
            deposit_category: "Card in Store",
            extra_deposit_category: `Card in Store:${paymentRecord.id}`,
            deposit_status: "accepted",
            payment_id: paymentRecord.id,
            source_booking: "manual",
            assignedById: assignedBy.id,
          },
        });

        if (booking.attachments?.length) {
          await tx.appointmentAttachment.createMany({
            data: booking.attachments.map((attachment) => ({
              appointmentId: appointment.id,
              fileId: attachment.fileId,
              url: attachment.url,
              filename: attachment.filename,
              mime: attachment.mime,
              size: attachment.size,
              width: attachment.width ?? null,
              height: attachment.height ?? null,
            })),
          });
        }

        await tx.notification.create({
          data: {
            created_by: employee.id,
            title: "has new booking",
            description: booking.detail ?? "No description provided",
            customer_name: booking.customerName.trim(),
            quote_amount: quoteAmount,
            deposit_amount: depositAmount,
            deposit_category: "Card in Store",
            extra_deposit_category: `Card in Store:${paymentRecord.id}`,
            appointment_start_time: start.toDate(),
            appointment_end_time: end.toDate(),
            appointment_id: appointment.id,
          },
        });

        return appointment;
      });

      (async () => {
        try {
          const users = await prisma.user.findMany({
            where: {
              OR: [{ isOwner: true }, { isAdmin: true }, { is_reception: true }],
            },
            select: { id: true },
          });
          const userIds = Array.from(
            new Set([employeeId, ...users.map((user) => user.id)]),
          );
          const tokens = (
            await prisma.deviceToken.findMany({
              where: { userId: { in: userIds }, enabled: true },
              select: { token: true },
            })
          ).map((device) => device.token);

          if (tokens.length) {
            await sendPushAsync(tokens, {
              title: "New booking (Card in Store paid)",
              body: `${booking.customerName} booked ${start
                .tz(ZONE)
                .format("MMM D, HH:mm")}–${end.tz(ZONE).format("HH:mm")}`,
              data: { bookingId: created.id, type: "BOOKING" },
            });
          }
        } catch (pushError) {
          console.error("Push send error:", pushError);
        }
      })();

      return res.status(201).json({
        appointment: created,
        payment: {
          id: paymentRecord.id,
          referenceId: paymentRecord.referenceId,
          amount: paymentRecord.amount,
          last4: paymentRecord.last4,
        },
      });
    } catch (bookingError) {
      console.error(
        "Payment approved but appointment creation failed:",
        bookingError,
      );
      return res.status(502).json({
        message:
          "The card was approved, but the appointment could not be saved. Contact support before retrying.",
        paymentId: paymentRecord.id,
      });
    }
  } catch (error: any) {
    console.error(
      "In-store booking payment failed:",
      error.response?.data || error.message,
    );
    const terminalStatus =
      error.response?.data?.GeneralResponse?.StatusCode;
    if (terminalStatus === "2008") {
      const delay =
        error.response.data.GeneralResponse.DelayBeforeNextRequest;
      return res.status(429).json({
        message: `Terminal busy. Please wait ${Math.ceil(delay / 60)} min.`,
      });
    }
    if (terminalStatus === "2007") {
      return res.status(429).json({
        message: "Timeout waiting for card swipe. Please try again.",
      });
    }
    return res.status(500).json({
      message:
        "The terminal payment could not be completed. Verify the terminal before retrying.",
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
