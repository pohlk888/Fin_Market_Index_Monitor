import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchQuotes } from "../server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "..", "data", "quotes.json");
const symbols = [
  "SPY",
  "QQQ",
  "DIA",
  "IWM",
  "EWS",
  "SPX",
  "IXIC",
  "DJI",
  "RUT",
  "VIX",
  "STI",
  "N225",
  "HSI",
  "ES1!",
  "NQ1!",
  "YM1!",
  "RTY1!",
  "NKD1!",
  "HSI1!",
];

const payload = await fetchQuotes(symbols);
payload.generatedBy = "github-actions";
payload.generatedAt = Date.now();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`Wrote ${payload.quotes.length} quotes to ${outputPath}`);
