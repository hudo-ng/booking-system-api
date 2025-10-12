import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  setWorkingHours,
  getWorkingHours,
  getAllWorkingHours,
} from "../controllers/workingHours.controller";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

router.use("/", authenticate, enforceDevice, authorize(["admin", "employee"]));
router.post("/", setWorkingHours);
router.get("/all", getAllWorkingHours);
router.get("/:weekday", getWorkingHours);

export default router;
