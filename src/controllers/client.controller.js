import pool from "../config/db.js";
import crypto from "crypto";


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



// ============================================
//  Génération de lien d’accès client
// ============================================
export const generateClientAccessLink = async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que le client existe
    const [[client]] = await pool.query(
      "SELECT id, access_token FROM clients WHERE id = ?",
      [id]
    );

    if (!client) {
      return res.status(404).json({ message: "Client introuvable" });
    }

    // Garder le token existant si déjà généré (évite de casser un ancien lien)
    const token =
      client.access_token || crypto.randomBytes(32).toString("hex");

    if (!client.access_token) {
      await pool.query(
        "UPDATE clients SET access_token = ? WHERE id = ?",
        [token, id]
      );
    }

    const baseUrl =
      process.env.CLIENT_PORTAL_URL || "http://localhost:5173"; // adapte si besoin
    const link = `${baseUrl}/client-link/${token}`;

    res.json({ link, token });
  } catch (error) {
    console.error("❌ Erreur generateClientAccessLink:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// ============================================
//  Lecture des infos publiques par token
// ============================================
export const getClientPublicData = async (req, res) => {
  try {
    const { token } = req.params;

    // Trouver le client via le token
    const [[client]] = await pool.query(
      "SELECT id, name, email, phone, step FROM clients WHERE access_token = ?",
      [token]
    );

    if (!client) {
      return res.status(404).json({ message: "Lien invalide ou expiré." });
    }

    // Récupérer les véhicules présélectionnés pour ce client
    const [vehicles] = await pool.query(
      `SELECT id, client_id, title, price, mileage, year, fuel, gearbox, power, image, link, selected_by
       FROM selected_vehicles
       WHERE client_id = ?`,
      [client.id]
    );

    res.json({ client, vehicles });
  } catch (error) {
    console.error("❌ Erreur getClientPublicData:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// ============================================
//  Sauvegarde des choix du client via token
// ============================================
export const saveClientSelectionFromLink = async (req, res) => {
  try {
    const { token } = req.params;
    const { vehicle_ids } = req.body;

    if (!Array.isArray(vehicle_ids) || vehicle_ids.length === 0) {
      return res.status(400).json({ message: "Aucun véhicule reçu." });
    }

    if (vehicle_ids.length > 3) {
      return res
        .status(400)
        .json({ message: "Maximum 3 véhicules peuvent être sélectionnés." });
    }

    // Trouver le client via le token
    const [[client]] = await pool.query(
      "SELECT id, name FROM clients WHERE access_token = ?",
      [token]
    );

    if (!client) {
      return res.status(404).json({ message: "Lien invalide ou expiré." });
    }

    const clientId = client.id;

    // Reset anciennes sélections du client
    await pool.query(
      "UPDATE selected_vehicles SET selected_by = 'admin' WHERE client_id = ? AND selected_by = 'client'",
      [clientId]
    );

    // Appliquer les nouvelles sélections
    for (const vid of vehicle_ids) {
      await pool.query(
        "UPDATE selected_vehicles SET selected_by = 'client' WHERE id = ? AND client_id = ?",
        [vid, clientId]
      );
    }

    // 🔥🔥🔥 AJOUT NOTIFICATION DANS LA BDD 🔥🔥🔥
    await pool.query(
      `INSERT INTO notifications (client_id, message, type, is_read)
       VALUES (?, ?, ?, FALSE)`,
      [
        clientId,
        `Le client ${client.name} a sélectionné ${vehicle_ids.length} véhicule(s).`,
        "client_selection",
      ]
    );

    res.json({
      message: "Sélections client enregistrées ✅",
      selected: vehicle_ids,
    });
  } catch (error) {
    console.error("❌ Erreur saveClientSelectionFromLink:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// ============================================
//  Suppression d'un client
// ============================================
export const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId; // ID de l'utilisateur authentifié

    // Vérifier que le client existe et appartient à l'utilisateur
    const [[client]] = await pool.query(
      "SELECT id, user_id, name FROM clients WHERE id = ?",
      [id]
    );

    if (!client) {
      return res.status(404).json({ message: "Client non trouvé" });
    }

    // Vérifier que le client appartient à l'utilisateur connecté
    if (client.user_id !== userId) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // Suppression en cascade des données associées
    // 1. Supprimer les véhicules sélectionnés
    await pool.query("DELETE FROM selected_vehicles WHERE client_id = ?", [id]);

    // 2. Supprimer les demandes de véhicules
    await pool.query("DELETE FROM vehicle_requests WHERE client_id = ?", [id]);

    // 3. Supprimer les notifications
    await pool.query("DELETE FROM notifications WHERE client_id = ?", [id]);

    // 4. Supprimer le client
    await pool.query("DELETE FROM clients WHERE id = ?", [id]);

    res.json({
      message: `Client "${client.name}" et toutes ses données associées ont été supprimés avec succès`,
    });
  } catch (error) {
    console.error("❌ Erreur deleteClient:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
