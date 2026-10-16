import express from "express";
import {
  addClientStep,
  getClientSteps,
} from "../controllers/clientSteps.controller.js";

import {verifyToken} from "../middleware/auth.middleware.js";
const router = express.Router();
router.use(verifyToken);

router.get("/:id/steps", getClientSteps);
router.post("/:id/steps", addClientStep);

export default router;
