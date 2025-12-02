import Router from "express";
import { createCardPayment } from "../controllers/cardPayment.controller";

const router = Router();

router.post("/create", createCardPayment);

export default router;
