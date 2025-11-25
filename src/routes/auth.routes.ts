import express from "express";
import {
  register,
  login,
  logInByIdToken,
  createPaymentRequest,
  printTcpReceipt,
  printEposReceipt,
} from "../controllers/auth.controller";
import { getAllMiniPhoto } from "../controllers/management.controller";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/login/id-token", logInByIdToken);
router.get("/mini-photo", getAllMiniPhoto);
router.post("/create-payment-request", createPaymentRequest);
router.post("/print-tcp", printTcpReceipt);
router.post("/print-epos", printEposReceipt);
export default router;
