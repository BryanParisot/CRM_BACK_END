import express from 'express';
import crypto from 'node:crypto';
import pool from '../config/db.js';
import {verifyToken} from '../middleware/auth.middleware.js';
import {configuration, youtrustEnabled, youtrustService} from '../services/youtrust.service.js';

export const youtrustRouter=express.Router();
const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||502).json({message:error.message});}};
for(const [suffix, action] of [['',id=>youtrustService.ensure(id)],['/sync',id=>youtrustService.sync(id,{force:true})]]) {
  youtrustRouter.post(`/:id/youtrust${suffix}`,verifyToken,handle(async(req,res)=>{
    if(!youtrustEnabled())return res.status(503).json({message:'L’intégration Youtrust n’est pas activée.'});
    const [[client]]=await pool.query('SELECT id FROM clients WHERE id=? AND user_id=?',[req.params.id,req.userId]);
    if(!client)return res.status(404).json({message:'Client introuvable.'});
    const result=await action(client.id);
    res.json({message:'Signature Youtrust synchronisée.',...result});
  }));
}

export const youtrustWebhookRouter=express.Router();
youtrustWebhookRouter.post('/',express.raw({type:'application/json',limit:'1mb'}),handle(async(req,res)=>{
  const secret=process.env.YOUTRUST_WEBHOOK_SECRET;
  if(!secret||!youtrustEnabled())return res.status(503).json({message:'Webhook non configuré.'});
  if(!Buffer.isBuffer(req.body))return res.status(400).json({message:'Corps invalide.'});
  const received=Buffer.from(req.get('x-yousign-signature-256')||'');
  const expected=Buffer.from('sha256='+crypto.createHmac('sha256',secret).update(req.body).digest('hex'));
  if(received.length!==expected.length||!crypto.timingSafeEqual(received,expected))return res.status(401).json({message:'Signature invalide.'});
  const issued=Number(req.get('x-yousign-issued-at'));
  if(!Number.isFinite(issued)||Math.abs(Date.now()/1000-issued)>300)return res.status(401).json({message:'Notification expirée.'});
  let event;
  try{event=JSON.parse(req.body.toString());}catch{return res.status(400).json({message:'JSON invalide.'});}
  if(typeof event.sandbox!=='boolean'||event.sandbox!==(configuration().environment==='sandbox'))return res.status(400).json({message:'Environnement incorrect.'});
  const requestId=event.data?.signature_request?.id;
  if(!requestId)return res.sendStatus(204);
  const [[row]]=await pool.query('SELECT client_id,completed_at FROM client_signatures WHERE request_id=? AND environment=?',[requestId,configuration().environment]);
  if(row&&!row.completed_at){
    // Accuser réception rapidement, après avoir conservé la demande en base.
    await pool.query('UPDATE client_signatures SET sync_requested=TRUE,last_checked_at=NULL WHERE client_id=?',[row.client_id]);
    setImmediate(()=>youtrustService.sync(row.client_id,{force:true}).catch(()=>{}));
  }
  res.sendStatus(204);
}));
