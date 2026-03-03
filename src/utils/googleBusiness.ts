import axios from "axios";
import { google } from "googleapis";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface GoogleReviewResponse {
  reviews?: GoogleReview[];
  nextPageToken?: string;
}

interface GoogleReview {
  reviewId: string;
  reviewer: { displayName: string };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string;
}

const oauth2Client = new google.auth.OAuth2(
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
  const creds = await prisma.googleCredential.findUniqueOrThrow({
    where: { userId },
  });

  oauth2Client.setCredentials({ refresh_token: creds.refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();

  await prisma.googleCredential.update({
    where: { userId },
    data: {
      accessToken: credentials.access_token!,
      expiryDate: credentials.expiry_date!,
    },
  });

  return credentials.access_token!;
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
