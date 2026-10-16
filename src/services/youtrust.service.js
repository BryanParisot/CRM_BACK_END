import pool from '../config/db.js';
import {clientIdentity} from '../utils/clientIdentity.js';

const origins = { sandbox: 'https://api-sandbox.yousign.app/v3', production: 'https://api.yousign.app/v3' };
export function configuration() {
  const environment = process.env.YOUTRUST_ENVIRONMENT || 'sandbox';
  if (!origins[environment]) throw new Error('Environnement Youtrust invalide.');
  return { environment, apiKey: process.env.API_YOUTRUST_KEY?.trim(), templateId: process.env.YOUTRUST_TEMPLATE_ID?.trim(), placeholder: process.env.YOUTRUST_SIGNER_LABEL || 'client' };
}
export const youtrustEnabled = () => process.env.YOUTRUST_ENABLED === 'true';
export function failure(message, status = 400) { return Object.assign(new Error(message), {status}); }

export function signerInfo(client) {
  let identity;
  try { identity = clientIdentity(client.first_name, client.last_name); }
  catch { throw failure('Complétez les champs Prénom et Nom dans le dossier client avant de créer la signature.'); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email || '')) throw failure('Complétez une adresse email valide dans le dossier client.');
  let phone = String(client.phone || '').replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  if (/^0[1-9]\d{8}$/.test(phone)) phone = '+33' + phone.slice(1);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw failure('Complétez le téléphone du client (ex. 06… ou +33…).');
  return { first_name: identity.first_name, last_name: identity.last_name, email: client.email.trim(), phone_number: phone, locale: 'fr' };
}

