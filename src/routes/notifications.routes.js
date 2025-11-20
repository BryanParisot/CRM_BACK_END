import express from "express";
import {
  createNotification,
  getUnreadNotifications,
  markNotificationAsRead,
} from "../controllers/notifications.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/read/:id", verifyToken, markNotificationAsRead);
router.get("/unread", verifyToken, getUnreadNotifications);
router.post("/", createNotification);
export default router;
