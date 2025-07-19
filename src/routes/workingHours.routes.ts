import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  setWorkingHours,
  getWorkingHours,
} from "../controllers/workingHours.controller";

const router = Router();

router.use("/", authenticate, authorize(["admin", "employee"]));
router.post("/", setWorkingHours);
router.get("/", getWorkingHours);

export default router;
