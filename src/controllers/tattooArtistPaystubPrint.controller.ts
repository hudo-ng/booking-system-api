import { createHash, timingSafeEqual } from "crypto";
import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";

const prisma = new PrismaClient();
const TATTOO_PAYSTUB_PASSWORD = process.env.TATTOO_PAYSTUB_PASSWORD;
const MAX_FAILED_ATTEMPTS = 5;
const FAILED_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; expiresAt: number }>();

export const getLatestTattooArtistPaystubPrints = async (
  req: Request,
  res: Response,
) => {
  if (!TATTOO_PAYSTUB_PASSWORD) {
    return res.status(503).json({
      message: "Tattoo paystub access is not configured.",
    });
  }

  const now = Date.now();
  for (const [ip, attempt] of failedAttempts) {
    if (attempt.expiresAt <= now) failedAttempts.delete(ip);
  }

  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = failedAttempts.get(clientIp);
  if (attempt && attempt.count >= MAX_FAILED_ATTEMPTS) {
    return res.status(429).json({
      message: "Too many incorrect password attempts. Try again later.",
    });
  }

  const submittedPassword = req.body?.password;
  if (typeof submittedPassword !== "string") {
    return res.status(400).json({ message: "Password is required." });
  }

  const expectedHash = createHash("sha256")
    .update(TATTOO_PAYSTUB_PASSWORD)
    .digest();
  const submittedHash = createHash("sha256").update(submittedPassword).digest();

  if (!timingSafeEqual(expectedHash, submittedHash)) {
    failedAttempts.set(clientIp, {
      count: (attempt?.count ?? 0) + 1,
      expiresAt: attempt?.expiresAt ?? now + FAILED_ATTEMPT_WINDOW_MS,
    });
    return res.status(401).json({ message: "Incorrect password." });
  }

  failedAttempts.delete(clientIp);

  try {
    const paystubs = await prisma.tattooArtistPaystubPrint.findMany({
      orderBy: [{ end_date: "desc" }, { start_date: "desc" }],
      take: 20,
      select: {
        id: true,
        start_date: true,
        end_date: true,
        artist: true,
        pdf: true,
      },
    });

    return res.json({ success: true, data: paystubs });
  } catch (error) {
    console.error("Error fetching tattoo artist paystub prints:", error);
    return res.status(500).json({
      message: "Failed to fetch tattoo artist paystub prints.",
    });
  }
};
