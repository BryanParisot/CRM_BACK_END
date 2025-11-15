import express from "express";
import {
  createClient,
  generateClientAccessLink,
  getClientById,
  getClientPublicData,
  getClients,
  saveClientSelectionFromLink,
  updateClient,
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

export default router;
