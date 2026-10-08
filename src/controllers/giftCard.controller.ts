import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { customAlphabet } from "nanoid";
import Mailgun from "mailgun.js";
import FormData from "form-data";
import { SquareClient, SquareEnvironment } from "square";
import crypto from "crypto";
import { sendSMS } from "../utils/sms";

const prisma = new PrismaClient();

const squareClient = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Production,
});

const generateCode = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 10);

const mg = new Mailgun(FormData).client({
  username: "api",
  key: process.env.MAILGUN_API_KEY!,
});

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 10000;
const CARD_FEE_RATE = 0.035;
const PAYMENT_METHODS = ["Debit/Credit", "Apple Pay", "Cash App Pay"];

function removeBigInts(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function generateUniqueCode() {
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const existing = await prisma.giftCard.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique gift card code");
}

async function sendGiftCardNotifications(giftCard: {
  code: string;
  initialAmount: number;
  paymentMethod: string;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  giftMessage: string | null;
}) {
  const amount = `$${giftCard.initialAmount.toFixed(2)}`;
  const buyerName = escapeHtml(giftCard.buyerName);
  const recipientName = escapeHtml(giftCard.recipientName);
  const paymentMethod = escapeHtml(giftCard.paymentMethod);

  // The card is already paid for and saved, so a failed notification must not fail the purchase.
  const results = await Promise.allSettled([
    mg.messages.create(process.env.MAILGUN_DOMAIN!, {
      from: process.env.MAILGUN_FROM!,
      to: giftCard.buyerEmail,
      subject: "You just made someone's day 🎁",
      html: `<p>Hi ${buyerName},</p>
             <p>Thanks for the gift card — ${recipientName} is going to love it! Here's your receipt for the records:</p>
             <ul>
               <li>Amount: <strong>${amount}</strong></li>
               <li>Recipient: ${recipientName}</li>
               <li>Payment method: ${paymentMethod}</li>
             </ul>
             <p>We've already sent ${recipientName} their code by email and text, so there's nothing else you need to do.</p>
             <p>Thanks for choosing us,<br/>Hyper Inkers</p>`,
    }),
    mg.messages.create(process.env.MAILGUN_DOMAIN!, {
      from: process.env.MAILGUN_FROM!,
      to: giftCard.recipientEmail,
      subject: `🎁 ${giftCard.buyerName} just sent you a gift!`,
      html: `<p>Hey ${recipientName},</p>
             <p>Good news — ${buyerName} just treated you to a <strong>${amount}</strong> gift card at Hyper Inkers.</p>
             ${giftCard.giftMessage ? `<p>"${escapeHtml(giftCard.giftMessage)}"</p>` : ""}
             <p>Your code: <strong>${giftCard.code}</strong></p>
             <p>Just show this at checkout whenever you're ready — it never expires, so take your time picking out something great.</p>
             <p>Can't wait to see you,<br/>Hyper Inkers</p>`,
    }),
    sendSMS(
      giftCard.recipientPhone,
      `🎁 Surprise! ${giftCard.buyerName} just sent you a ${amount} gift card to Hyper Inkers. Code: ${giftCard.code} — flash it at checkout whenever you're ready, no expiration. Enjoy!`,
    ),
  ]);

  results.forEach((r) => {
    if (r.status === "rejected") {
      console.error(`Gift card ${giftCard.code} notification failed:`, r.reason);
    }
  });
}

// Charges the customer through Square and issues the gift card in one request,
// so a gift card can only exist for a completed payment of the same amount.
export const purchaseGiftCard = async (req: Request, res: Response) => {
  const {
    amount,
    sourceId,
    paymentMethod,
    buyerName,
    buyerEmail,
    buyerPhone,
    recipientName,
    recipientEmail,
    recipientPhone,
    giftMessage,
  } = req.body;

  const value = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(value) || value < MIN_AMOUNT || value > MAX_AMOUNT) {
    return res.status(400).json({
      success: false,
      message: `Amount must be between $${MIN_AMOUNT} and $${MAX_AMOUNT}`,
    });
  }
  // The convenience fee is computed here, never taken from the client.
  const chargeCents =
    Math.round(value * 100) + Math.round(value * CARD_FEE_RATE * 100);

  if (!sourceId || typeof sourceId !== "string") {
    return res.status(400).json({ success: false, message: "Missing payment token" });
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ success: false, message: "Invalid payment method" });
  }
  if (!buyerName || !buyerEmail || !recipientName || !recipientEmail || !recipientPhone) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  // Square payment tokens are single-use; keying on the token makes a retried request
  // return the original payment instead of charging twice.
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(`giftcard:${sourceId}`)
    .digest("hex")
    .slice(0, 45);

  let payment;
  try {
    const paymentResp = await squareClient.payments.create({
      idempotencyKey,
      amountMoney: {
        amount: BigInt(chargeCents),
        currency: "USD",
      },
      sourceId,
      locationId: process.env.SQUARE_LOCATION_ID!,
      note: `E-gift card for ${String(recipientName).slice(0, 100)}`,
    });
    payment = paymentResp.payment;
  } catch (error) {
    console.error("Gift card Square error:", error);
    return res.status(402).json({
      success: false,
      message: "Payment was declined. You have not been charged.",
    });
  }

  if (!payment?.id || payment.status !== "COMPLETED") {
    return res.status(402).json({ success: false, message: "Payment not completed" });
  }

  try {
    // A retry with the same token returns the same payment; hand back the card already issued for it.
    const existing = await prisma.giftCard.findUnique({
      where: { providerPaymentId: payment.id },
    });
    if (existing) {
      return res.json({ success: true, giftCard: existing });
    }

    const code = await generateUniqueCode();
    const giftCard = await prisma.$transaction(async (tx) => {
      await tx.webPaymentTracking.create({
        data: {
          provider: "SQUARE",
          providerPaymentId: payment.id!,
          method: paymentMethod,
          amount: chargeCents / 100,
          currency: "USD",
          status: payment.status!,
          avsStatus: payment.cardDetails?.avsStatus ?? null,
          cvvStatus: payment.cardDetails?.cvvStatus ?? null,
          rawResponse: removeBigInts(payment),
        },
      });

      return tx.giftCard.create({
        data: {
          code,
          initialAmount: value,
          balance: value,
          paymentMethod,
          providerPaymentId: payment.id!,
          buyerName,
          buyerEmail,
          buyerPhone: buyerPhone || null,
          recipientName,
          recipientEmail,
          recipientPhone,
          giftMessage: giftMessage ? String(giftMessage).slice(0, 300) : null,
        },
      });
    });

    await sendGiftCardNotifications(giftCard);

    return res.json({ success: true, giftCard });
  } catch (error) {
    console.error(
      `Gift card issue failed AFTER Square payment ${payment.id} was charged:`,
      error,
    );
    return res.status(500).json({
      success: false,
      paymentId: payment.id,
      message:
        "Your payment went through but the gift card could not be issued. Please contact us with your payment reference.",
    });
  }
};

