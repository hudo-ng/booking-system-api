import { Router } from "express";
import {
  deleteTattooArtistPaystubPrint,
  getLatestTattooArtistPaystubPrints,
  markTattooArtistPaystubPrintPaid,
} from "../controllers/tattooArtistPaystubPrint.controller";

const router = Router();

router.post("/latest", getLatestTattooArtistPaystubPrints);
router.patch("/:id", markTattooArtistPaystubPrintPaid);
router.delete("/:id", deleteTattooArtistPaystubPrint);

export default router;
