import { Router } from "express";
import { getAvailability } from "../controllers/availability.controller";

const router = Router();
router.get("/:id", getAvailability);
export default router;
