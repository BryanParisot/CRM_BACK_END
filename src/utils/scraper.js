import puppeteer from "puppeteer";

const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

export const scrapeAutoScout = async (clientData) => {
  const { vehicle, budget, maxKm, vehicleColor } = clientData;
  const [make, model] = vehicle.split(" ");
  const price = budget.replace("€", "").replace(/[\s,]/g, "");
  const mileage = maxKm.replace(/\s/g, "");
  const colorMap = { Rouge: "red", Noir: "black", Bleu: "blue" };
  const color = colorMap[vehicleColor] || "";

  const url = `https://www.autoscout24.fr/lst/${make}/${model}?atype=C&priceto=${price}&kmto=${mileage}&color=${color}`;

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  const vehicles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".cl-list-element")).map(
      (el, i) => {
        const titleEl = el.querySelector(".cldt-summary-makemodel");
        const title = titleEl ? titleEl.innerText.trim() : "";

        const priceEl = el.querySelector(".cldt-price");
        const price = priceEl ? priceEl.innerText.trim() : "";

        const mileageSpan = el.querySelector(".cldt-summary-vehicle-data span");
        const mileageText = mileageSpan ? mileageSpan.innerText.trim() : "0";
        const mileage = parseInt(mileageText.replace(/\D/g, ""), 10) || 0;

        const yearSpan = el.querySelectorAll(
          ".cldt-summary-vehicle-data span"
        )[1];
        const yearText = yearSpan ? yearSpan.innerText.trim() : "0";
        const year = parseInt(yearText, 10) || 0;

        const linkEl = el.querySelector("a");
        const link = linkEl ? linkEl.href : "";

        const imgEl = el.querySelector("img");
        const image = imgEl ? imgEl.src : "https://via.placeholder.com/150";

        return { id: `vehicle-${i}`, title, price, mileage, year, link, image };
      }
    );
  });

  await browser.close();
  return vehicles;
};
