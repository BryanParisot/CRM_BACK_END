import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import {youtrustWebhookRouter} from '../src/routes/youtrust.routes.js';
import pool from '../src/config/db.js';
import {createYoutrustService,signerInfo} from '../src/services/youtrust.service.js';

const config=()=>({environment:'sandbox',apiKey:'fake-test-key',templateId:'test-template',placeholder:'client'});
let userId;
const clients=[];
async function newClient(name='Prénom Test') {
  const [row]=await pool.query('INSERT INTO clients(user_id,name,first_name,last_name,email,phone,step) VALUES(?,?,?,?,?,?,3)',[userId,name,name==='bryan'?null:'Prénom',name==='bryan'?null:'Test','test@example.com','0612345678']);
  clients.push(row.insertId);return row.insertId;
}
await test('Intégration Youtrust : reprise, confidentialité et récupération automatique', async t=>{
  const [user]=await pool.query('INSERT INTO users(name,email,password) VALUES(?,?,?)',['Test Youtrust',`youtrust-${Date.now()}@example.com`,'unused']);
  userId=user.insertId;
  try {
    await t.test('Réutilise les coordonnées et normalise le téléphone',()=>{
      const info=signerInfo({first_name:'Prénom composé',last_name:'Nom composé',email:'test@example.com',phone:'06 12 34 56 78'});
      assert.equal(info.first_name,'Prénom composé');assert.equal(info.last_name,'Nom composé');assert.equal(info.phone_number,'+33612345678');
      assert.throws(()=>signerInfo({name:'bryan',email:'test@example.com',phone:'0612345678'}),/Prénom et Nom/);
    });
    await t.test('Une invitation unique, reprise après activation, PDF avant déblocage',async()=>{
      const id=await newClient();let creates=0,activations=0,done=false;
      const api=async(path,options={})=>{
        if(path==='/signature_requests'){
          creates++;assert.equal(options.body.delivery_mode,'none');assert.equal(options.body.template_placeholders.signers[0].label,'client');assert.equal(options.body.template_placeholders.signers[0].info.email,'test@example.com');
          return {id:'mock-request',status:'draft'};
        }
        if(path.endsWith('/activate')){activations++;return {status:'ongoing'};}
        if(path.endsWith('/signers'))return [{id:'mock-signer',info:{email:'test@example.com'},signature_link:'https://example.com/sign'}];
        if(path.endsWith('/documents'))return [{id:'mock-doc',nature:'signable_document'}];
        if(path.endsWith('/download'))return Buffer.from('%PDF-1.4\nSIGNED');
        return {status:done?'done':activations?'ongoing':'draft'};
      };
      const service=createYoutrustService({api,config});
      await service.ensure(id);await service.ensure(id);
      assert.equal(creates,1);assert.equal(activations,1);
      let [[client]]=await pool.query('SELECT signature_url,signature_confirmed_at,payment_confirmed_at FROM clients WHERE id=?',[id]);
      assert.equal(client.signature_url,'https://example.com/sign');assert.equal(client.signature_confirmed_at,null);
      done=true;await service.sync(id,{force:true});await service.sync(id,{force:true});
      [[client]]=await pool.query('SELECT signature_confirmed_at,payment_confirmed_at FROM clients WHERE id=?',[id]);
      assert.ok(client.signature_confirmed_at);assert.equal(client.payment_confirmed_at,null);
      const [[document]]=await pool.query("SELECT content FROM client_documents WHERE client_id=? AND kind='cgv'",[id]);assert.match(document.content.toString(),/SIGNED/);
      const [[count]]=await pool.query("SELECT COUNT(*) AS total FROM notifications WHERE client_id=? AND type='cgv_signed'",[id]);assert.equal(count.total,1);
    });
    await t.test('Activation échouée : reprend la même invitation',async()=>{
      const id=await newClient();let creates=0,fail=true;
      const api=async(path,options)=>{
        if(path==='/signature_requests'){creates++;return {id:'mock-resume',status:'draft'};}
        if(path.endsWith('/activate')){if(fail)throw new Error('Activation échouée');return {status:'ongoing'};}
        if(path.endsWith('/signers'))return [{info:{email:'test@example.com'},signature_link:'https://example.com/sign'}];
        return {status:'draft'};
      };
      const service=createYoutrustService({api,config});
      await assert.rejects(service.ensure(id),/Activation/);fail=false;await service.ensure(id);assert.equal(creates,1);
    });
    await t.test('Réponse de création incertaine : ne crée pas de doublon',async()=>{
      const id=await newClient();let creates=0;
      const service=createYoutrustService({config,api:async()=>{creates++;throw Object.assign(new Error('Timeout'),{uncertain:true});}});
      await assert.rejects(service.ensure(id),/Timeout/);await assert.rejects(service.ensure(id),/doublon/);assert.equal(creates,1);
    });
    await t.test('Impossible de débloquer la suite si le téléchargement échoue',async()=>{
      const id=await newClient();await pool.query("INSERT INTO client_signatures(client_id,request_id,environment,template_id,status) VALUES (?,?,'sandbox','test-template','ongoing')",[id,'mock-pdf-failed']);
      const service=createYoutrustService({config,api:async path=>{if(path.endsWith('/documents'))return [{id:'mock-doc',nature:'signable_document'}];if(path.includes('/download'))throw new Error('PDF indisponible');return {status:'done'};}});
      await assert.rejects(service.sync(id,{force:true}),/PDF/);
      const [[client]]=await pool.query('SELECT signature_confirmed_at FROM clients WHERE id=?',[id]);assert.equal(client.signature_confirmed_at,null);
    });
    await t.test('Pas d’appel API sans nom complet ni mélange d’environnements',async()=>{
      const id=await newClient('bryan');let calls=0;const service=createYoutrustService({config,api:async()=>{calls++;}});
      await assert.rejects(service.ensure(id),/Prénom et Nom/);assert.equal(calls,0);
      await pool.query("INSERT INTO client_signatures(client_id,request_id,environment,template_id,status) VALUES (?,?,'production','test-template','ongoing')",[id,'mock-production']);
      await assert.rejects(service.sync(id,{force:true}),/autre environnement/);assert.equal(calls,0);
    });
    await t.test('Deux clics simultanés ne créent pas deux invitations',async()=>{
      const id=await newClient();let release,started,creates=0;
      const ready=new Promise(resolve=>{started=resolve;});
      const gate=new Promise(resolve=>{release=resolve;});
      const service=createYoutrustService({config,api:async path=>{
        if(path==='/signature_requests'){creates++;started();await gate;return {id:'mock-concurrent',status:'draft'};}
        if(path.endsWith('/signers'))return [{info:{email:'test@example.com'},signature_link:'https://example.com/sign'}];
        return {status:'ongoing'};
      }});
      const first=service.ensure(id);await ready;
      try{await assert.rejects(service.ensure(id),error=>error.status===409);}finally{release();}
      await first;assert.equal(creates,1);
    });
    await t.test('Webhook : HMAC, corps brut, date et environnement sont vérifiés',async()=>{
      const previous={secret:process.env.YOUTRUST_WEBHOOK_SECRET,enabled:process.env.YOUTRUST_ENABLED,environment:process.env.YOUTRUST_ENVIRONMENT};
      process.env.YOUTRUST_WEBHOOK_SECRET='test-webhook-secret';process.env.YOUTRUST_ENABLED='true';process.env.YOUTRUST_ENVIRONMENT='sandbox';
      const app=express();app.use('/webhook',youtrustWebhookRouter);
      const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
      const send=async(body,{signedBody=body,age=0}={})=>fetch(`http://127.0.0.1:${server.address().port}/webhook`,{method:'POST',headers:{'Content-Type':'application/json','x-yousign-issued-at':String(Math.floor(Date.now()/1000)-age),'x-yousign-signature-256':'sha256='+crypto.createHmac('sha256','test-webhook-secret').update(signedBody).digest('hex')},body});
      try {
        const body=JSON.stringify({sandbox:true,event_name:'signature_request.done',data:{signature_request:{id:crypto.randomUUID()}}});
        assert.equal((await send(body)).status,204);
        assert.equal((await send(body,{signedBody:body+' '})).status,401);
        assert.equal((await send(body,{age:600})).status,401);
        assert.equal((await send(body.replace('true','false'))).status,400);
        assert.equal((await send('{invalid-json')).status,400);
      }finally{
        await new Promise(resolve=>server.close(resolve));
        for(const [key,value] of [['YOUTRUST_WEBHOOK_SECRET',previous.secret],['YOUTRUST_ENABLED',previous.enabled],['YOUTRUST_ENVIRONMENT',previous.environment]]){
          if(value===undefined)delete process.env[key];else process.env[key]=value;
        }
      }
    });
  } finally {
    for(const id of clients){await pool.query('DELETE FROM notifications WHERE client_id=?',[id]);await pool.query('DELETE FROM clients WHERE id=?',[id]);}
    if(userId)await pool.query('DELETE FROM users WHERE id=?',[userId]);
    await pool.end();
  }
});
