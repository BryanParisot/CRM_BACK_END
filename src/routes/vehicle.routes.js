import express from "express";
import {
  preselectVehicles,
  getPreselectedVehicles,
  selectByClient,
  selectVehicleByClient,
} from "../controllers/vehicle.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/preselect", verifyToken, preselectVehicles);
router.get("/client/:id", verifyToken, getPreselectedVehicles);
router.post("/client-select", selectByClient);
router.post("/select", selectVehicleByClient);

export default router;
