import http from "node:http";
import tls from "node:tls";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

loadEnvFile();

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com";
const SPY_DRAWDOWN_ALARM_PERCENT = Number(process.env.SPY_DRAWDOWN_ALARM_PERCENT || 3.5);
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || "pohlk888@gmail.com";
const ALERT_EMAIL_COOLDOWN_MS = Number(process.env.ALERT_EMAIL_COOLDOWN_MS || 6 * 60 * 60 * 1000);
const ALARM_SYMBOLS = ["SPY", "SPX", "ES1!"];
const DEFAULT_ALLOWED_ORIGINS = [
  "https://pohlk888.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function alertEmailRecipients() {
  return ALERT_EMAIL_TO.split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function loadEnvFile() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

const MARKET_SYMBOLS = [
  { symbol: "SPY", tv: "AMEX:SPY", scanner: "america", group: "ETF" },
  { symbol: "QQQ", tv: "NASDAQ:QQQ", scanner: "america", group: "ETF" },
  { symbol: "DIA", tv: "AMEX:DIA", scanner: "america", group: "ETF" },
  { symbol: "IWM", tv: "AMEX:IWM", scanner: "america", group: "ETF" },
  { symbol: "EWS", tv: "AMEX:EWS", scanner: "america", group: "ETF" },
  { symbol: "SPX", tv: "SP:SPX", scanner: "america", group: "Index" },
  { symbol: "IXIC", tv: "NASDAQ:IXIC", scanner: "america", group: "Index" },
  { symbol: "DJI", tv: "DJ:DJI", scanner: "america", group: "Index" },
  { symbol: "RUT", tv: "TVC:RUT", scanner: "america", group: "Index" },
  { symbol: "VIX", tv: "TVC:VIX", scanner: "america", group: "Index" },
  { symbol: "STI", tv: "TVC:STI", scanner: "global", group: "Index" },
  { symbol: "N225", tv: "TVC:NI225", scanner: "global", group: "Index" },
  { symbol: "HSI", tv: "TVC:HSI", scanner: "global", group: "Index" },
  { symbol: "ES1!", tv: "CME_MINI:ES1!", scanner: "futures", group: "Future" },
  { symbol: "NQ1!", tv: "CME_MINI:NQ1!", scanner: "futures", group: "Future" },
  { symbol: "YM1!", tv: "CBOT_MINI:YM1!", scanner: "futures", group: "Future" },
  { symbol: "RTY1!", tv: "CME_MINI:RTY1!", scanner: "futures", group: "Future" },
  { symbol: "NKD1!", tv: "CME:NKD1!", scanner: "futures", group: "Future" },
  { symbol: "HSI1!", tv: "HKEX:HSI1!", scanner: "futures", group: "Future" },
];

const DEFAULT_SYMBOLS = MARKET_SYMBOLS.map((item) => item.symbol);
const TV_COLUMNS = [
  "name",
  "description",
  "type",
  "exchange",
  "close",
  "High.All",
  "change",
  "change_abs",
  "high",
  "low",
  "open",
  "volume",
  "update_mode",
  "pricescale",
];

let cache = {
  key: "",
  fetchedAt: 0,
  payload: null,
};

let spyAlarmState = {
  active: false,
  lastNotificationAttemptAt: 0,
  lastEmailSentAt: 0,
  lastEmailStatus: "Not sent",
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...corsHeaders(res.req),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function corsHeaders(req) {
  const origin = req?.headers?.origin;
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : null;

  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  };
}

function handleCorsPreflight(req, res) {
  res.writeHead(204, {
    ...corsHeaders(req),
    "cache-control": "no-store",
  });
  res.end();
}

async function fetchQuotes(symbols) {
  const key = [...symbols].sort().join(",");
  const now = Date.now();

  if (cache.payload && cache.key === key && now - cache.fetchedAt < 7000) {
    return { ...cache.payload, cached: true };
  }

  const requested = symbols
    .map((symbol) => MARKET_SYMBOLS.find((item) => item.symbol.toLowerCase() === symbol.toLowerCase()))
    .filter(Boolean);
  const requestedByTv = new Map(requested.map((item) => [item.tv, item]));
  const scanners = [...new Set(requested.map((item) => item.scanner))];
  const results = await Promise.all(scanners.map((scanner) => fetchTradingViewScanner(scanner, requested)));
  const quotes = results
    .flat()
    .map((row) => compactTradingViewQuote(row, requestedByTv))
    .filter(Boolean);
  const payload = {
    source: "TradingView",
    fetchedAt: now,
    quotes,
    missing: requested.filter((item) => !quotes.some((q) => q.symbol === item.symbol)).map((item) => item.symbol),
  };

  payload.alerts = await evaluateSpyDrawdownAlarm(quotes, now);
  cache = { key, fetchedAt: now, payload };
  return { ...payload, cached: false };
}

async function evaluateSpyDrawdownAlarm(quotes, now) {
  const triggerLevel = -Math.abs(SPY_DRAWDOWN_ALARM_PERCENT);
  const watchedQuotes = quotes.filter((quote) => ALARM_SYMBOLS.includes(quote.symbol));
  const triggeredQuotes = watchedQuotes.filter(
    (quote) => typeof quote.drawdownPercent === "number" && quote.drawdownPercent <= triggerLevel,
  );
  const triggered = triggeredQuotes.length > 0;

  if (!triggered) {
    spyAlarmState.active = false;
  }

  if (triggered && !hasEmailConfig()) {
    spyAlarmState.lastEmailStatus = "Email not configured: set SMTP_HOST, SMTP_USER, and SMTP_PASS";
  }

  if (triggered && shouldSendSpyAlarmNotifications(now)) {
    spyAlarmState.active = true;
    spyAlarmState.lastNotificationAttemptAt = now;

    await sendConfiguredEmailAlarm(triggeredQuotes, now);
  } else if (triggered) {
    spyAlarmState.active = true;
  }

  const criteria = `${ALARM_SYMBOLS.join(", ")} drawdown <= -${SPY_DRAWDOWN_ALARM_PERCENT.toFixed(2)}%`;

  for (const quote of quotes) {
    if (ALARM_SYMBOLS.includes(quote.symbol)) {
      quote.alarmCriteria = criteria;
      quote.alarmTriggered =
        typeof quote.drawdownPercent === "number" && quote.drawdownPercent <= triggerLevel;
    } else {
      quote.alarmCriteria = "--";
      quote.alarmTriggered = false;
    }
  }

  return {
    spyDrawdown: {
      triggered,
      thresholdPercent: SPY_DRAWDOWN_ALARM_PERCENT,
      criteria,
      symbols: ALARM_SYMBOLS,
      triggeredSymbols: triggeredQuotes.map((quote) => quote.symbol),
      emailRecipient: alertEmailRecipients(),
      emailConfigured: hasEmailConfig(),
      lastNotificationAttemptAt: spyAlarmState.lastNotificationAttemptAt || null,
      lastEmailSentAt: spyAlarmState.lastEmailSentAt || null,
      lastEmailStatus: spyAlarmState.lastEmailStatus,
    },
  };
}

function shouldSendSpyAlarmNotifications(now) {
  if (!hasEmailConfig()) return false;
  if (!spyAlarmState.active) return true;
  return now - spyAlarmState.lastNotificationAttemptAt >= ALERT_EMAIL_COOLDOWN_MS;
}

function hasEmailConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendConfiguredEmailAlarm(triggeredQuotes, now) {
  if (!hasEmailConfig()) return;

  try {
    await sendDrawdownAlarmEmail(triggeredQuotes);
    spyAlarmState.lastEmailSentAt = now;
    spyAlarmState.lastEmailStatus = `Sent to ${alertEmailRecipients().join(", ")}`;
  } catch (error) {
    spyAlarmState.lastEmailStatus = `Email not sent: ${error.message}`;
    console.error(spyAlarmState.lastEmailStatus);
  }
}

async function sendTrialAlert() {
  const now = Date.now();
  const { quotes } = await fetchQuotes(ALARM_SYMBOLS);
  const watchedQuotes = ALARM_SYMBOLS.map((symbol) => quotes.find((quote) => quote.symbol === symbol)).filter(Boolean);
  const result = {
    sentAt: now,
    email: {
      recipient: alertEmailRecipients(),
      configured: hasEmailConfig(),
      status: "Not attempted",
    },
  };

  if (hasEmailConfig()) {
    try {
      await sendDrawdownAlarmEmail(watchedQuotes, true);
      result.email.status = `Sent to ${alertEmailRecipients().join(", ")}`;
    } catch (error) {
      result.email.status = `Email not sent: ${error.message}`;
    }
  } else {
    result.email.status = "Missing SMTP_HOST, SMTP_USER, and SMTP_PASS";
  }

  return result;
}

function alertConfigStatus() {
  return {
    email: {
      recipient: alertEmailRecipients(),
      configured: hasEmailConfig(),
      missing: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((key) => !process.env[key]),
    },
    criteria: `${ALARM_SYMBOLS.join(", ")} drawdown <= -${SPY_DRAWDOWN_ALARM_PERCENT.toFixed(2)}%`,
    symbols: ALARM_SYMBOLS,
    cooldownMs: ALERT_EMAIL_COOLDOWN_MS,
  };
}

async function sendDrawdownAlarmEmail(quotes, trial = false) {
  if (!hasEmailConfig()) {
    throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS are not configured");
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const symbols = quotes.map((quote) => quote.symbol).join(", ") || ALARM_SYMBOLS.join(", ");
  const subject = trial
    ? "Market drawdown alarm trial run"
    : `Market drawdown alarm: ${symbols}`;
  const body = [
    trial ? "Market drawdown alarm trial run." : "Market drawdown alarm triggered.",
    "",
    ...quotes.map((quote) =>
      [
        `${quote.symbol}:`,
        `  Current value: ${formatNumber(quote.price)}`,
        `  All-time high: ${formatNumber(quote.allTimeHigh)}`,
        `  Drawdown: ${formatPercent(quote.drawdownPercent)}`,
        `  Quote time: ${new Date(quote.marketTime || Date.now()).toLocaleString()}`,
      ].join("\n"),
    ),
    "",
    `Alarm threshold: ${SPY_DRAWDOWN_ALARM_PERCENT.toFixed(2)}%`,
  ].join("\n");

  await sendSmtpMail({ host, port, user, pass, from, to: alertEmailRecipients(), subject, body });
}

async function sendSmtpMail({ host, port, user, pass, from, to, subject, body }) {
  const recipients = Array.isArray(to) ? to : [to];
  const socket = tls.connect({ host, port, servername: host });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  const readResponse = createSmtpReader(socket);
  const send = async (command, expected) => {
    if (command) socket.write(`${command}\r\n`);
    const response = await readResponse();
    if (!expected.some((code) => response.startsWith(String(code)))) {
      throw new Error(`SMTP ${response.trim()}`);
    }
    return response;
  };

  try {
    await send("", [220]);
    await send("EHLO localhost", [250]);
    await send("AUTH LOGIN", [334]);
    await send(Buffer.from(user).toString("base64"), [334]);
    await send(Buffer.from(pass).toString("base64"), [235]);
    await send(`MAIL FROM:<${from}>`, [250]);
    for (const recipient of recipients) {
      await send(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await send("DATA", [354]);
    socket.write(buildEmailMessage({ from, to: recipients.join(", "), subject, body }));
    await send(".", [250]);
    await send("QUIT", [221]);
  } finally {
    socket.end();
  }
}

function createSmtpReader(socket) {
  let buffer = "";
  const queue = [];

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    flush();
  });

  function flush() {
    while (queue.length) {
      const match = buffer.match(/(?:^|\r\n)(\d{3}) [^\r\n]*(?:\r\n|$)/);
      if (!match) return;
      const end = match.index + match[0].length;
      const response = buffer.slice(0, end);
      buffer = buffer.slice(end);
      queue.shift().resolve(response);
    }
  }

  return () =>
    new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      socket.once("error", reject);
      flush();
    });
}

