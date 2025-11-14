import pool from "../config/db.js";

export const getClientById = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, 
              vr.marque, vr.modele, vr.couleur, vr.budget, vr.max_km, 
              vr.description, vr.carburant, vr.premiere_immat, vr.puissance_min, vr.boite
       FROM clients c
       LEFT JOIN vehicle_requests vr ON c.id = vr.client_id
       WHERE c.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Client non trouvé" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("❌ Erreur récupération client:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

export const getClients = async (req, res) => {
  try {
    const userId = req.userId;
    const [clients] = await pool.query(
      `SELECT c.*, vr.marque, vr.modele, vr.budget, vr.couleur, vr.premiere_immat
       FROM clients c
       LEFT JOIN vehicle_requests vr ON c.id = vr.client_id
       WHERE c.user_id = ?`,
      [userId]
    );
    res.json(clients);
  } catch (error) {
    console.error("❌ Erreur récupération clients:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};


/**
 * PATCH /api/clients/:id
 * Mise à jour partielle (step, progress, champs)
 */
export const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body; // ex: { step: 2, progress: 50 }
    if (!fields || Object.keys(fields).length === 0)
      return res.status(400).json({ message: "Aucun champ à mettre à jour" });

    const keys = Object.keys(fields);
    const values = Object.values(fields);

    const setClause = keys.map(k => `${k} = ?`).join(", ");
    await pool.query(`UPDATE clients SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, id]);

    res.json({ message: "Client mis à jour." });
  } catch (error) {
    console.error("updateClient:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

export const createClient = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      date_of_birth,
      marque,
      modele,
      budget,
      max_km,
      vehicle_color,
      description,
      carburant,
      first_registration,
      puissance_min,
      boite
    } = req.body;

    const userId = req.userId;

    // 1️⃣ Création du client
    const [clientResult] = await pool.query(
       `INSERT INTO clients (user_id, name, email, phone, date_of_birth, step)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [userId, name, email, phone, date_of_birth]
    );

    const clientId = clientResult.insertId;

    // 2️⃣ Création de la demande véhicule associée
 await pool.query(
      `INSERT INTO vehicle_requests (client_id, marque, modele, couleur, carburant, premiere_immat, budget, max_km, description, puissance_min, boite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        marque,
        modele,
        vehicle_color,
        carburant,
        first_registration,
        budget,
        max_km,
        description,
        puissance_min,
        boite
      ]
    );

    res.status(201).json({
      message: "Client et demande véhicule créés avec succès",
      clientId,
    });
  } catch (error) {
    console.error("❌ Erreur création client:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
