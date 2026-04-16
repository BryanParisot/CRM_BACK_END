import express from "express";
import {
  createClient,
  deleteClient,
  generateClientAccessLink,
  getClientById,
  getClientPublicData,
  getClients,
  saveClientSelectionFromLink,
  updateClient,
  addVehicleChecks,
} from "../controllers/client.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/:id/generate-link", verifyToken, generateClientAccessLink);
router.get("/public/:token", getClientPublicData);
router.post("/public/:token/select", saveClientSelectionFromLink);

router.get("/", verifyToken, getClients);
router.post("/", verifyToken, createClient);
router.get("/:id", getClientById);
router.patch("/:id", updateClient);
router.delete("/:id", verifyToken, deleteClient);

// Route pour ajouter/modifier la checklist d'un véhicule (Admin)
router.post("/vehicle/:vehicleId/checks", verifyToken, addVehicleChecks);

export default router;
