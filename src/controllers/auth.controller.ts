import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config";
import slugify from "slugify";
import { customAlphabet } from "nanoid";
import axios from "axios";
import escpos from "escpos";
import fetch from "node-fetch";

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
    const { artist, Cash, Card } = req.body;

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
          paymentType: "Cash",
          transactionType: "CashPayment",
          amount: Cash,
          artist,
          payment_method: "Cash",
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
        IsReadyForIS: false,
        CustomFields: { document_id: "hello", id: "10" },
      };

      const response = await axios.post(
        "https://spinpos.net/v2/Payment/Sale",
        payload,
        { headers: { "Content-Type": "application/json" }, timeout: 120000 }
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
          payment_method: "Card",
        },
      });
    }

    return res.json({ success: true, dejavoo, cashRecord, cardRecord });
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

// Import Network adapter separately

const Network = require("escpos-network");

export const printTcpReceipt = async (req: Request, res: Response) => {
  const { client, service, employee, amount, date } = req.body;
  const PRINTER_IP = "192.168.0.200";

  try {
    // Create network device
    const device = new Network(PRINTER_IP, 9100);

    // Create printer instance
    const printer = new escpos.Printer(device);

    // Open device
    device.open((err: any) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Printer connection failed",
          error: err.toString(),
        });
      }

      // Print receipt
      printer

        .text("✨ LUXURY SALON RECEIPT ✨")
        .drawLine()

        .text(`Client: ${client}`)
        .text(`Service: ${service}`)
        .text(`Employee: ${employee}`)
        .text(`Date: ${date}`)
        .text(`Amount: $${amount}`)
        .drawLine()

        .text("Thank you for visiting!")
        .cut()
        .close();

      return res.json({ success: true, message: "Printed via TCP 9100" });
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Unexpected error",
      error: err.message,
    });
  }
};

export const printEposReceipt = async (req: Request, res: Response) => {
  try {
    const { client, service, employee, amount, date } = req.body;
    const PRINTER_IP = "192.168.0.200"; // Your printer IP

    // Epson ePOS JSON commands
    const eposCommand = {
      printer: "local_printer", // most LAN printers accept "local_printer"
      commands: [
        { align: "center" },
        { text: "Salon Receipt\n" },
        { align: "left" },
        { text: "-------------------------------\n" },
        { text: `Client: ${client}\n` },
        { text: `Service: ${service}\n` },
        { text: `Employee: ${employee}\n` },
        { text: `Date: ${date}\n` },
        { text: `Amount: $${amount}\n` },
        { text: "-------------------------------\n" },
        { text: "Thank you!\n\n" },
        { cut: "full" },
      ],
    };

    const response = await fetch(
      `http://${PRINTER_IP}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eposCommand),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res
        .status(500)
        .json({ message: "Failed to print via ePOS", error: text });
    }

    return res.json({ success: true, message: "Printed via ePOS" });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
};
