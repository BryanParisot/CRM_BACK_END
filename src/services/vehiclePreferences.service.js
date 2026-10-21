import pool from '../config/db.js';

const fail = (status, message) => Object.assign(new Error(message), {status});
const normalize = value => (value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('fr');

export function validateVehiclePreference(body) {
  if (typeof body?.marque !== 'string' || !body.marque.trim() || body.marque.trim().length > 255) {
    throw fail(400, 'Renseignez une marque de 255 caractères maximum.');
  }
  const modele = body.modele ?? '';
  if (typeof modele !== 'string' || modele.trim().length > 255) {
    throw fail(400, 'Le modèle doit contenir 255 caractères maximum.');
  }
  return {marque: body.marque.trim(), modele: modele.trim()};
}

export async function readAdditionalVehicles(clientId, db = pool) {
  const [rows] = await db.query('SELECT id,marque,modele FROM additional_vehicle_preferences WHERE client_id=? ORDER BY id', [clientId]);
  return rows;
}

export async function attachAdditionalVehicles(clients) {
  if (!clients.length) return;
  const [rows] = await pool.query('SELECT id,client_id,marque,modele FROM additional_vehicle_preferences WHERE client_id IN (?) ORDER BY id', [clients.map(client => client.id)]);
  const byClient = new Map();
  for (const {client_id, ...vehicle} of rows) {
    if (!byClient.has(client_id)) byClient.set(client_id, []);
    byClient.get(client_id).push(vehicle);
  }
  for (const client of clients) client.additional_vehicles = byClient.get(client.id) || [];
}

export async function changeVehiclePreference(clientId, userId, action, preferenceId, value) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[client]] = await db.query('SELECT id,step FROM clients WHERE id=? AND user_id=? FOR UPDATE', [clientId, userId]);
    if (!client) throw fail(404, 'Client introuvable.');
    if (client.step !== 1) throw fail(409, 'Les véhicules recherchés se renseignent à l’étape 1.');
    const additional = await readAdditionalVehicles(client.id, db);
    if (action !== 'add' && !additional.some(vehicle => vehicle.id === preferenceId)) throw fail(404, 'Véhicule recherché introuvable.');
    if (value) {
      const [[primary]] = await db.query('SELECT marque,modele FROM vehicle_requests WHERE client_id=?', [client.id]);
      const duplicate = [primary, ...additional.filter(vehicle => vehicle.id !== preferenceId)].filter(Boolean).some(vehicle =>
        normalize(vehicle.marque) === normalize(value.marque) && normalize(vehicle.modele) === normalize(value.modele)
      );
      if (duplicate) throw fail(409, 'Ce véhicule figure déjà dans la recherche.');
    }
    if (action === 'add') {
      await db.query('INSERT INTO additional_vehicle_preferences (client_id,marque,modele) VALUES (?,?,?)', [client.id, value.marque, value.modele]);
    } else if (action === 'update') {
      await db.query('UPDATE additional_vehicle_preferences SET marque=?,modele=? WHERE id=? AND client_id=?', [value.marque, value.modele, preferenceId, client.id]);
    } else {
      await db.query('DELETE FROM additional_vehicle_preferences WHERE id=? AND client_id=?', [preferenceId, client.id]);
    }
    const result = await readAdditionalVehicles(client.id, db);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}
