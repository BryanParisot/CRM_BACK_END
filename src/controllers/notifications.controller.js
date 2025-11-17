import pool from "../config/db.js";

// Get all unread notifications
export const getUnreadNotifications = async (req, res) => {
  const [rows] = await pool.query(`
    SELECT * FROM notifications
    ORDER BY created_at DESC
  `);
  res.json(rows);
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
  await pool.query(`UPDATE notifications SET is_read = TRUE WHERE id = ?`, [
    req.params.id,
  ]);
  res.json({ success: true });
};
