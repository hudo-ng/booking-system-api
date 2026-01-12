import { Router } from "express";
import { getAvailability, getMonthlyAvailability } from "../controllers/availability.controller";

const router = Router();
router.get("/:id", getAvailability);
router.get("/:id/month", getMonthlyAvailability);
export default router;
