import pool from '../config/db.js';

export const FINAL_DOCUMENT_KINDS = ['sales_contract', 'registration', 'cebia_report'];
export const fail = (status, message) => Object.assign(new Error(message), {status});
export function cents(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) throw fail(400, 'Montant invalide : utilisez au maximum deux décimales.');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export const money = value => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
export function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw fail(400, 'Renseignez entre 1 et 20 postes.');
  const normalized = items.map(item => {
    if (!item || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 150) throw fail(400, 'Chaque poste doit avoir un intitulé de 150 caractères maximum.');
    return {label:item.label.trim(), amount:money(cents(item.amount))};
  });
  const total = normalized.reduce((sum,item) => sum + cents(item.amount), 0);
  if (total <= 0 || total > 999999999999) throw fail(400, 'Le total doit être positif et inférieur à 10 milliards d’euros.');
  return normalized;
}
export function settlementSummary(client, settlement) {
  const items = settlement ? (typeof settlement.items === 'string' ? JSON.parse(settlement.items) : settlement.items) : [];
  const total = items.reduce((sum,item) => sum + cents(item.amount), 0);
  const deposit = client.payment_confirmed_at ? cents(client.deposit_paid_amount ?? client.deposit_amount) : 0;
  const finalPaid = settlement?.payment_confirmed_at ? cents(settlement.paid_amount) : 0;
  return {
    client:{name:client.name,step:client.step}, items, revision:settlement?.revision ?? 0,
    total_amount:settlement ? money(total) : null,
    deposit_requested_amount:client.deposit_amount,
    deposit_paid_amount:money(deposit), deposit_confirmed_at:client.payment_confirmed_at,
    balance_due:settlement ? money(Math.max(total-deposit,0)) : null,
    remaining_amount:settlement ? money(Math.max(total-deposit-finalPaid,0)) : null,
    credit_amount:settlement ? money(Math.max(deposit+finalPaid-total,0)) : '0.00',
    final_payment_declared_at:settlement?.payment_declared_at ?? null,
    final_payment_confirmed_at:settlement?.payment_confirmed_at ?? null,
  };
}
export async function readSettlement(client, db = pool) {
  const [[row]] = await db.query('SELECT * FROM client_settlements WHERE client_id=?',[client.id]);
  const [documents] = await db.query('SELECT kind,updated_at FROM client_documents WHERE client_id=? AND kind IN (?,?,?)',[client.id,...FINAL_DOCUMENT_KINDS]);
  return {...settlementSummary(client,row),documents};
}
export async function setDepositConfirmation(clientId,userId,confirmed) {
  const db=await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[client]]=await db.query('SELECT payment_confirmed_at FROM clients WHERE id=? AND user_id=? FOR UPDATE',[clientId,userId]);
    if(!client)throw fail(404,'Client introuvable.');
    const [[settlement]]=await db.query('SELECT payment_confirmed_at FROM client_settlements WHERE client_id=? FOR UPDATE',[clientId]);
    if(settlement?.payment_confirmed_at && Boolean(client.payment_confirmed_at)!==confirmed)throw fail(409,'Retirez la confirmation du solde avant de modifier celle de l’acompte.');
    await db.query(confirmed
      ? 'UPDATE clients SET deposit_paid_amount=IF(payment_confirmed_at IS NULL,deposit_amount,COALESCE(deposit_paid_amount,deposit_amount)),payment_confirmed_at=COALESCE(payment_confirmed_at,CURRENT_TIMESTAMP) WHERE id=?'
      : 'UPDATE clients SET payment_confirmed_at=NULL,deposit_paid_amount=NULL WHERE id=?',[clientId]);
    // A changed deposit invalidates a declaration made for a different balance.
    if(Boolean(client.payment_confirmed_at)!==confirmed)await db.query('UPDATE client_settlements SET payment_declared_at=NULL,revision=revision+1 WHERE client_id=?',[clientId]);
    await db.commit();
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}
