import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchQuotes, getSpyAlarmState, setSpyAlarmState } from "../server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "..", "data", "quotes.json");
const alarmStatePath = join(__dirname, "..", "data", "alarm-state.json");
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
  "GOLD",
  "USDSGD",
  "SHCOMP",
  "CSI300",
  "SZCOMP",
  "TAIEX",
  "JCI",
  "ES1!",
  "NQ1!",
  "YM1!",
  "RTY1!",
  "NKD1!",
  "HSI1!",
];

try {
  const previousState = JSON.parse(await readFile(alarmStatePath, "utf8"));
  setSpyAlarmState(previousState.spyDrawdown || {});
} catch {
  // First run: no saved alarm state yet.
}

const payload = await fetchQuotes(symbols);
payload.generatedBy = "github-actions";
payload.generatedAt = Date.now();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(
  alarmStatePath,
  `${JSON.stringify({ spyDrawdown: getSpyAlarmState(), updatedAt: Date.now() }, null, 2)}\n`,
);

console.log(`Wrote ${payload.quotes.length} quotes to ${outputPath}`);
