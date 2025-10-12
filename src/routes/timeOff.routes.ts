import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { setTimeOff, getTimeOff } from "../controllers/timeOff.controller";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

router.use(authenticate, enforceDevice, authorize(["admin", "employee"]));
router.post("/", setTimeOff);
router.get("/", getTimeOff);

export default router;
