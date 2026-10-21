import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
import {generateToken} from '../src/utils/generateToken.js';

const origin = process.env.TEST_API_URL || 'http://localhost:3000';
const users = [], clients = [];
try {
  for (const suffix of ['owner', 'other']) {
    const [row] = await pool.query('INSERT INTO users(name,email,password) VALUES (?,?,?)', ['Test priorité', `priority-${suffix}-${Date.now()}@example.com`, 'unused']);
    users.push(row.insertId);
    const [client] = await pool.query('INSERT INTO clients(user_id,name,step,access_token) VALUES (?,?,1,?)', [row.insertId, 'Client test priorité', `priority-${suffix}-${Date.now()}`]);
    clients.push(client.insertId);
  }
  const token = generateToken(users[0]);
  const request = async (path, {method = 'GET', body, jwt = token} = {}) => {
    const response = await fetch(`${origin}/api/clients${path}`, {method, headers: {...(jwt ? {Authorization: `Bearer ${jwt}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: response.status, data: await response.json()};
  };
  const path = `/${clients[0]}/priority`;
  const update = priority => request(path, {method: 'PATCH', body: {is_priority: priority}});
  assert.equal(Boolean((await request(`/${clients[0]}`)).data.is_priority), false);
  assert.equal((await request(path, {method: 'PATCH', jwt: null, body: {is_priority: true}})).status, 401);
  assert.equal((await request(`/${clients[1]}/priority`, {method: 'PATCH', body: {is_priority: true}})).status, 404);
  assert.equal((await request('/0/priority', {method: 'PATCH', body: {is_priority: true}})).status, 404);
  for (const value of [null, 0, 1, 'true', 'false', {}, []]) assert.equal((await update(value)).status, 400);
  assert.equal((await request(path, {method: 'PATCH', body: {}})).status, 400);
  assert.equal((await update(false)).status, 200); // Une répétition de la même valeur est acceptée.
  let result = await update(true);assert.equal(result.status, 200);assert.equal(result.data.is_priority, true);
  assert.equal((await update(true)).status, 200);
  const list = (await request('/')).data;
  assert.equal(Boolean(list.find(client => client.id === clients[0]).is_priority), true);
  const [[saved]] = await pool.query('SELECT is_priority,step,access_token FROM clients WHERE id=?', [clients[0]]);
  assert.equal(saved.is_priority, 1);assert.equal(saved.step, 1);
  const publicClient = (await request(`/public/${saved.access_token}`, {jwt: null})).data.client;
  assert.equal(publicClient.is_priority, undefined);
  await pool.query('UPDATE clients SET step=5 WHERE id=?', [clients[0]]);
  assert.equal((await update(false)).status, 200);
  assert.equal(Boolean((await request(`/${clients[0]}`)).data.is_priority), false);
  assert.equal((await request(`/${clients[0]}`)).data.step, 5);
  const [[other]] = await pool.query('SELECT is_priority FROM clients WHERE id=?', [clients[1]]);assert.equal(other.is_priority, 0);
  console.log('Priorité OK : valeur par défaut, ajout/retrait, persistance, répétition, validation booléenne, droits propriétaire et absence dans le portail client.');
} finally {
  for (const id of clients) await pool.query('DELETE FROM clients WHERE id=?', [id]);
  for (const id of users) await pool.query('DELETE FROM users WHERE id=?', [id]);
  await pool.end();
}
