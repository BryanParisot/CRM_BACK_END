import puppeteer from "puppeteer";

export const scrapeAutoScout = async (clientData) => {
  const { marque, modele, budget, maxKm, puissance_min } = clientData;

  const searchPath = `${marque.toLowerCase()}/${encodeURIComponent(modele.toLowerCase())}`;
  const url = `https://www.autoscout24.fr/lst/${searchPath}/pr_${budget || 20000}?atype=C&cy=F&damaged_listing=exclude&desc=0&kmto=${maxKm || 120000}&powerfrom=${puissance_min || ''}&powertype=kw&ustate=N%2CU`;

  console.log("🌐 URL générée :", url);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("✅ Page chargée, défilement pour charger les images...");

    await autoScroll(page);

    console.log("📸 Scroll terminé, extraction des annonces...");

    const vehicles = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("div.ListItem_wrapper__TxHWu"));
      return items.map((el) => ({
        title: el.querySelector("a[class*='ListItem_title'] h2")?.innerText.trim() || "",
        price: el.querySelector('p[data-testid="regular-price"]')?.innerText.trim() || "",
        mileage: el.querySelector('span[data-testid="VehicleDetails-mileage_road"]')?.innerText.trim() || "",
        year: el.querySelector('span[data-testid="VehicleDetails-calendar"]')?.innerText.trim() || "",
        fuel: el.querySelector('span[data-testid="VehicleDetails-gas_pump"]')?.innerText.trim() || "",
        gearbox: el.querySelector('span[data-testid="VehicleDetails-gearbox"]')?.innerText.trim() || "",
        power: el.querySelector('span[data-testid="VehicleDetails-speedometer"]')?.innerText.trim() || "",
        image: (() => {
          const picture = el.querySelector("picture img");
          if (picture?.src) return picture.src;
          const source = el.querySelector("picture source[type='image/webp'], picture source[type='image/jpeg']");
          if (source) {
            const srcset = source.getAttribute("srcset");
            if (srcset) return srcset.split(" ")[0];
          }
          return "https://via.placeholder.com/250x188?text=No+Image";
        })(),

        // ✅ Lien complet
        link: (() => {
          const anchor = el.querySelector("a[class*='ListItem_title']");
          if (!anchor) return "";
          const href = anchor.getAttribute("href");
          if (!href) return "";
          return href.startsWith("http")
            ? href
            : "https://www.autoscout24.fr" + href;
        })(),
      }));
    });

    console.log(`🚗 ${vehicles.length} véhicules trouvés`);
    return vehicles.filter((v) => v.title && v.price);
  } catch (error) {
    console.error("❌ Erreur de scraping :", error);
    throw new Error(error.message);
  } finally {
    if (browser) await browser.close();
  }
};

// --- Fonction utilitaire : scroll progressif jusqu’en bas
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400; // px à scroller à chaque étape
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300); // vitesse du scroll (ms)
    });
  });
  // On attend un peu pour laisser charger les images
  await new Promise((r) => setTimeout(r, 3000));
}
