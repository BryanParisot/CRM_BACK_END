import pool from "../config/db.js";

// Get all unread notifications
export const getUnreadNotifications = async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM notifications ORDER BY created_at DESC`
  );
  res.json(rows);
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
  await pool.query(`UPDATE notifications SET is_read = TRUE WHERE id = ?`, [
    req.params.id,
  ]);
  res.json({ success: true });
};

// 👇 NEW: créer une notification
export const createNotification = async (req, res) => {
  try {
    const { client_id, type, message } = req.body;

    await pool.query(
      `INSERT INTO notifications (client_id, type, message, is_read)
       VALUES (?, ?, ?, FALSE)`,
      [client_id || null, type || null, message]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("❌ Erreur createNotification:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
