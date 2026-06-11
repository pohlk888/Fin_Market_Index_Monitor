const SYMBOLS = [
  { symbol: "SPY", group: "etf" },
  { symbol: "QQQ", group: "etf" },
  { symbol: "DIA", group: "etf" },
  { symbol: "IWM", group: "etf" },
  { symbol: "EWS", group: "etf" },
  { symbol: "SPX", group: "index" },
  { symbol: "IXIC", group: "index" },
  { symbol: "DJI", group: "index" },
  { symbol: "RUT", group: "index" },
  { symbol: "VIX", group: "index" },
  { symbol: "STI", group: "index" },
  { symbol: "N225", group: "index" },
  { symbol: "HSI", group: "index" },
  { symbol: "ES1!", group: "future" },
  { symbol: "NQ1!", group: "future" },
  { symbol: "YM1!", group: "future" },
  { symbol: "RTY1!", group: "future" },
  { symbol: "NKD1!", group: "future" },
  { symbol: "HSI1!", group: "future" },
];
const ALARM_SYMBOLS = ["SPY", "SPX", "ES1!"];

const quoteBody = document.querySelector("#quoteBody");
const searchInput = document.querySelector("#searchInput");
const refreshButton = document.querySelector("#refreshButton");
const statusText = document.querySelector("#statusText");
const connectionDot = document.querySelector("#connectionDot");
const alarmPanel = document.querySelector("#alarmPanel");
const alarmText = document.querySelector("#alarmText");
const alarmEmailStatus = document.querySelector("#alarmEmailStatus");
const emailStatus = document.querySelector("#emailStatus");
const testAlertButton = document.querySelector("#testAlertButton");
const testAlertStatus = document.querySelector("#testAlertStatus");
const tabs = [...document.querySelectorAll(".tab")];
const API_BASE_URL = String(window.MARKET_MONITOR_CONFIG?.apiBaseUrl || "").replace(/\/+$/, "");

let quotes = [];
let alerts = {};
let activeFilter = "all";
let timer = null;

function isGitHubPagesHost() {
  return window.location.hostname.endsWith(".github.io");
}

