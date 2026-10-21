import pool from '../config/db.js';
import { youtrustEnabled, configuration, signerInfo } from '../services/youtrust.service.js';
import { FINAL_DOCUMENT_KINDS, setDepositConfirmation } from '../services/settlement.service.js';

const validKind = kind => ['cgv', 'invoice', ...FINAL_DOCUMENT_KINDS].includes(kind);
const findOwnedClient = async (req) => {
  const [[client]] = await pool.query('SELECT id, user_id, step, deposit_amount, deposit_paid_amount, payment_confirmed_at, signature_confirmed_at, payment_declared_at, signature_url FROM clients WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  return client;
};

const readDocuments = async (client) => {
  const [docs] = await pool.query('SELECT kind, updated_at FROM client_documents WHERE client_id = ?', [client.id]);
  const [[template]] = await pool.query('SELECT updated_at FROM cgv_templates WHERE user_id = ?', [client.user_id]);
  const [identity] = await pool.query('SELECT kind, updated_at FROM client_identity_documents WHERE client_id = ?', [client.id]);
  const [[signature]] = await pool.query('SELECT request_id,status,environment,last_error FROM client_signatures WHERE client_id=?', [client.id]);
  let readinessError = null;
  if (youtrustEnabled() && !signature) {
    const [[details]] = await pool.query('SELECT first_name,last_name,email,phone FROM clients WHERE id=?', [client.id]);
    try {
      signerInfo(details);
    }
    catch (error) {
      readinessError = error.message;
    }
  }
  return { youtrust_enabled: youtrustEnabled(), youtrust_environment: configuration().environment, youtrust: signature || null, youtrust_error: signature?.last_error || readinessError, identity, signature_confirmed_at: client.signature_confirmed_at, payment_declared_at: client.payment_declared_at, payment_confirmed_at: client.payment_confirmed_at, signature_url: client.signature_url,
    step: client.step, deposit_amount: client.deposit_amount, deposit_paid_amount: client.deposit_paid_amount,
    final_documents: docs.filter(doc => FINAL_DOCUMENT_KINDS.includes(doc.kind)), cgv_template: template || null,
    cgv: docs.find(d => d.kind === 'cgv') || null, invoice: docs.find(d => d.kind === 'invoice') || null };
};

const identityKinds = ['cni_front', 'cni_back', 'license', 'address'];
const findPublicClient = async (req) => {
  const [[client]] = await pool.query('SELECT id, name, step, signature_confirmed_at, payment_confirmed_at FROM clients WHERE access_token = ?', [req.params.token]);
  return client;
};

export const saveCgvTemplate = async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 5 || req.body.subarray(0, 5).toString() !== '%PDF-')
    return res.status(400).json({ message: 'Choisissez un fichier PDF (10 Mo maximum).' });
  await pool.query('INSERT INTO cgv_templates (user_id,content) VALUES (?,?) ON DUPLICATE KEY UPDATE content=VALUES(content), updated_at=CURRENT_TIMESTAMP', [req.userId, req.body]);
  res.json({ message: 'Modèle commun enregistré.' });
};

export const getClientDocuments = async (req, res) => {
  const client = await findOwnedClient(req);
  if (!client)
    return res.status(404).json({ message: 'Client introuvable.' });
  res.set('Cache-Control', 'no-store').json(await readDocuments(client));
};

