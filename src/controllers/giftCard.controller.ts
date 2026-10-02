import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { customAlphabet } from "nanoid";
import Mailgun from "mailgun.js";
import FormData from "form-data";
import { sendSMS } from "../utils/sms";

const prisma = new PrismaClient();

const generateCode = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 10);

const mg = new Mailgun(FormData).client({
  username: "api",
  key: process.env.MAILGUN_API_KEY!,
});

async function generateUniqueCode() {
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const existing = await prisma.giftCard.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique gift card code");
}

// Call this once payment has already been taken care of (card, cash, terminal, etc).
// This endpoint only records the gift card and sends the receipt/code - it never charges anything itself.
export const purchaseGiftCard = async (req: Request, res: Response) => {
  try {
    const {
      amount,
      paymentMethod,
      providerPaymentId,
      buyerName,
      buyerEmail,
      buyerPhone,
      recipientName,
      recipientEmail,
      recipientPhone,
      giftMessage,
    } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }
    if (
      !paymentMethod ||
      !buyerName ||
      !buyerEmail ||
      !recipientName ||
      !recipientEmail ||
      !recipientPhone
    ) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const code = await generateUniqueCode();
    const giftCard = await prisma.giftCard.create({
      data: {
        code,
        initialAmount: Number(amount),
        balance: Number(amount),
        paymentMethod,
        providerPaymentId,
        buyerName,
        buyerEmail,
        buyerPhone,
        recipientName,
        recipientEmail,
        recipientPhone,
        giftMessage,
      },
    });

    await mg.messages.create(process.env.MAILGUN_DOMAIN!, {
      from: process.env.MAILGUN_FROM!,
      to: buyerEmail,
      subject: "Your gift card purchase receipt",
      html: `<p>Thanks for your purchase, ${buyerName}!</p>
             <p>You bought a <strong>$${Number(amount).toFixed(2)}</strong> gift card for ${recipientName}.</p>
             <p>It has been sent to them by email and text message.</p>`,
    });

    await mg.messages.create(process.env.MAILGUN_DOMAIN!, {
      from: process.env.MAILGUN_FROM!,
      to: recipientEmail,
      subject: `${buyerName} sent you a gift card!`,
      html: `<p>You've received a <strong>$${Number(amount).toFixed(2)}</strong> gift card from ${buyerName}.</p>
             ${giftMessage ? `<p>"${giftMessage}"</p>` : ""}
             <p>Your code: <strong>${code}</strong></p>
             <p>Present this code at checkout to redeem it.</p>`,
    });

    await sendSMS(
      recipientPhone,
      `${buyerName} sent you a $${Number(amount).toFixed(2)} gift card! Code: ${code}. Present it at checkout to redeem.`
    );

    return res.json({ success: true, giftCard });
  } catch (error) {
    console.error("Gift card purchase error:", error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "An unknown error occurred",
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
