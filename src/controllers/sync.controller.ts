import {
  fetchReviews,
  fetchAllReviews,
  getFreshAccessToken,
  parseRating,
} from "../utils/googleBusiness";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const syncAllArtistReviews = async (ownerId: string) => {
  try {
    const token = await getFreshAccessToken(ownerId);
    const keys = await prisma.googleReviewKey.findMany();

    console.log(keys);

    for (const key of keys) {
      const googleReviews = await fetchAllReviews(token, key.locationId);

      for (const gr of googleReviews) {
        await prisma.review.upsert({
          where: { googleReviewId: gr.reviewId },
          update: {
            comment: gr.comment,
            starRating: parseRating(gr.starRating),
          },
          create: {
            googleReviewId: gr.reviewId,
            reviewerName: gr.reviewer.displayName,
            starRating: parseRating(gr.starRating),
            comment: gr.comment,
            createTime: new Date(gr.createTime),
            userId: key.userId,
            googleReviewKeyId: key.id,
          },
        });
      }
    }
    console.log(`[${new Date().toISOString()}] Sync completed.`);
  } catch (error) {
    console.error("Sync failed:", error);
  }
};

export const syncAllArtistReviews1 = async (ownerId: string) => {
  try {
    const token = await getFreshAccessToken(ownerId);
    const keys = await prisma.googleReviewKey.findMany();
    const locationIds = [...new Set(keys.map(k => k.locationId))];

    for (const locId of locationIds) {
      const googleReviews = await fetchAllReviews(token, locId);

      for (const gr of googleReviews) {
        const comment = (gr.comment || "").toLowerCase();
        
        let assignedUserId: string | null = null;
        let matchedKeyId: string | null = null;

        for (const key of keys) {
          const regex = new RegExp(`\\b${key.displayName}\\b`, 'i');
          if (regex.test(comment)) {
            assignedUserId = key.userId;
            matchedKeyId = key.id;
            break; 
          }
        }

        await prisma.review.upsert({
          where: { googleReviewId: gr.reviewId },
          update: {
            comment: gr.comment || null,
            starRating: parseRating(gr.starRating),
            userId: assignedUserId,
          },
          create: {
            googleReviewId: gr.reviewId,
            reviewerName: gr.reviewer.displayName,
            starRating: parseRating(gr.starRating),
            comment: gr.comment || null,
            createTime: new Date(gr.createTime),
            userId: assignedUserId,
            googleReviewKeyId: matchedKeyId ?? "", 
          },
        });
      }
    }
    console.log("Sync completed.");
  } catch (error) {
    console.error("Sync failed:", error);
  }
};
