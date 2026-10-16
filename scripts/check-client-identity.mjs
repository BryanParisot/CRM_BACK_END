import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
import {generateToken} from '../src/utils/generateToken.js';

let userId;
const clientIds=[];
try {
  const [user]=await pool.query('INSERT INTO users(name,email,password) VALUES(?,?,?)',['Test identité',`identity-${Date.now()}@example.com`,'unused']);
  userId=user.insertId;
  const token=generateToken(userId);
  const request=async(path,method='GET',body)=>{
    const response=await fetch(`http://localhost:3000/api/clients${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  };
  assert.equal((await request('','POST',{first_name:' ',last_name:'Dupont'})).status,400);
  assert.equal((await request('','POST',{first_name:'Jean'})).status,400);
  const created=await request('','POST',{first_name:'  Jean Pierre  ',last_name:' de La Tour ',email:'test@example.com',phone:'0612345678'});
  assert.equal(created.status,201);
  const id=created.data.id;clientIds.push(id);
  assert.equal(created.data.name,'Jean Pierre de La Tour');
  assert.equal(created.data.first_name,'Jean Pierre');assert.equal(created.data.last_name,'de La Tour');
  assert.equal((await request(`/${id}`,'PATCH',{last_name:"D’Angelo-Dupont"})).status,200);
  const detail=(await request(`/${id}`)).data;
  assert.equal(detail.first_name,'Jean Pierre');assert.equal(detail.last_name,'D’Angelo-Dupont');assert.equal(detail.name,'Jean Pierre D’Angelo-Dupont');
  assert.equal((await request(`/${id}`,'PATCH',{first_name:''})).status,400);
  assert.equal((await request(`/${id}`,'PATCH',{first_name:null})).status,400);
  assert.equal((await request(`/${id}`,'PATCH',{name:'Nom désynchronisé'})).status,400);
  const [legacy]=await pool.query('INSERT INTO clients(user_id,name) VALUES(?,?)',[userId,'Ancien nom conservé']);clientIds.push(legacy.insertId);
  const old=(await request(`/${legacy.insertId}`)).data;
  assert.equal(old.name,'Ancien nom conservé');assert.equal(old.first_name,null);assert.equal(old.last_name,null);
  await request(`/${legacy.insertId}`,'PATCH',{first_name:'Prénom composé',last_name:'Nom composé'});
  assert.equal((await request(`/${legacy.insertId}`)).data.name,'Prénom composé Nom composé');
  console.log('Identité OK : création, noms composés, modification partielle, validation et conservation des anciens noms.');
} finally {
  for(const id of clientIds)await pool.query('DELETE FROM clients WHERE id=?',[id]);
  if(userId)await pool.query('DELETE FROM users WHERE id=?',[userId]);
  await pool.end();
}
