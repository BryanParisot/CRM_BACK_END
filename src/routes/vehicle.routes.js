import express from "express";
import {
  deletePreselectedVehicle,
  getPreselectedVehicles,
  preselectVehicles,
  selectByClient,
  selectVehicleByClient,
} from "../controllers/vehicles.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/preselect", preselectVehicles);
router.get("/client/:id", getPreselectedVehicles);
router.post("/client-select", selectByClient);
router.post("/select", selectVehicleByClient);
router.delete("/:id", deletePreselectedVehicle);

export default router;
