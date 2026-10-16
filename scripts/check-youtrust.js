import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const environment = process.env.YOUTRUST_ENVIRONMENT || 'sandbox';
const apiKey = process.env.API_YOUTRUST_KEY?.trim();
const templateId = process.env.YOUTRUST_TEMPLATE_ID?.trim();
const origins = {
  sandbox: 'https://api-sandbox.yousign.app/v3',
  production: 'https://api.yousign.app/v3',
};

async function check() {
  if (!origins[environment]) throw new Error('YOUTRUST_ENVIRONMENT doit être sandbox ou production.');
  if (!apiKey) throw new Error('API_YOUTRUST_KEY manque dans .env.');
  if (!templateId) throw new Error('YOUTRUST_TEMPLATE_ID manque dans .env.');

  let cursor;
  const seen = new Set();
  do {
    const query = new URLSearchParams({ limit: '10', ...(cursor ? { after: cursor } : {}) });
    const response = await fetch(`${origins[environment]}/templates?${query}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`API ${environment} : HTTP ${response.status}. Vérifier la clé, ses droits et l’environnement.`);
    }
    const result = await response.json();
    const template = result.data?.find(item => item.id === templateId);
    if (template) {
      if (template.status !== 'active') throw new Error('Modèle trouvé, mais non actif. Activez-le dans Youtrust.');
      console.log(`API ${environment} : clé acceptée, modèle ${templateId} trouvé et actif.`);
      console.log('Vérification en lecture seule terminée. Aucune invitation créée.');
      return;
    }
    cursor = result.meta?.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error('Pagination incohérente de l’API Youtrust.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  throw new Error(`Clé ${environment} acceptée, mais modèle ${templateId} inaccessible. Vérifier l’environnement du modèle et les droits sur son espace de travail.`);
}

check().catch(error => {
  // Ne jamais journaliser les en-têtes de requête ni la clé API.
  console.error(error.name === 'TimeoutError' ? 'Délai de connexion à Youtrust dépassé.' : error.message);
  process.exitCode = 1;
});
