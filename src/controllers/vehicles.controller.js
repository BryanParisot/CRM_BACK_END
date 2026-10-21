import pool from "../config/db.js";
import {readVehicleChoice} from '../services/vehicleChoice.service.js';

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

    const [[client]] = await pool.query("SELECT id, step FROM clients WHERE id = ? AND user_id = ?", [client_id, req.userId]);
    if (!client) return res.status(404).json({ message: "Client introuvable." });
    if (client.step !== 2) return res.status(400).json({ message: "Les liens peuvent être ajoutés uniquement à l’étape 2." });
    if (!vehicles.length) return res.status(400).json({ message: "Ajoutez un lien." });
    const proposals = [];
    for (const v of vehicles) {
      let url;
      try { url = new URL(v.link); } catch { return res.status(400).json({ message: "Lien invalide." }); }
      if (!["http:", "https:"].includes(url.protocol)) return res.status(400).json({ message: "Le lien doit commencer par http:// ou https://." });
      proposals.push({ ...v, link: url.href, title: String(v.title || url.hostname).trim().slice(0, 512) });
    }
    for (const v of proposals) {
      await pool.query(
        `INSERT INTO selected_vehicles
         (client_id, title, price, mileage, year, fuel, gearbox, power, image, link, selected_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')`,
        [client_id, v.title, v.price || null, v.mileage || null, v.year || null,
         v.fuel || null, v.gearbox || null, v.power || null, v.image || null, v.link]
      );
    }

    res.status(201).json({ message: "✅ Véhicules présélectionnés enregistrés." });
  } catch (error) {
    console.error("Erreur preselectVehicles:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

/**
 * DELETE /api/vehicles/preselect/:id
 * → Supprime un véhicule présélectionné par l’admin
 */
export const deletePreselectedVehicle = async (req, res) => {
  const { id } = req.params;

  try {
    const [[choice]]=await pool.query('SELECT client_id FROM client_vehicle_choices WHERE vehicle_id=?',[id]);
    if(choice)return res.status(409).json({message:'Ce véhicule a été choisi définitivement par le client. Il ne peut pas être supprimé.'});
    const [result] = await pool.query(
      "DELETE FROM selected_vehicles WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Véhicule non trouvé" });
    }

    res.json({ message: "✅ Véhicule présélectionné supprimé avec succès" });
  } catch (error) {
    console.error("❌ Erreur suppression véhicule :", error);
    res.status(500).json({
      message: "Erreur serveur lors de la suppression du véhicule",
      error: error.message,
    });
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

    // Récupérer les checklists pour chaque véhicule
    const choice=await readVehicleChoice(id);
    for (const vehicle of rows) {
      vehicle.is_final_choice=vehicle.id===choice?.vehicle_id;
      vehicle.final_choice_needs_reconfirmation=vehicle.is_final_choice&&Boolean(choice?.needs_reconfirmation);
      vehicle.final_chosen_at=vehicle.is_final_choice?choice.chosen_at:null;
      const [checks] = await pool.query(
        "SELECT * FROM vehicle_checks WHERE selected_vehicle_id = ?",
        [vehicle.id]
      );
      vehicle.checklist = checks;
    }

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
