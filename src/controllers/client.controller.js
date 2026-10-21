import pool from "../config/db.js";
import crypto from "crypto";
import {clientIdentity} from "../utils/clientIdentity.js";
import {checklistVersion,checklistReviewed,readVehicleChoice} from '../services/vehicleChoice.service.js';
import {attachAdditionalVehicles} from '../services/vehiclePreferences.service.js';

export const updateClientPriority = async (req, res) => {
  const priority = req.body?.is_priority;
  if (typeof priority !== 'boolean') return res.status(400).json({message: 'Priorité invalide.'});
  try {
    const [result] = await pool.query('UPDATE clients SET is_priority=? WHERE id=? AND user_id=?', [priority, req.params.id, req.userId]);
    if (!result.affectedRows) return res.status(404).json({message: 'Client introuvable.'});
    res.set('Cache-Control', 'no-store').json({is_priority: priority});
  } catch (error) {
    console.error('Priorité client :', error.message);
    res.status(500).json({message: 'Impossible de modifier la priorité.'});
  }
};

export const updateDepositAmount = async (req, res) => {
  const amount = req.body.deposit_amount;
  if (typeof amount !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return res.status(400).json({ message: 'Saisissez un montant positif avec au maximum deux décimales.' });
  }
  try {
    const [[client]] = await pool.query('SELECT id, step, payment_confirmed_at FROM clients WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!client) return res.status(404).json({ message: 'Client introuvable.' });
    if (client.step !== 3) return res.status(400).json({ message: 'Le montant de l’acompte se modifie à l’étape 3.' });
    if (client.payment_confirmed_at) return res.status(409).json({message:'Retirez la confirmation de réception avant de modifier l’acompte.'});
    const [updated]=await pool.query('UPDATE clients SET deposit_amount = ? WHERE id = ? AND user_id = ? AND step=3 AND payment_confirmed_at IS NULL', [amount, client.id, req.userId]);
    if(!updated.affectedRows)return res.status(409).json({message:'Le dossier a changé. Actualisez la page avant de modifier l’acompte.'});
    res.json({ deposit_amount: Number(amount).toFixed(2) });
  } catch (error) {
    res.status(500).json({ message: 'Impossible de modifier l’acompte.' });
  }
};

export const saveVehicleDecision = async (req, res) => {
  const { decision } = req.body;
  if (!["accepted", "rejected", "pending"].includes(decision)) {
    return res.status(400).json({ message: "Choix invalide." });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[vehicle]] = await connection.query(
      `SELECT v.id, v.client_id, v.selected_by, v.title, c.name, c.step
       FROM selected_vehicles v JOIN clients c ON c.id = v.client_id
       WHERE c.access_token = ? AND v.id = ? FOR UPDATE`,
      [req.params.token, req.params.vehicleId]
    );
    if (!vehicle) {
      await connection.rollback();
      return res.status(404).json({ message: "Proposition introuvable." });
    }
    const selectedBy = { accepted: "client", rejected: "rejected", pending: "admin" }[decision];
    if(vehicle.step!==2){await connection.rollback();return res.status(409).json({message:'Les propositions se choisissent à l’étape 2. Le choix définitif se fait après les contrôles.'});}
    if (vehicle.selected_by !== selectedBy) {
      await connection.query("UPDATE selected_vehicles SET selected_by = ? WHERE id = ?", [selectedBy, vehicle.id]);
      const label = { accepted: "a retenu", rejected: "a refusé", pending: "a remis en attente" }[decision];
      await connection.query("INSERT INTO notifications (client_id, type, message) VALUES (?, ?, ?)",
        [vehicle.client_id, "client_selection", `${vehicle.name} ${label} la proposition ${vehicle.title}.`]);
    }
    await connection.commit();
    res.json({ id: vehicle.id, selected_by: selectedBy });
  } catch (error) {
    if (connection) await connection.rollback();
    res.status(500).json({ message: "Impossible d'enregistrer le choix." });
  } finally {
    connection?.release();
  }
};


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

    await attachAdditionalVehicles(rows);
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
    await attachAdditionalVehicles(clients);
    res.json(clients);
  } catch (error) {
    console.error("❌ Erreur récupération clients:", error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};


/**
 * PATCH /api/clients/:id
 * Mise à jour complète du client et de sa demande de véhicule
 */
export const updateClient = async (req, res) => {
  if(req.body.step!==undefined||req.body.progress!==undefined)return res.status(400).json({message:'Utilisez les boutons de changement d’étape du dossier.'});
  try {
    const { id } = req.params;
    const userId = req.userId; // ID de l'utilisateur authentifié
    const {
      // Informations client
      name,
      email,
      phone,
      date_of_birth,
      step,
      progress,
      // Informations véhicule
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

    // Vérifier que le client existe et appartient à l'utilisateur
    const [[client]] = await pool.query(
      "SELECT id, user_id, first_name, last_name FROM clients WHERE id = ?",
      [id]
    );

    if (!client) {
      return res.status(404).json({ message: "Client non trouvé" });
    }

    // Vérifier que le client appartient à l'utilisateur connecté
    if (client.user_id !== userId) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // Construire dynamiquement la requête de mise à jour pour le client
    const clientFields = {};
    if (req.body.first_name !== undefined || req.body.last_name !== undefined) {
      try {
        Object.assign(clientFields, clientIdentity(req.body.first_name !== undefined ? req.body.first_name : client.first_name, req.body.last_name !== undefined ? req.body.last_name : client.last_name));
      } catch(error) { return res.status(400).json({message:error.message}); }
    } else if (name !== undefined) {
      return res.status(400).json({message:'Utilisez les champs Prénom et Nom séparés.'});
    }
    if (email !== undefined) clientFields.email = email || null;
    if (phone !== undefined) clientFields.phone = phone || null;
    if (date_of_birth !== undefined) clientFields.date_of_birth = date_of_birth;
    if (step !== undefined) clientFields.step = step;
    if (progress !== undefined) clientFields.progress = progress;

    // Mettre à jour le client si des champs sont fournis
    if (Object.keys(clientFields).length > 0) {
      const clientKeys = Object.keys(clientFields);
      const clientValues = Object.values(clientFields);
      const clientSetClause = clientKeys.map(k => `${k} = ?`).join(", ");

      await pool.query(
        `UPDATE clients SET ${clientSetClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...clientValues, id]
      );
    }

    // Construire dynamiquement la requête de mise à jour pour la demande de véhicule
    const vehicleFields = {};
    if (marque !== undefined) vehicleFields.marque = marque;
    if (modele !== undefined) vehicleFields.modele = modele;
    if (budget !== undefined) vehicleFields.budget = budget;
    if (max_km !== undefined) vehicleFields.max_km = max_km;
    if (vehicle_color !== undefined) vehicleFields.couleur = vehicle_color;
    if (description !== undefined) vehicleFields.description = description;
    if (carburant !== undefined) vehicleFields.carburant = carburant;
    if (first_registration !== undefined) vehicleFields.premiere_immat = first_registration;
    if (puissance_min !== undefined) vehicleFields.puissance_min = puissance_min;
    if (boite !== undefined) vehicleFields.boite = boite;

    // Mettre à jour la demande de véhicule si des champs sont fournis
    if (Object.keys(vehicleFields).length > 0) {
      const vehicleKeys = Object.keys(vehicleFields);
      const vehicleValues = Object.values(vehicleFields);
      const vehicleSetClause = vehicleKeys.map(k => `${k} = VALUES(${k})`).join(", ");

      await pool.query(
        `INSERT INTO vehicle_requests (client_id, ${vehicleKeys.join(', ')})
         VALUES (?, ${vehicleKeys.map(() => '?').join(', ')})
         ON DUPLICATE KEY UPDATE ${vehicleSetClause}`,
        [id, ...vehicleValues]
      );
    }

    res.json({
      message: "Client et demande de véhicule mis à jour avec succès",
      clientId: id
    });
  } catch (error) {
    console.error("❌ Erreur updateClient:", error);
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

    let identity;
    try { identity = clientIdentity(req.body.first_name, req.body.last_name); }
    catch(error) { return res.status(400).json({message:error.message}); }
    const userId = req.userId;

    // 1️⃣ Création du client
    const [clientResult] = await pool.query(
      `INSERT INTO clients (user_id, name, first_name, last_name, email, phone, date_of_birth, step)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [userId, identity.name, identity.first_name, identity.last_name, email || null, phone || null, date_of_birth || null]
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

    const [[created]] = await pool.query("SELECT c.*, vr.marque, vr.modele, vr.budget FROM clients c LEFT JOIN vehicle_requests vr ON vr.client_id=c.id WHERE c.id=?", [clientId]);
    res.status(201).json({ ...created, clientId });
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
      `SELECT c.id,c.name,c.first_name,c.last_name,c.email,c.phone,c.step,c.deposit_amount,
        vr.marque,vr.modele,vr.couleur,vr.carburant,vr.premiere_immat,vr.budget,
        vr.max_km,vr.description,vr.puissance_min,vr.boite
       FROM clients c LEFT JOIN vehicle_requests vr ON vr.client_id=c.id WHERE c.access_token=?`,
      [token]
    );

    if (!client) {
      return res.status(404).json({ message: "Lien invalide ou expiré." });
    }

    await attachAdditionalVehicles([client]);

    // Récupérer les véhicules présélectionnés pour ce client
    const [vehicles] = await pool.query(
      `SELECT id, client_id, title, price, mileage, year, fuel, gearbox, power, image, link, selected_by
       FROM selected_vehicles
       WHERE client_id = ?`,
      [client.id]
    );

    // Récupérer les checklists pour chaque véhicule
    for (const vehicle of vehicles) {
      const [checks] = await pool.query(
        "SELECT id, name, status FROM vehicle_checks WHERE selected_vehicle_id = ?",
        [vehicle.id]
      );
      vehicle.checklist = checks;
      vehicle.checklist_version=checklistVersion(checks);
      vehicle.can_choose_final=checklistReviewed(checks);
    }

    res.set('Cache-Control','no-store').json({ client, vehicles,final_choice:await readVehicleChoice(client.id) });
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
      "SELECT id, name, step FROM clients WHERE access_token = ?",
      [token]
    );

    if (!client) {
      return res.status(404).json({ message: "Lien invalide ou expiré." });
    }

    const clientId = client.id;
    if(client.step!==2)return res.status(409).json({message:'Les propositions se choisissent uniquement à l’étape 2.'});

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

// ============================================
//  Gestion de la Checklist Technique
// ============================================
export const addVehicleChecks = async (req,res) => {
  const checks=req.body?.checks;
  const statuses=['pending','validated','issue','rejected','not_applicable'];
  if(!Array.isArray(checks)||!checks.length||checks.length>50||checks.some(check=>!check||typeof check.name!=="string"||!check.name.trim()||check.name.length>255||!statuses.includes(check.status??'pending')))return res.status(400).json({message:'Point de contrôle ou statut invalide.'});
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const [[vehicle]]=await db.query('SELECT v.id FROM selected_vehicles v JOIN clients c ON c.id=v.client_id WHERE v.id=? AND c.user_id=? FOR UPDATE',[req.params.vehicleId,req.userId]);
    if(!vehicle){await db.rollback();return res.status(404).json({message:'Véhicule introuvable.'});}
    await db.query('DELETE FROM vehicle_checks WHERE selected_vehicle_id=?',[vehicle.id]);
    for(const check of checks)await db.query('INSERT INTO vehicle_checks (selected_vehicle_id,name,status) VALUES (?,?,?)',[vehicle.id,check.name.trim(),check.status??'pending']);
    await db.commit();res.json({message:'Checklist sauvegardée avec succès.'});
  }catch(error){await db.rollback();console.error('Checklist :',error.message);res.status(500).json({message:'Impossible de sauvegarder la checklist.'});}finally{db.release();}
};
