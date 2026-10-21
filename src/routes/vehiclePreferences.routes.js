import express from 'express';
import {
  addVehiclePreference,
  deleteVehiclePreference,
  updateVehiclePreference,
} from '../controllers/vehiclePreferences.controller.js';
import {verifyToken} from '../middleware/auth.middleware.js';
import {handleVehiclePreferencesError} from '../middleware/error.middleware.js';

const router = express.Router();

router.post('/:id/vehicle-preferences', verifyToken, addVehiclePreference);
router.patch('/:id/vehicle-preferences/:preferenceId', verifyToken, updateVehiclePreference);
router.delete('/:id/vehicle-preferences/:preferenceId', verifyToken, deleteVehiclePreference);

router.use(handleVehiclePreferencesError);

export default router;
