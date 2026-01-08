import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config";
import slugify from "slugify";
import { customAlphabet } from "nanoid";
import axios from "axios";
import { sendSMS } from "../utils/sms";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

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
      return res
        .status(400)
        .json({ success: false, error: "Amount and artist are required" });
    }

    // --- Generate ReferenceId (day starts at 06:00) ---

    const startOfTodayUTC = dayjs()
      .tz("America/Chicago")
      .startOf("day")
      .utc()
      .toDate();

    const endOfTodayUTC = dayjs()
      .tz("America/Chicago")
      .endOf("day")
      .utc()
      .toDate();

    const lastPaymentToday = await prisma.trackingPayment.findFirst({
      where: {
        createdAt: {
          gte: startOfTodayUTC,
          lte: endOfTodayUTC,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const nextReferenceId = lastPaymentToday
      ? (parseInt(lastPaymentToday.referenceId, 10) + 1)
          .toString()
          .padStart(3, "0")
      : "001";

    if (isNaN(Card) && isNaN(Cash)) {
      return res.status(400).json({
        success: false,
        error: "Amount must be a valid number",
      });
    }
    let cashRecord = null;
    let cardRecord = null;
    let dejavoo = null;
    // --- CASH PAYMENT ---
    if (typeof Cash === "number" && Cash > 0) {
      cashRecord = await prisma.trackingPayment.create({
        data: {
          referenceId: nextReferenceId,
          paymentType: isCashApp ? "CashApp" : "Cash",
          transactionType: isCashApp ? "CashAppPayment" : "CashPayment",
          amount: Cash,
          artist,
          payment_method: extra_data?.paid_by ?? "Cash",
          item_service: item_service ? item_service : "Undefined",
          service_price:
            extra_data?.service_price &&
            typeof extra_data?.service_price === "number"
              ? extra_data?.service_price
              : 0,
          jewelry_price:
            extra_data?.jewelry_price &&
            typeof extra_data?.jewelry_price === "number"
              ? extra_data?.jewelry_price
              : 0,
          saline_price:
            extra_data?.saline_price &&
            typeof extra_data?.saline_price === "number"
              ? extra_data?.saline_price
              : 0,
          document_id: extra_data?.documentId ?? "",
          customer_name: extra_data?.customer_name ?? "",
          customer_phone: extra_data?.customer_phone ?? "",
        },
      });
    }
    if (typeof Card === "number" && Card > 0) {
      // --- CARD PAYMENT ---
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
        IsReadyForIS: true,
        CustomFields: { document_id: "hello", id: "10" },
        SPInProxyTimeout: 240,
      };

      const response = await axios.post(
        "https://spinpos.net/v2/Payment/Sale",
        payload,
        { headers: { "Content-Type": "application/json" }, timeout: 240000 }
      );

      dejavoo = response.data;

      // --- Insert into DB ---
      cardRecord = await prisma.trackingPayment.create({
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
          hostResponseMessage: dejavoo?.GeneralResponse?.HostResponseMessage,
          resultCode: dejavoo?.GeneralResponse?.ResultCode,
          statusCode: dejavoo?.GeneralResponse?.StatusCode,
          message: dejavoo?.GeneralResponse?.Message,
          detailedMessage: dejavoo?.GeneralResponse?.DetailedMessage,
          artist,
          payment_method: extra_data?.paid_by ?? "Card",
          item_service: item_service ? item_service : "Undefined",
          service_price:
            extra_data?.service_price &&
            typeof extra_data?.service_price === "number"
              ? extra_data?.service_price
              : 0,
          jewelry_price:
            extra_data?.jewelry_price &&
            typeof extra_data?.jewelry_price === "number"
              ? extra_data?.jewelry_price
              : 0,
          saline_price:
            extra_data?.saline_price &&
            typeof extra_data?.saline_price === "number"
              ? extra_data?.saline_price
              : 0,
          document_id: extra_data?.documentId ?? "",
          customer_name: extra_data?.customer_name ?? "",
          customer_phone: extra_data?.customer_phone ?? "",
        },
      });
    }
    // UPDATE PAY IN FIREBASE DATABASE
    let is_failed = false;
    if (extra_data?.paid_by && extra_data?.id && extra_data?.documentId) {
      if (typeof Card === "number" && Card > 0) {
        if (
          !dejavoo?.GeneralResponse?.Message?.toLowerCase().includes("approved")
        ) {
          is_failed = true;
          return res.json({
            success: true,
            dejavoo,
            cashRecord,
            cardRecord,
            id: cashRecord?.id ?? cardRecord?.id ?? "",
            cash_id: cashRecord?.id ?? "",
            card_id: cardRecord?.id ?? "",
            referenceId: nextReferenceId,
          });
        }
      }
      if (
        cardRecord?.message &&
        cardRecord?.message?.length > 2 &&
        !cardRecord?.message?.toLowerCase()?.includes("approved")
      ) {
        is_failed = true;
        return res.status(400).json({
          success: false,
          dejavoo,
          cashRecord,
          cardRecord,
          id: cashRecord?.id ?? cardRecord?.id ?? "",
          cash_id: cashRecord?.id ?? "",
          card_id: cardRecord?.id ?? "",
          referenceId: nextReferenceId,
        });
      }
      let deposit_has_been_used = false;
      // Check if appointment_id is provided in extra_data and update the appointment
      if (
        extra_data?.appointment_id &&
        typeof extra_data?.deposit_has_been_used === "boolean" &&
        extra_data?.deposit_has_been_used
      ) {
        // Fetch the current appointment to check the current value of deposit_has_been_used
        const currentAppointment = await prisma.appointment.findUnique({
          where: { id: extra_data.appointment_id },
          select: { deposit_has_been_used: true },
        });

        // Only update if the current deposit_has_been_used is false
        if (currentAppointment?.deposit_has_been_used === false) {
          await prisma.appointment.update({
            where: { id: extra_data.appointment_id },
            data: {
              deposit_has_been_used: extra_data?.deposit_has_been_used ?? false,
            },
          });
          deposit_has_been_used = true;
        }
      }
      // PAYMENT SUCCESFULLY
      if (!cardRecord?.id && !cashRecord?.id) {
        is_failed = true;
      }
      console.log("is_failed:", is_failed);
      if (!is_failed) {
        await axios.patch(
          `https://hyperinkersform.com/api/${item_service}/payment`,
          {
            tracking_payment_id: cashRecord?.id ?? cardRecord?.id ?? "",
            cash_id: cashRecord?.id ?? "",
            card_id: cardRecord?.id ?? "",
            status: "paid",
            paid_by: extra_data?.paid_by ?? "",
            cash: Cash ?? 0,
            card: Card ?? 0,
            id: extra_data?.id,
            tip: dejavoo?.Amounts?.TipAmount ?? 0,
            documentId: extra_data?.documentId,
            collectionId: extra_data?.collectionId,
            paid_money: (Cash ?? 0) + (Card ?? 0),
            deposit_has_been_used: deposit_has_been_used,
          }
        );
      }
    }
    return res.json({
      success: true,
      dejavoo,
      cashRecord,
      cardRecord,
      id: cashRecord?.id ?? cardRecord?.id ?? "",
      cash_id: cashRecord?.id ?? "",
      card_id: cardRecord?.id ?? "",
      referenceId: nextReferenceId,
    });
  } catch (err: any) {
    console.error("Payment Error:", err.response?.data || err.message);

    // Terminal busy
    if (err.response?.data?.GeneralResponse?.StatusCode === "2008") {
      const delay = err.response.data.GeneralResponse.DelayBeforeNextRequest;
      return res.status(429).json({
        success: false,
        error: `Terminal busy. Please wait ${Math.ceil(delay / 60)} min.`,
      });
    }
    if (err.response?.data?.GeneralResponse?.StatusCode === "2007") {
      return res.status(429).json({
        success: false,
        error: `Timeout waiting for card swipe. Please try again.`,
      });
    }

    return res
      .status(500)
      .json({ success: false, error: err.response?.data || err.message });
  }
};

