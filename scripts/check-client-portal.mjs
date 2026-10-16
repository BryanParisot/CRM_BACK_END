import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
const origin=process.env.TEST_API_URL||'http://localhost:3000';
let userId;const clients=[];
try{
  const [user]=await pool.query('INSERT INTO users (name,email,password) VALUES (?,?,?)',['Test espace client',`portal-${Date.now()}@example.com`,'unused']);userId=user.insertId;
  const token=`portal-${Date.now()}-${userId}`;
  const [client]=await pool.query('INSERT INTO clients (user_id,name,first_name,last_name,email,phone,step,access_token) VALUES (?,?,?,?,?,?,?,?)',[userId,'Alex Martin','Alex','Martin','alex@example.com','0612345678',5,token]);clients.push(client.insertId);
  await pool.query('INSERT INTO vehicle_requests (client_id,marque,modele,budget,max_km,description,carburant,boite,couleur,premiere_immat,puissance_min) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[client.insertId,'Toyota','Corolla','25000.00',80000,'Boîte automatique, couleur sobre.','Hybride','Automatique','Gris','2020',120]);
  const res=await fetch(`${origin}/api/clients/public/${token}`);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  const {client:info}=await res.json();assert.equal(info.id,client.insertId);assert.equal(info.first_name,'Alex');assert.equal(info.last_name,'Martin');assert.equal(info.email,'alex@example.com');assert.equal(info.phone,'0612345678');
  assert.equal(info.step,5);assert.equal(info.marque,'Toyota');assert.equal(info.modele,'Corolla');assert.equal(info.budget,'25000.00');assert.equal(info.max_km,80000);assert.equal(info.description,'Boîte automatique, couleur sobre.');
  assert.equal(info.access_token,undefined);assert.equal(info.user_id,undefined);assert.equal(info.password,undefined);
  const otherToken=`other-${token}`;
  const [other]=await pool.query('INSERT INTO clients (user_id,name,step,access_token) VALUES (?,?,?,?)',[userId,'Autre dossier',1,otherToken]);clients.push(other.insertId);
  const otherInfo=await (await fetch(`${origin}/api/clients/public/${otherToken}`)).json();assert.equal(otherInfo.client.name,'Autre dossier');assert.equal(otherInfo.client.marque,null);assert.equal(otherInfo.client.email,null);
  await pool.query('UPDATE vehicle_requests SET modele=? WHERE client_id=?',['Yaris',client.insertId]);
  assert.equal((await (await fetch(`${origin}/api/clients/public/${token}`)).json()).client.modele,'Yaris');
  assert.equal((await fetch(`${origin}/api/clients/public/portal-invalid-token`)).status,404);
  console.log('Espace client OK : coordonnées et critères du bon dossier, données actualisées, anciens dossiers incomplets, lien invalide et absence de jeton ou données internes dans la réponse.');
}finally{
  for(const id of clients)await pool.query('DELETE FROM clients WHERE id=?',[id]);
  if(userId)await pool.query('DELETE FROM users WHERE id=?',[userId]);
  await pool.end();
}
