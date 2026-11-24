# AquaPave AI Dashboard

A lightweight, single-page web dashboard that visualizes **AquaPave** sensor data with **line graphs** and **numeric KPIs**, styled similarly to modern analytics UIs.

Data is read **live from Firebase Realtime Database** — no ESP32 IP addresses, no manual "Connect" step.

## Files

- `index.html` – main page with layout and components (loads the Firebase SDK + Chart.js from CDN)
- `style.css` – styling for the sidebar, cards, charts, and responsive layout
- `app.dual.js` – logic for subscribing to Firebase and rendering charts/KPIs

## Data source

The dashboard connects to:

```
https://aquapave-database-default-rtdb.asia-southeast1.firebasedatabase.app/
```

It listens (realtime `onValue`) to two nodes:

| Node                    | Board               | Fields |
| ----------------------- | ------------------- | ------ |
| `/aquapave/upper_tank`  | Water level ESP32   | `tankHeightCm`, `zeroWaterThresholdCm`, `waterLevel`, `waterLevelCm`, `distanceCm`, `waterFlowLmin`, `waterRateCmPerSec`, `predictionReady`, `predictedWaterLevel10s`, `valveOpen`, `systemEnabled` |
| `/aquapave/filter`      | Water quality ESP32 | `turbidity`, `ph`, `tds`, `waterLevelCm`, `efficiency`, `prediction` |

Notes:

- Read access is public; the dashboard only **reads** (it does not write to Firebase).
- The boards do not send a wall-clock timestamp, so the dashboard stamps each received sample with the browser time for charting.
- The boards may omit `predictedWaterLevel10s` (or send the literal string `"null"`) when a prediction is not ready; the dashboard treats both as "no prediction".
- Chart history ("last 5 / 15 / 60 minutes") is accumulated in the browser while the page is open. It is **not** persisted across refreshes.

Paths live at the top of `app.dual.js` (`WATER_PATH`, `QUALITY_PATH`) if you need to rename them.

## Firmware

Firmware is **not** tracked in this repository. It is maintained separately because it
contains WiFi credentials and device secrets.

- `UPPER_TANK/ESP32_DASHBOARD.ino` – water level board (WiFi captive-portal setup, ultrasonic + flow sensor, valve relay, 10 s water-level prediction). Publishes telemetry to `/aquapave/upper_tank`.
- `LOWER_TANK/WaterQual_Updated.ino` – water quality board (WiFi captive-portal setup; pH, turbidity, TDS, water level, filter prediction). Publishes telemetry to `/aquapave/filter`.

Both boards publish to the Realtime Database at their sampling interval (upper tank 10 s,
lower tank 3 s) using the `Firebase ESP32 Client` library. The upper-tank sketch also needs
the trained header `water_model_params_10s.h` placed next to the sketch; its feature vector
must match `INPUT_SIZE`.

## Deploying (Vercel)

Deploy by importing this repository into Vercel. No build step, no environment variables,
no secrets in the dashboard.

```bash
# from the repository root
npm i -g vercel
vercel --prod          # or: vercel, then promote
```

`vercel.json` is already configured:

- `buildCommand: null`, `outputDirectory: "."` – the three dashboard files are served as-is.
- `.vercelignore` keeps `firmware/` and non-runtime files (`app.js`, `README.md`) out of the
  upload, so only `index.html`, `style.css` and `app.dual.js` are published.
- Security headers on every response: Content-Security-Policy, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and no-cache for
  `.js/.css/.html`.

### Database rules (do this before going public)

The Firebase Realtime Database is currently configured to accept **unauthenticated
writes**. Because the dashboard will be publicly reachable, lock it down first:

1. Firebase console → Project `aquapave-database` → Realtime Database → Rules.
2. Publish:

```json
{
  "rules": {
    "aquapave": {
      ".read": true,
      ".write": false
    }
  }
}
```

3. If you want only the two ESP32 devices to be able to write, replace `".write": false` with
   `".write": "auth != null"` and give each board a Firebase **database secret** (Project
   settings → Service accounts → Database secrets → Show), then in both sketches set
   `config.signer.tokens.legacy_token = "<DATABASE_SECRET>"` before `Firebase.begin()`.

To keep the data readable without login, `".read": true` stays — the dashboard is
read-only, so it needs no Firebase Authentication.

The Firebase Web API key in `app.dual.js` is **not** a secret: it only identifies the
project, and access is controlled entirely by the rules above.

## Running the dashboard

### Easiest: open directly

1. Open `index.html` in your browser (double-click it).
2. It connects to Firebase automatically and starts showing live data as soon as the boards publish. Until the first reading arrives it shows the disconnected/waiting state.

### Optional: run with a static server

If you have Node.js:

```bash
cd "d:\\Programs and Code\\THESIS"
npm install serve
npm run start
```

Then open the printed `http://localhost:xxxx` URL in your browser.
