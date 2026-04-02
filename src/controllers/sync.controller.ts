import {
  fetchReviews,
  fetchAllReviews,
  getFreshAccessToken,
  parseRating,
} from "../utils/googleBusiness";
import { generateAIReply } from "../utils/googlePrompt";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

export const syncAllArtistReviews = async (ownerId: string) => {
  try {
    const token = await getFreshAccessToken(ownerId);
    const keys = await prisma.googleReviewKey.findMany();

    for (const key of keys) {
      // Use fetchReviews (for latest) or fetchAllReviews (for history)
      const googleReviews = await fetchReviews(token, key.locationId);

      for (const gr of googleReviews) {
        // 1. Check our Database first
        const existingReview = await prisma.review.findUnique({
          where: { googleReviewId: gr.reviewId },
        });

        // 2. Perform the Upsert to keep our DB in sync with Google
        const savedReview = await prisma.review.upsert({
          where: { googleReviewId: gr.reviewId },
          update: {
            comment: gr.comment,
            starRating: parseRating(gr.starRating),
            // Update replyText if it exists on Google but not in our DB
            replyText: gr.reviewReply?.comment || existingReview?.replyText,
          },
          create: {
            googleReviewId: gr.reviewId,
            reviewerName: gr.reviewer.displayName,
            starRating: parseRating(gr.starRating),
            comment: gr.comment,
            createTime: new Date(gr.createTime),
            userId: key.userId,
            googleReviewKeyId: key.id,
            replyText: gr.reviewReply?.comment || null,
          },
        });

        // 3. DECISION LOGIC: Should we reply right now?
        // We only reply if:
        // - There is NO reply on Google yet
        // - There is NO replyText in our DB
        const needsReply = !gr.reviewReply?.comment && !savedReview.replyText;
        
        if (needsReply) {
          const rating = parseRating(gr.starRating);
          const hasComment = gr.comment && gr.comment.trim() !== "";
          const fullReviewPath = `${key.locationId}/reviews/${gr.reviewId}`;

          // CASE A: 5 Stars, No Comment (Template)
          if (rating === 5 && !hasComment) {
            const msg = "Thank you so much for the 5-star rating! We appreciate the support.";
            await postGoogleReply(token, fullReviewPath, msg);
            
            // Save the reply to DB so we don't try again
            await prisma.review.update({
              where: { id: savedReview.id },
              data: { replyText: msg }
            });
          }

          // CASE B: 4-5 Stars + Comment (AI)
          else if (rating >= 4 && hasComment) {
            console.log(`🧠 Generating AI reply for ${gr.reviewer.displayName}...`);
            const aiReply = await generateAIReply(gr.reviewer.displayName, rating, gr.comment!);
            
            if (aiReply) {
              await postGoogleReply(token, fullReviewPath, aiReply);
              
              // Save the AI reply to DB
              await prisma.review.update({
                where: { id: savedReview.id },
                data: { replyText: aiReply }
              });
            }
          }
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
