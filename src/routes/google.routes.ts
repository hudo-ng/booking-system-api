import Router from "express";
import {
  getDashboardData,
  linkArtistKey,
  getGoogleReviewKeys,
  deleteGoogleReviewKey,
} from "../controllers/review.controller";

const router = Router();

router.get("/dashboard", getDashboardData);
router.get("/keys", getGoogleReviewKeys);
router.post("/artist-key", linkArtistKey);
router.delete("/keys/:id", deleteGoogleReviewKey);

export default router;
