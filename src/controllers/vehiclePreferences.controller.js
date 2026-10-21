import {changeVehiclePreference, validateVehiclePreference} from '../services/vehiclePreferences.service.js';

function preferenceId(req) {
  const id = Number(req.params.preferenceId);
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error('Véhicule recherché invalide.'), {status: 400});
  return id;
}

export const addVehiclePreference = async (req, res) => {
  const value = validateVehiclePreference(req.body);
  const vehicles = await changeVehiclePreference(req.params.id, req.userId, 'add', null, value);
  res.status(201).set('Cache-Control', 'no-store').json({additional_vehicles: vehicles});
};

export const updateVehiclePreference = async (req, res) => {
  const value = validateVehiclePreference(req.body);
  const vehicles = await changeVehiclePreference(req.params.id, req.userId, 'update', preferenceId(req), value);
  res.set('Cache-Control', 'no-store').json({additional_vehicles: vehicles});
};

export const deleteVehiclePreference = async (req, res) => {
  const vehicles = await changeVehiclePreference(req.params.id, req.userId, 'delete', preferenceId(req));
  res.set('Cache-Control', 'no-store').json({additional_vehicles: vehicles});
};
