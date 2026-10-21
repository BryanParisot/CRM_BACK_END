import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mysql from "mysql2";
import authRoutes from "./routes/auth.routes.js";
import clientRoutes from "./routes/client.routes.js";
import clientStepsRoutes from "./routes/clientSteps.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import vehicleRoutes from "./routes/vehicle.routes.js";
import clientDocumentsRoutes from './routes/clientDocuments.routes.js';
import settlementRoutes from './routes/settlement.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
import vehicleChoiceRoutes from './routes/vehicleChoice.routes.js';
import {youtrustRouter,youtrustWebhookRouter} from './routes/youtrust.routes.js';
import {startYoutrustSync} from './services/youtrust.service.js';

dotenv.config();

const app = express();
app.use(cors());
app.use("/api/webhooks/youtrust",youtrustWebhookRouter);
app.use(express.json());

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
});

db.connect((err) => {
  if (err) {
    console.error("❌ Erreur de connexion MySQL :", err);
  } else {
    console.log("✅ Connecté à MySQL !");
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/clients", youtrustRouter);
app.use("/api/clients", settlementRoutes);
app.use("/api/clients", deliveryRoutes);
app.use('/api/clients',vehicleChoiceRoutes);
app.use("/api/clients", clientDocumentsRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/clients", clientStepsRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/notifications", notificationsRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🔥 Serveur lancé sur : http://localhost:${PORT}`)
);

startYoutrustSync();
