import express from 'express';
import pool from '../config/db.js';
import {verifyToken} from '../middleware/auth.middleware.js';
import {fail,validateItems,settlementSummary,readSettlement} from '../services/settlement.service.js';
const router=express.Router();
const safe=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
const select='SELECT id,name,step,deposit_amount,deposit_paid_amount,payment_confirmed_at FROM clients';
router.get('/:id/settlement',verifyToken,safe(async(req,res)=>{
  const [[client]]=await pool.query(`${select} WHERE id=? AND user_id=?`,[req.params.id,req.userId]);
  if(!client)throw fail(404,'Client introuvable.');
  res.set('Cache-Control','no-store').json(await readSettlement(client));
}));
router.get('/public/:token/settlement',safe(async(req,res)=>{
  const [[client]]=await pool.query(`${select} WHERE access_token=?`,[req.params.token]);
  if(!client)throw fail(404,'Lien invalide ou expiré.');
  if(client.step<5)throw fail(403,'Le récapitulatif sera disponible à l’étape 5.');
  res.set('Cache-Control','no-store').json(await readSettlement(client));
}));
router.patch('/:id/settlement',verifyToken,safe(async(req,res)=>{
  const body=req.body;
  if(!body || !Number.isInteger(body.revision))throw fail(400,'Rechargez le récapitulatif avant de l’enregistrer.');
  const hasItems=Object.hasOwn(body,'items');
  const hasPayment=Object.hasOwn(body,'payment_confirmed');
  if(hasItems===hasPayment)throw fail(400,'Modifiez les montants ou la confirmation du paiement séparément.');
  const items=hasItems?validateItems(body.items):null;
  if(hasPayment&&typeof body.payment_confirmed!=='boolean')throw fail(400,'Confirmation invalide.');
  const db=await pool.getConnection();
  let client;
  try{
    await db.beginTransaction();
    [[client]]=await db.query(`${select} WHERE id=? AND user_id=? FOR UPDATE`,[req.params.id,req.userId]);
    if(!client)throw fail(404,'Client introuvable.');
    if(client.step!==5)throw fail(403,'Le solde peut être modifié uniquement à l’étape 5.');
    const [[row]]=await db.query('SELECT * FROM client_settlements WHERE client_id=? FOR UPDATE',[client.id]);
    const summary=settlementSummary(client,row);
    if(body.revision!==summary.revision)throw fail(409,'Le récapitulatif a changé. Actualisez-le et vérifiez les montants.');
    if(hasItems){
      if(row?.payment_confirmed_at)throw fail(409,'Retirez la confirmation du solde avant de modifier les montants.');
      await db.query('INSERT INTO client_settlements (client_id,items) VALUES (?,?) ON DUPLICATE KEY UPDATE items=VALUES(items),revision=revision+1,payment_declared_at=NULL',[client.id,JSON.stringify(items)]);
    }else{
      if(!row)throw fail(400,'Renseignez les montants avant de confirmer le paiement.');
      if(body.balance_due!==summary.balance_due)throw fail(409,'Le solde a changé. Vérifiez le montant avant de confirmer.');
      if(body.payment_confirmed&&summary.balance_due==='0.00')throw fail(400,'Aucun solde supplémentaire à confirmer.');
      if(Boolean(row.payment_confirmed_at)!==body.payment_confirmed)await db.query('UPDATE client_settlements SET payment_confirmed_at=?,paid_amount=?,revision=revision+1 WHERE client_id=?',[body.payment_confirmed?new Date():null,body.payment_confirmed?summary.balance_due:null,client.id]);
    }
    const result=await readSettlement(client,db);
    await db.commit();res.set('Cache-Control','no-store').json(result);
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}));
router.post('/public/:token/final-payment-declaration',safe(async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const [[client]]=await db.query(`${select} WHERE access_token=? FOR UPDATE`,[req.params.token]);
    if(!client)throw fail(404,'Lien invalide ou expiré.');
    if(client.step!==5)throw fail(403,'Le règlement du solde est ouvert uniquement à l’étape 5.');
    const [[row]]=await db.query('SELECT * FROM client_settlements WHERE client_id=? FOR UPDATE',[client.id]);
    const summary=settlementSummary(client,row);
    if(!row||summary.balance_due==='0.00'||row.payment_confirmed_at)throw fail(409,'Aucun solde à déclarer.');
    if(req.body?.revision!==summary.revision||req.body?.balance_due!==summary.balance_due)throw fail(409,'Le solde a changé. Actualisez la page avant de déclarer votre virement.');
    if(!row.payment_declared_at){
      await db.query('UPDATE client_settlements SET payment_declared_at=CURRENT_TIMESTAMP WHERE client_id=?',[client.id]);
      await db.query('INSERT INTO notifications (client_id,type,message) VALUES (?,?,?)',[client.id,'final_payment_declared',`${client.name} indique avoir viré le solde de ${summary.balance_due} €. Réception à confirmer.`]);
    }
    const result=await readSettlement(client,db);
    await db.commit();res.set('Cache-Control','no-store').json(result);
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}));
router.use((error,req,res,next)=>{
  if(!error.status)console.error('Solde :',error.message);
  res.status(error.status||500).json({message:error.status?error.message:'Impossible de traiter le récapitulatif.'});
});
export default router;
