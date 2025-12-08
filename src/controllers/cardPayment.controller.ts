import { SquareClient, SquareEnvironment } from "square";
import crypto from "crypto";
import { Request, Response } from "express";

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Production,
});

function removeBigInts(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

export const createCardPayment = async (req: Request, res: Response) => {
  try {
    const { amount, sourceId } = req.body;

    const idempotencyKey = crypto.randomUUID();

    const response = await client.payments.create({
      idempotencyKey,
      amountMoney: {
        amount: BigInt(Math.round(Number(amount) * 100)),
        currency: "USD",
      },
      sourceId,
      locationId: process.env.SQUARE_LOCATION_ID!,
    });

    const safePayment = removeBigInts(response.payment);

    return res.json({
      success: true,
      payment: safePayment,
    });
  } catch (error) {
    console.error("Square error:", error);
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "An unknown error occurred",
    });
  }
};
