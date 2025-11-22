import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config";
import slugify from "slugify";
import { customAlphabet } from "nanoid";
import axios from "axios";

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
    const { Amount, PaymentType = "Card", artist } = req.body;

    if (!artist) {
      return res
        .status(400)
        .json({ success: false, error: "Amount and artist are required" });
    }

    // --- Generate ReferenceId ---
    let lastPayment = await prisma.trackingPayment.findFirst({
      orderBy: { createdAt: "desc" },
    });

    const nextReferenceId = lastPayment
      ? (parseInt(lastPayment.referenceId) + 1).toString().padStart(6, "0")
      : "000001";

    let amountNumber = typeof Amount === "number" ? Amount : parseFloat(Amount);

    if (isNaN(amountNumber)) {
      return res.status(400).json({
        success: false,
        error: "Amount must be a valid number",
      });
    }

    // --- CASH PAYMENT ---
    if (PaymentType === "Cash") {
      const cashRecord = await prisma.trackingPayment.create({
        data: {
          referenceId: nextReferenceId,
          paymentType: "Cash",
          transactionType: "CashPayment",
          amount: amountNumber,
          artist,
          payment_method: "Cash",
        },
      });

      return res.json({ success: true, data: cashRecord });
    }

    // --- CARD PAYMENT ---
    const Tpn = process.env.DEJAVOO_TPN!;
    const Authkey = process.env.DEJAVOO_AUTH_KEY!;
    const RegisterId = process.env.DEJAVOO_REGISTER_ID!;
    const MerchantNumber = process.env.DEJAVOO_MERCHANT_NUMBER ?? null;

    if (!Tpn || !Authkey || !RegisterId) {
      return res
        .status(500)
        .json({ success: false, error: "Missing terminal credentials" });
    }

    const payload = {
      Amount,
      PaymentType,
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

    console.log("Dejavoo Request:", payload);

    const response = await axios.post(
      "https://spinpos.net/v2/Payment/Sale",
      payload,
      { headers: { "Content-Type": "application/json" }, timeout: 120000 }
    );

    const data = response.data;

    // --- Insert into DB ---
    const cardRecord = await prisma.trackingPayment.create({
      data: {
        referenceId: nextReferenceId,
        paymentType: PaymentType,
        transactionType: data?.TransactionType ?? "CardPayment",
        invoiceNumber: data?.InvoiceNumber,
        batchNumber: data?.BatchNumber,
        transactionNumber: data?.TransactionNumber,
        authCode: data?.AuthCode,
        voided: data?.Voided ?? false,
        pnReferenceId: data?.PNReferenceId,

        totalAmount: data?.Amounts?.TotalAmount,
        amount: data?.Amounts?.Amount,
        tipAmount: data?.Amounts?.TipAmount,
        feeAmount: data?.Amounts?.FeeAmount,
        taxAmount: data?.Amounts?.TaxAmount,

        cardType: data?.CardData?.CardType,
        entryType: data?.CardData?.EntryType,
        last4: data?.CardData?.Last4,
        first4: data?.CardData?.First4,
        BIN: data?.CardData?.BIN,
        name: data?.CardData?.Name,

        emvApplicationName: data?.EMVData?.ApplicationName,
        emvAID: data?.EMVData?.AID,
        emvTVR: data?.EMVData?.TVR,
        emvTSI: data?.EMVData?.TSI,
        emvIAD: data?.EMVData?.IAD,
        emvARC: data?.EMVData?.ARC,

        hostResponseCode: data?.GeneralResponse?.HostResponseCode,
        hostResponseMessage: data?.GeneralResponse?.HostResponseMessage,
        resultCode: data?.GeneralResponse?.ResultCode,
        statusCode: data?.GeneralResponse?.StatusCode,
        message: data?.GeneralResponse?.Message,
        detailedMessage: data?.GeneralResponse?.DetailedMessage,

        artist,
        payment_method: "Card",
      },
    });

    return res.json({ success: true, data: cardRecord });
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

    return res
      .status(500)
      .json({ success: false, error: err.response?.data || err.message });
  }
};
