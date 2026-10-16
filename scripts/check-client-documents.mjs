import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
import { generateToken } from '../src/utils/generateToken.js';

const origin = process.env.TEST_API_URL || 'http://localhost:3000';
let userId, clientId;
const pdf = Buffer.from('%PDF-1.4\n% Document de test\n%%EOF');
try {
  const [user] = await pool.query('INSERT INTO users (name,email,password) VALUES (?,?,?)', ['Test documents',`documents-test-${Date.now()}@example.com`,'unused']);
  userId = user.insertId;
  const accessToken = `documents-test-${Date.now()}-${userId}`;
  const [client] = await pool.query('INSERT INTO clients (user_id,name,step,access_token) VALUES (?,?,?,?)', [userId,'Test documents',3,accessToken]);
  clientId = client.insertId;
  const auth = generateToken(userId);
  const foreignAuth = generateToken(0);
  const request = (path, { method = 'GET', body, token, pdfBody = false } = {}) => fetch(`${origin}/api/clients${path}`, {
    method, headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':pdfBody?'application/pdf':'application/json'}:{})},
    ...(body?{body:pdfBody?body:JSON.stringify(body)}:{}),
  });
  const publicPath = `/public/${accessToken}/documents`;
  assert.equal((await request(`/${clientId}/documents`)).status,401);
  assert.equal((await request(`/${clientId}/documents`,{token:foreignAuth})).status,404);
  assert.equal((await request(`/${clientId}/documents/cgv`,{method:'PUT',body:Buffer.from('not a PDF'),pdfBody:true,token:auth})).status,400);
  assert.equal((await request(`/public/${accessToken}/identity/cni_front`,{method:'PUT',body:pdf,pdfBody:true})).status,403);
  assert.equal((await request(`/public/${accessToken}/payment-declaration`,{method:'POST'})).status,403);
  assert.equal((await request(`/${clientId}/document-settings`,{method:'PATCH',body:{signature_confirmed:true},token:auth})).status,400);
  for(const kind of ['cgv','invoice']) assert.equal((await request(`/${clientId}/documents/${kind}`,{method:'PUT',body:pdf,pdfBody:true,token:auth})).status,200);
  assert.equal((await request('/templates/cgv',{method:'PUT',body:pdf,pdfBody:true,token:auth})).status,200);
  assert.equal(await (await request(publicPath+'/cgv-template')).text(),pdf.toString());
  assert.equal((await request(`/${clientId}/document-settings`,{method:'PATCH',body:{signature_confirmed:true},token:auth})).status,200);
  for(const kind of ['cni_front','cni_back','license','address']) {
    assert.equal((await request(`/public/${accessToken}/identity/${kind}`,{method:'PUT',body:pdf,pdfBody:true})).status,200);
    const received=await (await request(`/${clientId}/documents`,{token:auth})).json();
    assert.ok(received.identity.some(document=>document.kind===kind&&document.updated_at),'Le justificatif doit apparaître immédiatement dans le suivi administrateur.');
  }
  const replacement=Buffer.from('%PDF-1.4\n% Justificatif remplace\n%%EOF');
  assert.equal((await request(`/public/${accessToken}/identity/address`,{method:'PUT',body:replacement,pdfBody:true})).status,200);
  const received=await (await request(`/${clientId}/documents`,{token:auth})).json();
  assert.equal(received.identity.length,4,'Remplacer un justificatif ne doit pas créer de doublon.');
  assert.equal(await (await request(`/${clientId}/identity/address`,{token:auth})).text(),replacement.toString());
  assert.equal((await request(`/${clientId}/identity/cni_front`,{token:foreignAuth})).status,404);
  assert.equal(await (await request(`/${clientId}/identity/cni_front`,{token:auth})).text(),pdf.toString());
  assert.equal((await request(`/public/${accessToken}/payment-declaration`,{method:'POST'})).status,200);
  assert.equal((await request(`/public/${accessToken}/payment-declaration`,{method:'POST'})).status,200);
  const [[notifications]]=await pool.query("SELECT COUNT(*) AS total FROM notifications WHERE client_id=? AND type='payment_declared'",[clientId]);
  assert.equal(notifications.total,1);
  let metadata = await (await request(publicPath)).json();
  assert.ok(metadata.cgv_template);assert.ok(metadata.cgv);assert.equal(metadata.invoice,null);
  assert.equal((await request(publicPath+'/invoice')).status,403);
  assert.equal(await (await request(publicPath+'/cgv')).text(),pdf.toString());
  assert.equal((await request('/public/bad-token/documents/cgv')).status,404);
  assert.equal((await request(`/${clientId}/document-settings`,{method:'PATCH',body:{payment_confirmed:true}})).status,401);
  assert.equal((await request(`/${clientId}/document-settings`,{method:'PATCH',body:{payment_confirmed:true},token:foreignAuth})).status,404);
  assert.equal((await request(`/${clientId}/document-settings`,{method:'PATCH',body:{payment_confirmed:'yes'},token:auth})).status,400);
  assert.equal((await request(`/${clientId}/document-settings`,{method:'PATCH',body:{payment_confirmed:true},token:auth})).status,200);
  metadata = await (await request(publicPath)).json();assert.ok(metadata.invoice);assert.ok(metadata.payment_confirmed_at);
  const download = await request(publicPath+'/invoice');
  assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal(await download.text(),pdf.toString());
  await request(`/${clientId}/document-settings`,{method:'PATCH',body:{payment_confirmed:false},token:auth});
  assert.equal((await request(publicPath+'/invoice')).status,403);
  assert.equal((await request(`/${clientId}/document-settings`,{method:'PATCH',body:{signature_url:'javascript:alert(1)'},token:auth})).status,400);
  console.log('Documents OK : import PDF, accès propriétaire, téléchargement par lien client, facture bloquée avant confirmation et après révocation.');
} finally {
  if(clientId){ await pool.query('DELETE FROM notifications WHERE client_id = ?',[clientId]); await pool.query('DELETE FROM clients WHERE id = ?',[clientId]); }
  if(userId)await pool.query('DELETE FROM users WHERE id = ?',[userId]);
  await pool.end();
}
