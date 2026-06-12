# Live Backend Deployment

GitHub Pages is static. It can host the table UI, but reliable live quotes and email alerts need the Node backend in `server.js`.

The monitor now uses this order:

1. Live Render backend API: `https://fin-market-index-monitor-api.onrender.com`
2. GitHub Pages `data/quotes.json` fallback
3. GitHub raw `data/quotes.json` fallback

## Deployment Flow

1. In Render, create a **Blueprint** or **Web Service** from this GitHub repository.
2. If using manual Web Service setup, use these commands:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
3. Add environment variables from `.env.example`.
4. Keep `SMTP_PASS` secret. Do not commit `.env`.
5. Use the service name `fin-market-index-monitor-api` so the URL is:
   `https://fin-market-index-monitor-api.onrender.com`

## Checkpoints

Open these URLs after deployment:

- `https://your-backend-url/api/health`
- `https://your-backend-url/api/alert-status`
- `https://your-backend-url/api/quotes?symbols=SPY,SPX,ES1!`

When those work, GitHub Pages will call the backend every 15 seconds. If Render is sleeping or offline, the page falls back to the GitHub Actions data file.
