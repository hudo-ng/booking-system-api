import Router from "express";
import { oauth2Client } from "../utils/googleBusiness";
import {
  getDashboardData,
  linkArtistKey,
  getGoogleReviewKeys,
  deleteGoogleReviewKey,
  syncGoogleReviews,
} from "../controllers/review.controller";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

router.get("/dashboard", getDashboardData);
router.get("/keys", getGoogleReviewKeys);
router.get("/sync", syncGoogleReviews);
router.post("/artist-key", linkArtistKey);
router.delete("/keys/:id", deleteGoogleReviewKey);

router.get("/auth/google/connect", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/business.manage"],
  });
  res.redirect(url);
});

router.get("/api/google/callback", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code as string);

  const owner = await prisma.user.findFirst({
    where: { isOwner: true, id: "0ca37281-3084-4c3b-b9b2-fc0185c28108" },
  });

  if (owner && tokens.refresh_token) {
    await prisma.googleCredential.upsert({
      where: { userId: owner.id },
      update: {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token!,
        expiryDate: new Date(tokens.expiry_date!).getTime(),
      },
      create: {
        userId: owner.id,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token!,
        expiryDate: new Date(tokens.expiry_date!).getTime(),
      },
    });
    res.send(
      "<h1>Success!</h1><p>Google Business is re-linked. Your Cron job will work now.</p>",
    );
  } else {
    res.send(
      "<h1>Error</h1><p>Failed to get a refresh token. Make sure you clicked 'Allow'.</p>",
    );
  }
});

export default router;
