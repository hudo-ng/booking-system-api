import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config";
import slugify from "slugify";
import { customAlphabet } from "nanoid";
import axios from "axios";
import { sendSMS } from "../utils/sms";
import { parseMoney } from "../utils/utils";

const prisma = new PrismaClient();

export const register = async (req: Request, res: Response) => {
  const { email, password, name, role, colour, start_price } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const nano = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 5);
  const base = slugify(name || "user", { lower: true, strict: true }) || "user";
  const slug = `${base}-${nano()}`;
  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      name,
      role,
      colour,
      start_price,
      isAdmin: false,
      phone_number: "6471234567",
      slug,
      isOwner: false,
      show_on_calendar_booking: false,
    },
  });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
};

export const login = async (req: Request, res: Response) => {
  const { email, password, deviceId } = req.body as {
    email: string;
    password: string;
    deviceId?: string;
  };
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isEmployee = (user.role as any) === "employee";
  if (isEmployee && deviceId && !user.currentDeviceId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { currentDeviceId: deviceId },
    });
  }

  if (
    isEmployee &&
    deviceId &&
    user.currentDeviceId &&
    user.currentDeviceId !== deviceId
  ) {
    return res.status(423).json({
      error: "DEVICE_LOCKED",
      message: "This device is not authorized.",
    });
  }

  const token = jwt.sign(
    {
      userId: user.id,
      role: user.role,
      isAdmin: user.isAdmin,
      name: user.name,
      isOwner: user.isOwner,
      is_reception: user.is_reception,
      deviceId: deviceId ?? null,
      slug: user.slug,
    },
    config.jwtSecret,
    { expiresIn: "1y" }
  );

  const safeUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    slug: user.slug,
  };

  res.json({ token: token, ...safeUser });
};

