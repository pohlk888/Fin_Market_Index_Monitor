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
  { symbol: "GOLD", group: "gold" },
  { symbol: "USDSGD", group: "fx" },
  { symbol: "SHCOMP", group: "china" },
  { symbol: "CSI300", group: "china" },
  { symbol: "SZCOMP", group: "china" },
  { symbol: "TAIEX", group: "taiwan" },
  { symbol: "JCI", group: "indonesia" },
  { symbol: "ES1!", group: "future" },
  { symbol: "NQ1!", group: "future" },
  { symbol: "YM1!", group: "future" },
  { symbol: "RTY1!", group: "future" },
  { symbol: "NKD1!", group: "future" },
  { symbol: "HSI1!", group: "future" },
];
const ALARM_SYMBOLS = ["SPY", "SPX", "ES1!"];
const PRICE_DIGITS = {
  USDSGD: 4,
};
const STATIC_DATA_MAX_AGE_MS = 10 * 60 * 1000;
const STATIC_DATA_SOURCES = [
  () => `data/quotes.json?t=${Date.now()}`,
  () => `https://raw.githubusercontent.com/pohlk888/Fin_Market_Index_Monitor/main/data/quotes.json?t=${Date.now()}`,
];
const TREND_STORAGE_KEY = "marketMonitorTrendHistory";
const TREND_MAX_POINTS = 240;

const quoteBody = document.querySelector("#quoteBody");
const quoteCards = document.querySelector("#quoteCards");
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
const trendPanel = document.querySelector("#trendPanel");
const trendTitle = document.querySelector("#trendTitle");
const trendLast = document.querySelector("#trendLast");
const trendChange = document.querySelector("#trendChange");
const trendPoints = document.querySelector("#trendPoints");
const trendSvg = document.querySelector("#trendSvg");
const trendNote = document.querySelector("#trendNote");
const trendCloseButton = document.querySelector("#trendCloseButton");
const tabs = [...document.querySelectorAll(".tab")];
const API_BASE_URL = String(window.MARKET_MONITOR_CONFIG?.apiBaseUrl || "").replace(/\/+$/, "");
const FORCE_STATIC_DATA = new URLSearchParams(window.location.search).has("static");

let quotes = [];
let alerts = {};
let activeFilter = "all";
let timer = null;
let openTrendSymbol = null;
let trendHistory = loadTrendHistory();

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
  return FORCE_STATIC_DATA || (isGitHubPagesHost() && !hasRemoteApi());
}

function canUseStaticFallback() {
  return FORCE_STATIC_DATA || isGitHubPagesHost();
}

function payloadTime(payload) {
  return Number(payload.generatedAt || payload.fetchedAt || 0);
}

