import pool from "../config/db.js";

/**
 * GET /api/clients/:id/steps
 * → Récupère l'historique des transitions de step pour un client
 */
export const getClientSteps = async (req, res) => {
  try {
    const { id } = req.params;
    const [steps] = await pool.query(
      `SELECT id, from_step, to_step, changed_by, created_at
       FROM client_steps
       WHERE client_id = ?
       ORDER BY created_at ASC`,
      [id]
    );

    res.json(steps);
  } catch (error) {
    console.error("❌ Erreur getClientSteps:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * POST /api/clients/:id/steps
 * → Ajoute une nouvelle transition d'étape (ex: 2 → 3)
 */
export const addClientStep = async (req, res) => {
  try {
    const { id } = req.params;
    const { to_step, changed_by = "admin" } = req.body;

    // Récupère l'étape actuelle du client
    const [[client]] = await pool.query(
      "SELECT step FROM clients WHERE id = ?",
      [id]
    );

    if (!client) {
      return res.status(404).json({ message: "Client introuvable" });
    }

    const from_step = client.step;

    // Met à jour l'étape du client
    await pool.query(
      "UPDATE clients SET step = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [to_step, id]
    );

    // Enregistre la transition dans client_steps
    await pool.query(
      `INSERT INTO client_steps (client_id, from_step, to_step, changed_by)
       VALUES (?, ?, ?, ?)`,
      [id, from_step, to_step, changed_by]
    );

    res.json({
      message: "✅ Étape mise à jour avec succès",
      client_id: id,
      from_step,
      to_step,
    });
  } catch (error) {
    console.error("❌ Erreur addClientStep:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
