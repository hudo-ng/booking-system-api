import {
  fetchReviews,
  getFreshAccessToken,
  parseRating,
} from "../utils/googleBusiness";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const syncAllArtistReviews = async (ownerId: string) => {
  try {
    const token = await getFreshAccessToken(ownerId);
    const keys = await prisma.googleReviewKey.findMany();

    for (const key of keys) {
      const googleReviews = await fetchReviews(token, key.locationId);

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
