window.MARKET_MONITOR_CONFIG = {
  apiBaseUrl: ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://127.0.0.1:4173"
    : "https://fin-market-index-monitor-api.onrender.com",
};
