import { Router } from "express";
import { listEmployees } from "../controllers/employess.controller";

const router = Router();

// Public endpoint — no auth required
router.get("/", listEmployees);

export default router;
