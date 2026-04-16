import { scrapeAutoScout } from "./src/utils/scraper.js";

const testData = {
    marque: 'Audi',
    modele: 'A3',
    budget: 25000,
    maxKm: 300000,
    puissance_min: 100,
    boite: 'Automatique',
    fuel: 'Essence'
};

console.log("🚀 Starting scraper test...");
scrapeAutoScout(testData)
    .then(vehicles => {
        console.log(`✅ Found ${vehicles.length} vehicles`);
        if (vehicles.length > 0) {
            console.log("First vehicle:", vehicles[0]);
        }
    })
    .catch(err => console.error("❌ Error:", err));
