import pool from "../config/db.js";

/**
 * ADMIN — Ajout de véhicules présélectionnés pour un client
 * POST /api/vehicles/preselect
 */
export const preselectVehicles = async (req, res) => {
  try {
    const { client_id, vehicles } = req.body;

    if (!client_id || !Array.isArray(vehicles)) {
      return res.status(400).json({ message: "Requête invalide" });
    }

    for (const v of vehicles) {
      await pool.query(
        `INSERT INTO selected_vehicles 
         (client_id, title, price, mileage, year, fuel, gearbox, power, image, link, selected_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')`,
        [
          client_id,
          v.title,
          v.price,
          v.mileage,
          v.year,
          v.fuel,
          v.gearbox,
          v.power,
          v.image,
          v.link,
        ]
      );
    }

    res.status(201).json({ message: "✅ Véhicules présélectionnés enregistrés." });
  } catch (error) {
    console.error("Erreur preselectVehicles:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * GET /api/vehicles/client/:id
 * → Récupère les véhicules présélectionnés par l’admin pour un client
 */
export const getPreselectedVehicles = async (req, res) => {
  try {
    const { id } = req.params; // id du client
    const [rows] = await pool.query(
      "SELECT * FROM selected_vehicles WHERE client_id = ? ",
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error("Erreur getPreselectedVehicles:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * CLIENT — Sélectionne jusqu’à 3 véhicules parmi ceux proposés
 * POST /api/vehicles/client-select
 */
export const selectByClient = async (req, res) => {
  try {
    const { clientId, vehicles } = req.body;

    if (!clientId || !vehicles || vehicles.length === 0) {
      return res.status(400).json({ message: "❌ clientId et véhicules requis." });
    }

    if (vehicles.length > 3) {
      return res.status(400).json({ message: "❌ Max 3 véhicules autorisés." });
    }

    for (const v of vehicles) {
      await pool.query(
        `INSERT INTO selected_vehicles 
         (client_id, title, price, mileage, year, fuel, gearbox, power, image, link, selected_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'client')`,
        [
          clientId,
          v.title || null,
          v.price || null,
          v.mileage || null,
          v.year || null,
          v.fuel || null,
          v.gearbox || null,
          v.power || null,
          v.image || null,
          v.link || null,
        ]
      );
    }

    res.status(201).json({ message: "✅ Sélections client enregistrées." });
  } catch (error) {
    console.error("Erreur selectByClient:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * CLIENT — Sélection unique d’un véhicule déjà pré-enregistré
 * POST /api/vehicles/select
 */
export const selectVehicleByClient = async (req, res) => {
  try {
    const { client_id, vehicle_id } = req.body;
    if (!client_id || !vehicle_id) {
      return res.status(400).json({ message: "❌ client_id et vehicle_id requis." });
    }

    await pool.query(
      "UPDATE selected_vehicles SET selected_by = 'client' WHERE id = ? AND client_id = ?",
      [vehicle_id, client_id]
    );

    res.json({ message: "✅ Véhicule sélectionné par le client." });
  } catch (error) {
    console.error("Erreur selectVehicleByClient:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