export const logInByIdToken = async (req: Request, res: Response) => {
  try {
    const { idToken, deviceId } = req.body as {
      idToken: string;
      deviceId?: string;
    };
    console.log("Received idToken:", idToken);
    if (!idToken) {
      return res.status(400).json({ message: "idToken is required" });
    }

    // 1️⃣ Verify the incoming token (the token should be signed with your server's secret)
    let decoded: any;
    try {
      decoded = jwt.verify(idToken, config.jwtSecret);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // 2️⃣ Check if user exists in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isEmployee = (user.role as any) === "employee";
    if (user.role === "employee") {
      if (deviceId && !user.currentDeviceId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { currentDeviceId: deviceId },
        });
      }
      if (
        deviceId &&
        user.currentDeviceId &&
        user.currentDeviceId !== deviceId
      ) {
        return res.status(423).json({
          error: "DEVICE_LOCKED",
          message: "This device is not authorized.",
        });
      }
    }

    // 3️⃣ Generate a new access token for continued use
    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        isAdmin: user.isAdmin,
        name: user.name,
        isOwner: user.isOwner,
        is_reception: user.is_reception,
        deviceId: deviceId ?? null,
        slug: user.slug,
      },
      config.jwtSecret,
      { expiresIn: "1y" }
    );

    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      slug: user.slug,
    };

    return res.json({ token, ...safeUser });
  } catch (error) {
    console.error("logInByIdToken error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createPaymentRequest = async (req: Request, res: Response) => {
  try {
    const { artist, Cash, Card, item_service, is_cashapp, extra_data } =
      req.body;

    let isCashApp = is_cashapp ?? false;

    if (!artist) {
      return res.status(400).json({
        success: false,
        error: "Amount and artist are required",
      });
    }

    // --- Generate random ReferenceId (100,000 to 100,000,000)
    const nextReferenceId = (
      Math.floor(Math.random() * (100_000_000 - 100_000 + 1)) + 100_000
    ).toString();

    if (isNaN(Card) && isNaN(Cash)) {
      return res.status(400).json({
        success: false,
        error: "Amount must be a valid number",
      });
    }

    let cashRecord: any = null;
    let cardRecord: any = null;
    let dejavoo: any = null;

    const tasks: Promise<any>[] = [];

    // --- CASH PAYMENT ---
    if (typeof Cash === "number" && Cash > 0) {
      tasks.push(
        prisma.trackingPayment
          .create({
            data: {
              referenceId: nextReferenceId,
              paymentType: isCashApp ? "CashApp" : "Cash",
              transactionType: isCashApp ? "CashAppPayment" : "CashPayment",
              amount: Cash,
              artist,
              payment_method: extra_data?.paid_by ?? "Cash",
              item_service: item_service || "Undefined",
              service_price: extra_data?.service_price || 0,
              jewelry_price: extra_data?.jewelry_price || 0,
              saline_price: extra_data?.saline_price || 0,
              document_id: extra_data?.documentId ?? "",
              customer_name: extra_data?.customer_name ?? "",
              customer_phone: extra_data?.customer_phone ?? "",
            },
          })
          .then((rec) => {
            cashRecord = rec;
          })
      );
    }

    // --- CARD PAYMENT ---
    if (typeof Card === "number" && Card > 0) {
      const Tpn = process.env.DEJAVOO_TPN!;
      const Authkey = process.env.DEJAVOO_AUTH_KEY!;
      const RegisterId = process.env.DEJAVOO_REGISTER_ID!;
      const MerchantNumber = process.env.DEJAVOO_MERCHANT_NUMBER!;

      if (!Tpn || !Authkey || !RegisterId) {
        return res
          .status(500)
          .json({ success: false, error: "Missing terminal credentials" });
      }

      const payload = {
        Amount: Card,
        PaymentType: "Credit",
        ReferenceId: nextReferenceId,
        Tpn,
        RegisterId,
        Authkey,
        MerchantNumber,
        PrintReceipt: "No",
        GetReceipt: "No",
        CaptureSignature: true,
        CallbackInfo: { Url: "" },
        GetExtendedData: true,
        IsReadyForIS: false,
        CustomFields: { document_id: "hello", id: "10" },
      };

      tasks.push(
        axios
          .post("https://spinpos.net/v2/Payment/Sale", payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 120000,
          })
          .then(async (response) => {
            dejavoo = response.data;

            const rec = await prisma.trackingPayment.create({
              data: {
                referenceId: nextReferenceId,
                paymentType: "Credit",
                transactionType: dejavoo?.TransactionType ?? "CardPayment",
                invoiceNumber: dejavoo?.InvoiceNumber,
                batchNumber: dejavoo?.BatchNumber,
                transactionNumber: dejavoo?.TransactionNumber,
                authCode: dejavoo?.AuthCode,
                voided: dejavoo?.Voided ?? false,
                pnReferenceId: dejavoo?.PNReferenceId,

                totalAmount: dejavoo?.Amounts?.TotalAmount,
                amount: dejavoo?.Amounts?.Amount,
                tipAmount: dejavoo?.Amounts?.TipAmount,
                feeAmount: dejavoo?.Amounts?.FeeAmount,
                taxAmount: dejavoo?.Amounts?.TaxAmount,

                cardType: dejavoo?.CardData?.CardType,
                entryType: dejavoo?.CardData?.EntryType,
                last4: dejavoo?.CardData?.Last4,
                first4: dejavoo?.CardData?.First4,
                BIN: dejavoo?.CardData?.BIN,
                name: dejavoo?.CardData?.Name,

                emvApplicationName: dejavoo?.EMVData?.ApplicationName,
                emvAID: dejavoo?.EMVData?.AID,
                emvTVR: dejavoo?.EMVData?.TVR,
                emvTSI: dejavoo?.EMVData?.TSI,
                emvIAD: dejavoo?.EMVData?.IAD,
                emvARC: dejavoo?.EMVData?.ARC,

                hostResponseCode: dejavoo?.GeneralResponse?.HostResponseCode,
                hostResponseMessage:
                  dejavoo?.GeneralResponse?.HostResponseMessage,
                resultCode: dejavoo?.GeneralResponse?.ResultCode,
                statusCode: dejavoo?.GeneralResponse?.StatusCode,
                message: dejavoo?.GeneralResponse?.Message,
                detailedMessage: dejavoo?.GeneralResponse?.DetailedMessage,

                artist,
                payment_method: extra_data?.paid_by ?? "Card",
                item_service: item_service || "Undefined",
                service_price: extra_data?.service_price || 0,
                jewelry_price: extra_data?.jewelry_price || 0,
                saline_price: extra_data?.saline_price || 0,
                document_id: extra_data?.documentId ?? "",
                customer_name: extra_data?.customer_name ?? "",
                customer_phone: extra_data?.customer_phone ?? "",
              },
            });

            cardRecord = rec;
          })
      );
    }

    // run both in parallel
    await Promise.all(tasks);

    // --- DEPOSIT FLAG UPDATE ---
    let depositHasBeenUsed = false;

    if (
      extra_data?.appointment_id &&
      typeof extra_data?.deposit_has_been_used === "boolean" &&
      extra_data?.deposit_has_been_used
    ) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: extra_data.appointment_id },
        select: { deposit_has_been_used: true },
      });

      if (appointment?.deposit_has_been_used === false) {
        await prisma.appointment.update({
          where: { id: extra_data.appointment_id },
          data: {
            deposit_has_been_used: true,
          },
        });
        depositHasBeenUsed = true;
      }
    }

    // --- FINAL FIREBASE UPDATE ---
    const CashAmount = parseMoney(Cash);
    const CardAmount = parseMoney(Card);

    if (extra_data?.id && extra_data?.documentId) {
      await axios.patch(
        `https://hyperinkersform.com/api/${item_service}/payment`,
        {
          tracking_payment_id: cashRecord?.id ?? cardRecord?.id ?? "",
          cash_id: cashRecord?.id ?? "",
          card_id: cardRecord?.id ?? "",
          status: "paid",
          paid_by: extra_data?.paid_by ?? "",
          cash: CashAmount,
          card: CardAmount,
          id: extra_data?.id,
          tip: dejavoo?.Amounts?.TipAmount ?? 0,
          documentId: extra_data?.documentId,
          collectionId: extra_data?.collectionId,
          paid_money: CashAmount + CardAmount,
          deposit_has_been_used: depositHasBeenUsed,
        }
      );
    }

    return res.json({
      success: true,
      dejavoo,
      cashRecord,
      cardRecord,
      id: cashRecord?.id ?? cardRecord?.id,
      cash_id: cashRecord?.id ?? "",
      card_id: cardRecord?.id ?? "",
    });
  } catch (err: any) {
    console.error("Payment Error:", err.response?.data || err.message);

    if (err.response?.data?.GeneralResponse?.StatusCode === "2008") {
      const delay = err.response.data.GeneralResponse.DelayBeforeNextRequest;
      return res.status(429).json({
        success: false,
        error: `Terminal busy. Please wait ${Math.ceil(delay / 60)} min.`,
      });
    }

    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
};

