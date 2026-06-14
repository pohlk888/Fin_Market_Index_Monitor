import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "..", "data", "history.json");
const HISTORY_MAX_AGE_MS = Number(process.env.HISTORY_MAX_AGE_MS || 18 * 60 * 60 * 1000);
const FORCE_HISTORY_REFRESH = process.env.FORCE_HISTORY_REFRESH === "1";

const SYMBOLS = [
  { symbol: "SPY", yahoo: "SPY" },
  { symbol: "QQQ", yahoo: "QQQ" },
  { symbol: "DIA", yahoo: "DIA" },
  { symbol: "IWM", yahoo: "IWM" },
  { symbol: "EWS", yahoo: "EWS" },
  { symbol: "SPX", yahoo: "^GSPC" },
  { symbol: "IXIC", yahoo: "^IXIC" },
  { symbol: "DJI", yahoo: "^DJI" },
  { symbol: "RUT", yahoo: "^RUT" },
  { symbol: "VIX", yahoo: "^VIX" },
  { symbol: "STI", yahoo: "^STI" },
  { symbol: "N225", yahoo: "^N225" },
  { symbol: "HSI", yahoo: "^HSI" },
  { symbol: "GOLD", yahoo: "GC=F" },
  { symbol: "USDSGD", yahoo: "SGD=X" },
  { symbol: "SGDMYR", yahoo: "SGDMYR=X" },
  { symbol: "SGDIDR", yahoo: "SGDIDR=X" },
  { symbol: "SGDCNY", yahoo: "SGDCNY=X" },
  { symbol: "SGDTWD", yahoo: "SGDTWD=X" },
  { symbol: "SHCOMP", yahoo: "000001.SS" },
  { symbol: "CSI300", yahoo: "000300.SS" },
  { symbol: "SZCOMP", yahoo: "399001.SZ" },
  { symbol: "TAIEX", yahoo: "^TWII" },
  { symbol: "JCI", yahoo: "^JKSE" },
  { symbol: "ES1!", yahoo: "ES=F" },
  { symbol: "NQ1!", yahoo: "NQ=F" },
  { symbol: "YM1!", yahoo: "YM=F" },
  { symbol: "RTY1!", yahoo: "RTY=F" },
  { symbol: "NKD1!", yahoo: "NKD=F" },
  { symbol: "HSI1!", yahoo: ["HSI=F", "^HSI"] },
];

async function readExistingPayload() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return null;
  }
}

function isFresh(payload) {
  return payload?.generatedAt && Date.now() - Number(payload.generatedAt) < HISTORY_MAX_AGE_MS;
}

async function fetchDailyHistory(item) {
  const symbols = Array.isArray(item.yahoo) ? item.yahoo : [item.yahoo];
  let lastError = null;

  for (const yahooSymbol of symbols) {
    try {
      return await fetchYahooDailyHistory(item, yahooSymbol);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`${item.symbol} history unavailable`);
}

async function fetchYahooDailyHistory(item, yahooSymbol) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
  url.searchParams.set("range", "5y");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "history");

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 FinMarketIndexMonitor/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`${item.symbol} history returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const points = timestamps
    .map((timestamp, index) => ({
      t: timestamp * 1000,
      o: typeof opens[index] === "number" ? opens[index] : closes[index],
      h: typeof highs[index] === "number" ? highs[index] : closes[index],
      l: typeof lows[index] === "number" ? lows[index] : closes[index],
      c: closes[index],
    }))
    .filter((point) =>
      [point.o, point.h, point.l, point.c].every((value) => typeof value === "number" && Number.isFinite(value)),
    );

  return {
    symbol: item.symbol,
    sourceSymbol: yahooSymbol,
    points,
    firstDate: points[0]?.t || null,
    lastDate: points.at(-1)?.t || null,
  };
}

async function main() {
  const existing = await readExistingPayload();
  if (!FORCE_HISTORY_REFRESH && isFresh(existing)) {
    console.log(`History is fresh; keeping ${outputPath}`);
    return;
  }

  const results = await Promise.allSettled(SYMBOLS.map(fetchDailyHistory));
  const history = {};
  const missing = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.points.length) {
      history[result.value.symbol] = result.value;
    } else {
      const reason = result.status === "rejected" ? result.reason.message : "No history points returned";
      missing.push(reason);
    }
  }

  const payload = {
    source: "Yahoo Finance daily OHLC",
    range: "5y",
    interval: "1d",
    generatedAt: Date.now(),
    history,
    missing,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote history for ${Object.keys(history).length} symbols to ${outputPath}`);
  if (missing.length) {
    console.log(`Missing history: ${missing.join("; ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
