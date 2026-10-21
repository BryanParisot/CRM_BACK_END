import express from 'express';
import {confirmFinalVehicle} from '../controllers/vehicleChoice.controller.js';

const router = express.Router();

router.put('/public/:token/final-vehicle', confirmFinalVehicle);

export default router;
