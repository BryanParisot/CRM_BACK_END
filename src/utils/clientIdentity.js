export function clientIdentity(firstName, lastName) {
  const clean = (value, limit, label) => {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label} invalide.`);
    const result = value.trim().replace(/\s+/gu, ' ');
    if (!result || result.length > limit) throw new Error(`${label} obligatoire (${limit} caractères maximum).`);
    return result;
  };
  const first_name = clean(firstName, 100, 'Prénom');
  const last_name = clean(lastName, 150, 'Nom');
  return { first_name, last_name, name: `${first_name} ${last_name}` };
}
