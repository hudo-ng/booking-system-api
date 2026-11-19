import { Router } from "express";
import { getLatestTattooArtistPaystubPrints } from "../controllers/tattooArtistPaystubPrint.controller";

const router = Router();

router.post("/latest", getLatestTattooArtistPaystubPrints);

export default router;
