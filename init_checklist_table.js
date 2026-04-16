import pool from "./src/config/db.js";

const createTable = async () => {
    try {
        console.log("🚀 Creating vehicle_checks table...");

        await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicle_checks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        selected_vehicle_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        status ENUM('pending', 'validated', 'rejected', 'not_applicable') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (selected_vehicle_id) REFERENCES selected_vehicles(id) ON DELETE CASCADE
      )
    `);

        console.log("✅ Table vehicle_checks created successfully!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error creating table:", error);
        process.exit(1);
    }
};

createTable();
