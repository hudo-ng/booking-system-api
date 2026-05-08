import { Router } from "express";
import {
  getAvailability,
  getMonthlyAvailability,
  getShopAvailabilityByDay,
} from "../controllers/availability.controller";

const router = Router();
router.get("/all", getShopAvailabilityByDay);
router.get("/:id", getAvailability);
router.get("/:id/month", getMonthlyAvailability);

export default router;
