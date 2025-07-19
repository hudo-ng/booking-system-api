import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { setTimeOff, getTimeOff } from "../controllers/timeOff.controller";

const router = Router();

router.use(authenticate, authorize(["admin", "employee"]));
router.post("/", setTimeOff);
router.get("/", getTimeOff);

export default router;
