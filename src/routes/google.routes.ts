import Router from "express";
import {
  getDashboardData,
  linkArtistKey,
} from "../controllers/review.controller";

const router = Router();

router.get("/dashboard", getDashboardData);
router.post("/artist-key", linkArtistKey);

export default router;