export const saveClientDocument = async (req, res) => {
  if (!validKind(req.params.kind))
    return res.status(400).json({ message: 'Type de document invalide.' });
  const client = await findOwnedClient(req);
  if (!client)
    return res.status(404).json({ message: 'Client introuvable.' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 5 || req.body.subarray(0, 5).toString() !== '%PDF-')
    return res.status(400).json({ message: 'Choisissez un fichier PDF (10 Mo maximum).' });
  await pool.query(`INSERT INTO client_documents (client_id,kind,content) VALUES (?,?,?) ON DUPLICATE KEY UPDATE content=VALUES(content), updated_at=CURRENT_TIMESTAMP`, [client.id, req.params.kind, req.body]);
  res.json({ message: 'Document enregistré.' });
};

export const downloadClientDocument = async (req, res) => {
  if (!validKind(req.params.kind))
    return res.status(404).json({ message: 'Document introuvable.' });
  const client = await findOwnedClient(req);
  if (!client)
    return res.status(404).json({ message: 'Client introuvable.' });
  const [[doc]] = await pool.query('SELECT content FROM client_documents WHERE client_id=? AND kind=?', [client.id, req.params.kind]);
  if (!doc)
    return res.status(404).json({ message: 'Document non disponible.' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${req.params.kind}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(doc.content);
};

export const updateDocumentSettings = async (req, res) => {
  const client = await findOwnedClient(req);
  if (!client)
    return res.status(404).json({ message: 'Client introuvable.' });
  const [[linked]] = await pool.query('SELECT request_id FROM client_signatures WHERE client_id=?', [client.id]);
  if (linked?.request_id && ('signature_confirmed' in req.body || 'signature_url' in req.body))
    return res.status(409).json({ message: 'La signature est gérée automatiquement par Youtrust.' });
  if ('signature_confirmed' in req.body) {
    if (typeof req.body.signature_confirmed !== 'boolean')
      return res.status(400).json({ message: 'Confirmation invalide.' });
    if (req.body.signature_confirmed) {
      const [[signed]] = await pool.query("SELECT client_id FROM client_documents WHERE client_id = ? AND kind = 'cgv'", [client.id]);
      if (!signed)
        return res.status(400).json({ message: 'Importez les CGV signées avant de confirmer la signature.' });
    }
  }
  if ('payment_confirmed' in req.body && typeof req.body.payment_confirmed !== 'boolean')
    return res.status(400).json({ message: 'Confirmation invalide.' });
  if ('signature_url' in req.body) {
    const value = req.body.signature_url;
    if (typeof value !== 'string' || value.length > 2048)
      return res.status(400).json({ message: 'Lien invalide.' });
    if (value) {
      let url;
      try {
        url = new URL(value);
      }
      catch {
        return res.status(400).json({ message: 'Lien invalide.' });
      }
      if (url.protocol !== 'https:')
        return res.status(400).json({ message: 'Utilisez un lien https://.' });
    }
  }
  if ('payment_confirmed' in req.body)
    await setDepositConfirmation(client.id, req.userId, req.body.payment_confirmed);
  if ('signature_confirmed' in req.body)
    await pool.query('UPDATE clients SET signature_confirmed_at = ? WHERE id = ?', [req.body.signature_confirmed ? new Date() : null, client.id]);
  if ('signature_url' in req.body)
    await pool.query('UPDATE clients SET signature_url = ? WHERE id = ?', [req.body.signature_url || null, client.id]);
  res.json({ message: 'Dossier mis à jour.' });
};

export const getPublicDocuments = async (req, res) => {
  const [[client]] = await pool.query('SELECT id, user_id, name, step, deposit_amount, deposit_paid_amount, payment_confirmed_at, signature_confirmed_at, payment_declared_at, signature_url FROM clients WHERE access_token = ?', [req.params.token]);
  if (!client)
    return res.status(404).json({ message: 'Lien invalide.' });
  const info = await readDocuments(client);
  if (!client.payment_confirmed_at)
    info.invoice = null;
  if (client.step < 5)
    info.final_documents = [];
  res.set('Cache-Control', 'no-store').json({ name: client.name, ...info });
};

export const downloadPublicDocument = async (req, res) => {
  if (!validKind(req.params.kind) && req.params.kind !== 'cgv-template')
    return res.status(404).json({ message: 'Document introuvable.' });
  const [[client]] = await pool.query('SELECT id, user_id, step, payment_confirmed_at FROM clients WHERE access_token = ?', [req.params.token]);
  if (!client)
    return res.status(404).json({ message: 'Lien invalide.' });
  if (req.params.kind === 'invoice' && !client.payment_confirmed_at)
    return res.status(403).json({ message: 'La facture sera disponible après confirmation du paiement.' });
  if (FINAL_DOCUMENT_KINDS.includes(req.params.kind) && client.step < 5)
    return res.status(403).json({ message: 'Ce document sera disponible à l’étape 5.' });
  const [[doc]] = req.params.kind === 'cgv-template'
    ? await pool.query('SELECT content FROM cgv_templates WHERE user_id = ?', [client.user_id])
    : await pool.query('SELECT content FROM client_documents WHERE client_id = ? AND kind = ?', [client.id, req.params.kind]);
  if (!doc)
    return res.status(404).json({ message: 'Document non disponible.' });
  const filename = { cgv: 'CGV-signees', 'cgv-template': 'CGV-modele', invoice: 'Facture', sales_contract: 'Contrat-de-vente', registration: 'Certificat-immatriculation', cebia_report: 'Rapport-CEBIA' }[req.params.kind];
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(doc.content);
};

export const saveIdentityDocument = async (req, res) => {
  const client = await findPublicClient(req);
  if (!client)
    return res.status(404).json({ message: 'Lien invalide.' });
  if (!client.signature_confirmed_at)
    return res.status(403).json({ message: 'La signature des CGV doit être confirmée avant le dépôt.' });
  if (!identityKinds.includes(req.params.kind))
    return res.status(400).json({ message: 'Type de justificatif invalide.' });
  const content = req.body;
  if (!Buffer.isBuffer(content))
    return res.status(400).json({ message: 'Utilisez un PDF, JPG ou PNG.' });
  const mime = content.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
    : content.length >= 3 && content[0] === 255 && content[1] === 216 && content[2] === 255 ? 'image/jpeg'
      : content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : null;
  if (!mime)
    return res.status(400).json({ message: 'Utilisez un PDF, JPG ou PNG valide.' });
  await pool.query('INSERT INTO client_identity_documents (client_id,kind,content,mime) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE content=VALUES(content), mime=VALUES(mime), updated_at=CURRENT_TIMESTAMP', [client.id, req.params.kind, content, mime]);
  res.json({ message: 'Justificatif enregistré.' });
};

export const downloadIdentityDocument = async (req, res) => {
  const client = await findOwnedClient(req);
  if (!client)
    return res.status(404).json({ message: 'Client introuvable.' });
  const [[doc]] = await pool.query('SELECT content,mime FROM client_identity_documents WHERE client_id = ? AND kind = ?', [client.id, req.params.kind]);
  if (!doc)
    return res.status(404).json({ message: 'Justificatif introuvable.' });
  const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[doc.mime];
  res.set({ 'Content-Type': doc.mime, 'Content-Disposition': `attachment; filename="${req.params.kind}.${extension}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(doc.content);
};

export const declareDepositPayment = async (req, res) => {
  const client = await findPublicClient(req);
  if (!client)
    return res.status(404).json({ message: 'Lien invalide.' });
  const [identity] = await pool.query('SELECT kind FROM client_identity_documents WHERE client_id = ?', [client.id]);
  if (!client.signature_confirmed_at || !identityKinds.every(kind => identity.some(doc => doc.kind === kind)))
    return res.status(403).json({ message: 'Terminez la signature et le dépôt des justificatifs avant le paiement.' });
  if (client.step < 3)
    return res.status(403).json({ message: 'Le paiement n’est pas encore ouvert.' });
  const [result] = await pool.query('UPDATE clients SET payment_declared_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_declared_at IS NULL', [client.id]);
  if (result.affectedRows)
    await pool.query('INSERT INTO notifications (client_id,type,message) VALUES (?,?,?)', [client.id, 'payment_declared', `${client.name} indique avoir effectué le virement. Réception à confirmer.`]);
  res.json({ message: 'Déclaration enregistrée. Votre conseiller va vérifier la réception du paiement.' });
};
