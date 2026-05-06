import {
  fetchReviews,
  fetchAllReviews,
  getFreshAccessToken,
  parseRating,
} from "../utils/googleBusiness";
import {
  generateAIReply,
  generateBadReviewOptions,
} from "../utils/googlePrompt";
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
      const googleReviews = await fetchReviews(token, key.locationId);

      for (const gr of googleReviews) {
        const reviewDate = new Date(gr.createTime);
        const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
        const isRecent = reviewDate > seventyTwoHoursAgo;

        const existingReview = await prisma.review.findUnique({
          where: { googleReviewId: gr.reviewId },
        });

        const savedReview = await prisma.review.upsert({
          where: { googleReviewId: gr.reviewId },
          update: {
            comment: gr.comment,
            starRating: parseRating(gr.starRating),
            replyText: gr.reviewReply?.comment || existingReview?.replyText,
          },
          create: {
            googleReviewId: gr.reviewId,
            reviewerName: gr.reviewer.displayName,
            starRating: parseRating(gr.starRating),
            comment: gr.comment,
            createTime: reviewDate,
            userId: key.userId,
            googleReviewKeyId: key.id,
            replyText: gr.reviewReply?.comment || null,
          },
        });

        const needsReply =
          isRecent && !gr.reviewReply?.comment && !savedReview.replyText;

        if (needsReply) {
          const rating = parseRating(gr.starRating);
          const hasComment = gr.comment && gr.comment.trim() !== "";
          const fullReviewPath = `${key.locationId}/reviews/${gr.reviewId}`;

          if (rating === 5 && !hasComment) {
            const msg =
              "Thank you so much for the 5-star rating! We appreciate the support.";
            await postGoogleReply(token, fullReviewPath, msg);
            await prisma.review.update({
              where: { id: savedReview.id },
              data: { replyText: msg },
            });
          } else if (rating >= 4 && hasComment) {
            console.log(
              `🧠 Generating AI reply for ${gr.reviewer.displayName}...`,
            );
            const aiReply = await generateAIReply(
              gr.reviewer.displayName,
              rating,
              gr.comment!,
            );

            if (aiReply) {
              await postGoogleReply(token, fullReviewPath, aiReply);
              await prisma.review.update({
                where: { id: savedReview.id },
                data: { replyText: aiReply },
              });
            }
          } else if (rating <= 3) {
            console.log(
              `⚠️ Saving AI draft for 1-3 star review from ${gr.reviewer.displayName}`,
            );
            const aiDraft = await generateAIReply(
              gr.reviewer.displayName,
              rating,
              gr.comment || "",
            );
            if (aiDraft) {
              await prisma.review.update({
                where: { id: savedReview.id },
                data: { replyDraft: aiDraft },
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

export const syncAllArtistReviews1 = async (
  ownerId: "0ca37281-3084-4c3b-b9b2-fc0185c28108",
) => {
  console.log(`🚀 Starting sync for Owner: ${ownerId}`);

  try {
    const token = await getFreshAccessToken(ownerId);
    const keys = await prisma.googleReviewKey.findMany();

    for (const key of keys) {
      const googleReviews = await fetchReviews(token, key.locationId);

      for (const gr of googleReviews) {
        const reviewDate = new Date(gr.createTime);
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const isRecent = reviewDate > fortyEightHoursAgo;

        const existingReview = await prisma.review.findUnique({
          where: { googleReviewId: gr.reviewId },
        });

        const savedReview = await prisma.review.upsert({
          where: { googleReviewId: gr.reviewId },
          update: {
            comment: gr.comment,
            starRating: parseRating(gr.starRating),
            replyText: gr.reviewReply?.comment || existingReview?.replyText,
          },
          create: {
            googleReviewId: gr.reviewId,
            reviewerName: gr.reviewer.displayName,
            starRating: parseRating(gr.starRating),
            comment: gr.comment,
            createTime: reviewDate,
            userId: key.userId,
            googleReviewKeyId: key.id,
            replyText: gr.reviewReply?.comment || null,
          },
        });

        if (!isRecent) continue;

        const needsReply =
          !gr.reviewReply?.comment &&
          !savedReview.replyText &&
          !savedReview.replyDraft;

        if (needsReply) {
          const rating = parseRating(gr.starRating);
          const hasComment = gr.comment && gr.comment.trim() !== "";
          const fullReviewPath = `${key.locationId}/reviews/${gr.reviewId}`;

          if (rating === 5 && !hasComment) {
            const msg =
              "Thank you so much for the 5-star rating! We appreciate the support.";
            await postGoogleReply(token, fullReviewPath, msg);
            await prisma.review.update({
              where: { id: savedReview.id },
              data: { replyText: msg },
            });
          } else if (rating >= 4 && hasComment) {
            console.log(`🧠 AI Reply for: ${gr.reviewer.displayName}`);
            const aiReply = await generateAIReply(
              gr.reviewer.displayName,
              rating,
              gr.comment!,
            );
            if (aiReply) {
              await postGoogleReply(token, fullReviewPath, aiReply);
              await prisma.review.update({
                where: { id: savedReview.id },
                data: { replyText: aiReply },
              });
            }
          } else if (rating <= 3) {
            console.log(
              `📝 Saving 1-3 star draft for: ${gr.reviewer.displayName}`,
            );
            const aiDraft = await generateBadReviewOptions(
              gr.reviewer.displayName,
              rating,
              gr.comment || "",
            );
            if (aiDraft) {
              await prisma.review.update({
                where: { id: savedReview.id },
                data: {
                  replyDraft: aiDraft.option1,
                  replyDraft1: aiDraft.option2,
                },
              });
            }
          }
        }
      }
    }

    const approved = await prisma.review.findMany({
      where: { isReadytoReply: true, replyText: null },
      include: { googleReviewKey: true },
    });

    if (approved.length > 0) {
      console.log(
        `📨 Sending ${approved.length} approved replies to Google...`,
      );
      for (const rev of approved) {
        try {
          const artistToken = await getFreshAccessToken(ownerId);
          const path = `${rev.googleReviewKey.locationId}/reviews/${rev.googleReviewId}`;
          await postGoogleReply(artistToken, path, rev.replyDraft!);
          await prisma.review.update({
            where: { id: rev.id },
            data: { replyText: rev.replyDraft, isReadytoReply: false },
          });
        } catch (err) {
          console.error(
            `❌ Failed to send approved draft for ${rev.reviewerName}`,
          );
        }
      }
    }

    console.log(
      `[${new Date().toISOString()}] Sync & Queue Process Completed.`,
    );
  } catch (error) {
    console.error("Sync failed:", error);
  }
};