export const getTrackingPaymentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Payment ID is required",
      });
    }

    const payment = await prisma.trackingPayment.findUnique({
      where: { id },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: "Payment not found",
      });
    }

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error("Get tracking payment error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch payment",
    });
  }
};

function getChicagoStartEndOfDay() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const [{ value: month }, , { value: day }, , { value: year }] =
    formatter.formatToParts(now);

  const start = new Date(`${year}-${month}-${day}T00:00:00-06:00`);
  const end = new Date(`${year}-${month}-${day}T23:59:59.999-06:00`);

  return { startOfDay: start, endOfDay: end };
}

function normalizePhone(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.substring(1);
  }
  return digits;
}

export const createVerification = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const normalizedInput = normalizePhone(phone);

    if (normalizedInput.length !== 10) {
      return res.status(400).json({ message: "Invalid phone number format" });
    }

    const { startOfDay, endOfDay } = getChicagoStartEndOfDay();

    // 1. Fetch all appointments that overlap today
    const todaysAppointments = await prisma.appointment.findMany({
      where: {
        AND: [
          {
            startTime: {
              lte: endOfDay, // appointment started before day ended
            },
          },
          {
            endTime: {
              gte: startOfDay, // appointment ends after day started
            },
          },
        ],
      },
    });

    // 2. Compare using normalized phone numbers
    const appointment = todaysAppointments.find((appt) => {
      const normalizedDbPhone = normalizePhone(appt.phone);
      return normalizedDbPhone === normalizedInput;
    });

    if (!appointment) {
      return res.status(404).json({
        message: "No appointment found for this phone number today",
      });
    }

    // 3. Generate code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await prisma.verificationCode.create({
      data: {
        appointment_id: appointment.id,
        phone: normalizePhone(appointment.phone), // store normalized
        code,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    await sendSMS(normalizedInput, `Your verification code is: ${code}`);

    return res.status(200).json({
      message: "Verification code sent successfully",
    });
  } catch (error) {
    console.error("Error creating verification:", error);
    return res.status(500).json({
      message: "Failed to create verification",
    });
  }
};

export const validateVerification = async (req: Request, res: Response) => {
  try {
    const { phone, code } = req.body;
    const normalizedInput = normalizePhone(phone);

    // Find latest valid verification record
    const record = await prisma.verificationCode.findFirst({
      where: {
        phone: normalizedInput, // 🔥 compare using normalized phone stored in DB
        code,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        appointment: {
          include: {
            employee: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!record) {
      return res.status(400).json({
        message: "Invalid or expired verification code",
      });
    }

    // Mark code as used
    await prisma.verificationCode.update({
      where: { id: record.id },
      data: { isUsed: true },
    });

    return res.status(200).json({
      message: "Verification successful",
      appointment: record.appointment,
    });
  } catch (error) {
    console.error("Error validating verification:", error);
    return res.status(500).json({
      message: "Failed to validate verification",
    });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = (req as any).user.userId;

    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Old password and new password are required" });
    }

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        isAdmin: user.isAdmin,
        name: user.name,
        isOwner: user.isOwner,
        is_reception: user.is_reception,
        deviceId: user.currentDeviceId ?? null,
      },
      config.jwtSecret,
      { expiresIn: "1y" }
    );
    res.json({ message: "Password changed successfully", token });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ message: "Failed to change password" });
  }
};
