import { Request, Response } from "express";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DashboardQuery {
  userId?: string;
  starRating?: string;
  startDate?: string;
  endDate?: string;
}

import { syncAllArtistReviews } from "./sync.controller";

export const getDashboardData = async (
  req: Request<{}, {}, {}, DashboardQuery>,
  res: Response,
) => {
  const { userId, starRating, startDate, endDate } = req.query;

  const reviews = await prisma.review.findMany({
    where: {
      ...(userId && { userId: userId }),
      ...(starRating && { starRating: parseInt(starRating) }),
      ...((startDate || endDate) && {
        createTime: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      }),
    },
    orderBy: { createTime: "desc" },
    include: { user: { select: { name: true, photo_url: true } } },
  });

  res.json(reviews);
};

export const getGoogleReviewKeys = async (req: Request, res: Response) => {
  try {
    const keys = await prisma.googleReviewKey.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res.json(keys);
  } catch (error) {
    console.error("Error fetching review keys:", error);
    res.status(500).json({ error: "Failed to fetch review keys" });
  }
};

export const linkArtistKey = async (req: Request, res: Response) => {
  const { userId, locationId, displayName } = req.body;

  const newKey = await prisma.googleReviewKey.create({
    data: {
      userId: userId,
      locationId: locationId,
      displayName: displayName,
    },
  });

  res.status(201).json(newKey);
};

export const deleteGoogleReviewKey = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const existingKey = await prisma.googleReviewKey.findUnique({
      where: { id: id },
    });

    if (!existingKey) {
      return res.status(404).json({ error: "Keyword not found." });
    }

    await prisma.googleReviewKey.delete({
      where: { id: id },
    });

    res.status(200).json({ message: "Keyword deleted successfully." });
  } catch (error) {
    console.error("Error deleting review key:", error);
    res.status(500).json({ error: "Failed to delete the keyword." });
  }
};

export const updateReviewDraft = async (req: Request, res: Response) => {
  const { reviewId } = req.params;
  const { replyDraft } = req.body;

  try {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data: {
        replyDraft: replyDraft,
        isReadytoReply: true,
      },
    });

    return res.status(200).json({
      message: "Draft saved and queued for sync",
      review: updatedReview,
    });
  } catch (error) {
    console.error("Error updating review draft:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};