function isStalePayload(payload) {
  const timestamp = payloadTime(payload);
  return !timestamp || Date.now() - timestamp > STATIC_DATA_MAX_AGE_MS;
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

function formatRange(quote) {
  return quote.dayLow != null && quote.dayHigh != null
    ? `${formatQuoteNumber(quote, quote.dayLow)} - ${formatQuoteNumber(quote, quote.dayHigh)}`
    : "--";
}

function formatQuoteNumber(quote, value) {
  return formatNumber(value, PRICE_DIGITS[quote?.symbol] ?? 2);
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
    gold: "Gold",
    fx: "FX",
    china: "China",
    taiwan: "Taiwan",
    indonesia: "Indonesia",
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

function alarmCriteriaLabel(value) {
  if (!value || value === "--") return "--";
  const percent = String(value).match(/-?\d+(?:\.\d+)?%/);
  return percent ? percent[0] : value;
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

function loadTrendHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TREND_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveTrendHistory() {
  try {
    window.localStorage.setItem(TREND_STORAGE_KEY, JSON.stringify(trendHistory));
  } catch {
    // Private browsing or full storage should not block live quote rendering.
  }
}

function recordTrendHistory(nextQuotes, timestamp) {
  const time = Number(timestamp) || Date.now();
  let changed = false;

  nextQuotes.forEach((quote) => {
    if (typeof quote.price !== "number") return;

    const points = Array.isArray(trendHistory[quote.symbol]) ? trendHistory[quote.symbol] : [];
    const last = points.at(-1);
    if (last && last.t === time && last.p === quote.price) return;

    trendHistory[quote.symbol] = [...points, { t: time, p: quote.price }].slice(-TREND_MAX_POINTS);
    changed = true;
  });

  if (changed) saveTrendHistory();
}

function trendPointsFor(symbol) {
  return Array.isArray(trendHistory[symbol]) ? trendHistory[symbol] : [];
}

function svgText(x, y, text, className = "trend-axis-text", anchor = "start") {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${text}</text>`;
}

function renderTrendChart(symbol) {
  const quote = quotes.find((item) => item.symbol === symbol);
  const points = trendPointsFor(symbol);

  if (!quote) return;

  trendTitle.textContent = `${quote.symbol} ${quote.shortName || ""}`.trim();
  trendLast.textContent = `Last ${formatQuoteNumber(quote, quote.price)}`;
  trendChange.textContent = `Move ${formatNumber(quote.change)} (${formatNumber(quote.changePercent)}%)`;
  trendChange.className = movementClass(quote.change);
  trendPoints.textContent = `${points.length} point${points.length === 1 ? "" : "s"}`;

  const chartWidth = 640;
  const chartHeight = 220;
  const padding = { top: 18, right: 72, bottom: 34, left: 18 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  if (!points.length) {
    trendSvg.innerHTML = `
      <rect class="trend-frame" x="1" y="1" width="638" height="218" rx="8"></rect>
      ${svgText(320, 112, "Waiting for live quote history", "trend-empty-text", "middle")}
    `;
    trendNote.textContent = "The chart will appear after this counter receives a quote refresh.";
    return;
  }

  const prices = points.map((point) => point.p);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || Math.max(Math.abs(maxPrice) * 0.01, 1);
  const yMin = minPrice - range * 0.08;
  const yMax = maxPrice + range * 0.08;
  const yRange = yMax - yMin || 1;
  const xStep = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  const coords = points.map((point, index) => {
    const x = padding.left + (points.length > 1 ? index * xStep : innerWidth / 2);
    const y = padding.top + (1 - (point.p - yMin) / yRange) * innerHeight;
    return { x, y, point };
  });
  const path = coords.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaPath = `M ${coords[0].x.toFixed(2)} ${chartHeight - padding.bottom} L ${path
    .split(" ")
    .join(" L ")} L ${coords.at(-1).x.toFixed(2)} ${chartHeight - padding.bottom} Z`;
  const lineClass = quote.change >= 0 ? "trend-line positive-line" : "trend-line negative-line";
  const dotClass = quote.change >= 0 ? "trend-dot positive-dot" : "trend-dot negative-dot";
  const startTime = formatTime(points[0].t).replace(/\sGMT.*$/, "");
  const endTime = formatTime(points.at(-1).t).replace(/\sGMT.*$/, "");
  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = padding.top + ratio * innerHeight;
      const price = yMax - ratio * yRange;
      return `
        <line class="trend-grid-line" x1="${padding.left}" x2="${chartWidth - padding.right}" y1="${y}" y2="${y}"></line>
        ${svgText(chartWidth - padding.right + 8, y + 4, formatQuoteNumber(quote, price))}
      `;
    })
    .join("");

  trendSvg.innerHTML = `
    <rect class="trend-frame" x="1" y="1" width="638" height="218" rx="8"></rect>
    ${grid}
    <path class="trend-area" d="${areaPath}"></path>
    ${points.length > 1 ? `<polyline class="${lineClass}" points="${path}"></polyline>` : ""}
    <circle class="${dotClass}" cx="${coords.at(-1).x}" cy="${coords.at(-1).y}" r="4"></circle>
    ${svgText(padding.left, chartHeight - 10, startTime, "trend-axis-text")}
    ${svgText(chartWidth - padding.right, chartHeight - 10, endTime, "trend-axis-text", "end")}
  `;
  trendNote.textContent = "Trend is stored in this browser and updates whenever this page refreshes market quotes.";
}

function openTrend(symbol) {
  openTrendSymbol = symbol;
  renderTrendChart(symbol);
  trendPanel.hidden = false;
  trendCloseButton.focus();
}

function closeTrend() {
  trendPanel.hidden = true;
  openTrendSymbol = null;
}

function openTrendFromEvent(event) {
  const item = event.target.closest("[data-symbol]");
  if (!item) return;
  const symbol = item.dataset.symbol;
  if (symbol && quotes.some((quote) => quote.symbol === symbol)) openTrend(symbol);
}

function openTrendFromKeyboard(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const item = event.target.closest("[data-symbol]");
  if (!item) return;
  event.preventDefault();
  openTrendFromEvent(event);
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

function renderTable() {
  const rows = applyFilters();

  if (!rows.length) {
    quoteBody.innerHTML = `<tr><td colspan="14" class="empty">No matching markets</td></tr>`;
    quoteCards.innerHTML = `<div class="empty-card">No matching markets</div>`;
    return;
  }

  quoteBody.innerHTML = rows
    .map((quote) => {
      const group = groupFor(quote.symbol);
      const moveClass = movementClass(quote.change);
      const range = formatRange(quote);

      return `
        <tr class="${isSpyAlarmTriggered(quote) ? "alarm-row" : ""}" data-symbol="${quote.symbol}" tabindex="0">
          <td><span class="symbol">${quote.symbol}</span></td>
          <td><button class="trend-open" type="button" data-symbol="${quote.symbol}">Trend Chart</button></td>
          <td><div class="name" title="${quote.shortName}">${quote.shortName}</div></td>
          <td><span class="badge">${groupLabel(group)}</span></td>
          <td class="num">${formatQuoteNumber(quote, quote.price)}</td>
          <td class="num ${moveClass}">${formatNumber(quote.change)}</td>
          <td class="num ${moveClass}">${formatNumber(quote.changePercent)}%</td>
          <td class="num">${formatQuoteNumber(quote, quote.allTimeHigh)}</td>
          <td class="num ${movementClass(quote.drawdownPercent)}">${formatNumber(quote.drawdownPercent)}%</td>
          <td><span class="criteria ${quote.alarmTriggered ? "criteria-hot" : ""}">${alarmCriteriaLabel(quote.alarmCriteria)}</span></td>
          <td class="num">${range}</td>
          <td class="num">${formatVolume(quote.volume)}</td>
          <td>${formatTime(quote.marketTime)}</td>
          <td><span class="badge">${feedLabel(quote.marketState)}</span></td>
        </tr>
      `;
    })
    .join("");

  quoteCards.innerHTML = rows
    .map((quote) => {
      const group = groupFor(quote.symbol);
      const moveClass = movementClass(quote.change);
      const alarmClass = isSpyAlarmTriggered(quote) ? " alarm-card-hot" : "";

      return `
        <article class="quote-card${alarmClass}" data-symbol="${quote.symbol}" tabindex="0">
          <div class="quote-card-head">
            <div>
              <strong>${quote.symbol}</strong>
              <span>${quote.shortName || "--"}</span>
            </div>
            <em>${groupLabel(group)}</em>
          </div>
          <div class="quote-card-price">
            <span>${formatQuoteNumber(quote, quote.price)}</span>
            <b class="${moveClass}">${formatNumber(quote.change)} (${formatNumber(quote.changePercent)}%)</b>
          </div>
          <button class="trend-open trend-open-mobile" type="button" data-symbol="${quote.symbol}">Trend Chart</button>
          <dl class="quote-card-grid">
            <div>
              <dt>All-Time High</dt>
              <dd>${formatQuoteNumber(quote, quote.allTimeHigh)}</dd>
            </div>
            <div>
              <dt>Drawdown</dt>
              <dd class="${movementClass(quote.drawdownPercent)}">${formatNumber(quote.drawdownPercent)}%</dd>
            </div>
            <div>
              <dt>Day Range</dt>
              <dd>${formatRange(quote)}</dd>
            </div>
            <div>
              <dt>Volume</dt>
              <dd>${formatVolume(quote.volume)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>${formatTime(quote.marketTime)}</dd>
            </div>
            <div>
              <dt>Feed</dt>
              <dd>${feedLabel(quote.marketState)}</dd>
            </div>
          </dl>
          <div class="quote-card-criteria ${quote.alarmTriggered ? "criteria-hot" : ""}">
            Alarm Criteria ${alarmCriteriaLabel(quote.alarmCriteria)}
          </div>
        </article>
      `;
    })
    .join("");
}

function render() {
  renderAlarm();
  renderTable();
  if (openTrendSymbol) renderTrendChart(openTrendSymbol);
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
  if (!hasRemoteApi()) {
    emailStatus.textContent = "Email alerts need live backend";
    emailStatus.className = "delivery-pill ready";
    return;
  }

  try {
    const response = await fetch(apiUrl("/api/alert-status"));
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || "Alert status failed");
    renderDeliveryStatus(status);
  } catch (error) {
    emailStatus.textContent = canUseStaticFallback()
      ? "Email backend offline; using GitHub data"
      : "Email status unavailable";
    emailStatus.className = "delivery-pill missing";
    testAlertStatus.textContent = error.message;
  }
}

async function sendTestAlert() {
  if (!hasRemoteApi()) {
    testAlertStatus.textContent = "Test email needs live backend";
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
    const { payload, sourceLabel } = await fetchBestQuotes(symbols);

    if (!payload.quotes?.length) throw new Error("No quote rows returned");

    alerts = payload.alerts || {};
    quotes = payload.quotes.sort((a, b) => {
      const orderA = SYMBOLS.findIndex((item) => item.symbol === a.symbol);
      const orderB = SYMBOLS.findIndex((item) => item.symbol === b.symbol);
      return orderA - orderB;
    });

    const timestamp = payloadTime(payload);
    recordTrendHistory(quotes, timestamp);
    render();
    const stamp = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp));
    const stale = isStalePayload(payload);
    setStatus(stale ? "error" : "live", `${sourceLabel} ${stamp}${stale ? " stale" : ""}`);
  } catch (error) {
    setStatus("error", error.message);
  } finally {
    timer = window.setTimeout(loadQuotes, hasRemoteApi() ? 15000 : 60000);
  }
}

async function fetchBestQuotes(symbols) {
  if (!hasRemoteApi()) {
    return fetchStaticQuotes();
  }

  try {
    return await fetchApiQuotes(symbols);
  } catch (error) {
    if (!canUseStaticFallback()) throw error;
    const fallback = await fetchStaticQuotes();
    return {
      payload: fallback.payload,
      sourceLabel: `${fallback.sourceLabel} fallback`,
    };
  }
}

async function fetchApiQuotes(symbols) {
  const response = await fetch(apiUrl(`/api/quotes?symbols=${encodeURIComponent(symbols)}`), {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || "Quote request failed");
  }
  return { payload, sourceLabel: payload.source || "Live API" };
}

async function fetchStaticQuotes() {
  let lastError = null;

  for (let index = 0; index < STATIC_DATA_SOURCES.length; index += 1) {
    try {
      const response = await fetch(STATIC_DATA_SOURCES[index](), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || "Static quote request failed");
      }

      const sourceLabel = index === 0 ? "GitHub Pages" : "GitHub raw";
      if (!isStalePayload(payload) || index === STATIC_DATA_SOURCES.length - 1) {
        return { payload, sourceLabel };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Static quote request failed");
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
quoteBody.addEventListener("click", openTrendFromEvent);
quoteBody.addEventListener("keydown", openTrendFromKeyboard);
quoteCards.addEventListener("click", openTrendFromEvent);
quoteCards.addEventListener("keydown", openTrendFromKeyboard);
trendCloseButton.addEventListener("click", closeTrend);
trendPanel.addEventListener("click", (event) => {
  if (event.target === trendPanel) closeTrend();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !trendPanel.hidden) closeTrend();
});

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
