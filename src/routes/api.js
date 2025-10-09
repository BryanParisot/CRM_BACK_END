import express from "express";
import { scrapeAutoScout } from "../utils/scraper.js";

const router = express.Router();

router.post("/scrape", async (req, res) => {
  try {
    const clientData = req.body;
    const vehicles = await scrapeAutoScout(clientData);
    res.json(vehicles);
  } catch (error) {
    console.error("Erreur dans /scrape:", error.message);
    res.status(500).json({
      message: "Erreur serveur lors du scraping",
      error: error.message,
    });
  }
});

export default router;
