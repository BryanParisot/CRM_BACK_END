import express from "express";
import {
  addClientStep,
  getClientSteps,
} from "../controllers/clientSteps.controller.js";

const router = express.Router();

router.get("/:id/steps", getClientSteps);
router.post("/:id/steps", addClientStep);

export default router;
