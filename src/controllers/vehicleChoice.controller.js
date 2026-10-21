import pool from '../config/db.js';
import { checklistVersion, checklistReviewed, readVehicleChoice } from '../services/vehicleChoice.service.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
export const confirmFinalVehicle = async (req, res) => {
  const { vehicle_id, expected_revision, checklist_version, acknowledged_checks } = req.body || {};
  if (!Number.isInteger(vehicle_id) || vehicle_id <= 0 || !Number.isInteger(expected_revision) || expected_revision < 0 || typeof checklist_version !== 'string' || !/^[a-f0-9]{64}$/.test(checklist_version) || acknowledged_checks !== true)
    return res.status(400).json({ message: 'Consultez les contrôles et confirmez le véhicule choisi.' });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[client]] = await db.query('SELECT id,name,step FROM clients WHERE access_token=? FOR UPDATE', [req.params.token]);
    if (!client)
      throw fail(404, 'Lien invalide ou expiré.');
    if (client.step !== 4)
      throw fail(409, 'Le choix définitif est ouvert pendant l’étape des contrôles. Contactez votre conseiller pour une modification.');
    const [[vehicle]] = await db.query("SELECT id,title FROM selected_vehicles WHERE id=? AND client_id=? AND selected_by='client'", [vehicle_id, client.id]);
    if (!vehicle)
      throw fail(404, 'Choisissez un véhicule que vous avez retenu dans ce dossier.');
    const [[previous]] = await db.query('SELECT vehicle_id,revision,checklist_version FROM client_vehicle_choices WHERE client_id=?', [client.id]);
    if (previous && previous.vehicle_id !== vehicle.id)
      throw fail(409, 'Votre choix définitif est déjà confirmé. Vous ne pouvez plus sélectionner un autre véhicule.');
    const [checks] = await db.query('SELECT id,name,status FROM vehicle_checks WHERE selected_vehicle_id=?', [vehicle.id]);
    if (!checklistReviewed(checks))
      throw fail(409, 'Attendez que les points de contrôle de ce véhicule soient renseignés avant de confirmer votre choix.');
    const version = checklistVersion(checks);
    if (version !== checklist_version)
      throw fail(409, 'Les contrôles ont été modifiés. Consultez leur dernière version avant de confirmer.');
    // Retrying the same confirmation does not create another notification.
    if (previous?.vehicle_id === vehicle.id && previous.checklist_version === version) {
      const choice = await readVehicleChoice(client.id, db);
      await db.commit();
      return res.json({ final_choice: choice, message: 'Votre choix est déjà enregistré.' });
    }
    if (expected_revision !== (previous?.revision || 0))
      throw fail(409, 'Votre choix a changé dans un autre onglet. Actualisez la page avant de confirmer.');
    await db.query(`INSERT INTO client_vehicle_choices (client_id,vehicle_id,checklist_version) VALUES (?,?,?)
   ON DUPLICATE KEY UPDATE vehicle_id=VALUES(vehicle_id),checklist_version=VALUES(checklist_version),revision=revision+1,chosen_at=CURRENT_TIMESTAMP`, [client.id, vehicle.id, version]);
    await db.query('INSERT INTO notifications (client_id,type,message) VALUES (?,?,?)', [client.id, 'final_vehicle_choice', `${client.name} a ${previous ? 'mis à jour' : 'confirmé'} son choix définitif : ${vehicle.title || 'Annonce véhicule'}.`]);
    const choice = await readVehicleChoice(client.id, db);
    await db.commit();
    res.set('Cache-Control', 'no-store').json({ final_choice: choice, message: 'Votre choix définitif a été transmis à votre conseiller.' });
  }
  catch (error) {
    await db.rollback();
    if (!error.status)
      console.error('Choix du véhicule :', error.message);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Impossible d’enregistrer votre choix. Réessayez.' });
  }
  finally {
    db.release();
  }
};
