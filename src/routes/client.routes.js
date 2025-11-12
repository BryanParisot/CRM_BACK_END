import express from "express";
import {
  createClient,
  getClientById,
  getClients,
  updateClient,
} from "../controllers/client.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", verifyToken, getClients);
router.post("/", verifyToken, createClient);
router.get("/:id", getClientById);
router.patch("/:id", updateClient);

export default router;
