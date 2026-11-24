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

- `firmware/UPPER_TANK/ESP32_DASHBOARD.ino` – water level board (WiFi captive-portal setup, ultrasonic + flow sensor, valve relay, 10 s water-level prediction). Publishes telemetry to `/aquapave/upper_tank`.
- `firmware/LOWER_TANK/WaterQual_Updated.ino` – water quality board (WiFi captive-portal setup; pH, turbidity, TDS, water level, filter prediction). Publishes telemetry to `/aquapave/filter`.

Both boards publish directly to the Realtime Database every sampling interval (upper tank 10 s, lower tank 3 s) and require the `Firebase ESP32 Client` library.

Copy your trained header **`water_model_params_10s.h`** next to the water sketch (`firmware/UPPER_TANK/`); the feature vector must match `INPUT_SIZE`.

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
