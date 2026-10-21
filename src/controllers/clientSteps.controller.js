import pool from '../config/db.js';
import {youtrustEnabled,youtrustService} from '../services/youtrust.service.js';
import {readVehicleChoice} from '../services/vehicleChoice.service.js';

export const getClientSteps=async(req,res)=>{
  try{
    const [steps]=await pool.query(`SELECT s.id,s.from_step,s.to_step,s.changed_by,s.created_at
      FROM client_steps s JOIN clients c ON c.id=s.client_id
      WHERE c.id=? AND c.user_id=? ORDER BY s.created_at ASC`,[req.params.id,req.userId]);
    res.json(steps);
  }catch(error){res.status(500).json({message:'Impossible de charger les étapes.'});}
};

export const addClientStep=async(req,res)=>{
  const target=req.body?.to_step;
  if(!Number.isInteger(target)||target<1||target>6)return res.status(400).json({message:'Étape invalide.'});
  const db=await pool.getConnection();let client;
  try{
    await db.beginTransaction();
    [[client]]=await db.query('SELECT id,name,step FROM clients WHERE id=? AND user_id=? FOR UPDATE',[req.params.id,req.userId]);
    if(!client){await db.rollback();return res.status(404).json({message:'Client introuvable.'});}
    if(Math.abs(target-client.step)>1){await db.rollback();return res.status(400).json({message:'Impossible de sauter plusieurs étapes.'});}
    if(target===client.step){await db.commit();return res.json({from_step:client.step,to_step:target,signature_error:null,message:'Dossier déjà dans cette étape.'});}
    if(client.step===4&&target===5){
      const choice=await readVehicleChoice(client.id,db);
      if(!choice||choice.needs_reconfirmation){
        await db.rollback();return res.status(409).json({message:choice?'Les contrôles ont changé. Le client doit reconfirmer son choix définitif.':'Le client doit confirmer son véhicule définitif après consultation des contrôles.'});
      }
    }
    if(target<4){
      const [removed]=await db.query('DELETE FROM client_vehicle_choices WHERE client_id=?',[client.id]);
      if(removed.affectedRows)await db.query('INSERT INTO notifications (client_id,type,message) VALUES (?,?,?)',[client.id,'final_choice_reset',`Le choix définitif de ${client.name} sera à confirmer après le retour aux contrôles.`]);
    }
    await db.query('UPDATE clients SET step=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[target,client.id]);
    await db.query('INSERT INTO client_steps (client_id,from_step,to_step,changed_by) VALUES (?,?,?,?)',[client.id,client.step,target,String(req.userId)]);
    await db.query('INSERT INTO notifications (client_id,message,type) VALUES (?,?,?)',[client.id,`${client.name} est passé à l’étape ${target}.`,'step_change']);
    await db.commit();
  }catch(error){await db.rollback();console.error('Étapes :',error.message);return res.status(500).json({message:'Impossible de changer l’étape.'});}finally{db.release();}
  let signature_error=null;
  if(target===3&&youtrustEnabled())try{await youtrustService.ensure(client.id);}catch(error){signature_error=error.message;}
  res.json({signature_error,message:`Étape ${client.step} → ${target} validée`,from_step:client.step,to_step:target});
};
