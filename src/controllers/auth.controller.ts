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
import isBetween from "dayjs/plugin/isBetween";
import { normalizeSignedDate } from "../utils/time";
import Mailgun from "mailgun.js";
import puppeteer from "puppeteer";
import { getReceptionWeekData } from "../services/paystub.service";
import minMax from "dayjs/plugin/minMax";
import { imageKit } from "../utils/imagekit";
import customParseFormat from "dayjs/plugin/customParseFormat";

// This line is crucial for both JS logic and TS types
dayjs.extend(minMax);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
// Extend dayjs to handle custom formats like MMDDYYYY
dayjs.extend(customParseFormat);
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
    { expiresIn: "1y" },
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
      { expiresIn: "1y" },
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
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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
        { headers: { "Content-Type": "application/json" }, timeout: 240000 },
      );

      dejavoo = response.data;
      if (dejavoo?.GeneralResponse?.StatusCode! != "0000") {
        console.log("Dejavoo Response:", dejavoo);
      }
      // ** Retry once if request format error **
      if (
        dejavoo?.GeneralResponse?.StatusCode === "1999" &&
        dejavoo?.GeneralResponse?.DetailedMessage === "Request format error"
      ) {
        console.log("Dejavoo format error → polling StatusList…");

        const lastCardPaymentToday = await prisma.trackingPayment.findFirst({
          where: {
            createdAt: {
              gte: startOfTodayUTC,
              lte: endOfTodayUTC,
            },
            statusCode: "0000",
            device_number: "terminal_1",
          },
          orderBy: { createdAt: "desc" },
        });

        const transactionIndex =
          Number(lastCardPaymentToday?.transactionNumber || 0) + 1;

        for (let attempt = 1; attempt <= 20; attempt++) {
          console.log(
            `StatusList attempt for transactionIndex ${transactionIndex} at attemp number ${attempt}/10`,
          );

          const statusPayload = {
            PaymentType: "Credit",
            Tpn,
            Authkey,
            RegisterId,
            MerchantNumber,
            TransactionFromIndex: transactionIndex,
            TransactionToIndex: transactionIndex,
          };

          try {
            const statusRes = await axios.post(
              "https://spinpos.net/v2/Payment/StatusList",
              statusPayload,
              { timeout: 240000 },
            );

            const match = statusRes.data?.Transactions?.find(
              (t: any) => t?.ReferenceId === nextReferenceId,
            );

            if (match?.GeneralResponse?.StatusCode === "0000") {
              console.log("Dejavoo recovered transaction: !", match);
              dejavoo = match;
              break;
            }
          } catch (err) {
            console.error("StatusList error:", err);
          }

          // Wait 500ms before next poll
          await sleep(500);
        }
      }

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
          },
        );
        if (
          item_service === "tattoo" ||
          extra_data?.item_service === "tattoo"
        ) {
          const newPaymentAmount = (Cash ?? 0) + (Card ?? 0);
          try {
            await prisma.signInCustomer.update({
              where: {
                document_id: extra_data?.documentId,
              },
              data: {
                spending_amount: {
                  increment: newPaymentAmount,
                },
              },
            });
          } catch (error) {
            console.error("Tattoo payment update sign in:", error);
          }
        }
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

export const createAdminPaymentRequest = async (
  req: Request,
  res: Response,
) => {
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
          device_number: "terminal_2",
        },
      });
    }
    if (typeof Card === "number" && Card > 0) {
      // --- CARD PAYMENT ---
      const Tpn = process.env.DEJAVOO_TPN_SECOND!;
      const Authkey = process.env.DEJAVOO_AUTH_KEY_SECOND!;
      const RegisterId = process.env.DEJAVOO_REGISTER_ID_SECOND!;
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
        { headers: { "Content-Type": "application/json" }, timeout: 240000 },
      );

      dejavoo = response.data;
      if (dejavoo?.GeneralResponse?.StatusCode! != "0000") {
        console.log("Dejavoo Response:", dejavoo);
      }
      // ** Retry once if request format error **
      if (
        dejavoo?.GeneralResponse?.StatusCode === "1999" &&
        dejavoo?.GeneralResponse?.DetailedMessage === "Request format error"
      ) {
        console.log("Dejavoo format error → polling StatusList…");

        const lastCardPaymentToday = await prisma.trackingPayment.findFirst({
          where: {
            createdAt: {
              gte: startOfTodayUTC,
              lte: endOfTodayUTC,
            },
            statusCode: "0000",
            device_number: "terminal_2",
          },
          orderBy: { createdAt: "desc" },
        });

        const transactionIndex =
          Number(lastCardPaymentToday?.transactionNumber || 0) + 1;

        for (let attempt = 1; attempt <= 20; attempt++) {
          console.log(
            `StatusList attempt for transactionIndex ${transactionIndex} at attemp number ${attempt}/10`,
          );

          const statusPayload = {
            PaymentType: "Credit",
            Tpn,
            Authkey,
            RegisterId,
            MerchantNumber,
            TransactionFromIndex: transactionIndex,
            TransactionToIndex: transactionIndex,
          };

          try {
            const statusRes = await axios.post(
              "https://spinpos.net/v2/Payment/StatusList",
              statusPayload,
              { timeout: 240000 },
            );

            const match = statusRes.data?.Transactions?.find(
              (t: any) => t?.ReferenceId === nextReferenceId,
            );

            if (match?.GeneralResponse?.StatusCode === "0000") {
              console.log("Dejavoo recovered transaction: !", match);
              dejavoo = match;
              break;
            }
          } catch (err) {
            console.error("StatusList error:", err);
          }

          // Wait 500ms before next poll
          await sleep(500);
        }
      }

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
          device_number: "terminal_2",
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
          },
        );
        if (
          item_service === "tattoo" ||
          extra_data?.item_service === "tattoo"
        ) {
          const newPaymentAmount = (Cash ?? 0) + (Card ?? 0);
          try {
            await prisma.signInCustomer.update({
              where: {
                document_id: extra_data?.documentId,
              },
              data: {
                spending_amount: {
                  increment: newPaymentAmount,
                },
              },
            });
          } catch (error) {
            console.error("Tattoo payment update sign in:", error);
          }
        }
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
    console.error("Payment Error Second:", err.response?.data || err.message);

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
      },
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
      { expiresIn: "1y" },
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
  res: Response,
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

export const calculateTotalCapturedHourFromWorkShift = async (
  req: Request,
  res: Response,
) => {
  try {
    const { userId, fromDate, toDate } = req.query;

    if (!userId || !fromDate || !toDate) {
      return res.status(400).json({
        message: "userId, fromDate, and toDate are required",
      });
    }

    const start = dayjs(String(fromDate)).startOf("day");
    const end = dayjs(String(toDate)).endOf("day");

    if (!start.isValid() || !end.isValid()) {
      return res.status(400).json({
        message: "Invalid date format",
      });
    }
    const user = await prisma.user.findUnique({
      where: { id: String(userId) },
    });
    const shifts = await prisma.workShift.findMany({
      where: {
        userId: String(userId),
        clockIn: {
          gte: start.toDate(),
          lte: end.toDate(),
        },
        clockOut: {
          not: null,
        },
      },
      orderBy: { clockIn: "asc" },
    });
    console.log(
      `Found ${shifts.length} shifts for user ${userId} between ${start.toISOString()} and ${end.toISOString()}`,
    );
    let totalMilliseconds = 0;

    for (const shift of shifts) {
      if (!shift.clockOut) continue; // ignore open shifts

      const shiftStart = dayjs(shift.clockIn);
      const shiftEnd = dayjs(shift.clockOut);

      // Clamp shift within range
      const effectiveStart = shiftStart.isBefore(start) ? start : shiftStart;

      const effectiveEnd = shiftEnd.isAfter(end) ? end : shiftEnd;

      if (effectiveEnd.isAfter(effectiveStart)) {
        totalMilliseconds += effectiveEnd.diff(effectiveStart);
      }
    }

    const totalHours = Number(
      (totalMilliseconds / (1000 * 60 * 60)).toFixed(2),
    );

    return res.json({
      userId,
      fromDate: start.toISOString(),
      toDate: end.toISOString(),
      shiftCount: shifts.length,
      totalHours,
      user,
    });
  } catch (error) {
    console.error("Error calculating work hours:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getPaystubForZoe = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, artist } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        message: "Missing startDate or endDate",
      });
    }

    const results: any[] = [];

    const [startY, startM, startD] = String(startDate).split("-").map(Number);
    const [endY, endM, endD] = String(endDate).split("-").map(Number);

    const start = new Date(startY, startM - 1, startD);
    const end = new Date(endY, endM - 1, endD);
    const current = new Date(start);

    // -----------------------------
    // 1️⃣ FETCH ALL DAYS
    // -----------------------------
    while (current <= end) {
      const formattedDate = `${String(current.getMonth() + 1).padStart(2, "0")}${String(
        current.getDate(),
      ).padStart(2, "0")}${current.getFullYear()}`;

      const response = await axios.post(
        "https://hyperinkersform.com/api/fetching",
        { endDate: formattedDate },
      );

      if (response.data?.data) {
        response.data.data.forEach((item: any) => {
          results.push({
            ...item,
            created_at: formattedDate,
          });
        });
      }

      current.setDate(current.getDate() + 1);
    }

    // -----------------------------
    // 2️⃣ FILTER PAID + ARTIST
    // -----------------------------
    let data = results.filter(
      (i) =>
        i?.status?.toLowerCase() === "paid" ||
        i?.status?.toLowerCase() === "done",
    );

    if (artist && artist !== "All") {
      data = data.filter(
        (i) => i.artist?.toLowerCase() === String(artist).toLowerCase(),
      );
    }

    // -----------------------------
    // 3️⃣ GROUP BY DAY
    // -----------------------------
    const grouped: Record<string, any> = {};

    data.forEach((i) => {
      const dateKey = i.created_at;

      if (!grouped[dateKey]) {
        grouped[dateKey] = {
          date: i.created_at,
          totalPrice: 0,
          totalPriceJewelry: 0,
          totalPriceSanity: 0,
          totalTip: 0,
          totalPiercing: 0,
          firstTime: null as dayjs.Dayjs | null,
          lastTime: null as dayjs.Dayjs | null,
        };
      }

      const time = normalizeSignedDate(i.signedDate);

      if (time) {
        if (
          !grouped[dateKey].firstTime ||
          time.isBefore(grouped[dateKey].firstTime)
        ) {
          grouped[dateKey].firstTime = time;
        }

        if (
          !grouped[dateKey].lastTime ||
          time.isAfter(grouped[dateKey].lastTime)
        ) {
          grouped[dateKey].lastTime = time;
        }
      }

      // Piercing only (matches your totals logic)
      if ((i.color ?? "piercing") === "piercing") {
        grouped[dateKey].totalPrice += i.price || 0;
        grouped[dateKey].totalPriceJewelry += i.priceJewelry || 0;
        grouped[dateKey].totalPriceSanity += i.priceSaline || 0;
        grouped[dateKey].totalPiercing += i.price || 0;
        grouped[dateKey].totalTip += i.tip || 0;
      }
    });

    // -----------------------------
    // 4️⃣ FINAL FORMAT
    // -----------------------------
    const final = Object.values(grouped)
      .map((d: any) => {
        let total_work_hour = 0;

        if (d.firstTime && d.lastTime) {
          total_work_hour = Number(
            Number(d.lastTime.diff(d.firstTime, "minute") / 60).toFixed(2),
          );
        }

        return {
          date: d.date,
          totalPrice: Number(d.totalPrice.toFixed(2)),
          totalPriceJewelry: Number(d.totalPriceJewelry.toFixed(2)),
          totalPriceSanity: Number(d.totalPriceSanity.toFixed(2)),
          totalTip: Number(d.totalTip.toFixed(2)),
          totalPiercing: Number(d.totalPiercing.toFixed(2)),
          total_work_hour: Number(total_work_hour),
        };
      })
      .sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf());

    return res.json({ data: final });
  } catch (error: any) {
    console.error("Paystub error:", error.message);
    return res.status(500).json({ message: "Failed to generate paystub" });
  }
};

