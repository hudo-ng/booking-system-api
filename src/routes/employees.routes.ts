import { Router } from "express";
import {
  listEmployees,
  getEmployeeId,
} from "../controllers/employess.controller";

const router = Router();

router.get("/", listEmployees);
router.get("/:employeeSlug", getEmployeeId);

export default router;
