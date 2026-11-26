import { createHash, timingSafeEqual } from "crypto";
import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import { imageKit } from "../utils/imagekit";

const prisma = new PrismaClient();
const TATTOO_PAYSTUB_PASSWORD = process.env.TATTOO_PAYSTUB_PASSWORD;
const MAX_FAILED_ATTEMPTS = 5;
const FAILED_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; expiresAt: number }>();

const authorizePaystubRequest = (req: Request, res: Response): boolean => {
  if (!TATTOO_PAYSTUB_PASSWORD) {
    res.status(503).json({
      message: "Tattoo paystub access is not configured.",
    });
    return false;
  }

  const now = Date.now();
  for (const [ip, attempt] of failedAttempts) {
    if (attempt.expiresAt <= now) failedAttempts.delete(ip);
  }

  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = failedAttempts.get(clientIp);
  if (attempt && attempt.count >= MAX_FAILED_ATTEMPTS) {
    res.status(429).json({
      message: "Too many incorrect password attempts. Try again later.",
    });
    return false;
  }

  const submittedPassword = req.body?.password;
  if (typeof submittedPassword !== "string") {
    res.status(400).json({ message: "Password is required." });
    return false;
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
    res.status(401).json({ message: "Incorrect password." });
    return false;
  }

  failedAttempts.delete(clientIp);
  return true;
};

const findImageKitFileIdByUrl = async (pdfUrl: string) => {
  const limit = 1000;
  let skip = 0;

  while (true) {
    const files = await imageKit.listFiles({
      path: "/tattoo-artist-paystub-prints",
      limit,
      skip,
    });
    const matchingFile = files.find(
      (file) => "fileId" in file && "url" in file && file.url === pdfUrl,
    );

    if (matchingFile && "fileId" in matchingFile) {
      return matchingFile.fileId;
    }
    if (files.length < limit) return null;

    skip += limit;
  }
};

export const getLatestTattooArtistPaystubPrints = async (
  req: Request,
  res: Response,
) => {
  if (!authorizePaystubRequest(req, res)) return;
  try {
    const paystubs = await prisma.tattooArtistPaystubPrint.findMany({
      orderBy: [
        { createdAt: "desc" },
        { end_date: "desc" },
        { start_date: "desc" },
      ],
      take: 20,
      select: {
        id: true,
        start_date: true,
        end_date: true,
        artist: true,
        pdf: true,
        status: true,
        createdAt: true,
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

export const markTattooArtistPaystubPrintPaid = async (
  req: Request,
  res: Response,
) => {
  if (!authorizePaystubRequest(req, res)) return;

  const { id } = req.params;
  if (!id) return res.status(400).json({ message: "Paystub ID is required." });
  if (req.body?.status !== "paid") {
    return res.status(400).json({ message: 'Status must be "paid".' });
  }

  try {
    const paystub = await prisma.tattooArtistPaystubPrint.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!paystub) {
      return res.status(404).json({ message: "Paystub not found." });
    }

    const updatedPaystub = await prisma.tattooArtistPaystubPrint.update({
      where: { id },
      data: { status: "paid" },
      select: { id: true, status: true },
    });

    return res.json({ success: true, data: updatedPaystub });
  } catch (error) {
    console.error("Error marking tattoo artist paystub as paid:", error);
    return res.status(500).json({
      message: "Failed to update tattoo artist paystub status.",
    });
  }
};

export const deleteTattooArtistPaystubPrint = async (
  req: Request,
  res: Response,
) => {
  if (!authorizePaystubRequest(req, res)) return;

  const { id } = req.params;
  if (!id) return res.status(400).json({ message: "Paystub ID is required." });

  try {
    const paystub = await prisma.tattooArtistPaystubPrint.findUnique({
      where: { id },
      select: { id: true, pdf: true },
    });
    if (!paystub) {
      return res.status(404).json({ message: "Paystub not found." });
    }

    const fileId = await findImageKitFileIdByUrl(paystub.pdf);
    if (fileId) await imageKit.deleteFile(fileId);

    await prisma.tattooArtistPaystubPrint.delete({ where: { id } });

    return res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error("Error deleting tattoo artist paystub print:", error);
    return res.status(500).json({
      message: "Failed to delete tattoo artist paystub print.",
    });
  }
};
