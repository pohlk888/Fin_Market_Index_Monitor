# Backend Deployment

GitHub Pages is static. It can host the table UI, but live quotes and email alerts need the Node backend in `server.js`.

## Deployment Flow

1. Create a web service from this GitHub repository.
2. Use these commands:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
3. Add environment variables from `.env.example`.
4. Keep `SMTP_PASS` secret. Do not commit `.env`.
5. After the backend is live, copy its public URL.
6. Update `config.js` and `public/config.js`:

```js
window.MARKET_MONITOR_CONFIG = {
  apiBaseUrl: "https://your-backend-url",
};
```

7. Commit and push that config change.

## Checkpoints

Open these URLs after deployment:

- `https://your-backend-url/api/health`
- `https://your-backend-url/api/alert-status`
- `https://your-backend-url/api/quotes?symbols=SPY,SPX,ES1!`

When those work, GitHub Pages can call the backend and the public monitor can show live data.
