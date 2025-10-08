import express from "express";
import {
  register,
  login,
  logInByIdToken,
} from "../controllers/auth.controller";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/login/id-token", logInByIdToken);

export default router;
