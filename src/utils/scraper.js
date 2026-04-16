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
      // Sélecteur mis à jour pour la vue "decluttered"
      const items = Array.from(
        document.querySelectorAll('article[data-testid="decluttered-list-item"]')
      );

      // Fallback sur l'ancien sélecteur si le nouveau ne trouve rien
      if (items.length === 0) {
        const oldItems = Array.from(document.querySelectorAll('article[data-testid="list-item"]'));
        if (oldItems.length > 0) return oldItems.map(el => ({ title: "Old Selector Found - Please Update Scraper Logic", price: "0" })); // Juste pour signaler
        return [];
      }

      return items.map((el) => {
        const titleEl = el.querySelector("h2.ListItemTitle_heading__G2W_N") || el.querySelector("h2");
        const priceEl = el.querySelector("span.CurrentPrice_price__Ekflz") || el.querySelector('p[data-testid="regular-price"]');

        // Extraction des détails via les "pills"
        const pills = el.querySelectorAll("div.ListItemVehicleDetails_pillContainer__do2qz > div span.ListItemPill_text__Cr6mq");
        const yearEl = pills.length > 0 ? pills[0] : null;
        const mileageEl = pills.length > 1 ? pills[1] : null;
        const fuelEl = pills.length > 2 ? pills[2] : null;
        const powerEl = pills.length > 3 ? pills[3] : null;
        const gearboxEl = pills.length > 4 ? pills[4] : null; // Tentative de récupérer la boite si présente

        const linkEl = el.querySelector("a.ListItemTitle_anchor__4TrfR") || el.querySelector("a");
        const imageEl = el.querySelector("picture img.ListItemImage_image__syCVC") || el.querySelector("picture img");

        let imgUrl = "https://via.placeholder.com/250x188?text=No+Image";
        if (imageEl && imageEl.src) {
          imgUrl = imageEl.src;
        } else {
          const source = el.querySelector("picture source");
          const srcset = source ? source.getAttribute("srcset") : null;
          if (srcset) {
            imgUrl = srcset.split(" ")[0];
          }
        }

        let linkUrl = "";
        if (linkEl) {
          const href = linkEl.getAttribute("href");
          if (href) {
            linkUrl = href.startsWith("http") ? href : `https://www.autoscout24.fr${href}`;
          }
        }

        return {
          title: titleEl ? titleEl.innerText.trim() : "",
          price: priceEl ? priceEl.innerText.trim() : "",
          mileage: mileageEl ? mileageEl.innerText.trim() : "",
          year: yearEl ? yearEl.innerText.trim() : "",
          fuel: fuelEl ? fuelEl.innerText.trim() : "",
          gearbox: gearboxEl ? gearboxEl.innerText.trim() : "",
          power: powerEl ? powerEl.innerText.trim() : "",
          image: imgUrl,
          link: linkUrl
        };
      });
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
