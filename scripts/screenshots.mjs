import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "docs", "screenshots");

const TABS = [
  { id: "dashboard", file: "01-dashboard.png" },
  { id: "accounts", file: "02-accounts.png" },
  { id: "logs", file: "03-logs.png" },
  { id: "history", file: "04-history.png" },
  { id: "usage", file: "05-usage.png" },
  { id: "cost", file: "06-cost.png" },
  { id: "settings", file: "07-settings.png" },
  { id: "notifications", file: "08-notifications.png" },
];

const VIEWPORT = { width: 1440, height: 900 };
const BASE = process.env.BASE_URL || "http://localhost:4143";

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log(`Navigating to ${BASE}/dashboard...`);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  for (const tab of TABS) {
    console.log(`Capturing tab: ${tab.id}`);
    await page.evaluate((id) => {
      const el = document.querySelector("[x-data]");
      if (el && el._x_dataStack) {
        const data = el._x_dataStack[0];
        data.activeTab = id;
      } else if (window.Alpine) {
        const root = document.querySelector("[x-data]");
        Alpine.$data(root).activeTab = id;
      }
    }, tab.id);
    await page.waitForTimeout(800);

    const target = resolve(outDir, tab.file);
    await page.screenshot({
      path: target,
      fullPage: true,
    });
    console.log(`  -> ${target}`);
  }

  console.log("Capturing OAuth modal (accounts tab + add modal)...");
  await page.evaluate(() => {
    const root = document.querySelector("[x-data]");
    const data = root._x_dataStack ? root._x_dataStack[0] : Alpine.$data(root);
    data.activeTab = "accounts";
    data.showAddModal = true;
  });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: resolve(outDir, "09-add-account-modal.png"),
    fullPage: false,
  });

  await browser.close();
  console.log("\nDone. Screenshots saved to:", outDir);
}

main().catch((err) => {
  console.error("Screenshot script failed:", err);
  process.exit(1);
});
