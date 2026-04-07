import axios from "axios";
import { google } from "googleapis";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface GoogleReviewResponse {
  reviews?: GoogleReview[];
  nextPageToken?: string;
}

interface GoogleReview {
  reviewReply: any;
  reviewId: string;
  reviewer: { displayName: string };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string;
}

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

export const parseRating = (rating: GoogleReview["starRating"]): number => {
  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };
  return map[rating] || 0;
};

export const getFreshAccessToken = async (userId: string): Promise<string> => {
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ where: { isOwner: true } });

  if (!user) throw new Error("No valid owner found to sync reviews.");

  const creds = await prisma.googleCredential.findUniqueOrThrow({
    where: { userId },
  });
  if (!creds || !creds.refreshToken) {
    throw new Error(
      `User ${user.email} has no Refresh Token. Please log in again.`,
    );
  }

  oauth2Client.setCredentials({ refresh_token: creds.refreshToken });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await prisma.googleCredential.update({
      where: { userId: user.id },
      data: {
        accessToken: credentials.access_token!,
        expiryDate: credentials.expiry_date!,
        ...(credentials.refresh_token && {
          refreshToken: credentials.refresh_token,
        }),
      },
    });
    return credentials.access_token!;
  } catch (error: any) {
    if (error.response?.data?.error === "invalid_grant") {
      console.error(
        `!!! CRITICAL: Real email ${user.email} needs to RE-LOGIN via Google !!!`,
      );
    }
    throw error;
  }
};

export const fetchReviews = async (
  accessToken: string,
  locationResourceName: string,
): Promise<GoogleReview[]> => {
  const url = `https://mybusiness.googleapis.com/v4/${locationResourceName}/reviews`;

  const response = await axios.get<GoogleReviewResponse>(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { pageSize: 50 },
  });

  return response.data.reviews || [];
};

export const fetchAllReviews = async (
  accessToken: string,
  locationId: string,
): Promise<GoogleReview[]> => {
  let allReviews: GoogleReview[] = [];
  let nextPageToken: string | undefined = undefined;

  do {
    const response: { data: GoogleReviewResponse } =
      await axios.get<GoogleReviewResponse>(
        `https://mybusiness.googleapis.com/v4/${locationId}/reviews`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            pageSize: 50,
            pageToken: nextPageToken,
          },
        },
      );

    if (response.data.reviews) {
      allReviews.push(...response.data.reviews);
    }

    nextPageToken = response.data.nextPageToken;
  } while (nextPageToken);

  return allReviews;
};