export const getGiftCardByCode = async (req: Request, res: Response) => {
  try {
    const code = req.params.code.toUpperCase();
    const giftCard = await prisma.giftCard.findUnique({ where: { code } });
    if (!giftCard) {
      return res.status(404).json({ success: false, message: "Gift card not found" });
    }
    return res.json({ success: true, giftCard });
  } catch (error) {
    console.error("Gift card lookup error:", error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "An unknown error occurred",
    });
  }
};

export const redeemGiftCard = async (req: Request, res: Response) => {
  try {
    const { code, amount, appointmentId } = req.body;

    if (!code || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "Invalid code or amount" });
    }

    const giftCard = await prisma.giftCard.findUnique({
      where: { code: String(code).toUpperCase() },
    });
    if (!giftCard) {
      return res.status(404).json({ success: false, message: "Gift card not found" });
    }
    if (giftCard.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: `Gift card is ${giftCard.status.toLowerCase()}`,
      });
    }
    if (giftCard.balance < Number(amount)) {
      return res.status(400).json({ success: false, message: "Insufficient gift card balance" });
    }

    const newBalance = giftCard.balance - Number(amount);

    const [updated] = await prisma.$transaction([
      prisma.giftCard.update({
        where: { id: giftCard.id },
        data: {
          balance: newBalance,
          status: newBalance === 0 ? "REDEEMED" : "ACTIVE",
        },
      }),
      prisma.giftCardRedemption.create({
        data: {
          giftCardId: giftCard.id,
          amount: Number(amount),
          appointmentId,
        },
      }),
    ]);

    return res.json({ success: true, giftCard: updated });
  } catch (error) {
    console.error("Gift card redemption error:", error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "An unknown error occurred",
    });
  }
};
