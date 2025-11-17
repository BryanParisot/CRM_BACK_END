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

    // 🔍 Récupérer l'étape et le nom du client
    const [[client]] = await pool.query(
      "SELECT name, step FROM clients WHERE id = ?",
      [id]
    );

    if (!client) {
      return res.status(404).json({ message: "Client introuvable" });
    }

    const from_step = client.step;

    // Validation logique habituelle
    if (Math.abs(to_step - from_step) > 1) {
      return res.status(400).json({
        message: "Impossible de sauter plusieurs étapes.",
      });
    }

    // Mise à jour de l'étape
    await pool.query(
      "UPDATE clients SET step = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [to_step, id]
    );

    // Enregistrement historique
    await pool.query(
      `INSERT INTO client_steps (client_id, from_step, to_step, changed_by)
       VALUES (?, ?, ?, ?)`,
      [id, from_step, to_step, changed_by]
    );

    // 🔔 ⭐ ENREGISTRER UNE NOTIFICATION AVEC LE NOM DU CLIENT ⭐
    const message = `${client.name} est passé à l’étape ${to_step}.`;

    await pool.query(
      `INSERT INTO notifications (client_id, message, type, is_read)
       VALUES (?, ?,?, FALSE)`,
      [id, message, "step_change"]
    );

    res.json({
      message: `Étape ${from_step} → ${to_step} validée`,
      from_step,
      to_step,
    });
  } catch (error) {
    console.error("❌ Erreur addClientStep:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