export const sendWeeklyReceptionPaystub = async (
  req: Request,
  res: Response,
) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const now = new Date();
    const today = dayjs();
    const fromDate = today.startOf("week").subtract(1, "week").add(1, "day");
    const toDate = fromDate.add(6, "day");
    const format = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");
    const formatDate = (date: Date) => dayjs(date).format("MMM DD, YYYY");

    // 1. Fetch Reception Data (Hours/Wage)
    const week = await getReceptionWeekData(
      String(userId),
      format(fromDate),
      format(toDate),
    );
    if (!week?.user) return res.status(404).json({ message: "User not found" });

    // 2. Fetch Appointments booked by this user (The IDs we need to track)
    const bookedAppointments = await prisma.appointment.findMany({
      where: { assignedById: String(userId) },
      select: { id: true },
    });
    const bookedIds = bookedAppointments.map((a) => a.id);

    // 3. Fetch External API Data for the period (Caching as before)
    const apiDataCache = new Map<string, any[]>();
    let fetchCursor = new Date(fromDate.toDate());
    while (fetchCursor <= toDate.toDate()) {
      const formatted = dayjs(fetchCursor).format("MMDDYYYY");
      try {
        const response = await axios.post(
          "https://hyperinkersform.com/api/fetching",
          { endDate: formatted },
        );
        apiDataCache.set(formatted, response.data?.data || []);
      } catch (err) {
        apiDataCache.set(formatted, []);
      }
      fetchCursor.setDate(fetchCursor.getDate() + 1);
    }

    // 4. Calculate Commissions from the Cache
    let totalBookingVolume = 0;
    let qualifiedBookingCount = 0;
    const bookingCommRate = 0.01; // 1%

    apiDataCache.forEach((items) => {
      const paidBookings = items.filter(
        (i) =>
          bookedIds.includes(i.appointment_id) &&
          (i.status?.toLowerCase() === "paid" ||
            i.status?.toLowerCase() === "done"),
      );
      qualifiedBookingCount += paidBookings.length;
      paidBookings.forEach((i) => {
        const paid = parseFloat(i?.paid_money) || 0;
        const deposit =
          i?.deposit_has_been_used !== false ? parseFloat(i?.deposit) || 0 : 0;
        totalBookingVolume += paid + deposit;
      });
    });

    const bookingCommission = totalBookingVolume * bookingCommRate;

    // 5. Calculate Hourly Pay
    const hrs = week.totalHours || 0;
    const rate = week.user.wage || 0;
    const bonusHourrate = 14;
    const totalWorkDays = week.totalWorkDays || 0;
    const expectedHours = totalWorkDays * 8;
    const reg = Math.min(hrs, expectedHours);
    const ot = Math.max(0, hrs - expectedHours);

    const gross = reg * rate + ot * bonusHourrate + bookingCommission;

    // 6. HTML Content (Maintained your style, added Booking Commission row)
    const htmlContent = `
    <html>
      <head>
        <style>
          body { font-family: 'Helvetica', Arial, sans-serif; color: #333; margin: 0; padding: 40px; background: #fff; }
          .header { display: flex; justify-content: space-between; margin-bottom: 20px; }
          .company-info h1 { margin: 0; font-size: 22px; color: #000; text-transform: uppercase; }
          .company-info p { margin: 4px 0; font-size: 12px; color: #555; }
          .stub-title { text-align: right; }
          .stub-title h1 { margin: 0; font-size: 26px; color: #888; font-weight: bold; }
          .summary-header { display: flex; justify-content: flex-end; gap: 30px; margin-top: 15px; }
          .summary-box { text-align: center; }
          .summary-box small { display: block; font-weight: bold; color: #999; font-size: 10px; margin-bottom: 2px; }
          .summary-box span { font-size: 20px; font-weight: bold; }
          .grey-bar { background: #888; color: white; padding: 10px 15px; font-size: 10px; font-weight: bold; text-transform: uppercase; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; margin-top: 20px; }
          .info-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; padding: 15px; border-bottom: 1px solid #ccc; font-size: 12px; margin-bottom: 30px; }
          table { width: 100%; border-collapse: collapse; border: 1px solid #ccc; }
          th { background: #f2f2f2; color: #666; font-size: 10px; padding: 12px 10px; text-align: left; text-transform: uppercase; border-bottom: 1px solid #ccc; }
          td { padding: 15px 10px; font-size: 13px; border-bottom: 1px solid #eee; }
          .ot-text { color: #2563eb; font-weight: 600; }
          .comm-text { color: #c5c5c5; font-weight: 600; }
          .footer-totals { display: flex; justify-content: flex-end; padding: 20px; background: #f9f9f9; border: 1px solid #ccc; border-top: none; }
          .total-item { margin-left: 50px; text-align: center; }
          .total-item small { display: block; font-weight: bold; color: #888; font-size: 10px; margin-bottom: 4px; }
          .total-item span { font-size: 18px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-info">
            <h1>HYPER INKER STUDIO</h1>
            <p>8045 Callaghan Rd, San Antonio, TX 78230</p>
            <p><strong>Pay Date:</strong> ${formatDate(now)}</p>
          </div>
          <div class="stub-title">
            <h1>RECEPTION PAY STATEMENT</h1>
            <div class="summary-header">
              <div class="summary-box"><small>PERIOD</small><span>7 Days</span></div>
              <div class="summary-box"><small>GROSS PAY</small><span>$${gross.toFixed(2)}</span></div>
            </div>
          </div>
        </div>
        <div class="grey-bar">
          <div>Employee Information</div>
          <div>Rate</div>
          <div>Status</div>
          <div>Pay Period</div>
        </div>
        <div class="info-row">
          <div><strong>${week.user.name}</strong><br />Receptionist</div>
          <div>$${(rate - 1).toFixed(2)} + ($1 bonus) /hr</div>
          <div>Weekly</div>
          <div>${format(fromDate)} to ${format(toDate)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Pay Description</th>
              <th>Quantity/Volume</th>
              <th>Rate</th>
              <th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Regular Hours</strong></td>
              <td>${reg.toFixed(1)} hrs</td>
              <td>$${(rate - 1).toFixed(2)} + ($1 bonus)</td>
              <td style="text-align:right; font-weight:bold;">$${(reg * rate).toFixed(2)}</td>
            </tr>
            ${
              ot > 0
                ? `
            <tr>
              <td><strong>Bonus Hours</strong></td>
              <td class="ot-text">${ot.toFixed(1)} hrs</td>
              <td>$${bonusHourrate}</td>
              <td style="text-align:right; font-weight:bold;">$${(ot * bonusHourrate).toFixed(2)}</td>
            </tr>`
                : ""
            }
            ${
              bookingCommission > 0
                ? `
            <tr>
              <td><strong>Booking Commission (1%)</strong></td>
              <td class="comm-text">$${totalBookingVolume.toFixed(2)}</td>
              <td>1%</td>
              <td style="text-align:right; font-weight:bold; color:#16a34a;">$${bookingCommission.toFixed(2)}</td>
            </tr>`
                : ""
            }
          </tbody>
        </table>
        <div class="footer-totals">
          <div class="total-item"><small>BOOKINGS</small><span>${qualifiedBookingCount}</span></div>
          <div class="total-item"><small>WORK DAYS</small><span>${totalWorkDays} Days</span></div>
          <div class="total-item"><small>TOTAL HOURS</small><span>${(reg + ot).toFixed(1)}</span></div>
          <div class="total-item" style="color:#000;"><small>Gross Pay</small><span>$${gross.toFixed(2)}</span></div>
        </div>
      </body>
    </html>`;

    // 7. Puppeteer Render
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 850, height: 800, deviceScaleFactor: 2 });
    await page.setContent(htmlContent);
    const image = await page.screenshot({ type: "png" });
    await browser.close();

    // 8. Upload & Save
    const uploadResponse = await imageKit.upload({
      file: Buffer.from(image),
      fileName: `paystub_reception_${userId}_${fromDate.format("YYYYMMDD")}.png`,
      folder: "/paystubs",
    });

    await prisma.paystub.create({
      data: {
        userId: String(userId),
        name: week.user.name,
        cash: 0,
        card: 0,
        total: totalBookingVolume,
        imageUrl: uploadResponse.url,
        startDate: fromDate.toDate(),
        endDate: toDate.toDate(),
        grossAmount: gross,
      },
    });
    // 6. Send Email using the Buffer or the new ImageKit URL
    const mg = new Mailgun(FormData).client({
      username: "api",
      key: process.env.MAILGUN_API_KEY!,
    });
    await mg.messages.create(process.env.MAILGUN_DOMAIN!, {
      from: process.env.MAILGUN_FROM!,
      to: week.user?.email ?? "canhducc@gmail.com",
      subject: `Weekly Paystub (${fromDate.format("MMM DD")} - ${toDate.format("MMM DD")})`,
      html: `<p>Your paystub is ready. <a href="${uploadResponse.url}">Click here to view online.</a></p>`,
      attachment: [{ filename: "paystub.png", data: Buffer.from(image) }],
    });
    return res.json({ success: true, gross, imageUrl: uploadResponse.url });
  } catch (error: any) {
    console.error("Weekly paystub error:", error);
    return res.status(500).json({ message: error.message });
  }
};

