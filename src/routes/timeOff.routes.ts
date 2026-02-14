import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  setTimeOff,
  getTimeOffWithFilter,
  setTimeOffBulk,
  setTimeOffStatus,
  setTimeOffBatchStatus,
  getTimeOffAll,
  getTimeOffAlls,
} from "../controllers/timeOff.controller";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

router.use(authenticate, enforceDevice, authorize(["admin", "employee"]));
router.post("/bulk", setTimeOffBulk);
router.get("/", getTimeOffWithFilter);
router.get("/all", getTimeOffAll);
router.get("/alls", getTimeOffAlls);
router.patch("/:id/status", setTimeOffStatus);
router.patch("/batch/:batchId/status", setTimeOffBatchStatus);
router.post("/", setTimeOff);

export default router;
