import express from "express";
import {
  preselectVehicles,
  getPreselectedVehicles,
  selectByClient,
  selectVehicleByClient,
} from "../controllers/vehicles.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/preselect",preselectVehicles);
router.get("/client/:id", getPreselectedVehicles);
router.post("/client-select", selectByClient);
router.post("/select", selectVehicleByClient);

export default router;
