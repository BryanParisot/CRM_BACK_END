import bcrypt from 'bcryptjs';
import pool from '../src/config/db.js';

// Reconstitution du schéma à partir des requêtes de l'application.
// Aucun effacement : les tables et le compte existants sont conservés.
const tables = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(100),
    date_of_birth DATE, step INT DEFAULT 1, progress INT DEFAULT 0,
    access_token VARCHAR(128) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS vehicle_requests (
    id INT AUTO_INCREMENT PRIMARY KEY, client_id INT NOT NULL UNIQUE,
    marque VARCHAR(255), modele VARCHAR(255), couleur VARCHAR(255),
    carburant VARCHAR(100), premiere_immat VARCHAR(100), budget DECIMAL(12,2),
    max_km INT, description TEXT, puissance_min INT, boite VARCHAR(100),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS selected_vehicles (
    id INT AUTO_INCREMENT PRIMARY KEY, client_id INT NOT NULL,
    title VARCHAR(512), price VARCHAR(100), mileage VARCHAR(100), year VARCHAR(100),
    fuel VARCHAR(100), gearbox VARCHAR(100), power VARCHAR(100), image TEXT, link TEXT,
    selected_by VARCHAR(20) DEFAULT 'admin', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS vehicle_checks (
    id INT AUTO_INCREMENT PRIMARY KEY, selected_vehicle_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    status ENUM('pending','validated','rejected','not_applicable','issue') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (selected_vehicle_id) REFERENCES selected_vehicles(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS client_steps (
    id INT AUTO_INCREMENT PRIMARY KEY, client_id INT NOT NULL,
    from_step INT, to_step INT, changed_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY, client_id INT NOT NULL,
    type VARCHAR(100), message TEXT, is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`,
];

try {
  for (const sql of tables) await pool.query(sql);
  const [[checkStatus]]=await pool.query("SHOW COLUMNS FROM vehicle_checks LIKE 'status'");
  if(!checkStatus.Type.includes("'issue'"))await pool.query("ALTER TABLE vehicle_checks MODIFY COLUMN status ENUM('pending','validated','rejected','not_applicable','issue') DEFAULT 'pending'");
  for (const [name, definition] of [['first_name', 'VARCHAR(100) NULL'], ['last_name', 'VARCHAR(150) NULL']]) {
    const [columns] = await pool.query('SHOW COLUMNS FROM clients LIKE ?', [name]);
    if (!columns.length) await pool.query(`ALTER TABLE clients ADD COLUMN ${name} ${definition}`);
  }
  for (const [name, definition] of [['payment_confirmed_at', 'DATETIME NULL'], ['signature_confirmed_at', 'DATETIME NULL'], ['payment_declared_at', 'DATETIME NULL'], ['signature_url', 'VARCHAR(2048) NULL']]) {
    const [columns] = await pool.query('SHOW COLUMNS FROM clients LIKE ?', [name]);
    if (!columns.length) await pool.query(`ALTER TABLE clients ADD COLUMN ${name} ${definition}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS client_documents (
    client_id INT NOT NULL, kind VARCHAR(20) NOT NULL, content MEDIUMBLOB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, kind), FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cgv_templates (
    user_id INT PRIMARY KEY, content MEDIUMBLOB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS client_identity_documents (
    client_id INT NOT NULL, kind VARCHAR(30) NOT NULL, content MEDIUMBLOB NOT NULL,
    mime VARCHAR(50) NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, kind), FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS client_signatures (
    client_id INT PRIMARY KEY, request_id VARCHAR(36) UNIQUE,
    environment VARCHAR(20) NOT NULL, template_id VARCHAR(36) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'creating', last_checked_at DATETIME NULL,
    completed_at DATETIME NULL, last_error VARCHAR(1000) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);
  const [syncColumns]=await pool.query("SHOW COLUMNS FROM client_signatures LIKE 'sync_requested'");
  if(!syncColumns.length)await pool.query('ALTER TABLE client_signatures ADD COLUMN sync_requested BOOLEAN NOT NULL DEFAULT FALSE');
  const [depositColumns] = await pool.query("SHOW COLUMNS FROM clients LIKE 'deposit_amount'");
  if (!depositColumns.length) {
    await pool.query('ALTER TABLE clients ADD COLUMN deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 450.00');
  }
  const [paidColumns] = await pool.query("SHOW COLUMNS FROM clients LIKE 'deposit_paid_amount'");
  if (!paidColumns.length) {
    await pool.query('ALTER TABLE clients ADD COLUMN deposit_paid_amount DECIMAL(12,2) NULL');
  }
  await pool.query('UPDATE clients SET deposit_paid_amount=deposit_amount WHERE payment_confirmed_at IS NOT NULL AND deposit_paid_amount IS NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS client_settlements (
    client_id INT PRIMARY KEY, items JSON NOT NULL,
    revision INT NOT NULL DEFAULT 1,
    payment_declared_at DATETIME NULL, payment_confirmed_at DATETIME NULL,
    paid_amount DECIMAL(12,2) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS client_deliveries (
    client_id INT PRIMARY KEY, delivery_date DATE NOT NULL,
    address VARCHAR(500) NOT NULL, revision INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);
  const email = process.env.ADMIN_EMAIL || 'admin@cartrust.local';
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (!existing.length) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('Définir ADMIN_PASSWORD pour créer le compte local.');
    await pool.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      ['Administrateur', email, await bcrypt.hash(password, 10)]);
    console.log(`Compte administrateur créé : ${email}`);
  }
  console.log('Base CRM initialisée.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
