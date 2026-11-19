import { Router } from "express";
import {
  deleteTattooArtistPaystubPrint,
  getLatestTattooArtistPaystubPrints,
} from "../controllers/tattooArtistPaystubPrint.controller";

const router = Router();

router.post("/latest", getLatestTattooArtistPaystubPrints);
router.delete("/:id", deleteTattooArtistPaystubPrint);

export default router;