const formatDate = (d: Date) => d.toISOString().split("T")[0];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const sendZoePaystub = async (req: Request, res: Response) => {
  try {
    const artistName = "Zoe";
    const hourlyRate = 12.5;
    const commRate = 0.1; // 10%
    const commPercent = commRate * 100;

    // 1. Date Range Setup (Previous 2 Weeks)
    const now = new Date();
    now.setDate(now.getDate() - 3);
    const dayOfWeek = now.getDay();
    const toDate = new Date(now);
    toDate.setDate(now.getDate() - dayOfWeek - 1);
    const fromDate = new Date(toDate);
    fromDate.setDate(toDate.getDate() - 13);

    const periodStr = `${dayjs(fromDate).format("MMM DD, YYYY")} - ${dayjs(toDate).format("MMM DD, YYYY")}`;
    const dailyLogs: any[] = [];
    let cursor = new Date(fromDate);

    while (cursor <= toDate) {
      const formatted = dayjs(cursor).format("MMDDYYYY");
      let dayServiceTotal = 0;
      let dayJewelry = 0;
      let daySaline = 0;
      let dayTips = 0;
      let dayHours = 0;

      try {
        const salesRes = await axios.post(
          "https://hyperinkersform.com/api/fetching",
          { endDate: formatted },
        );
        const items = salesRes.data?.data || [];
        await delay(500);
        const promoRes = await axios.post(
          `https://hyperinkersform.com/api/fetching/promotion`,
          { endDate: formatted },
        );
        const promoData = promoRes.data?.data || {};

        const artistItems = items.filter(
          (i: any) =>
            i.artist?.toLowerCase() === artistName.toLowerCase() &&
            (i.status?.toLowerCase() === "paid" ||
              i.status?.toLowerCase() === "done"),
        );

        if (artistItems.length > 0) {
          const trackingIds = artistItems
            .map((i: any) => i.tracking_payment_id)
            .filter((id: string) => !!id);
          const payments = await prisma.trackingPayment.findMany({
            where: { id: { in: trackingIds } },
            select: { createdAt: true },
          });

          const sortedPayments = payments.sort(
            (a, b) =>
              dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf(),
          );

          artistItems.forEach((i: any) => {
            const fullName = `${i?.firstName} ${i?.lastName}`;
            if (fullName.includes("*"))
              dayServiceTotal += Number(i?.price) || 0;
            dayJewelry += Number(i?.priceJewelry) || 0;
            daySaline += Number(i?.priceSaline) || 0;
            dayTips += Number(i?.tip) || 0;
          });

          const clockInStr =
            promoData["Zoe"]?.fullTimestamp || promoData["Zoe"];
          const lastPayment = sortedPayments[sortedPayments.length - 1];
          const clockOutTime = lastPayment?.createdAt;

          if (clockInStr && clockOutTime) {
            const diffMinutes = dayjs(clockOutTime).diff(
              dayjs(clockInStr),
              "minute",
            );
            dayHours =
              diffMinutes > 0 ? Number((diffMinutes / 60).toFixed(2)) : 0.5;
          }
        }
      } catch (err) {
        console.error(`Fetch failed for ${formatted}:`, err);
      }

      dailyLogs.push({
        date: dayjs(cursor).format("MMM DD, YYYY"),
        hrs: dayHours,
        jewelry: dayJewelry,
        saline: daySaline,
        servicePrice: dayServiceTotal,
        tips: dayTips,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    // 2. Calculations
    const totalHours = dailyLogs.reduce((acc, d) => acc + d.hrs, 0);
    const laborPay = totalHours * hourlyRate;
    const totalJ = dailyLogs.reduce((acc, d) => acc + d.jewelry, 0);
    const totalS = dailyLogs.reduce((acc, d) => acc + d.saline, 0);
    const totalService = dailyLogs.reduce((acc, d) => acc + d.servicePrice, 0);
    const totalTips = dailyLogs.reduce((acc, d) => acc + d.tips, 0);

    const jewelryComm = totalJ * commRate;
    const salineComm = totalS * commRate;
    const serviceComm = totalService * commRate;

    const totalCommission = jewelryComm + salineComm + serviceComm;
    const netPay = laborPay + totalCommission + totalTips;
    const totalWorkDays = dailyLogs.filter(
      (d) => d.hrs > 0 || d.tips > 0 || d.servicePrice > 0,
    ).length;

    // 3. HTML Content using your Design
    const htmlContent = `
    <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          body { font-family: 'Inter', sans-serif; color: #1a1a1a; margin: 0; padding: 40px; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; }
          .company-info h1 { margin: 0; font-size: 22px; font-weight: 800; color: #000; letter-spacing: -0.5px; }
          .company-info p { margin: 4px 0; font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
          .summary-box { text-align: center; }
          .summary-box small { display: block; font-weight: 700; color: #aaa; font-size: 9px; margin-bottom: 4px; text-transform: uppercase; }
          .summary-box span { font-size: 22px; font-weight: 700; color: #000; }
          .grey-bar { background: #333; color: white; padding: 10px 15px; font-size: 9px; font-weight: 700; text-transform: uppercase; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; margin-top: 30px; border-radius: 4px 4px 0 0; }
          .info-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; padding: 15px; border: 1px solid #eee; border-top: none; font-size: 12px; margin-bottom: 30px; border-radius: 0 0 4px 4px; }
          table { width: 100%; border-collapse: collapse; border: 1px solid #eee; }
          th { background: #f8f9fa; font-size: 9px; padding: 12px 8px; text-align: left; border-bottom: 1px solid #eee; color: #888; text-transform: uppercase; }
          td { padding: 10px 8px; font-size: 11px; border-bottom: 1px solid #f4f4f4; color: #444; }
          .bold-total { font-weight: 700; color: #000; text-align: right; }
          .footer-totals { display: flex; justify-content: flex-end; padding: 25px; background: #fcfcfc; border: 1px solid #eee; border-top: none; border-radius: 0 0 4px 4px; }
          .total-item { margin-left: 60px; text-align: center; }
          .total-item small { display: block; font-weight: 700; color: #aaa; font-size: 9px; text-transform: uppercase; margin-bottom: 5px; }
          .total-item span { font-size: 18px; font-weight: 700; color: #000; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-info">
            <h1>HYPER INKER STUDIO</h1>
            <p>8045 Callaghan Rd, San Antonio, TX 78230</p>
            <p><strong>Pay Date:</strong> ${dayjs().format("MMM DD, YYYY")}</p>
          </div>
          <div class="summary-box"><small>Gross Payout</small><span>$${netPay.toFixed(2)}</span></div>
        </div>

        <div class="grey-bar">
          <div>Employee</div><div>Rate</div><div>Status</div><div>Pay Period</div>
        </div>
        <div class="info-row">
          <div><strong>${artistName}</strong></div>
          <div>$${hourlyRate.toFixed(2)}/hr + ${commPercent}% Comm</div>
          <div>Active</div>
          <div>${periodStr}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Hours</th>
              <th>Jewelry</th>
              <th>Saline</th>
              <th>Service</th>
              <th>Tips</th> 
              <th style="text-align:right">Daily Gross</th>
            </tr>
          </thead>
          <tbody>
            ${dailyLogs
              .map((d) => {
                const dLabor = d.hrs * hourlyRate;
                const dComm =
                  (d.jewelry + d.saline + d.servicePrice) * commRate;
                const dTotal = dLabor + dComm + d.tips;
                return `
              <tr>
                <td>${d.date}</td>
                <td>${d.hrs}h ($${dLabor.toFixed(2)})</td>
                <td>$${d.jewelry.toFixed(2)}</td>
                <td>$${d.saline.toFixed(2)}</td>
                <td>$${d.servicePrice.toFixed(2)}</td>
                <td style="color: #2e7d32;">$${d.tips.toFixed(2)}</td> 
                <td class="bold-total">$${dTotal.toFixed(2)}</td>
              </tr>`;
              })
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <td style="text-align:right;">TOTALS:</td>
              <td>$${laborPay.toFixed(2)}</td>
              <td>$${jewelryComm.toFixed(2)}</td>
              <td>$${salineComm.toFixed(2)}</td>
              <td>$${serviceComm.toFixed(2)}</td>
              <td>$${totalTips.toFixed(2)}</td> 
              <td class="bold-total">$${netPay.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <div class="footer-totals">
          <div class="total-item">
            <small>Total Work Days</small>
            <span>${totalWorkDays} Days</span>
          </div>
          <div class="total-item"><small>Tips (100%)</small><span>$${totalTips.toFixed(2)}</span></div>
          <div class="total-item"><small>Commissions</small><span>$${totalCommission.toFixed(2)}</span></div>
          <div class="total-item"><small>Gross Payout</small><span>$${netPay.toFixed(2)}</span></div>
        </div>
      </body>
    </html>`;

    // 4. Puppeteer Rendering & Upload
    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
    await page.setContent(htmlContent);
    const imageBuffer = await page.screenshot({ type: "png", fullPage: true });
    await browser.close();

    const upload = await imageKit.upload({
      file: Buffer.from(imageBuffer),
      fileName: `zoe_paystub_${dayjs().format("YYYYMMDD")}.png`,
      folder: "/zoe-paystubs",
    });
    // 7. Store in Prisma
    await prisma.paystub.create({
      data: {
        userId: String(req.query.userId),
        imageUrl: upload.url,
        name: artistName,
        cash: 0,
        card: 0,
        total: 0,
        startDate: fromDate,
        endDate: toDate,
        grossAmount: netPay,
      },
    });
    return res.json({
      success: true,
      imageUrl: upload.url,
      netPay: netPay.toFixed(2),
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};
export const generateZoePaystubData = async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.body;

    // 1. Zoe's Specific Configuration
    const artistName = "Zoe";
    const hourlyRate = 12.5;
    const commRate = 0.1; // 10%

    const fromDate = dayjs(start_date).toDate();
    const toDate = dayjs(end_date).toDate();

    const dailyLogs: any[] = [];
    let cursor = new Date(fromDate);

    // 2. Main Processing Loop (Matches your original logic)
    while (cursor <= toDate) {
      const formatted = dayjs(cursor).format("MMDDYYYY");
      let dayServiceTotal = 0,
        dayJewelry = 0,
        daySaline = 0,
        dayTips = 0,
        dayHours = 0;

      try {
        const [salesRes, promoRes] = await Promise.all([
          axios.post("https://hyperinkersform.com/api/fetching", {
            endDate: formatted,
          }),
          axios.post("https://hyperinkersform.com/api/fetching/promotion", {
            endDate: formatted,
          }),
        ]);

        const items = salesRes.data?.data || [];
        const promoData = promoRes.data?.data || {};

        const artistItems = items.filter(
          (i: any) =>
            i.artist?.toLowerCase() === artistName.toLowerCase() &&
            ["paid", "done"].includes(i.status?.toLowerCase()),
        );

        if (artistItems.length > 0) {
          // --- Logic Check: Payment IDs for Clock Out ---
          const trackingIds = artistItems
            .map((i: any) => i.tracking_payment_id)
            .filter(Boolean);
          const payments = await prisma.trackingPayment.findMany({
            where: { id: { in: trackingIds } },
            select: { createdAt: true },
          });

          const sortedPayments = payments.sort(
            (a, b) =>
              dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf(),
          );

          // --- Logic Check: Service vs Jewelry vs Saline ---
          artistItems.forEach((i: any) => {
            const fullName = `${i?.firstName} ${i?.lastName}`;
            // Only add to service if name contains "*"
            if (fullName.includes("*"))
              dayServiceTotal += Number(i?.price) || 0;

            dayJewelry += Number(i?.priceJewelry) || 0;
            daySaline += Number(i?.priceSaline) || 0;
            dayTips += Number(i?.tip) || 0;
          });

          // --- Logic Check: Clock In / Out ---
          const clockInStr =
            promoData["Zoe"]?.fullTimestamp || promoData["Zoe"];
          const lastPayment = sortedPayments[sortedPayments.length - 1];
          const clockOutTime = lastPayment?.createdAt;

          if (clockInStr && clockOutTime) {
            const diffMinutes = dayjs(clockOutTime).diff(
              dayjs(clockInStr),
              "minute",
            );
            dayHours =
              diffMinutes > 0 ? Number((diffMinutes / 60).toFixed(2)) : 0.5;
          }
        }
        await delay(300);
      } catch (err) {
        console.error(`Fetch failed for ${formatted}:`, err);
      }

      // Daily Sub-calculations for the UI
      const dLabor = dayHours * hourlyRate;
      const dComm = (dayJewelry + daySaline + dayServiceTotal) * commRate;

      dailyLogs.push({
        date: dayjs(cursor).format("MMM DD, YYYY"),
        hrs: dayHours,
        labor: dLabor,
        jewelry: dayJewelry,
        saline: daySaline,
        servicePrice: dayServiceTotal,
        tips: dayTips,
        commission: dComm,
        subtotal: dLabor + dComm + dayTips,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    // 3. Final Aggregations
    const totalHours = dailyLogs.reduce((acc, d) => acc + d.hrs, 0);
    const laborPay = totalHours * hourlyRate;
    const totalJ = dailyLogs.reduce((acc, d) => acc + d.jewelry, 0);
    const totalS = dailyLogs.reduce((acc, d) => acc + d.saline, 0);
    const totalService = dailyLogs.reduce((acc, d) => acc + d.servicePrice, 0);
    const totalTips = dailyLogs.reduce((acc, d) => acc + d.tips, 0);

    const totalCommission = (totalJ + totalS + totalService) * commRate;
    const netPay = laborPay + totalCommission + totalTips;
    const totalWorkDays = dailyLogs.filter((d) => d.subtotal > 0).length;

    // 4. Return structured JSON for Expo
    return res.json({
      success: true,
      artist: { name: artistName, hourlyRate, commRate },
      period: {
        formatted: `${dayjs(fromDate).format("MMM DD")} - ${dayjs(toDate).format("MMM DD, YYYY")}`,
      },
      stats: {
        totalHours: totalHours.toFixed(2),
        laborPay,
        totalCommission,
        totalTips,
        netPay,
        totalWorkDays,
      },
      dailyLogs: dailyLogs.filter((d) => d.subtotal > 0),
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};
export const sendArtistPaystub = async (req: Request, res: Response) => {
  try {
    const artistName = (req.query.artist_name as string) || "Zoe";
    const isHourlyPaid = String(req.query.is_hourly_paid) === "true";
    const hourlyRate = parseFloat(req.query.hourly_rate as string) || 35.0;
    const targetEmail = (req.query.email as string) || "canhducc@gmail.com";
    const commRate = 0.5;
    const commPercent = commRate * 100;

    const now = new Date();
    const dayOfWeek = now.getDay();
    const toDate = new Date(now);
    toDate.setDate(now.getDate() - dayOfWeek - 1);
    const fromDate = new Date(toDate);
    fromDate.setDate(toDate.getDate() - 13);

    const periodStr = `${dayjs(fromDate).format("MMM DD, YYYY")} - ${dayjs(toDate).format("MMM DD, YYYY")}`;

    const dailyLogs: any[] = [];
    let cursor = new Date(fromDate);

    while (cursor <= toDate) {
      const formatted = dayjs(cursor).format("MMDDYYYY");
      let dayPiercingTotal = 0;
      let dayServiceTotal = 0;
      let dayJewelry = 0;
      let daySaline = 0;
      let dayTips = 0; // Added tips variable
      let dayHours = 0;
      let dayCash = 0;
      let dayCard = 0;
      try {
        const response = await axios.post(
          "https://hyperinkersform.com/api/fetching",
          { endDate: formatted },
        );
        const items = response.data?.data || [];

        const artistItems = items.filter(
          (i: any) =>
            i.artist?.toLowerCase() === artistName.toLowerCase() &&
            (i.status?.toLowerCase() === "paid" ||
              i.status?.toLowerCase() === "done") &&
            (i.color ?? "piercing") === "piercing",
        );

        if (artistItems.length > 0) {
          artistItems.forEach((i: any) => {
            const fullName = `${i?.firstName} ${i?.lastName}`;
            const price = i?.price || 0;
            let recordCash = i?.cash ?? 0;
            const recordCard = i?.card ?? 0;

            if (typeof fullName === "string" && fullName.includes("*")) {
              dayServiceTotal += price;
            } else {
              dayPiercingTotal += price;
            }
            const pJewelry = i?.priceJewelry || 0;
            const pSaline = i?.priceSaline || 0;
            dayJewelry += pJewelry;
            daySaline += pSaline;
            dayTips += i?.tip || 0;
            if (recordCash + recordCard === 0) {
              recordCash += pJewelry + pSaline + price;
            }
            if (i?.paid_by?.includes("card")) {
              dayCard += recordCard;
            }
            if (recordCash + recordCard > price + pJewelry + pSaline) {
              // Destructure parentSignature out, and collect the rest into 'logData'
              const { signature, parentSignature, ...logData } = i;
              console.warn("Mismatch detected for record:", logData);
            } else {
              dayCash += recordCash;
            }
          });

          const timestamps = artistItems
            .map((i: any) => dayjs(i.signedDate).valueOf())
            .filter((t: number) => !isNaN(t));
          if (timestamps.length > 1) {
            dayHours = Number(
              (
                dayjs(Math.max(...timestamps)).diff(
                  dayjs(Math.min(...timestamps)),
                  "minute",
                ) / 60
              ).toFixed(2),
            );
          } else if (timestamps.length === 1) {
            dayHours = 0.5;
          }
        }
      } catch (err) {
        console.error(`Fetch failed for ${formatted}: ${err}`);
      }

      dailyLogs.push({
        date: dayjs(cursor).format("MMM DD, YYYY"),
        hrs: dayHours,
        jewelry: dayJewelry,
        saline: daySaline,
        piercingPrice: dayPiercingTotal,
        servicePrice: dayServiceTotal,
        tips: dayTips,
        cash: dayCash,
        card: dayCard,
        totalSales: dayCash + dayCard,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    // 4. Aggregate Totals
    const totalCash = dailyLogs.reduce((acc, d) => acc + d.cash, 0);
    const totalCard = dailyLogs.reduce((acc, d) => acc + d.card, 0);
    const totalSalesVolume = totalCash + totalCard; // Sum of all cash + card transactions
    const totalHours = dailyLogs.reduce((acc, d) => acc + d.hrs, 0);
    const totalJ = dailyLogs.reduce((acc, d) => acc + d.jewelry, 0);
    const totalS = dailyLogs.reduce((acc, d) => acc + d.saline, 0);
    const totalPiercing = dailyLogs.reduce(
      (acc, d) => acc + d.piercingPrice,
      0,
    );
    const totalService = dailyLogs.reduce((acc, d) => acc + d.servicePrice, 0);
    const totalTips = dailyLogs.reduce((acc, d) => acc + d.tips, 0); // Total tips (100% to artist)

    const laborPay = isHourlyPaid ? totalHours * hourlyRate : 0;
    const piercingComm = isHourlyPaid ? 0 : totalPiercing * commRate;
    const serviceComm = totalService * commRate;
    const jewelryComm = totalJ * commRate;
    const salineComm = totalS * commRate;

    const netPay =
      laborPay +
      piercingComm +
      serviceComm +
      jewelryComm +
      salineComm +
      totalTips;
    const totalWorkDays = dailyLogs.filter(
      (d) =>
        d.hrs > 0 ||
        d.piercingPrice > 0 ||
        d.servicePrice > 0 ||
        d.jewelry > 0 ||
        d.saline > 0 ||
        d.tips > 0,
    ).length;
    // 5. Build HTML Content (Added Tips Columns)
    const htmlContent = `
    <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          body { font-family: 'Inter', sans-serif; color: #1a1a1a; margin: 0; padding: 40px; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; }
          .company-info h1 { margin: 0; font-size: 22px; font-weight: 800; color: #000; letter-spacing: -0.5px; }
          .company-info p { margin: 4px 0; font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
          .summary-box { text-align: center; }
          .summary-box small { display: block; font-weight: 700; color: #aaa; font-size: 9px; margin-bottom: 4px; text-transform: uppercase; }
          .summary-box span { font-size: 22px; font-weight: 700; color: #000; }
          .grey-bar { background: #333; color: white; padding: 10px 15px; font-size: 9px; font-weight: 700; text-transform: uppercase; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; margin-top: 30px; border-radius: 4px 4px 0 0; }
          .info-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; padding: 15px; border: 1px solid #eee; border-top: none; font-size: 12px; margin-bottom: 30px; border-radius: 0 0 4px 4px; }
          table { width: 100%; border-collapse: collapse; border: 1px solid #eee; }
          th { background: #f8f9fa; font-size: 9px; padding: 12px 8px; text-align: left; border-bottom: 1px solid #eee; color: #888; text-transform: uppercase; }
          td { padding: 10px 8px; font-size: 11px; border-bottom: 1px solid #f4f4f4; color: #444; }
          .bold-total { font-weight: 700; color: #000; text-align: right; }
          .footer-totals { display: flex; justify-content: flex-end; padding: 25px; background: #fcfcfc; border: 1px solid #eee; border-top: none; border-radius: 0 0 4px 4px; }
          .total-item { margin-left: 60px; text-align: center; }
          .total-item small { display: block; font-weight: 700; color: #aaa; font-size: 9px; text-transform: uppercase; margin-bottom: 5px; }
          .total-item span { font-size: 18px; font-weight: 700; color: #000; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-info">
            <h1>HYPER INKER STUDIO</h1>
            <p>8045 Callaghan Rd, San Antonio, TX 78230</p>
            <p><strong>Pay Date:</strong> ${dayjs().format("MMM DD, YYYY")}</p>
          </div>
          <div class="summary-box"><small>Gross Payout</small><span>$${netPay.toFixed(2)}</span></div>
        </div>

        <div class="grey-bar">
          <div>Employee</div><div>Rate</div><div>Status</div><div>Pay Period</div>
        </div>
        <div class="info-row">
          <div><strong>${artistName}</strong></div>
          <div>${isHourlyPaid ? `$${hourlyRate}/hr` : `${commPercent}% Comm`}</div>
          <div>Active</div>
          <div>${periodStr}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              ${isHourlyPaid ? `<th>Hours</th>` : ""}
              <th>Jewelry</th>
              <th>Saline</th>
              <th>Piercing</th>
              <th>Service</th>
              <th>Tips</th> <th style="text-align:right">Daily Gross</th>
            </tr>
          </thead>
          <tbody>
            ${dailyLogs
              .map((d) => {
                const dLabor = isHourlyPaid ? d.hrs * hourlyRate : 0;
                const dTotal =
                  dLabor +
                  (d.jewelry +
                    d.saline +
                    d.servicePrice +
                    (isHourlyPaid ? 0 : d.piercingPrice)) *
                    commRate +
                  d.tips;
                return `
                <tr>
                  <td>${d.date}</td>
                  ${isHourlyPaid ? `<td>${d.hrs}h</td>` : ""}
                  <td>$${d.jewelry.toFixed(2)}</td>
                  <td>$${d.saline.toFixed(2)}</td>
                  <td>$${d.piercingPrice.toFixed(2)}</td>
                  <td>$${d.servicePrice.toFixed(2)}</td>
                  <td style="color: #2e7d32;">$${d.tips.toFixed(2)}</td> <td class="bold-total">$${dTotal.toFixed(2)}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <td style="text-align:right;">TOTALS:</td>
              ${isHourlyPaid ? `<td>$${laborPay.toFixed(2)}</td>` : ""}
              <td>$${jewelryComm.toFixed(2)}</td>
              <td>$${salineComm.toFixed(2)}</td>
              <td>$${piercingComm.toFixed(2)}</td>
              <td>$${serviceComm.toFixed(2)}</td>
              <td>$${totalTips.toFixed(2)}</td> <td class="bold-total">$${netPay.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <div class="footer-totals">
          <div class="total-item">
            <small>Total Work Days</small>
            <span>${totalWorkDays} Days</span>
          </div>
          <div class="total-item"><small>Tips (100%)</small><span>$${totalTips.toFixed(2)}</span></div>
          <div class="total-item"><small>Commissions</small><span>$${(piercingComm + serviceComm + jewelryComm + salineComm).toFixed(2)}</span></div>
          <div class="total-item"><small>Gross Payout</small><span>$${netPay.toFixed(2)}</span></div>
        </div>
      </body>
    </html>`;

    // 6. Image Generation & Upload to ImageKit
    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
    await page.setContent(htmlContent);
    const imageBuffer = await page.screenshot({ type: "png", fullPage: true });
    await browser.close();

    const upload = await imageKit.upload({
      file: Buffer.from(imageBuffer),
      fileName: `paystub_${artistName}_${dayjs().format("YYYYMMDD")}.png`,
      folder: "/artist-paystubs",
    });

    // 7. Store in Prisma
    await prisma.paystub.create({
      data: {
        userId: String(req.query.userId),
        imageUrl: upload.url,
        name: artistName,
        cash: totalCash,
        card: totalCard,
        total: totalSalesVolume,
        startDate: fromDate,
        endDate: toDate,
        grossAmount: netPay,
      },
    });

    // 8. Email with Link & Attachment
    const mg = new Mailgun(FormData).client({
      username: "api",
      key: process.env.MAILGUN_API_KEY!,
    });
    // await mg.messages.create(process.env.MAILGUN_DOMAIN!, {
    //   from: process.env.MAILGUN_FROM!,
    //   to: targetEmail,
    //   subject: `Earnings: ${artistName} (${periodStr})`,
    //   html: `<p>Your statement is ready: <a href="${upload.url}">View Online</a></p>`,
    //   attachment: [
    //     {
    //       filename: `${artistName}_Paystub.png`,
    //       data: Buffer.from(imageBuffer),
    //     },
    //   ],
    // });

    return res.json({
      success: true,
      imageUrl: upload.url,
      name: artistName,
      cash: totalCash,
      card: totalCard,
      total: totalSalesVolume,
      startDate: fromDate,
      endDate: toDate,
      grossAmount: netPay,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};

export const generateYenPaystubData = async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.body;

    // Yen's Configuration (Defaults based on your logic)
    const artistName = "Yen";
    const isHourlyPaid = false; // Set to true if Yen is hourly
    const hourlyRate = 35.0;
    const commRate = 0.5; // 50% commission
    const commPercent = commRate * 100;

    const fromDate = dayjs(start_date).toDate();
    const toDate = dayjs(end_date).toDate();

    const dailyLogs: any[] = [];
    let cursor = new Date(fromDate);

    // 1. Data Fetching & Calculation Loop
    while (cursor <= toDate) {
      const formatted = dayjs(cursor).format("MMDDYYYY");
      let dayPiercingTotal = 0,
        dayServiceTotal = 0,
        dayJewelry = 0;
      let daySaline = 0,
        dayTips = 0,
        dayHours = 0;
      let dayCash = 0,
        dayCard = 0;

      try {
        const response = await axios.post(
          "https://hyperinkersform.com/api/fetching",
          { endDate: formatted },
        );
        const items = response.data?.data || [];

        // Filter for Yen + Status + Piercing category
        const artistItems = items.filter(
          (i: any) =>
            i.artist?.toLowerCase() === artistName.toLowerCase() &&
            ["paid", "done"].includes(i.status?.toLowerCase()) &&
            (i.color ?? "piercing") === "piercing",
        );

        if (artistItems.length > 0) {
          artistItems.forEach((i: any) => {
            const fullName = `${i?.firstName} ${i?.lastName}`;
            const price = Number(i?.price) || 0;
            let recordCash = Number(i?.cash) || 0;
            const recordCard = Number(i?.card) || 0;
            const pJewelry = Number(i?.priceJewelry) || 0;
            const pSaline = Number(i?.priceSaline) || 0;

            // Logic: Asterisk separates "Service" from "Piercing"
            if (fullName.includes("*")) {
              dayServiceTotal += price;
            } else {
              dayPiercingTotal += price;
            }

            dayJewelry += pJewelry;
            daySaline += pSaline;
            dayTips += Number(i?.tip) || 0;

            // Handle zero-record edge case from your logic
            if (recordCash + recordCard === 0) {
              recordCash = pJewelry + pSaline + price;
            }

            if (i?.paid_by?.includes("card")) {
              dayCard += recordCard;
            }
            dayCash += recordCash;
          });

          // Hour Calculation based on signedDate timestamps
          const timestamps = artistItems
            .map((i: any) => dayjs(i.signedDate).valueOf())
            .filter((t: number) => !isNaN(t));

          if (timestamps.length > 1) {
            const diff = dayjs(Math.max(...timestamps)).diff(
              dayjs(Math.min(...timestamps)),
              "minute",
            );
            dayHours = Number((diff / 60).toFixed(2));
          } else if (timestamps.length === 1) {
            dayHours = 0.5;
          }
        }
      } catch (err) {
        console.error(`Fetch failed for ${formatted}:`, err);
      }

      // Daily breakdown math
      const dLabor = isHourlyPaid ? dayHours * hourlyRate : 0;
      const dPiercingComm = isHourlyPaid ? 0 : dayPiercingTotal * commRate;
      const dServiceComm = dayServiceTotal * commRate;
      const dJewelryComm = dayJewelry * commRate;
      const dSalineComm = daySaline * commRate;

      const dayNet =
        dLabor +
        dPiercingComm +
        dServiceComm +
        dJewelryComm +
        dSalineComm +
        dayTips;

      dailyLogs.push({
        date: dayjs(cursor).format("MMM DD, YYYY"),
        hrs: dayHours,
        piercing: dayPiercingTotal,
        service: dayServiceTotal,
        jewelry: dayJewelry,
        saline: daySaline,
        tips: dayTips,
        cash: dayCash,
        card: dayCard,
        subtotal: dayNet,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    // 2. Final Aggregations
    const totalHours = dailyLogs.reduce((acc, d) => acc + d.hrs, 0);
    const totalPiercing = dailyLogs.reduce((acc, d) => acc + d.piercing, 0);
    const totalService = dailyLogs.reduce((acc, d) => acc + d.service, 0);
    const totalJ = dailyLogs.reduce((acc, d) => acc + d.jewelry, 0);
    const totalS = dailyLogs.reduce((acc, d) => acc + d.saline, 0);
    const totalTips = dailyLogs.reduce((acc, d) => acc + d.tips, 0);
    const totalCash = dailyLogs.reduce((acc, d) => acc + d.cash, 0);
    const laborPay = isHourlyPaid ? totalHours * hourlyRate : 0;
    const piercingComm = isHourlyPaid ? 0 : totalPiercing * commRate;
    const totalCommission =
      (totalService + totalJ + totalS) * commRate + piercingComm;
    const netPay = laborPay + totalCommission + totalTips;

    // 3. Structured JSON Response for Expo
    return res.json({
      success: true,
      artist: { name: artistName, hourlyRate, commRate, isHourlyPaid },
      period: {
        formatted: `${dayjs(start_date).format("MMM DD")} - ${dayjs(end_date).format("MMM DD, YYYY")}`,
      },
      stats: {
        totalHours: totalHours.toFixed(2),
        totalCommission,
        totalTips,
        netPay,
        totalWorkDays: dailyLogs.filter((d) => d.subtotal > 0).length,
        totalCash: totalCash,
      },
      dailyLogs: dailyLogs.filter((d) => d.subtotal > 0),
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};
export const sendAllArtistPaystubs = async (req: Request, res: Response) => {
  try {
    const arrayArtistNeedToHavePaystub = [
      { name: "Damian", commission: 0.55 },
      { name: "Pablo", commission: 0.55 },
      { name: "Navei", commission: 0.55 },
      { name: "Jackie", commission: 0.55 },
      { name: "Tai", commission: 0.55 },
    ];

    // 1. Get IDs of appointments booked by the specific receptionists
    const bookedAppointments = await prisma.appointment.findMany({
      where: {
        assignedById: {
          in: [
            "6a0c3e58-d4e4-4f32-8585-9fbb81b08417",
            "bab24c5b-ec93-4386-bdfb-7b0e1f25eb7f",
          ],
        },
      },
      select: { id: true, customerName: true },
    });
    const bookedIds = bookedAppointments.map((a) => a.id);

    const now = new Date();
    const formatDate = (date: Date) => dayjs(date).format("MMM DD, YYYY");

    // Date Range Logic
    const dayOfWeek = now.getDay();
    const toDate = new Date(now);
    toDate.setDate(now.getDate() - dayOfWeek - 1);
    const fromDate = new Date(toDate);
    fromDate.setDate(toDate.getDate() - 13);
    const periodStr = `${formatDate(fromDate)} - ${formatDate(toDate)}`;

    // --- STEP 1: FETCH DATA ONCE ---
    const apiDataCache = new Map<string, any[]>();
    let fetchCursor = new Date(fromDate);
    while (fetchCursor <= toDate) {
      const formatted = dayjs(fetchCursor).format("MMDDYYYY");
      try {
        const response = await axios.post(
          "https://hyperinkersform.com/api/fetching",
          { endDate: formatted },
        );
        apiDataCache.set(formatted, response.data?.data || []);
      } catch (err) {
        apiDataCache.set(formatted, []);
      }
      fetchCursor.setDate(fetchCursor.getDate() + 1);
    }

    const processedArtists = [];

    // --- STEP 2: LOOP THROUGH ARTISTS ---
    for (const artistObj of arrayArtistNeedToHavePaystub) {
      const artistName = artistObj.name;
      const commRate = artistObj.commission;

      const user = await prisma.user.findFirst({ where: { name: artistName } });
      const dailyLogs: any[] = [];
      const bookingFeeDetails: any[] = []; // Track 0.5% fee items here

      let logCursor = new Date(fromDate);

      while (logCursor <= toDate) {
        const dateKey = dayjs(logCursor).format("MMDDYYYY");
        const items = apiDataCache.get(dateKey) || [];

        const artistItems = items.filter(
          (i) =>
            i.artist?.toLowerCase() === artistName.toLowerCase() &&
            (i.status?.toLowerCase() === "paid" ||
              i.status?.toLowerCase() === "done"),
        );

        let dayPaidMoney = 0;
        let dayDeposit = 0;
        let dayTips = 0;

        artistItems.forEach((i: any) => {
          const volume =
            (parseFloat(i?.paid_money) || 0) +
            (i?.deposit_has_been_used !== false
              ? parseFloat(i?.deposit) || 0
              : 0);

          dayPaidMoney += parseFloat(i?.paid_money) || 0;
          dayDeposit +=
            i?.deposit_has_been_used === false
              ? 0
              : parseFloat(i?.deposit) || 0;
          dayTips += parseFloat(i?.tip) || 0;

          // ✨ NEW: Check if this was a booked appointment
          if (bookedIds.includes(i.appointment_id)) {
            bookingFeeDetails.push({
              date: formatDate(logCursor),
              customer: i?.firstName + " " + i?.lastName,
              volume: volume,
              fee: volume * 0.005, // 0.5%
            });
          }
        });

        const dailyComm = (dayPaidMoney + dayDeposit) * commRate;
        dailyLogs.push({
          date: formatDate(logCursor),
          paidMoney: dayPaidMoney,
          deposit: dayDeposit,
          commission: dailyComm,
          tips: dayTips,
          subtotal: dailyComm + dayTips,
        });
        logCursor.setDate(logCursor.getDate() + 1);
      }

      const totalVolume = dailyLogs.reduce(
        (acc, d) => acc + d.paidMoney + d.deposit,
        0,
      );
      const totalTips = dailyLogs.reduce((acc, d) => acc + d.tips, 0);
      const totalCommission = totalVolume * commRate;
      const totalBookingFees = bookingFeeDetails.reduce(
        (acc, f) => acc + f.fee,
        0,
      );
      const netPay = totalCommission + totalTips - totalBookingFees;
      // Your original HTML (Variables mapped to the current artist in the loop)
      const htmlContent = `
<html>
  <head>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      
      body { 
        font-family: 'Inter', sans-serif; 
        color: #1a1a1a; 
        margin: 0; 
        padding: 40px; 
        background: #f4f4f4; 
      }

      .container { 
        max-width: 900px; 
        margin: auto; 
        background: #fff; 
        padding: 50px; 
        border: 1px solid #ddd;
        box-shadow: 0 4px 10px rgba(0,0,0,0.05);
      }
      
      /* Header Section */
      .header { 
        display: flex; 
        justify-content: space-between; 
        align-items: flex-start; 
        border-bottom: 4px solid #000; 
        padding-bottom: 20px; 
      }
      
      .company-info h1 { 
        margin: 0; 
        font-size: 24px; 
        font-weight: 800; 
        letter-spacing: -1px; 
      }
      
      .company-info p { 
        margin: 3px 0; 
        font-size: 11px; 
        color: #555; 
        text-transform: uppercase; 
        letter-spacing: 0.5px;
      }
      
      /* Meta Information Strip */
      .meta-strip { 
        display: grid; 
        grid-template-columns: repeat(3, 1fr); 
        gap: 20px; 
        margin: 30px 0; 
        padding: 15px; 
        background: #f9f9f9; 
        border: 1px solid #eee;
        border-radius: 4px;
      }
      
      .meta-item small { 
        display: block; 
        font-size: 9px; 
        color: #888; 
        text-transform: uppercase; 
        font-weight: 700; 
        margin-bottom: 4px; 
      }
      
      .meta-item span { 
        font-size: 14px; 
        font-weight: 700; 
        color: #1a1a1a;
      }
      
      .comm-highlight { 
        color: #2e7d32 !important; 
      }

      /* Tables */
      table { 
        width: 100%; 
        border-collapse: collapse; 
        margin-top: 10px;
      }
      
      th { 
        text-align: left; 
        font-size: 10px; 
        color: #888; 
        text-transform: uppercase; 
        padding: 12px 10px; 
        border-bottom: 2px solid #eee; 
        letter-spacing: 0.5px;
      }
      
      td { 
        padding: 12px 10px; 
        font-size: 12px; 
        border-bottom: 1px solid #f2f2f2; 
        color: #333;
      }

      .num { 
        font-variant-numeric: tabular-nums;
        font-weight: 500; 
      }

      /* Booking Fee Specific Table */
      .booking-fee-table { 
        margin-top: 10px; 
        border: 1px solid #fee2e2; 
      }
      
      .booking-fee-table th { 
        background: #fef2f2; 
        color: #991b1b; 
        border-bottom: 1px solid #fee2e2;
      }

      .fee-text { 
        color: #dc2626; 
        font-weight: 600; 
      }
      
      /* Footer Section (Right Aligned) */
      .footer { 
        margin-top: 50px; 
        display: flex; 
        justify-content: flex-end; 
      }

      .footer-table { 
        width: 350px; 
      }

      .footer-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
      }

      .vol-label { font-size: 12px; color: #666; font-weight: 500; }
      .vol-val { font-size: 13px; color: #1a1a1a; font-weight: 600; }

      .fee-row {
        border-top: 1px solid #eee;
        margin-top: 4px;
        padding-top: 4px;
      }

      .fee-label { 
        font-size: 11px; 
        color: #999; 
        font-weight: 500;
        text-transform: uppercase;
      }

      .fee-val { 
        font-size: 13px; 
        color: #999; 
        font-weight: 500; 
      }

      .total-row { 
        margin-top: 15px; 
        padding: 15px 10px; 
        background: #1a1a1a;
        color: #fff;
        border-radius: 4px;
      }
      
      .total-label { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
      .total-val { font-size: 28px; font-weight: 800; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="company-info">
          <h1>HYPER INKER STUDIO</h1>
          <p>8045 Callaghan Rd, San Antonio, TX 78230</p>
          <p><strong>Pay Date:</strong> ${formatDate(now)}</p>
        </div>
      </div>

      <div class="meta-strip">
        <div class="meta-item">
          <small>Artist Name</small>
          <span>${artistName}</span>
        </div>
        <div class="meta-item">
          <small>Period</small>
          <span>${periodStr}</span>
        </div>
        <div class="meta-item">
          <small>Commission Structure</small>
          <span class="comm-highlight">${(commRate * 100).toFixed(0)}%</span>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Service Date</th>
            <th>Tattoo Sale</th>
            <th>(Deposit)</th>
            <th>Commission</th>
            <th>Tips</th>
            <th style="text-align:right">Daily Net</th>
          </tr>
        </thead>
        <tbody>
          ${dailyLogs
            .map(
              (d) => `
            <tr>
              <td>${d.date}</td>
              <td class="num">$${d.paidMoney.toFixed(2)}</td>
              <td class="num">$${d.deposit.toFixed(2)}</td>
              <td class="num" style="color:#2e7d32; font-weight:600;">$${d.commission.toFixed(2)}</td>
              <td class="num">$${d.tips.toFixed(2)}</td>
              <td class="num" style="text-align:right; font-weight:700;">$${d.subtotal.toFixed(2)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>

      ${
        bookingFeeDetails.length > 0
          ? `
        <h3 style="margin-top:40px; font-size:14px; color:#991b1b;">BOOKING FEE DEDUCTIONS (0.5%)</h3>
        <table class="booking-fee-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Customer</th>
              <th>Price</th>
              <th style="text-align:right">Fee (0.5%)</th>
            </tr>
          </thead>
          <tbody>
            ${bookingFeeDetails
              .map(
                (f) => `
              <tr>
                <td>${f.date}</td>
                <td>${f.customer}</td>
                <td>$${f.volume.toFixed(2)}</td>
                <td style="text-align:right" class="fee-text">-$${f.fee.toFixed(2)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      `
          : ""
      }

      <div class="footer">
        <div class="footer-table">
          <div class="footer-row">
            <span class="vol-label">Total Tips (100% Artist):</span>
            <span class="vol-val">$${totalTips.toFixed(2)}</span>
          </div>
          
          <div class="footer-row">
            <span class="vol-label">Gross Commission:</span>
            <span class="vol-val">$${totalCommission.toFixed(2)}</span>
          </div>

          <div class="footer-row fee-row">
            <span class="fee-label">Booking Fee (0.5%):</span>
            <span class="fee-val">-$${totalBookingFees.toFixed(2)}</span>
          </div>

          <div class="footer-row total-row">
            <span class="total-label">Total Payout</span>
            <span class="total-val">$${netPay.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

      // --- STEP 3: PUPPETEER & UPLOAD ---
      const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
      const page = await browser.newPage();
      await page.setViewport({
        width: 1000,
        height: 1200,
        deviceScaleFactor: 2,
      });
      await page.setContent(htmlContent);
      const imageBuffer = await page.screenshot({
        type: "png",
        fullPage: true,
      });
      await browser.close();

      const upload = await imageKit.upload({
        file: Buffer.from(imageBuffer),
        fileName: `paystub_${artistName.toLowerCase()}_${dayjs().format("YYYYMMDD")}.png`,
        folder: "/artist-paystubs",
      });

      // Send Email
      if (user?.email) {
        const mg = new Mailgun(FormData).client({
          username: "api",
          key: process.env.MAILGUN_API_KEY!,
        });
        await mg.messages.create(process.env.MAILGUN_DOMAIN!, {
          from: process.env.MAILGUN_FROM!,
          to: user.email,
          subject: `Earnings: ${artistName} (${periodStr})`,
          html: `<p>Your statement is ready: <a href="${upload.url}">View Online</a></p>`,
          attachment: [
            {
              filename: `${artistName}_Paystub.png`,
              data: Buffer.from(imageBuffer),
            },
          ],
        });
      }

      // Save to DB
      await prisma.paystub.create({
        data: {
          userId: user?.id ? String(user.id) : "",
          imageUrl: upload.url,
          name: artistName,
          cash: 0,
          card: 0,
          total: totalVolume,
          startDate: fromDate,
          endDate: toDate,
          grossAmount: netPay,
        },
      });

      processedArtists.push({ name: artistName, url: upload.url });
    }

    return res.json({ success: true, processed: processedArtists });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};
export const sendPaystubArtistNicole = async (req: Request, res: Response) => {
  try {
    const targetEmail = (req.query.email as string) || "nicole@example.com";
    const studioFeeAmount = 65.0;

    const now = new Date();
    // now.setDate(now.getDate() - 5);
    const dayOfWeek = now.getDay();
    const toDate = new Date(now);
    toDate.setDate(now.getDate() - dayOfWeek - 1);
    const fromDate = new Date(toDate);
    fromDate.setDate(toDate.getDate() - 13);

    const periodStr = `${dayjs(fromDate).format("MMM DD, YYYY")} - ${dayjs(toDate).format("MMM DD, YYYY")}`;
    const dailyLogs: any[] = [];
    let cursor = new Date(fromDate);

    while (cursor <= toDate) {
      const formatted = dayjs(cursor).format("MMDDYYYY");

      // Individual Columns Logic
      let jDirect = 0,
        jYen = 0,
        jZoe = 0;
      let sDirect = 0,
        sYen = 0,
        sZoe = 0;
      let piercing = 0,
        service = 0,
        tips = 0,
        studioFee = 0;
      let totalPiercingForFee = 0;
      let cash = 0,
        card = 0;

      try {
        const response = await axios.post(
          "https://hyperinkersform.com/api/fetching",
          { endDate: formatted },
        );
        const items = response.data?.data || [];

        const relevantItems = items.filter(
          (i: any) =>
            ["nicole", "yen", "zoe"].includes(i.artist?.toLowerCase()) &&
            (i.status?.toLowerCase() === "paid" ||
              i.status?.toLowerCase() === "done") &&
            (i.color ?? "piercing") === "piercing",
        );

        relevantItems.forEach((i: any) => {
          const artist = i.artist.toLowerCase();
          const isService = (i.firstName + i.lastName).includes("*");
          const p = parseFloat(i.price) || 0;
          const pJ = parseFloat(i.priceJewelry) || 0;
          const pS = parseFloat(i.priceSaline) || 0;
          const pT = parseFloat(i.tip) || 0;

          if (p > 0) totalPiercingForFee += p;

          if (artist === "nicole") {
            if (isService) service += p * 0.6;
            else piercing += p * 0.6;
            jDirect += pJ * 0.6;
            sDirect += pS * 1.0;
            tips += pT;
          } else if (artist === "yen") {
            jYen += pJ * 0.1;
            sYen += pS * 0.5;
          } else if (artist === "zoe") {
            jZoe += pJ * 0.5;
            sZoe += pS * 0.9;
          }

          let rCash = parseFloat(i.cash) || 0,
            rCard = parseFloat(i.card) || 0;
          if (rCash + rCard === 0) rCash = p + pJ + pS + pT;
          if (i.paid_by?.toLowerCase().includes("card")) card += rCard;
          cash += rCash;
        });

        if (totalPiercingForFee > 0) studioFee = studioFeeAmount;
      } catch (err) {
        console.error(err);
      }

      dailyLogs.push({
        date: dayjs(cursor).format("MMM DD"),
        jDirect,
        jYen,
        jZoe,
        sDirect,
        sYen,
        sZoe,
        piercing,
        service,
        tips,
        studioFee,
        cash,
        card,
        dailyNet:
          jDirect +
          jYen +
          jZoe +
          sDirect +
          sYen +
          sZoe +
          piercing +
          service +
          tips -
          studioFee,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const netPay = dailyLogs.reduce((acc, d) => acc + d.dailyNet, 0);
    const totalWorkDays = dailyLogs.filter(
      (d) => d.jDirect + d.sDirect + d.piercing + d.service > 0,
    ).length;

    // A Studio Open Day is any day where there was activity from anyone (Nicole, Yen, or Zoe)
    // We can check if any commission or fee was generated
    const totalOpenDays = dailyLogs.filter(
      (d) => d.sDirect + d.sYen + d.sZoe + d.piercing + d.service > 0,
    ).length;
    const htmlContent = `
    <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
          body { font-family: 'Inter', sans-serif; color: #1a1a1a; padding: 20px; background: #fff; width: 1200px; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; margin-bottom: 20px; }
          .summary-box span { font-size: 28px; font-weight: 700; color: #000; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th { background: #f8f9fa; font-size: 9px; padding: 10px 2px; text-align: center; color: #555; text-transform: uppercase; border: 1px solid #ddd; }
          td { padding: 8px 2px; font-size: 10px; border: 1px solid #eee; text-align: center; }
          .direct-cell { background: #ffffff; font-weight: 600; }
          .passive-cell { background: #fcfcfc; color: #666; font-style: italic; }
          .bold-total { font-weight: 700; background: #f4f4f4; }
          .net { color: #009e3d; }
          .fee { color: #c7c7c7; }
          .footer-totals { display: flex; justify-content: flex-end; margin-top: 20px; padding: 20px; background: #fcfcfc; border: 1px solid #eee; border-radius: 8px; }
          .total-item { margin-left: 40px; text-align: center; }
          .total-item small { display: block; font-size: 9px; font-weight: 700; color: #aaa; text-transform: uppercase; }
          .total-item span { font-size: 18px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="header">
          <div><h1 style="margin:0;">HYPER INKER STUDIO</h1><p>Artist: <strong>Nicole</strong> | Period: ${periodStr}</p></div>
          <div class="summary-box"><small>NET PAYOUT</small><br><span>$${netPay.toFixed(2)}</span></div>
        </div>

        <table>
          <thead>
            <tr>
              <th rowspan="2" style="width: 70px;">Date</th>
              <th colspan="3" style="background: #e3f2fd;">Jewelry Commission</th>
              <th colspan="3" style="background: #e8f5e9;">Saline Commission</th>
              <th rowspan="2">Piercing</th>
              <th rowspan="2">Service</th>
              <th rowspan="2">Studio Fee</th>
              <th rowspan="2">Tips</th>
              <th rowspan="2" class="bold-total">Daily Net</th>
            </tr>
            <tr>
              <th style="background: #e3f2fd;">Direct (60%)</th>
              <th style="background: #e3f2fd;">Yen (10%)</th>
              <th style="background: #e3f2fd;">Zoe (50%)</th>
              <th style="background: #e8f5e9;">Direct (100%)</th>
              <th style="background: #e8f5e9;">Yen (50%)</th>
              <th style="background: #e8f5e9;">Zoe (90%)</th>
            </tr>
          </thead>
          <tbody>
            ${dailyLogs
              .map(
                (d) => `
              <tr>
                <td style="font-weight:700;">${d.date}</td>
                <td class="direct-cell">$${d.jDirect.toFixed(2)}</td>
                <td class="passive-cell">$${d.jYen.toFixed(2)}</td>
                <td class="passive-cell">$${d.jZoe.toFixed(2)}</td>
                <td class="direct-cell">$${d.sDirect.toFixed(2)}</td>
                <td class="passive-cell">$${d.sYen.toFixed(2)}</td>
                <td class="passive-cell">$${d.sZoe.toFixed(2)}</td>
                <td>$${d.piercing.toFixed(2)}</td>
                <td>$${d.service.toFixed(2)}</td>
                <td class="fee">-$${d.studioFee.toFixed(2)}</td>
                <td style="color:green;">$${d.tips.toFixed(2)}</td>
                <td class="bold-total">$${d.dailyNet.toFixed(2)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>

        <div class="footer-totals">
          <div class="total-item">
            <small>Total Open</small>
              <span class="count-badge">${totalOpenDays} Days</span>
          </div>
          <div class="total-item">
            <small>Total Work Days</small>
            <span class="count-badge">${totalWorkDays} Days</span>
          </div>
          <div class="total-item"><small>Direct Earnings</small><span>$${dailyLogs.reduce((acc, d) => acc + d.jDirect + d.sDirect + d.piercing + d.service, 0).toFixed(2)}</span></div>
          <div class="total-item"><small>Passive (Yen/Zoe)</small><span>$${dailyLogs.reduce((acc, d) => acc + d.jYen + d.jZoe + d.sYen + d.sZoe, 0).toFixed(2)}</span></div>
          <div class="total-item"><small>Tips</small><span>$${dailyLogs.reduce((acc, d) => acc + d.tips, 0).toFixed(2)}</span></div>
          <div class="total-item"><small>Studio Fees</small><span class="fee">-$${dailyLogs.reduce((acc, d) => acc + d.studioFee, 0).toFixed(2)}</span></div>
          <div class="total-item"><small>Total Net</small><span class="net">$${netPay.toFixed(2)}</span></div>
        </div>
      </body>
    </html>`;

    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const imageBuffer = await page.screenshot({ type: "png", fullPage: true });
    await browser.close();

    const upload = await imageKit.upload({
      file: Buffer.from(imageBuffer),
      fileName: `Nicole_Paystub_${dayjs().format("YYYYMMDD")}.png`,
      folder: "/nicole-paystubs",
    });

    await prisma.paystub.create({
      data: {
        userId: "1faf65bc-ab45-4b02-9548-5d367532ffea",
        imageUrl: upload.url,
        name: "Nicole",
        cash: dailyLogs.reduce((acc, d) => acc + d.cash, 0),
        card: dailyLogs.reduce((acc, d) => acc + d.card, 0),
        total: dailyLogs.reduce((acc, d) => acc + d.cash + d.card, 0),
        startDate: fromDate,
        endDate: toDate,
        grossAmount: netPay,
      },
    });

    return res.json({ success: true, url: upload.url });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};
export const generateNicolePaystubData = async (
  req: Request,
  res: Response,
) => {
  try {
    const { start_date, end_date } = req.body;
    const artistName = "Nicole";
    const studioFeeAmount = 65.0;

    const fromDate = dayjs(start_date).toDate();
    const toDate = dayjs(end_date).toDate();

    const dailyLogs: any[] = [];
    let cursor = new Date(fromDate);

    while (cursor <= toDate) {
      const formatted = dayjs(cursor).format("MMDDYYYY");

      // Reset Daily Accumulators
      let jDirect = 0,
        jYen = 0,
        jZoe = 0;
      let sDirect = 0,
        sYen = 0,
        sZoe = 0;
      let piercing = 0,
        service = 0,
        tips = 0,
        studioFee = 0;
      let totalPiercingForFee = 0;
      let dayCash = 0,
        dayCard = 0;

      try {
        const response = await axios.post(
          "https://hyperinkersform.com/api/fetching",
          {
            endDate: formatted,
          },
        );
        const items = response.data?.data || [];

        const relevantItems = items.filter(
          (i: any) =>
            ["nicole", "yen", "zoe"].includes(i.artist?.toLowerCase()) &&
            ["paid", "done"].includes(i.status?.toLowerCase()) &&
            (i.color ?? "piercing") === "piercing",
        );

        relevantItems.forEach((i: any) => {
          const artist = i.artist.toLowerCase();
          const isService = `${i.firstName}${i.lastName}`.includes("*");
          const p = parseFloat(i.price) || 0;
          const pJ = parseFloat(i.priceJewelry) || 0;
          const pS = parseFloat(i.priceSaline) || 0;
          const pT = parseFloat(i.tip) || 0;

          if (p > 0) totalPiercingForFee += p;

          if (artist === "nicole") {
            if (isService)
              service += p * 0.6; // 60% Service
            else piercing += p * 0.6; // 60% Piercing
            jDirect += pJ * 0.6; // 60% Jewelry
            sDirect += pS * 1.0; // 100% Saline
            tips += pT; // 100% Tips
          } else if (artist === "yen") {
            jYen += pJ * 0.1; // 10% Yen's Jewelry
            sYen += pS * 0.5; // 50% Yen's Saline
          } else if (artist === "zoe") {
            jZoe += pJ * 0.5; // 50% Zoe's Jewelry
            sZoe += pS * 0.9; // 90% Zoe's Saline
          }

          // Cash/Card Tracking
          let rCash = parseFloat(i.cash) || 0;
          let rCard = parseFloat(i.card) || 0;
          if (rCash + rCard === 0) rCash = p + pJ + pS + pT;

          if (i.paid_by?.toLowerCase().includes("card")) dayCard += rCard;
          dayCash += rCash;
        });

        // Apply Studio Fee only if there was piercing activity
        if (totalPiercingForFee > 0) studioFee = studioFeeAmount;
      } catch (err) {
        console.error(`Fetch failed for ${formatted}`);
      }

      const daySubtotal =
        jDirect +
        jYen +
        jZoe +
        sDirect +
        sYen +
        sZoe +
        piercing +
        service +
        tips -
        studioFee;

      dailyLogs.push({
        date: dayjs(cursor).format("MMM DD, YYYY"),
        jDirect,
        jYen,
        jZoe,
        sDirect,
        sYen,
        sZoe,
        piercing,
        service,
        tips,
        studioFee,
        cash: dayCash,
        subtotal: daySubtotal,
        // Helper properties for the aggregations below
        direct: jDirect + sDirect + piercing + service,
        passive: jYen + jZoe + sYen + sZoe,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    const stats = {
      totalDirect: dailyLogs.reduce((acc, d) => acc + d.direct, 0),
      totalPassive: dailyLogs.reduce((acc, d) => acc + d.passive, 0),
      totalTips: dailyLogs.reduce((acc, d) => acc + d.tips, 0),
      totalFees: dailyLogs.reduce((acc, d) => acc + d.studioFee, 0),
      totalCash: dailyLogs.reduce((acc, d) => acc + d.cash, 0),
      netPay: 0, // calculated below
      totalWorkDays: dailyLogs.filter((d) => d.direct > 0).length,
      totalOpenDays: dailyLogs.filter((d) => d.studioFee > 0).length, // Useful for the studio owner
    };

    stats.netPay =
      stats.totalDirect +
      stats.totalPassive +
      stats.totalTips -
      stats.totalFees;
    return res.json({
      success: true,
      artist: { name: artistName },
      period: {
        formatted: `${dayjs(start_date).format("MMM DD")} - ${dayjs(end_date).format("MMM DD, YYYY")}`,
      },
      stats,
      dailyLogs: dailyLogs.filter((d) => d.subtotal !== 0 || d.cash > 0),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
export const fixMissingTattooSpending = async (req: Request, res: Response) => {
  try {
    // 1. Find all Tattoo customers with 0 or null spending_amount
    const targetCustomers = await prisma.signInCustomer.findMany({
      where: {
        service: "tattoo",
        OR: [{ spending_amount: 0 }, { spending_amount: null }],
      },
      select: {
        id: true,
        document_id: true,
        name: true,
      },
    });

    if (targetCustomers.length === 0) {
      return res.json({
        message: "No customers found with missing spending data.",
      });
    }

    const results = [];

    // 2. Iterate through each customer to find their payments
    for (const customer of targetCustomers) {
      const payments = await prisma.trackingPayment.findMany({
        where: {
          document_id: customer.document_id,
          voided: false, // Ensure we don't count voided transactions
          OR: [
            { message: null },
            {
              message: {
                contains: "approved",
                mode: "insensitive", // case-insensitive
              },
            },
          ],
        },
      });

      // 3. Sum up the amounts (using 'amount' or 'totalAmount' depending on your business logic)
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

      if (totalPaid > 0) {
        // 4. Update the SignInCustomer record
        await prisma.signInCustomer.update({
          where: { id: customer.id },
          data: { spending_amount: totalPaid },
        });

        results.push({
          name: customer.name,
          document_id: customer.document_id,
          recoveredAmount: totalPaid,
          transactionCount: payments.length,
        });
      }
    }

    return res.json({
      success: true,
      processed: targetCustomers.length,
      fixed: results.length,
      details: results,
    });
  } catch (error: any) {
    console.error("Fix spending error:", error);
    return res.status(500).json({ error: error.message });
  }
};

export const scriptInsertData = async (req: Request, res: Response) => {
  try {
    // Range: Jan 1st to Jan 31st, 2025
    let current = dayjs("2024-12-19");
    const endDate = dayjs("2024-12-31");
    let totalInserted = 0;

    while (current.isBefore(endDate) || current.isSame(endDate, "day")) {
      const apiDateFormat = current.format("MMDDYYYY");
      console.log(`📡 Fetching: ${apiDateFormat}`);

      const response = await axios.post(
        "https://hyperinkersform.com/api/fetching",
        { endDate: apiDateFormat },
      );

      if (response.data?.data && Array.isArray(response.data.data)) {
        for (const item of response.data.data) {
          try {
            // --- ⚠️ CONSOLE WARNINGS FOR MISSING DATA ---
            if (!item.city?.name && !item.city)
              console.warn(`⚠️ Missing City for ID: ${item.id}`);
            if (!item.state?.name && !item.state)
              console.warn(`⚠️ Missing State for ID: ${item.id}`);
            if (!item.firstName && !item.lastName)
              console.warn(`⚠️ Missing Name for ID: ${item.id}`);

            // --- DATABASE INSERTION (UPSERT) ---
            await prisma.signInCustomer.upsert({
              where: { document_id: item.id },
              update: {}, // Don't overwrite if it already exists
              create: {
                name:
                  `${item.firstName || ""} ${item.lastName || ""}`.trim() ||
                  "Unknown Customer",
                email: item.email || "no-email@provided.com",
                dob: item.dob || item.dateOfBirth || "N/A",
                phone: item.phoneNumber || "N/A",
                address: item.addressOne || "N/A",

                // Handling the new Object structure for City/State
                city: item?.city || item.city?.name || "N/A",
                state:
                  item?.state ||
                  item.state?.isoCode ||
                  item.state?.name ||
                  "N/A",

                zip_code: item?.postalCode || "N/A",
                document_id: item.id,
                service: item.service || "Unknown",
                spending_artist: item.artist || "Unknown",
                spending_services: item.tattooStyle || "N/A",

                // Using Number(item.price) to handle both string "10" or number 10 safely
                spending_amount: Number(item.price) || 0,

                // Use the loop's current date to ensure year is 2025
                createdAt: current.toDate(),
              },
            });
            totalInserted++;
          } catch (err) {
            console.error(`❌ DB Error for ID ${item.id}:`, err);
          }
        }
      }

      current = current.add(1, "day");
    }

    console.log(`🏁 Migration finished. Total records: ${totalInserted}`);
    return res.status(200).json({ success: true, count: totalInserted });
  } catch (error: any) {
    console.error("❌ Global Error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getServiceDemographics = async (req: Request, res: Response) => {
  try {
    const customers = await prisma.signInCustomer.findMany({
      select: {
        zip_code: true,
        service: true,
        spending_amount: true,
      },
    });

    // Initialize the two main groups
    const piercingGroups: Record<string, number> = {};
    const tattooHighSpending: Record<string, number> = {}; // > 499
    const tattooLowSpending: Record<string, number> = {}; // <= 499

    customers.forEach((customer) => {
      const zip = customer.zip_code || "Unknown";
      const service = customer.service?.toLowerCase() || "";
      const amount = customer.spending_amount || 0;

      if (service.includes("piercing")) {
        piercingGroups[zip] = (piercingGroups[zip] || 0) + 1;
      } else if (service.includes("tattoo")) {
        if (amount > 499) {
          tattooHighSpending[zip] = (tattooHighSpending[zip] || 0) + 1;
        } else {
          tattooLowSpending[zip] = (tattooLowSpending[zip] || 0) + 1;
        }
      }
    });

    // Helper to convert objects to sorted lists for the response
    const formatGroup = (groupObj: Record<string, number>) =>
      Object.entries(groupObj)
        .map(([zip, count]) => ({ zip_code: zip, count }))
        .sort((a, b) => b.count - a.count);

    return res.json({
      success: true,
      groups: {
        piercing: formatGroup(piercingGroups),
        tattoo: {
          high_spending_over_499: formatGroup(tattooHighSpending),
          low_spending_under_500: formatGroup(tattooLowSpending),
        },
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
