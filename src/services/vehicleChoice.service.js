import crypto from 'node:crypto';
import pool from '../config/db.js';

export function checklistVersion(checks){
  // Saving an unchanged checklist can recreate its SQL IDs; only its content matters.
  const values=[...checks].sort((a,b)=>Number(a.id)-Number(b.id)).map(({name,status})=>({name,status}));
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export const checklistReviewed=checks=>checks.length>0&&checks.every(check=>['validated','issue','rejected','not_applicable'].includes(check.status));

export async function readVehicleChoice(clientId,db=pool){
  const [[choice]]=await db.query(`SELECT ch.vehicle_id,ch.checklist_version,ch.chosen_at,ch.revision,v.title,v.link,v.selected_by
    FROM client_vehicle_choices ch JOIN selected_vehicles v ON v.id=ch.vehicle_id AND v.client_id=ch.client_id
    WHERE ch.client_id=?`,[clientId]);
  if(!choice)return null;
  const [checks]=await db.query('SELECT id,name,status FROM vehicle_checks WHERE selected_vehicle_id=?',[choice.vehicle_id]);
  return {...choice,needs_reconfirmation:choice.selected_by!=='client'||choice.checklist_version!==checklistVersion(checks)||!checklistReviewed(checks)};
}