function buildEmailMessage({ from, to, subject, body }) {
  const headers = [
    `From: ${cleanHeader(from)}`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${cleanHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ].join("\r\n");

  return `${headers}\r\n\r\n${body.replace(/\r?\n/g, "\r\n")}\r\n`;
}

function cleanHeader(value) {
  return String(value).replace(/[\r\n]/g, " ").trim();
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "--";
}

function formatPercent(value) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "--";
}

async function fetchTradingViewScanner(scanner, requested) {
  const tickers = requested.filter((item) => item.scanner === scanner).map((item) => item.tv);
  const response = await fetch(`${TRADINGVIEW_SCAN_URL}/${scanner}/scan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "origin": "https://www.tradingview.com",
      "referer": "https://www.tradingview.com/",
      "user-agent": "Mozilla/5.0 FinMarketIndexMonitor/1.0",
    },
    body: JSON.stringify({
      symbols: { tickers, query: { types: [] } },
      columns: TV_COLUMNS,
    }),
  });

  if (!response.ok) {
    throw new Error(`${scanner} scanner returned HTTP ${response.status}`);
  }

  const raw = await response.json();
  return raw.data || [];
}

function compactTradingViewQuote(row, requestedByTv) {
  const meta = requestedByTv.get(row.s);
  if (!meta) return null;

  const [
    name,
    description,
    type,
    exchange,
    price,
    allTimeHigh,
    changePercent,
    change,
    dayHigh,
    dayLow,
    open,
    volume,
    updateMode,
  ] = row.d;

  return {
    symbol: meta.symbol,
    sourceSymbol: row.s,
    shortName: description || name || meta.symbol,
    quoteType: type || meta.group,
    group: meta.group,
    exchange: exchange || "",
    marketState: updateMode || "",
    currency: "",
    price,
    allTimeHigh,
    drawdownPercent: price != null && allTimeHigh ? ((price - allTimeHigh) / allTimeHigh) * 100 : null,
    change,
    changePercent,
    previousClose: price != null && change != null ? price - change : null,
    dayHigh,
    dayLow,
    open,
    volume,
    marketTime: Date.now(),
  };
}

async function handleQuotes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.searchParams.get("symbols");
  const symbols = (requested ? requested.split(",") : DEFAULT_SYMBOLS)
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .slice(0, 50);

  try {
    sendJson(res, 200, await fetchQuotes(symbols));
  } catch (error) {
    sendJson(res, 502, {
      error: "Quote retrieval failed",
      detail: error.message,
      fetchedAt: Date.now(),
    });
  }
}

async function handleTestAlert(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST /api/test-alert" });
    return;
  }

  try {
    sendJson(res, 200, await sendTrialAlert());
  } catch (error) {
    sendJson(res, 500, {
      error: "Trial alert failed",
      detail: error.message,
      fetchedAt: Date.now(),
    });
  }
}

async function handleAlertStatus(req, res) {
  sendJson(res, 200, alertConfigStatus());
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const pathname = decodedPath === "/" || decodedPath.endsWith("/") ? `${decodedPath}index.html` : decodedPath;
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(__dirname, "public", normalized);

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  res.req = req;

  if (req.method === "OPTIONS" && req.url?.startsWith("/api/")) {
    handleCorsPreflight(req, res);
    return;
  }

  if (req.url?.startsWith("/api/quotes")) {
    handleQuotes(req, res);
    return;
  }

  if (req.url?.startsWith("/api/test-alert")) {
    handleTestAlert(req, res);
    return;
  }

  if (req.url?.startsWith("/api/alert-status")) {
    handleAlertStatus(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Financial market monitor running at http://${HOST}:${PORT}`);
});
