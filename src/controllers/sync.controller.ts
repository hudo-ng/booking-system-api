import {
  fetchReviews,
  fetchAllReviews,
  getFreshAccessToken,
  parseRating,
} from "../utils/googleBusiness";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

export const syncAllArtistReviews = async (
  ownerId: "0ca37281-3084-4c3b-b9b2-fc0185c28108",
) => {
  try {
    const token = await getFreshAccessToken(ownerId);
    const keys = await prisma.googleReviewKey.findMany();

    for (const key of keys) {
      const googleReviews = await fetchAllReviews(token, key.locationId);

      for (const gr of googleReviews) {
        const existingReview = await prisma.review.findUnique({
          where: { googleReviewId: gr.reviewId },
        });

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

        const isNew = !existingReview;
        const isFiveStar = gr.starRating === "FIVE";
        const hasNoComment = !gr.comment || gr.comment.trim() === "";

        if (isNew && isFiveStar && hasNoComment) {
          const testMessage =
            "Thank you so much for the 5-star rating! We appreciate the support.";
          const fullReviewPath = `${key.locationId}/reviews/${gr.reviewId}`;
          await postGoogleReply(token, fullReviewPath, testMessage);
        }
      }
    }
    console.log(`[${new Date().toISOString()}] Sync completed.`);
  } catch (error) {
    console.error("Sync failed:", error);
  }
};

const postGoogleReply = async (
  token: string,
  reviewName: string,
  message: string,
) => {
  try {
    await axios.put(
      `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
      { comment: message },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    console.log(`Successfully replied to: ${reviewName}`);
  } catch (error) {
    const err = error as any;
    console.error("Google Reply API Error:", err.response?.data || err.message);
  }
};

export const syncAllArtistReviews1 = async (ownerId: string) => {
  try {
    const token = await getFreshAccessToken(ownerId);
    const keys = await prisma.googleReviewKey.findMany();
    const locationIds = [...new Set(keys.map((k) => k.locationId))];

    for (const locId of locationIds) {
      const googleReviews = await fetchAllReviews(token, locId);

      for (const gr of googleReviews) {
        const comment = (gr.comment || "").toLowerCase();

        let assignedUserId: string | null = null;
        let matchedKeyId: string | null = null;

        for (const key of keys) {
          const regex = new RegExp(`\\b${key.displayName}\\b`, "i");
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