export async function youtrustApi(path, {method = 'GET', body, binary = false, environment = configuration().environment} = {}) {
  const {apiKey} = configuration();
  if (!apiKey) throw failure('La clé API Youtrust est absente.',503);
  if (!origins[environment]) throw failure('Environnement Youtrust invalide.',503);
  let response;
  try {
    response = await fetch(origins[environment]+path, {method, redirect:'error',
      headers:{Authorization:`Bearer ${apiKey}`,Accept:binary?'application/pdf':'application/json',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(20000)});
  } catch {
    throw Object.assign(failure('Youtrust ne répond pas. Réessayez la synchronisation.',502),{uncertain:true});
  }
  if (!response.ok) {
    const info = await response.json().catch(()=>({}));
    const type = typeof info.type === 'string' && /^[a-zA-Z0-9_.-]+$/.test(info.type) ? ` (${info.type})` : '';
    throw Object.assign(failure(`Youtrust : HTTP ${response.status}${type}. Vérifiez les coordonnées, le modèle et ses champs.`,502),{uncertain:response.status>=500,upstreamStatus:response.status});
  }
  if (binary) {
    if (Number(response.headers.get('content-length')) > 10*1024*1024) throw failure('Le PDF Youtrust dépasse 10 Mo.',502);
    const chunks=[];let length=0;
    for await (const chunk of response.body) {
      length+=chunk.length;
      if(length>10*1024*1024) { throw failure('Le PDF Youtrust dépasse 10 Mo.',502); }
      chunks.push(chunk);
    }
    const pdf=Buffer.concat(chunks);
    if(pdf.subarray(0,5).toString()!=='%PDF-')throw failure('Youtrust n’a pas renvoyé un PDF signé valide.',502);
    return pdf;
  }
  if(response.status===204)return null;
  try{return await response.json();}
  catch{throw Object.assign(failure('Réponse Youtrust illisible. Vérifiez la demande avant de réessayer.',502),{uncertain:true});}
}
const items = value => Array.isArray(value)?value:value?.data || [];

export function createYoutrustService({db=pool,api=youtrustApi,config=configuration}={}) {
  const locked = async (id, action) => {
    const conn=await db.getConnection();const key=`crm_youtrust_${id}`;
    let acquired=false;
    try {
      const [[lock]]=await conn.query('SELECT GET_LOCK(?, 0) AS acquired',[key]);
      acquired=Boolean(lock.acquired);
      if(!acquired)throw failure('Signature en cours de préparation. Patientez quelques secondes.',409);
      return await action(conn);
    } finally { if(acquired)await conn.query('SELECT RELEASE_LOCK(?)',[key]);conn.release(); }
  };
  async function complete(conn, row) {
    if(row.completed_at)return;
    const options={environment:row.environment};
    const documents=items(await api(`/signature_requests/${row.request_id}/documents`,options));
    const signable=documents.filter(d=>d.nature==='signable_document');
    if(signable.length!==1)throw failure('Le modèle doit contenir un seul document de CGV à signer.',502);
    const pdf=await api(`/signature_requests/${row.request_id}/documents/${signable[0].id}/download`,{...options,binary:true});
    await conn.beginTransaction();
    try {
      await conn.query("INSERT INTO client_documents(client_id,kind,content) VALUES (?,'cgv',?) ON DUPLICATE KEY UPDATE content=VALUES(content),updated_at=CURRENT_TIMESTAMP",[row.client_id,pdf]);
      await conn.query('UPDATE clients SET signature_confirmed_at=CURRENT_TIMESTAMP WHERE id=?',[row.client_id]);
      await conn.query("UPDATE client_signatures SET status='done',completed_at=CURRENT_TIMESTAMP,last_error=NULL,sync_requested=FALSE WHERE client_id=?",[row.client_id]);
      await conn.query('INSERT INTO notifications(client_id,type,message) VALUES (?,?,?)',[row.client_id,'cgv_signed','Les CGV ont été signées sur Youtrust et ajoutées au dossier.']);
      await conn.commit();
    }catch(error){await conn.rollback();throw error;}
  }
  async function syncLocked(conn,row,{activate=false}={}) {
    const {environment}=config();
    if(row.environment!==environment)throw failure('Cette invitation appartient à un autre environnement Youtrust.',409);
    await conn.query('UPDATE client_signatures SET last_checked_at=CURRENT_TIMESTAMP WHERE client_id=?',[row.client_id]);
    let request=await api(`/signature_requests/${row.request_id}`,{environment});
    if(request.status==='draft'&&activate) {
      const recipients=items(await api(`/signature_requests/${row.request_id}/signers`,{environment}));
      const [[client]]=await conn.query('SELECT email FROM clients WHERE id=?',[row.client_id]);
      if(recipients.length!==1 || recipients[0].info?.email?.trim().toLowerCase()!==client.email.trim().toLowerCase()) {
        throw failure('Le modèle doit contenir un seul signataire modifiable « client », avec l’email du dossier.',502);
      }
      request=await api(`/signature_requests/${row.request_id}/activate`,{method:'POST',environment});
    }
    if(request.status==='done') {
      await complete(conn,row);
    } else {
      const recipients=items(await api(`/signature_requests/${row.request_id}/signers`,{environment}));
      // Un seul signataire client est pris en charge par ce parcours.
      if(recipients.length!==1)throw failure('Le modèle doit contenir un seul signataire modifiable « client ».',502);
      const link=recipients[0].signature_link;
      const usable=['ongoing','approval'].includes(request.status) && link;
      if(usable && new URL(link).protocol!=='https:')throw failure('Lien de signature Youtrust invalide.',502);
      await conn.query('UPDATE clients SET signature_url=? WHERE id=?',[usable?link:null,row.client_id]);
      await conn.query('UPDATE client_signatures SET status=?,last_error=NULL,sync_requested=FALSE WHERE client_id=?',[request.status,row.client_id]);
    }
    return {status:request.status};
  }
  async function ensure(clientId) {
    const settings=config();
    if(!settings.apiKey||!settings.templateId)throw failure('Configuration Youtrust incomplète.',503);
    return locked(clientId,async conn=>{
      const [[client]]=await conn.query('SELECT id,name,first_name,last_name,email,phone,step,signature_confirmed_at,signature_url FROM clients WHERE id=?',[clientId]);
      if(!client)throw failure('Client introuvable.',404);
      if(client.step<3)throw failure('La signature est disponible à partir de l’étape 3.');
      let [[row]]=await conn.query('SELECT * FROM client_signatures WHERE client_id=?',[clientId]);
      if(row?.completed_at)return {status:'done'};
      if(row?.request_id)return syncLocked(conn,row,{activate:true});
      if(row && ['creating','uncertain'].includes(row.status))throw failure('Création à vérifier dans Youtrust avant de réessayer afin d’éviter un doublon.',409);
      if(client.signature_confirmed_at || client.signature_url)throw failure('Ce dossier dispose déjà d’une signature manuelle. Conservez-la ou retirez-la avant de préparer une nouvelle invitation.',409);
      const info=signerInfo(client);
      await conn.query("INSERT INTO client_signatures(client_id,environment,template_id,status) VALUES (?,?,?,'creating') ON DUPLICATE KEY UPDATE environment=VALUES(environment),template_id=VALUES(template_id),status='creating',last_error=NULL",[clientId,settings.environment,settings.templateId]);
      let request;
      try {
        request=await api('/signature_requests',{method:'POST',body:{name:`CGV Cartrust - dossier ${clientId}`,delivery_mode:'none',template_id:settings.templateId,
          template_placeholders:{signers:[{label:settings.placeholder,info}]}},environment:settings.environment});
        if(!request?.id)throw Object.assign(failure('Réponse de création Youtrust incomplète.',502),{uncertain:true});
      }catch(error){
        await conn.query('UPDATE client_signatures SET status=?,last_error=? WHERE client_id=?',[error.uncertain?'uncertain':'failed',error.message.slice(0,1000),clientId]);
        throw error;
      }
      // Conserver l’ID avant activation pour reprendre sans recréer une invitation.
      await conn.query('UPDATE client_signatures SET request_id=?,status=? WHERE client_id=?',[request.id,request.status,clientId]);
      [[row]]=await conn.query('SELECT * FROM client_signatures WHERE client_id=?',[clientId]);
      try{return await syncLocked(conn,row,{activate:true});}
      catch(error){await conn.query('UPDATE client_signatures SET last_error=? WHERE client_id=?',[error.message.slice(0,1000),clientId]);throw error;}
    });
  }
  async function sync(clientId,{force=false}={}) {
    return locked(clientId,async conn=>{
      const [[row]]=await conn.query('SELECT * FROM client_signatures WHERE client_id=?',[clientId]);
      if(!row?.request_id||row.completed_at)return;
      if(!force&&row.last_checked_at&&Date.now()-new Date(row.last_checked_at).getTime()<60000)return;
      try{return await syncLocked(conn,row);}
      catch(error){await conn.query('UPDATE client_signatures SET last_error=? WHERE client_id=?',[error.message.slice(0,1000),clientId]);throw error;}
    });
  }
  return {ensure,sync};
}
export const youtrustService=createYoutrustService();

export function startYoutrustSync() {
  let running=false;
  const tick=async()=>{
    if(running||!youtrustEnabled())return;
    running=true;
    try {
      const [rows]=await pool.query("SELECT client_id FROM client_signatures WHERE request_id IS NOT NULL AND completed_at IS NULL AND (sync_requested=TRUE OR status IN ('ongoing','approval','done')) AND (last_checked_at IS NULL OR last_checked_at<DATE_SUB(NOW(), INTERVAL 60 SECOND)) LIMIT 20");
      for(const row of rows) await youtrustService.sync(row.client_id).catch(()=>{});
    }catch(error){console.error('Synchronisation Youtrust indisponible.');}finally{running=false;}
  };
  const timer=setInterval(tick,15000);timer.unref();
  return timer;
}