function hasRemoteApi() {
  return API_BASE_URL.length > 0;
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function usesStaticMarketData() {
  return isGitHubPagesHost() && !hasRemoteApi();
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatVolume(value) {
  if (value == null) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function movementClass(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function groupFor(symbol) {
  return SYMBOLS.find((item) => item.symbol === symbol)?.group || "index";
}

function groupLabel(group) {
  return {
    etf: "ETF",
    index: "Index",
    future: "Future",
  }[group] || group;
}

function feedLabel(value) {
  if (!value) return "--";
  if (value === "streaming") return "Streaming";
  const delayed = value.match(/delayed_streaming_(\d+)/);
  if (delayed) {
    const minutes = Math.round(Number(delayed[1]) / 60);
    return `Delayed ${minutes}m`;
  }
  return value.replaceAll("_", " ");
}

function spyAlarmThreshold() {
  return alerts.spyDrawdown?.thresholdPercent ?? 3.5;
}

function isSpyAlarmTriggered(quote) {
  return (
    ALARM_SYMBOLS.includes(quote?.symbol) &&
    typeof quote.drawdownPercent === "number" &&
    quote.drawdownPercent <= -Math.abs(spyAlarmThreshold())
  );
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  return quotes.filter((quote) => {
    const group = groupFor(quote.symbol);
    const inGroup = activeFilter === "all" || group === activeFilter;
    const inSearch = [quote.symbol, quote.shortName, quote.exchange, quote.marketState]
      .join(" ")
      .toLowerCase()
      .includes(query);
    return inGroup && inSearch;
  });
}

function renderSummary(symbol, valueId, moveId) {
  const quote = quotes.find((item) => item.symbol === symbol);
  const valueEl = document.querySelector(`#${valueId}`);
  const moveEl = document.querySelector(`#${moveId}`);

  if (!quote) {
    valueEl.textContent = "--";
    moveEl.textContent = "--";
    moveEl.className = "";
    return;
  }

  valueEl.textContent = formatNumber(quote.price);
  moveEl.textContent = `${formatNumber(quote.change)} (${formatNumber(quote.changePercent)}%)`;
  moveEl.className = movementClass(quote.change);
}

function renderTable() {
  const rows = applyFilters();

  if (!rows.length) {
    quoteBody.innerHTML = `<tr><td colspan="13" class="empty">No matching markets</td></tr>`;
    return;
  }

  quoteBody.innerHTML = rows
    .map((quote) => {
      const group = groupFor(quote.symbol);
      const moveClass = movementClass(quote.change);
      const range =
        quote.dayLow != null && quote.dayHigh != null
          ? `${formatNumber(quote.dayLow)} - ${formatNumber(quote.dayHigh)}`
          : "--";

      return `
        <tr class="${isSpyAlarmTriggered(quote) ? "alarm-row" : ""}">
          <td><span class="symbol">${quote.symbol}</span></td>
          <td><div class="name" title="${quote.shortName}">${quote.shortName}</div></td>
          <td><span class="badge">${groupLabel(group)}</span></td>
          <td class="num">${formatNumber(quote.price)}</td>
          <td class="num ${moveClass}">${formatNumber(quote.change)}</td>
          <td class="num ${moveClass}">${formatNumber(quote.changePercent)}%</td>
          <td class="num">${formatNumber(quote.allTimeHigh)}</td>
          <td class="num ${movementClass(quote.drawdownPercent)}">${formatNumber(quote.drawdownPercent)}%</td>
          <td><span class="criteria ${quote.alarmTriggered ? "criteria-hot" : ""}">${quote.alarmCriteria || "--"}</span></td>
          <td class="num">${range}</td>
          <td class="num">${formatVolume(quote.volume)}</td>
          <td>${formatTime(quote.marketTime)}</td>
          <td><span class="badge">${feedLabel(quote.marketState)}</span></td>
        </tr>
      `;
    })
    .join("");
}

function render() {
  renderSummary("SPY", "spyValue", "spyMove");
  renderSummary("QQQ", "qqqValue", "qqqMove");
  renderSummary("STI", "stiValue", "stiMove");
  renderSummary("ES1!", "esValue", "esMove");
  renderAlarm();
  renderTable();
}

function renderAlarm() {
  const triggeredQuotes = quotes.filter(isSpyAlarmTriggered);
  alarmPanel.hidden = triggeredQuotes.length === 0;

  if (!triggeredQuotes.length) return;

  const threshold = spyAlarmThreshold();
  const summary = triggeredQuotes
    .map((quote) => `${quote.symbol} ${formatNumber(quote.drawdownPercent)}%`)
    .join(", ");
  alarmText.textContent = `${summary} below the ${threshold.toFixed(1)}% alarm level`;
  const emailStatus = alerts.spyDrawdown?.lastEmailStatus || "Email alert status unavailable";
  alarmEmailStatus.textContent = emailStatus;
}

function setStatus(kind, message) {
  connectionDot.className = `dot ${kind}`;
  statusText.textContent = message;
}

function renderDeliveryStatus(status) {
  emailStatus.textContent = status.email.configured
    ? `Email ready: ${status.email.recipient}`
    : `Email missing: ${status.email.missing.join(", ")}`;
  emailStatus.className = `delivery-pill ${status.email.configured ? "ready" : "missing"}`;
}

async function loadAlertStatus() {
  if (usesStaticMarketData()) {
    emailStatus.textContent = "Email alerts handled by GitHub Actions";
    emailStatus.className = "delivery-pill ready";
    return;
  }

  try {
    const response = await fetch(apiUrl("/api/alert-status"));
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || "Alert status failed");
    renderDeliveryStatus(status);
  } catch (error) {
    emailStatus.textContent = "Email status unavailable";
    emailStatus.className = "delivery-pill missing";
    testAlertStatus.textContent = error.message;
  }
}

async function sendTestAlert() {
  if (usesStaticMarketData()) {
    testAlertStatus.textContent = "Test email runs from GitHub Actions";
    return;
  }

  testAlertButton.disabled = true;
  testAlertStatus.textContent = "Sending test";

  try {
    const response = await fetch(apiUrl("/api/test-alert"), { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || "Test alert failed");
    testAlertStatus.textContent = result.email.status;
    await loadAlertStatus();
  } catch (error) {
    testAlertStatus.textContent = error.message;
  } finally {
    testAlertButton.disabled = false;
  }
}

async function loadQuotes() {
  window.clearTimeout(timer);
  setStatus("loading", "Updating");

  try {
    const symbols = SYMBOLS.map((item) => item.symbol).join(",");
    const response = usesStaticMarketData()
      ? await fetch(`data/quotes.json?t=${Date.now()}`, { cache: "no-store" })
      : await fetch(apiUrl(`/api/quotes?symbols=${encodeURIComponent(symbols)}`));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Quote request failed");
    }

    alerts = payload.alerts || {};
    quotes = payload.quotes.sort((a, b) => {
      const orderA = SYMBOLS.findIndex((item) => item.symbol === a.symbol);
      const orderB = SYMBOLS.findIndex((item) => item.symbol === b.symbol);
      return orderA - orderB;
    });

    render();
    const stamp = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(payload.fetchedAt));
    setStatus("live", `${usesStaticMarketData() ? "GitHub Actions" : payload.source} ${stamp}`);
  } catch (error) {
    setStatus("error", error.message);
  } finally {
    timer = window.setTimeout(loadQuotes, usesStaticMarketData() ? 60000 : 15000);
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.dataset.filter;
    renderTable();
  });
});

searchInput.addEventListener("input", renderTable);
refreshButton.addEventListener("click", loadQuotes);
testAlertButton.addEventListener("click", sendTestAlert);

if (window.location.protocol === "file:") {
  const liveUrl = "http://127.0.0.1:4173/";
  setStatus("loading", "Opening live server");
  quoteBody.innerHTML = `
    <tr>
      <td colspan="13" class="empty">
        Redirecting to the live monitor. If it does not open, use ${liveUrl}
      </td>
    </tr>
  `;
  window.location.replace(liveUrl);
} else {
  loadAlertStatus();
  loadQuotes();
}
