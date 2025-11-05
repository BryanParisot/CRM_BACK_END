import puppeteer from "puppeteer";

export const scrapeAutoScout = async (clientData) => {
  let { marque, modele, budget, maxKm, puissance_min, boite, fuel } =
    clientData;

  // ✅ Nettoyage et normalisation des données reçues
  const normalizedBoite = (boite || "").trim().toLowerCase();
  let gearParam = "";
  if (normalizedBoite.includes("auto")) gearParam = "A";
  else if (normalizedBoite.includes("man")) gearParam = "M";

  // ✅ Conversion du carburant en code AutoScout24
  const normalizedFuel = (fuel || "").trim().toLowerCase();
  let fuelParam = "";
  if (normalizedFuel.includes("diesel")) fuelParam = "D";
  else if (
    normalizedFuel.includes("essence") ||
    normalizedFuel.includes("benzine")
  )
    fuelParam = "B";
  else if (
    normalizedFuel.includes("électrique") ||
    normalizedFuel.includes("electrique")
  )
    fuelParam = "E";
  else if (normalizedFuel.includes("hybride")) fuelParam = "H";
  else if (normalizedFuel.includes("gpl")) fuelParam = "L";
  else if (normalizedFuel.includes("gnv")) fuelParam = "C";

  // ✅ Construction dynamique du chemin et des query params
  const searchPath = `${marque.toLowerCase()}/${encodeURIComponent(
    modele.toLowerCase()
  )}`;
  const baseUrl = `https://www.autoscout24.fr/lst/${searchPath}`;

  const params = new URLSearchParams({
    atype: "C",
    cy: "F",
    damaged_listing: "exclude",
    desc: "0",
    sort: "standard",
    ustate: "N,U",
    powertype: "kw",
    kmto: maxKm || 120000,
    priceto: budget || 20000,
  });

  if (gearParam) params.append("gear", gearParam);
  if (puissance_min) params.append("powerfrom", puissance_min);
  if (fuelParam) params.append("fuel", fuelParam);

  const url = `${baseUrl}?${params.toString()}`;

  console.log("🌐 URL générée :", url);
  console.log("⚙️ Paramètres :", {
    marque,
    modele,
    budget,
    maxKm,
    puissance_min,
    boite,
    fuel,
    gearParam,
    fuelParam,
  });

  let browser;
  try {
    // ✅ Lancement de Puppeteer avec Chrome local (MacOS)
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);

    await page.goto(url, { waitUntil: "domcontentloaded" });
    console.log("✅ Page chargée, défilement en cours...");

    await autoScroll(page);
    console.log("📸 Scroll terminé, extraction des annonces...");

    const vehicles = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll("div.ListItem_wrapper__TxHWu")
      );
      if (items.length === 0) return [];

      return items.map((el) => ({
        title:
          el.querySelector("a[class*='ListItem_title'] h2")?.innerText.trim() ||
          "",
        price:
          el
            .querySelector('p[data-testid="regular-price"]')
            ?.innerText.trim() || "",
        mileage:
          el
            .querySelector('span[data-testid="VehicleDetails-mileage_road"]')
            ?.innerText.trim() || "",
        year:
          el
            .querySelector('span[data-testid="VehicleDetails-calendar"]')
            ?.innerText.trim() || "",
        fuel:
          el
            .querySelector('span[data-testid="VehicleDetails-gas_pump"]')
            ?.innerText.trim() || "",
        gearbox:
          el
            .querySelector('span[data-testid="VehicleDetails-gearbox"]')
            ?.innerText.trim() || "",
        power:
          el
            .querySelector('span[data-testid="VehicleDetails-speedometer"]')
            ?.innerText.trim() || "",
        image: (() => {
          const img = el.querySelector("picture img");
          if (img?.src) return img.src;
          const source = el.querySelector("picture source");
          const srcset = source?.getAttribute("srcset");
          return srcset
            ? srcset.split(" ")[0]
            : "https://via.placeholder.com/250x188?text=No+Image";
        })(),
        link: (() => {
          const anchor = el.querySelector("a[class*='ListItem_title']");
          const href = anchor?.getAttribute("href");
          return href?.startsWith("http")
            ? href
            : `https://www.autoscout24.fr${href || ""}`;
        })(),
      }));
    });

    console.log(`🚗 ${vehicles.length} véhicules trouvés`);
    return vehicles.filter((v) => v.title && v.price);
  } catch (error) {
    console.error("❌ Erreur de scraping :", error.message);
    throw new Error(`Scraping échoué : ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
};

// --- Scroll progressif pour charger toutes les annonces ---
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });
  // ⏳ Pause pour charger les images après le scroll
  await new Promise((r) => setTimeout(r, 2000));
}
