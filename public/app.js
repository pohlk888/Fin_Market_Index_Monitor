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
const HISTORY_DATA_SOURCES = [
  () => `data/history.json?t=${Date.now()}`,
  () => `https://raw.githubusercontent.com/pohlk888/Fin_Market_Index_Monitor/main/data/history.json?t=${Date.now()}`,
];

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
const trendLegend = document.querySelector("#trendLegend");
const trendSvg = document.querySelector("#trendSvg");
const trendNote = document.querySelector("#trendNote");
const trendCloseButton = document.querySelector("#trendCloseButton");
const trendExpandButton = document.querySelector("#trendExpandButton");
const trendZoomOutButton = document.querySelector("#trendZoomOutButton");
const trendZoomInButton = document.querySelector("#trendZoomInButton");
const trendResetButton = document.querySelector("#trendResetButton");
const tabs = [...document.querySelectorAll(".tab")];
const API_BASE_URL = String(window.MARKET_MONITOR_CONFIG?.apiBaseUrl || "").replace(/\/+$/, "");
const FORCE_STATIC_DATA = new URLSearchParams(window.location.search).has("static");

let quotes = [];
let alerts = {};
let activeFilter = "all";
let timer = null;
let openTrendSymbol = null;
let historyPayload = null;
let historyPromise = null;
let trendZoomLevel = 0;
let trendExpanded = false;

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

function trendPointsFor(symbol) {
  const points = historyPayload?.history?.[symbol]?.points;
  return Array.isArray(points) ? points : [];
}

