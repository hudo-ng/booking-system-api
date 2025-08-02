import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  editEmployee,
  getAllEmployees,
} from "../controllers/management.controller";

const router = Router();

router.use(authenticate, authorize(["admin", "employee"]));
router.get("/employees", getAllEmployees);
router.put("/employees/edit", editEmployee);

export default router;
