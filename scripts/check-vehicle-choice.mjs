import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
import {generateToken} from '../src/utils/generateToken.js';
const origin=process.env.TEST_API_URL||'http://localhost:3000';
const clients=[];const users=[];
try{
  for(const suffix of ['owner','other']){const [row]=await pool.query('INSERT INTO users(name,email,password) VALUES (?,?,?)',['Test choix définitif',`choice-${suffix}-${Date.now()}@example.com`,'unused']);users.push(row.insertId);}
  const auth=generateToken(users[0]);
  const request=async(path,{method='GET',body,jwt=auth}={})=>{
    const response=await fetch(`${origin}/api${path}`,{method,headers:{...(jwt?{Authorization:`Bearer ${jwt}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  };
  const fixture=async(userId)=>{
    const token=`final-choice-${Date.now()}-${clients.length}`;
    const [client]=await pool.query('INSERT INTO clients(user_id,name,step,access_token) VALUES (?, ?,4,?)',[userId,'Client de test',token]);clients.push(client.insertId);const vehicles=[];
    for(let i=0;i<3;i++){
      const [vehicle]=await pool.query('INSERT INTO selected_vehicles(client_id,title,link,selected_by) VALUES (?,?,?,?)',[client.insertId,`Annonce ${i+1}`,'https://example.com/annonce',i===2?'admin':'client']);vehicles.push(vehicle.insertId);
      if(i<2)for(const [name,status] of [['Entretien','validated'],['Contrôle technique',i===0?'issue':'validated']])await pool.query('INSERT INTO vehicle_checks(selected_vehicle_id,name,status) VALUES (?,?,?)',[vehicle.insertId,name,status]);
    }
    return {id:client.insertId,token,vehicles};
  };
  const own=await fixture(users[0]),foreign=await fixture(users[1]);
  const read=async(client=own)=>{const result=await request(`/clients/public/${client.token}`,{jwt:null});assert.equal(result.status,200);return result.data;};
  const confirm=(body,client=own)=>request(`/clients/public/${client.token}/final-vehicle`,{method:'PUT',body,jwt:null});
  const bodyFor=async(index,revision=0,client=own)=>{const data=await read(client);const vehicle=data.vehicles.find(v=>v.id===client.vehicles[index]);return {vehicle_id:vehicle.id,checklist_version:vehicle.checklist_version,expected_revision:revision,acknowledged_checks:true};};
  const advance=step=>request(`/clients/${own.id}/steps`,{method:'POST',body:{to_step:step}});
  assert.equal((await read()).final_choice,null);
  assert.equal((await advance(5)).status,409);
  const first=await bodyFor(0);
  assert.equal((await confirm({...first,acknowledged_checks:false})).status,400);
  assert.equal((await confirm({...first,vehicle_id:String(first.vehicle_id)})).status,400);
  assert.equal((await confirm({...first,vehicle_id:foreign.vehicles[0]})).status,404);
  assert.equal((await confirm({...first,vehicle_id:own.vehicles[2]})).status,404);
  assert.equal((await request('/clients/public/invalid-choice/final-vehicle',{method:'PUT',body:first,jwt:null})).status,404);
  await pool.query('UPDATE clients SET step=3 WHERE id=?',[own.id]);assert.equal((await confirm(first)).status,409);await pool.query('UPDATE clients SET step=4 WHERE id=?',[own.id]);
  await pool.query("UPDATE vehicle_checks SET status='pending' WHERE selected_vehicle_id=?",[own.vehicles[0]]);assert.equal((await confirm(await bodyFor(0))).status,409);await pool.query("UPDATE vehicle_checks SET status='validated' WHERE selected_vehicle_id=?",[own.vehicles[0]]);
  let choice=await bodyFor(0);assert.equal((await confirm(choice)).status,200);assert.equal((await confirm(choice)).status,200);
  let info=await read();assert.equal(info.final_choice.vehicle_id,own.vehicles[0]);assert.equal(info.final_choice.revision,1);assert.equal(info.final_choice.needs_reconfirmation,false);
  const sameChecks=info.vehicles.find(v=>v.id===own.vehicles[0]).checklist.map(({name,status})=>({name,status}));
  assert.equal((await request(`/clients/vehicle/${own.vehicles[0]}/checks`,{method:'POST',body:{checks:sameChecks}})).status,200);
  assert.equal((await read()).final_choice.needs_reconfirmation,false);
  assert.equal((await confirm(await bodyFor(1,0))).status,409);
  assert.equal((await confirm(await bodyFor(1,1))).status,409);
  info=await read();assert.equal(info.final_choice.vehicle_id,own.vehicles[0]);assert.equal(info.vehicles.filter(v=>v.selected_by==='client').length,2);
  const [[count]]=await pool.query("SELECT COUNT(*) AS total FROM notifications WHERE client_id=? AND type='final_vehicle_choice'",[own.id]);assert.equal(count.total,1);
  let admin=(await request(`/vehicles/client/${own.id}`)).data;assert.equal(admin.filter(v=>v.is_final_choice).length,1);assert.equal(admin.find(v=>v.is_final_choice).id,own.vehicles[0]);
  assert.equal((await read(foreign)).final_choice,null);
  const stale=await bodyFor(0,1);
  assert.equal((await request(`/clients/vehicle/${own.vehicles[0]}/checks`,{method:'POST',body:{checks:[{name:'Entretien',status:'validated'},{name:'Contrôle technique',status:'issue'}]}})).status,200);
  assert.equal((await read()).final_choice.needs_reconfirmation,true);assert.equal((await advance(5)).status,409);assert.equal((await confirm(stale)).status,409);
  assert.equal((await confirm(await bodyFor(1,1))).status,409);
  assert.equal((await confirm(await bodyFor(0,1))).status,200);
  admin=(await request(`/vehicles/client/${own.id}`)).data;assert.equal(admin.find(v=>v.is_final_choice).final_choice_needs_reconfirmation,false);
  assert.equal((await advance(5)).status,200);
  assert.equal((await confirm(await bodyFor(0,2))).status,409);
  assert.equal((await request(`/clients/public/${own.token}/vehicles/${own.vehicles[0]}/decision`,{method:'PUT',body:{decision:'rejected'},jwt:null})).status,409);
  assert.equal((await request(`/vehicles/${own.vehicles[0]}`,{method:'DELETE'})).status,409);
  assert.equal((await request(`/clients/${own.id}`,{method:'PATCH',body:{step:4}})).status,400);
  const parallel=await fixture(users[0]);const results=await Promise.all([confirm(await bodyFor(0,0,parallel),parallel),confirm(await bodyFor(1,0,parallel),parallel)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const [[rows]]=await pool.query('SELECT COUNT(*) AS total FROM client_vehicle_choices WHERE client_id=?',[parallel.id]);assert.equal(rows.total,1);
  const finalParallel=await read(parallel);const otherIndex=finalParallel.final_choice.vehicle_id===parallel.vehicles[0]?1:0;
  assert.equal((await confirm(await bodyFor(otherIndex,finalParallel.final_choice.revision,parallel),parallel)).status,409);
  console.log('Choix définitif OK : confirmation unique, changement de véhicule bloqué dès confirmation, isolation par lien, persistance, notification sans doublon, confirmations concurrentes, relecture des contrôles du même véhicule et verrouillage à l’étape 5.');
}finally{
  for(const id of clients)await pool.query('DELETE FROM clients WHERE id=?',[id]);
  for(const id of users)await pool.query('DELETE FROM users WHERE id=?',[id]);
  await pool.end();
}
