import pool from "../config/db.js";

export const getClients = async (req, res) => {
  try {
    const userId = req.userId;
    const [clients] = await pool.query(
      "SELECT * FROM clients WHERE user_id = ?",
      [userId]
    );
    res.json(clients);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};



export const getClientById = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM clients WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0)
      return res.status(404).json({ message: "Client non trouvé" });
    res.json(rows[0]);
  } catch (error) {
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
      vehicle,
      budget,
      max_km,
      vehicle_color,
    } = req.body;

    const userId = req.userId; // 🔥 récupéré automatiquement depuis le token

    const [result] = await pool.query(
      `INSERT INTO clients (user_id, name, email, phone, date_of_birth, vehicle, budget, max_km, vehicle_color, step)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        userId,
        name,
        email,
        phone,
        date_of_birth,
        vehicle,
        budget,
        max_km,
        vehicle_color,
      ]
    );

    res
      .status(201)
      .json({ message: "Client créé avec succès", clientId: result.insertId });
  } catch (error) {
    console.error("Erreur création client:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