const BASE_URL = "https://spinpos.net/v2";

export const getDailyReport = async (req: Request, res: Response) => {
  try {
    const Tpn = process.env.DEJAVOO_TPN!;
    const Authkey = process.env.DEJAVOO_AUTH_KEY!;

    if (!Tpn || !Authkey) {
      return res.status(500).json({
        success: false,
        error: "Missing Dejavoo credentials",
      });
    }

    const payload = {
      Tpn,
      Authkey,
      SPInProxyTimeout: null, // optional
    };

    const response = await axios.post(
      `https://spinpos.net/v2/Report/Summary`,
      payload,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 20000, // Daily reports can take time
      }
    );

    return res.json({
      success: true,
      report: response.data,
    });
  } catch (err: any) {
    console.error("Daily Report Error:", err.response?.data || err.message);

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

export const createSignInCustomer = async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      dob,
      phone,
      address,
      city,
      state,
      zip_code,
      document_id,
      service,
      spending_artist,
      spending_services,
      spending_amount,
    } = req.body;

    if (!document_id || !name || !phone) {
      return res.status(400).json({
        message: "document_id, name, and phone are required",
      });
    }

    const existingCustomer = await prisma.signInCustomer.findUnique({
      where: { document_id },
    });

    if (existingCustomer) {
      return res.status(409).json({
        message: "Customer with this document_id already exists",
      });
    }

    const customer = await prisma.signInCustomer.create({
      data: {
        name,
        email,
        dob,
        phone,
        address,
        city,
        state,
        zip_code,
        document_id,
        service,
        spending_artist,
        spending_services,
        spending_amount,
      },
    });

    return res.status(201).json(customer);
  } catch (error) {
    console.error("Create SignInCustomer failed", error);
    return res.status(500).json({
      message: "Failed to create sign-in customer",
    });
  }
};

export const updateSignInCustomerByDocumentId = async (
  req: Request,
  res: Response
) => {
  try {
    const { spending_artist, spending_services, spending_amount, document_id } =
      req.body;

    if (!document_id) {
      return res.status(400).json({
        message: "document_id is required",
      });
    }

    const existingCustomer = await prisma.signInCustomer.findUnique({
      where: { document_id },
    });

    if (!existingCustomer) {
      return res.status(404).json({
        message: "Customer not found",
      });
    }

    const updatedCustomer = await prisma.signInCustomer.update({
      where: { document_id },
      data: {
        spending_artist,
        spending_services,
        spending_amount,
      },
    });

    return res.status(200).json(updatedCustomer);
  } catch (error) {
    console.error("Update SignInCustomer failed", error);
    return res.status(500).json({
      message: "Failed to update sign-in customer",
    });
  }
};