function svgText(x, y, text, className = "trend-axis-text", anchor = "start") {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${text}</text>`;
}

function formatDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function pointClose(point) {
  return typeof point?.c === "number" ? point.c : point?.p;
}

function pointOpen(point) {
  return typeof point?.o === "number" ? point.o : pointClose(point);
}

function pointHigh(point) {
  return typeof point?.h === "number" ? point.h : Math.max(pointOpen(point), pointClose(point));
}

function pointLow(point) {
  return typeof point?.l === "number" ? point.l : Math.min(pointOpen(point), pointClose(point));
}

function visibleCountFor(points) {
  if (!trendZoomLevel) return points.length;
  return Math.max(60, Math.floor(points.length / 2 ** trendZoomLevel));
}

function movingAverageSeries(points, windowSize) {
  let sum = 0;
  return points.map((point, index) => {
    const close = pointClose(point);
    sum += close;
    if (index >= windowSize) sum -= pointClose(points[index - windowSize]);

    return {
      t: point.t,
      value: index >= windowSize - 1 ? sum / windowSize : null,
    };
  });
}

function pivotLevels(point) {
  if (!point) return null;
  const high = pointHigh(point);
  const low = pointLow(point);
  const close = pointClose(point);
  if (![high, low, close].every((value) => typeof value === "number" && Number.isFinite(value))) return null;

  const pivot = (high + low + close) / 3;
  return {
    pivot,
    r1: 2 * pivot - low,
    s1: 2 * pivot - high,
  };
}

async function loadHistoryData() {
  if (historyPayload) return historyPayload;
  if (historyPromise) return historyPromise;

  historyPromise = fetchHistoryData()
    .then((payload) => {
      historyPayload = payload;
      return payload;
    })
    .finally(() => {
      historyPromise = null;
    });

  return historyPromise;
}

async function fetchHistoryData() {
  let lastError = null;

  for (const source of HISTORY_DATA_SOURCES) {
    try {
      const response = await fetch(source(), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || "History request failed");
      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("History request failed");
}

function renderTrendLoading(symbol) {
  const quote = quotes.find((item) => item.symbol === symbol);
  trendTitle.textContent = `${symbol} ${quote?.shortName || ""}`.trim();
  trendLast.textContent = quote ? `Last ${formatQuoteNumber(quote, quote.price)}` : "Last --";
  trendChange.textContent = "Loading 5-year daily closes";
  trendChange.className = "neutral";
  trendPoints.textContent = "Loading";
  trendLegend.innerHTML = "";
  trendSvg.innerHTML = `
    <rect class="trend-frame" x="1" y="1" width="718" height="298" rx="8"></rect>
    ${svgText(320, 112, "Loading 5-year daily close chart", "trend-empty-text", "middle")}
  `;
  trendNote.textContent = "Trend Chart uses daily OHLC prices for the past 5 years.";
}

function renderTrendError(symbol, message) {
  trendTitle.textContent = `${symbol} Trend Chart`;
  trendLast.textContent = "Last --";
  trendChange.textContent = "History unavailable";
  trendChange.className = "negative";
  trendPoints.textContent = "0 points";
  trendLegend.innerHTML = "";
  trendSvg.innerHTML = `
    <rect class="trend-frame" x="1" y="1" width="718" height="298" rx="8"></rect>
    ${svgText(320, 112, "Unable to load daily close history", "trend-empty-text", "middle")}
  `;
  trendNote.textContent = message;
}

function renderTrendChart(symbol) {
  const quote = quotes.find((item) => item.symbol === symbol);
  const points = trendPointsFor(symbol);
  const history = historyPayload?.history?.[symbol];

  if (!quote) return;

  trendTitle.textContent = `${quote.symbol} ${quote.shortName || ""}`.trim();
  trendLast.textContent = `Last ${formatQuoteNumber(quote, quote.price)}`;
  trendChange.textContent = `Move ${formatNumber(quote.change)} (${formatNumber(quote.changePercent)}%)`;
  trendChange.className = movementClass(quote.change);
  const visibleCount = visibleCountFor(points);
  const startIndex = Math.max(0, points.length - visibleCount);
  const visiblePoints = points.slice(startIndex);
  trendPoints.textContent = `${visiblePoints.length} of ${points.length} days`;

  const chartWidth = 720;
  const chartHeight = 300;
  const padding = { top: 20, right: 86, bottom: 38, left: 18 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  if (!points.length) {
    trendSvg.innerHTML = `
      <rect class="trend-frame" x="1" y="1" width="718" height="298" rx="8"></rect>
      ${svgText(320, 112, "Waiting for live quote history", "trend-empty-text", "middle")}
    `;
    trendNote.textContent = "No 5-year daily OHLC history is available for this counter yet.";
    return;
  }

  const allMa20 = movingAverageSeries(points, 20);
  const allMa200 = movingAverageSeries(points, 200);
  const ma20 = allMa20.slice(startIndex);
  const ma200 = allMa200.slice(startIndex);
  const pivots = pivotLevels(points.at(-1));
  const ohlcValues = visiblePoints
    .flatMap((point) => [pointHigh(point), pointLow(point), pointOpen(point), pointClose(point)])
    .filter((value) => typeof value === "number");
  const maValues = [...ma20, ...ma200]
    .map((point) => point.value)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const pivotValues = pivots ? [pivots.pivot, pivots.r1, pivots.s1] : [];
  const chartValues = [...ohlcValues, ...maValues, ...pivotValues];
  const minPrice = Math.min(...chartValues);
  const maxPrice = Math.max(...chartValues);
  const range = maxPrice - minPrice || Math.max(Math.abs(maxPrice) * 0.01, 1);
  const yMin = minPrice - range * 0.08;
  const yMax = maxPrice + range * 0.08;
  const yRange = yMax - yMin || 1;
  const xStep = visiblePoints.length > 1 ? innerWidth / (visiblePoints.length - 1) : 0;

  const xForIndex = (index) => padding.left + (visiblePoints.length > 1 ? index * xStep : innerWidth / 2);
  const yForPrice = (price) => padding.top + (1 - (price - yMin) / yRange) * innerHeight;
  const movingAveragePath = (series) =>
    series
      .map((point, index) =>
        typeof point.value === "number" && Number.isFinite(point.value)
          ? `${xForIndex(index).toFixed(2)},${yForPrice(point.value).toFixed(2)}`
          : null,
      )
      .filter(Boolean)
      .join(" ");
  const candleWidth = Math.max(2, Math.min(9, innerWidth / Math.max(visiblePoints.length, 1) * 0.62));
  const ma20Path = movingAveragePath(ma20);
  const ma200Path = movingAveragePath(ma200);
  const candles = visiblePoints
    .map((point, index) => {
      const open = pointOpen(point);
      const high = pointHigh(point);
      const low = pointLow(point);
      const close = pointClose(point);
      const x = xForIndex(index);
      const yOpen = yForPrice(open);
      const yClose = yForPrice(close);
      const yHigh = yForPrice(high);
      const yLow = yForPrice(low);
      const yBody = Math.min(yOpen, yClose);
      const height = Math.max(Math.abs(yClose - yOpen), 1.6);
      const up = close >= open;
      return `
        <line class="candle-wick ${up ? "candle-up" : "candle-down"}" x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${yHigh.toFixed(2)}" y2="${yLow.toFixed(2)}"></line>
        <rect class="candle-body ${up ? "candle-up" : "candle-down"}" x="${(x - candleWidth / 2).toFixed(2)}" y="${yBody.toFixed(2)}" width="${candleWidth.toFixed(2)}" height="${height.toFixed(2)}" rx="0.8"></rect>
      `;
    })
    .join("");
  const startTime = formatDate(visiblePoints[0].t);
  const endTime = formatDate(visiblePoints.at(-1).t);
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
  const pivotLines = pivots
    ? [
        ["R1", pivots.r1, "pivot-r1"],
        ["P", pivots.pivot, "pivot-p"],
        ["S1", pivots.s1, "pivot-s1"],
      ]
        .map(([label, value, className]) => {
          const y = yForPrice(value);
          return `
            <line class="pivot-line ${className}" x1="${padding.left}" x2="${chartWidth - padding.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"></line>
            ${svgText(chartWidth - padding.right + 8, y + 4, label, `trend-axis-text ${className}`)}
          `;
        })
        .join("")
    : "";

  trendLegend.innerHTML = `
    <span><i class="candle-up-dot"></i>Up candle</span>
    <span><i class="candle-down-dot"></i>Down candle</span>
    <span><i class="ma20-dot"></i>20 days MA</span>
    <span><i class="ma200-dot"></i>200 days MA</span>
    <span><i class="pivot-dot"></i>Pivot P/R1/S1</span>
  `;
  trendSvg.innerHTML = `
    <rect class="trend-frame" x="1" y="1" width="718" height="298" rx="8"></rect>
    ${grid}
    ${pivotLines}
    ${candles}
    ${ma200Path ? `<polyline class="trend-ma-line ma200-line" points="${ma200Path}"></polyline>` : ""}
    ${ma20Path ? `<polyline class="trend-ma-line ma20-line" points="${ma20Path}"></polyline>` : ""}
    ${svgText(padding.left, chartHeight - 10, startTime, "trend-axis-text")}
    ${svgText(chartWidth - padding.right, chartHeight - 10, endTime, "trend-axis-text", "end")}
  `;
  const sourceSymbol = history?.sourceSymbol ? ` (${history.sourceSymbol})` : "";
  trendNote.textContent = `Daily OHLC prices for the past 5 years from ${historyPayload?.source || "history data"}${sourceSymbol}. Pivot uses latest daily high, low, and close.`;
}

async function openTrend(symbol) {
  openTrendSymbol = symbol;
  trendZoomLevel = 0;
  trendPanel.hidden = false;
  renderTrendLoading(symbol);
  trendCloseButton.focus();

  try {
    await loadHistoryData();
    if (openTrendSymbol === symbol) renderTrendChart(symbol);
  } catch (error) {
    if (openTrendSymbol === symbol) renderTrendError(symbol, error.message);
  }
}

function closeTrend() {
  trendPanel.hidden = true;
  openTrendSymbol = null;
}

function rerenderOpenTrend() {
  if (openTrendSymbol && historyPayload) renderTrendChart(openTrendSymbol);
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
trendExpandButton.addEventListener("click", () => {
  trendExpanded = !trendExpanded;
  trendPanel.classList.toggle("trend-panel-expanded", trendExpanded);
  trendExpandButton.textContent = trendExpanded ? "Normal" : "Enlarge";
  rerenderOpenTrend();
});
trendZoomInButton.addEventListener("click", () => {
  trendZoomLevel = Math.min(trendZoomLevel + 1, 6);
  rerenderOpenTrend();
});
trendZoomOutButton.addEventListener("click", () => {
  trendZoomLevel = Math.max(trendZoomLevel - 1, 0);
  rerenderOpenTrend();
});
trendResetButton.addEventListener("click", () => {
  trendZoomLevel = 0;
  rerenderOpenTrend();
});
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
