import express from 'express';
import pool from '../config/db.js';
import {verifyToken} from '../middleware/auth.middleware.js';
const router=express.Router();
const fail=(status,message)=>Object.assign(new Error(message),{status});
const safe=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
const read=async(client,db=pool)=>{
  const [[delivery]]=await db.query("SELECT DATE_FORMAT(delivery_date,'%Y-%m-%d') AS delivery_date,address,revision,updated_at FROM client_deliveries WHERE client_id=?",[client.id]);
  return {client:{name:client.name,step:client.step},delivery:delivery||null,default_address:'Avricourt'};
};
router.get('/:id/delivery',verifyToken,safe(async(req,res)=>{
  const [[client]]=await pool.query('SELECT id,name,step FROM clients WHERE id=? AND user_id=?',[req.params.id,req.userId]);
  if(!client)throw fail(404,'Client introuvable.');
  res.set('Cache-Control','no-store').json(await read(client));
}));
router.get('/public/:token/delivery',safe(async(req,res)=>{
  const [[client]]=await pool.query('SELECT id,name,step FROM clients WHERE access_token=?',[req.params.token]);
  if(!client)throw fail(404,'Lien invalide ou expiré.');
  if(client.step!==6)throw fail(403,'Les informations de livraison seront disponibles à l’étape 6.');
  res.set('Cache-Control','no-store').json(await read(client));
}));
router.patch('/:id/delivery',verifyToken,safe(async(req,res)=>{
  const {delivery_date:date,address,revision}=req.body||{};
  const parsed=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(`${date}T00:00:00Z`):null;
  if(!parsed||!Number.isFinite(parsed.getTime())||Number(date.slice(0,4))<1000||parsed.toISOString().slice(0,10)!==date)throw fail(400,'Choisissez une date de livraison valide.');
  if(typeof address!=='string'||address.trim().length<3||address.trim().length>500||/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(address))throw fail(400,'Renseignez une adresse de livraison entre 3 et 500 caractères.');
  if(!Number.isInteger(revision)||revision<0)throw fail(400,'Actualisez les informations de livraison avant de les enregistrer.');
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const [[client]]=await db.query('SELECT id,name,step FROM clients WHERE id=? AND user_id=? FOR UPDATE',[req.params.id,req.userId]);
    if(!client)throw fail(404,'Client introuvable.');
    if(client.step!==6)throw fail(403,'Les informations de livraison peuvent être modifiées uniquement à l’étape 6.');
    const [[current]]=await db.query('SELECT revision FROM client_deliveries WHERE client_id=? FOR UPDATE',[client.id]);
    if(revision!==(current?.revision||0))throw fail(409,'La livraison a été modifiée. Actualisez les informations avant de les enregistrer.');
    await db.query('INSERT INTO client_deliveries (client_id,delivery_date,address) VALUES (?,?,?) ON DUPLICATE KEY UPDATE delivery_date=VALUES(delivery_date),address=VALUES(address),revision=revision+1',[client.id,date,address.trim().replace(/\r\n?/g,'\n')]);
    const result=await read(client,db);
    await db.commit();res.set('Cache-Control','no-store').json(result);
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}));
router.use((error,req,res,next)=>{
  if(!error.status)console.error('Livraison :',error.message);
  res.status(error.status||500).json({message:error.status?error.message:'Impossible de traiter les informations de livraison.'});
});
export default router;
