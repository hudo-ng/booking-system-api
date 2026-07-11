import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  setWorkingHours,
  getWorkingHours,
  getAllWorkingHours,
  deleteTimeWorkOn,
  createTimeWorkOn,
} from "../controllers/workingHours.controller";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

router.use("/", authenticate, enforceDevice, authorize(["admin", "employee"]));
router.post("/", setWorkingHours);
router.get("/all", getAllWorkingHours);
router.get("/:weekday", getWorkingHours);
// TimeWorkOn
router.post("/work-on", createTimeWorkOn);
router.delete("/work-on", deleteTimeWorkOn);

export default router;
