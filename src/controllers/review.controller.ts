import { Request, Response } from "express";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DashboardQuery {
  userId?: string;
  starRating?: string;
  startDate?: string;
  endDate?: string;
}

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


