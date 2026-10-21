import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
import {generateToken} from '../src/utils/generateToken.js';

const origin = process.env.TEST_API_URL || 'http://localhost:3000';
const users = [], clients = [];
try {
  for (const suffix of ['owner', 'other']) {
    const [row] = await pool.query('INSERT INTO users(name,email,password) VALUES (?,?,?)', ['Test recherches', `preferences-${suffix}-${Date.now()}@example.com`, 'unused']);
    users.push(row.insertId);
  }
  const create = async (user, primary = true) => {
    const token = `preferences-${Date.now()}-${clients.length}`;
    const [row] = await pool.query('INSERT INTO clients(user_id,name,first_name,last_name,step,access_token) VALUES (?,?,?,?,1,?)', [user, 'Test Recherches', 'Test', 'Recherches', token]);
    clients.push(row.insertId);
    if (primary) await pool.query('INSERT INTO vehicle_requests(client_id,marque,modele,budget,max_km,description) VALUES (?,?,?,?,?,?)', [row.insertId, 'Škoda', 'Octavia', '25000.00', 60000, 'Historique complet']);
    return {id: row.insertId, token};
  };
  const own = await create(users[0]), other = await create(users[1]);
  const auth = generateToken(users[0]);
  const request = async (path, {method = 'GET', body, token = auth} = {}) => {
    const res = await fetch(`${origin}/api/clients${path}`, {method, headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: res.status, data: await res.json()};
  };
  const path = `/${own.id}/vehicle-preferences`;
  const add = body => request(path, {method: 'POST', body});
  assert.equal((await request(path, {method: 'POST', token: null, body: {marque: 'Audi', modele: 'Q7'}})).status, 401);
  assert.equal((await request(`/${other.id}/vehicle-preferences`, {method: 'POST', body: {marque: 'Audi'}})).status, 404);
  for (const body of [{}, {marque: ' '}, {marque: null}, {marque: []}, {marque: 'x'.repeat(256)}, {marque: 'Audi', modele: {}}, {marque: 'Audi', modele: 'x'.repeat(256)}]) assert.equal((await add(body)).status, 400);
  let created = await add({marque: ' Audi ', modele: ' Q7 '});
  assert.equal(created.status, 201);
  assert.equal(created.data.additional_vehicles.length, 1);
  const audi = created.data.additional_vehicles[0];
  assert.equal(audi.marque, 'Audi');assert.equal(audi.modele, 'Q7');
  assert.equal((await add({marque: 'audi', modele: 'q7'})).status, 409);
  assert.equal((await add({marque: 'Skoda', modele: 'octavia'})).status, 409);
  assert.equal((await request(path + '/999999', {method: 'PATCH', body: {marque: 'BMW'}})).status, 404);
  const [a, b] = await Promise.all([add({marque: 'Volvo', modele: 'XC60'}), add({marque: 'volvo', modele: 'xc60'})]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal((await add({marque: 'Škoda'})).status, 201); // Une marque seule est possible.
  const admin = await request(`/${own.id}`);
  assert.equal(admin.data.marque, 'Škoda');assert.equal(admin.data.modele, 'Octavia');
  assert.equal(admin.data.budget, '25000.00');assert.equal(admin.data.max_km, 60000);assert.equal(admin.data.description, 'Historique complet');
  assert.equal(admin.data.additional_vehicles.length, 3);
  const publicData = (await request(`/public/${own.token}`, {token: null})).data;
  assert.equal(publicData.client.additional_vehicles.length, 3);
  assert.equal(publicData.client.additional_vehicles[0].client_id, undefined);
  assert.deepEqual((await request(`/public/${other.token}`, {token: null})).data.client.additional_vehicles, []);
  const listed = (await request('/')).data.find(client => client.id === own.id);
  assert.equal(listed.additional_vehicles.length, 3);
  const changed = await request(`${path}/${audi.id}`, {method: 'PATCH', body: {marque: 'Audi', modele: 'Q5'}});
  assert.equal(changed.status, 200);assert.equal(changed.data.additional_vehicles[0].modele, 'Q5');
  assert.equal((await request(`${path}/${audi.id}`, {method: 'PATCH', body: {marque: 'Volvo', modele: 'XC60'}})).status, 409);
  assert.equal((await request(`/${other.id}/vehicle-preferences/${audi.id}`, {method: 'DELETE'})).status, 404);
  // La modification des critères communs conserve les possibilités supplémentaires.
  assert.equal((await request(`/${own.id}`, {method: 'PATCH', body: {budget: 27000, vehicle_color: 'Gris'}})).status, 200);
  assert.equal((await request(`/${own.id}`)).data.additional_vehicles.length, 3);
  await pool.query('UPDATE clients SET step=2 WHERE id=?', [own.id]);
  assert.equal((await add({marque: 'BMW'})).status, 409);
  assert.equal((await request(`${path}/${audi.id}`, {method: 'PATCH', body: {marque: 'BMW'}})).status, 409);
  assert.equal((await request(`${path}/${audi.id}`, {method: 'DELETE'})).status, 409);
  assert.equal((await request(`/${own.id}`)).data.additional_vehicles.length, 3);
  await pool.query('UPDATE clients SET step=1 WHERE id=?', [own.id]);
  assert.equal((await request(`${path}/${audi.id}`, {method: 'DELETE'})).status, 200);
  assert.equal((await request(`/${own.id}`)).data.additional_vehicles.length, 2);
  const legacy = await create(users[0], false);
  assert.equal((await request(`/${legacy.id}/vehicle-preferences`, {method: 'POST', body: {marque: 'Audi', modele: 'Q7'}})).status, 201);
  assert.equal((await request(`/${legacy.id}`)).data.additional_vehicles.length, 1);
  await pool.query('DELETE FROM clients WHERE id=?', [legacy.id]);
  const [[remaining]] = await pool.query('SELECT COUNT(*) AS total FROM additional_vehicle_preferences WHERE client_id=?', [legacy.id]);
  assert.equal(remaining.total, 0);
  console.log('Recherches OK : ajout, modification, retrait, marque seule, doublons/concurrence, critères conservés, persistance, propriétaire, étape 1, portail, liste, anciens dossiers et suppression en cascade.');
} finally {
  for (const id of clients) await pool.query('DELETE FROM clients WHERE id=?', [id]);
  for (const id of users) await pool.query('DELETE FROM users WHERE id=?', [id]);
  await pool.end();
}
