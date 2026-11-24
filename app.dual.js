// AquaPave AI dashboard — Firebase Realtime Database edition.
// Data is read live from the RTDB (no ESP32 IP polling, no manual connect).
//   /aquapave/upper_tank  -> water level board
//   /aquapave/filter      -> water quality board
// The theme, charts and KPIs are unchanged; only the data source was swapped.

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBIec4v7Wziad-FgxmCysgwdFlm7W7mcfo',
  databaseURL: 'https://aquapave-database-default-rtdb.asia-southeast1.firebasedatabase.app/',
};

const WATER_PATH = 'aquapave/upper_tank';
const QUALITY_PATH = 'aquapave/filter';

const MAX_POINTS = 1500;
const TURBIDITY_CLEAR_NTU_MAX = 40;
const TURBIDITY_DIRTY_NTU_MIN = 120;
const FILTER_EFFICIENCY_WEIGHTS = [-0.71863848, -0.56566994, 0.73802914, -1.28926102];
const FILTER_EFFICIENCY_BIAS = 88.73732907365545;
const FILTER_EFFICIENCY_MEANS = [249.621741, 4.99600086, 7.25006217, 2.75361437];
const FILTER_EFFICIENCY_SCALES = [144.26961376, 2.87686273, 0.72235594, 1.29209535];

const state = {
  connected: false,
  lastUpdate: null,
  devices: {
    water: { history: [], received: false },
    quality: { history: [], received: false },
  },
  charts: { history: null, waterLevel: null },
};

const elements = {
  firebaseStatus: document.getElementById('firebase-status'),
  firebaseLastUpdate: document.getElementById('firebase-last-update'),
  pauseBtn: document.getElementById('pause-btn'),
  timeRange: document.getElementById('time-range'),
  historyCanvas: document.getElementById('history-chart'),
  waterLevelCanvas: document.getElementById('waterlevel-chart'),
  recentList: document.getElementById('recent-readings'),
  turbValue: document.getElementById('turb-value'),
  turbTrend: document.getElementById('turb-trend'),
  turbClarity: document.getElementById('turb-clarity'),
  phValue: document.getElementById('ph-value'),
  phTrend: document.getElementById('ph-trend'),
  tdsValue: document.getElementById('tds-value'),
  tdsTrend: document.getElementById('tds-trend'),
  wlGaugeValue: document.getElementById('waterlevel-value'),
  wlCurrent: document.getElementById('wl-current'),
  wlTrend: document.getElementById('wl-trend'),
  distCurrent: document.getElementById('dist-current'),
  distTrend: document.getElementById('dist-trend'),
  wlPredicted: document.getElementById('wl-predicted'),
  wlPredictionState: document.getElementById('wl-prediction-state'),
  wlCurrentCm: document.getElementById('wl-current-cm'),
  wlRate: document.getElementById('wl-rate'),
  wlTankHeight: document.getElementById('wl-tank-height'),
  wlFlow: document.getElementById('wl-flow'),
  wlFlowTrend: document.getElementById('wl-flow-trend'),
  wlValve: document.getElementById('wl-valve'),
  fTurbValue: document.getElementById('f-turb-value'),
  fTurbTrend: document.getElementById('f-turb-trend'),
  fTurbClarity: document.getElementById('f-turb-clarity'),
  fPhValue: document.getElementById('f-ph-value'),
  fPhTrend: document.getElementById('f-ph-trend'),
  fTdsValue: document.getElementById('f-tds-value'),
  fTdsTrend: document.getElementById('f-tds-trend'),
  fQualityCard: document.getElementById('f-quality-card'),
  fQualityPredicted: document.getElementById('f-quality-predicted'),
  fWlValue: document.getElementById('f-wl-value'),
  fWlTrend: document.getElementById('f-wl-trend'),
  tabButtons: document.querySelectorAll('.sidebar__nav-item[data-tab]'),
  views: document.querySelectorAll('.view'),
};

function init() {
  bindTabs();
  bindEvents();
  initCharts();
  renderAll();
  connectFirebase();
}

function bindTabs() {
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      elements.tabButtons.forEach((b) => b.classList.toggle('sidebar__nav-item--active', b === btn));
      elements.views.forEach((v) => v.classList.toggle('view--active', v.id === `view-${tab}`));
    });
  });
}

function bindEvents() {
  elements.pauseBtn?.addEventListener('click', () => {
    state.paused = !state.paused;
    elements.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  });
  elements.timeRange?.addEventListener('change', renderHistoryChart);
}

/* ── Firebase ── */

function connectFirebase() {
  if (typeof firebase === 'undefined' || !firebase.initializeApp) {
    setFirebaseStatus('Firebase SDK failed to load', 'error');
    return;
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
  } catch (e) {
    // Already initialized (e.g. hot reload) — safe to ignore.
  }
  const db = firebase.database();

  db.ref('.info/connected').on('value', (snap) => {
    state.connected = snap.val() === true;
    refreshFirebaseStatus();
  });

  const onError = (err) => {
    console.error('Firebase listen error', err);
    setFirebaseStatus(`Firebase error: ${err?.code || err?.message || 'unknown'}`, 'error');
  };

  db.ref(WATER_PATH).on(
    'value',
    (snap) => {
      const data = snap.val();
      if (!data) return;
      ingestWaterSample(data);
      state.devices.water.received = true;
      markUpdated();
    },
    onError
  );

  db.ref(QUALITY_PATH).on(
    'value',
    (snap) => {
      const data = snap.val();
      if (!data) return;
      ingestQualitySample(data);
      state.devices.quality.received = true;
      markUpdated();
    },
    onError
  );
}

function markUpdated() {
  state.lastUpdate = Date.now();
  refreshFirebaseStatus();
  renderAll();
}

function refreshFirebaseStatus() {
  if (!state.connected) {
    setFirebaseStatus('Disconnected — retrying…', 'error');
  } else if (!state.devices.water.received && !state.devices.quality.received) {
    setFirebaseStatus('Connected — waiting for data', 'ok');
  } else {
    setFirebaseStatus('Live from Firebase', 'ok');
  }

  if (elements.firebaseLastUpdate) {
    elements.firebaseLastUpdate.textContent = state.lastUpdate
      ? `Last update ${formatTime(state.lastUpdate)}`
      : 'Waiting for first reading';
  }
}

function setFirebaseStatus(text, tone = 'normal') {
  const el = elements.firebaseStatus;
  if (!el) return;
  el.textContent = text;
  el.classList.remove('topbar__status--ok', 'topbar__status--error');
  if (tone === 'ok') el.classList.add('topbar__status--ok');
  if (tone === 'error') el.classList.add('topbar__status--error');
}

/* ── Ingestion ── */

function pushSample(list, sample) {
  list.push(sample);
  if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
}

function ingestQualitySample(raw) {
  pushSample(state.devices.quality.history, {
    timestamp: Date.now(),
    turbidity: Number(raw.turbidity ?? 0),
    turbidityRaw: normalizeInt(raw.turbidityRaw ?? raw.turbidity_raw ?? raw.raw),
    clearRaw: normalizeInt(raw.clearRaw ?? raw.clear_raw),
    dirtyRaw: normalizeInt(raw.dirtyRaw ?? raw.dirty_raw),
    ph: Number(raw.ph ?? 7),
    tds: Number(raw.tds ?? 0),
    waterLevelCm: normalizeNumber(raw.waterLevelCm ?? raw.water_level_cm),
    efficiency: normalizeNumber(raw.efficiency),
    prediction: normalizeInt(raw.prediction),
  });
}

function ingestWaterSample(raw) {
  const tankH = normalizeNumber(raw.tankHeightCm ?? raw.tank_height_cm);
  const threshold = normalizeNumber(raw.zeroWaterThresholdCm ?? raw.zero_water_threshold_cm) ?? 0.5;
  let waterLevelCm = normalizeNumber(raw.waterLevelCm ?? raw.water_level_cm);
  let distanceCm = normalizeNumber(raw.distanceCm ?? raw.distance_cm ?? raw.ultrasonicCm ?? raw.ultrasonic_cm);
  if (distanceCm != null && distanceCm < 0) distanceCm = 0;

  let waterLevel = normalizeLevel(raw.waterLevel ?? raw.waterLevelNormalized);
  if (waterLevel == null && tankH != null && waterLevelCm != null) waterLevel = clamp01(waterLevelCm / tankH);
  if (waterLevel == null && tankH != null && distanceCm != null) waterLevel = clamp01((tankH - distanceCm) / tankH);
  if (waterLevel == null) waterLevel = 0;
  if (waterLevelCm == null && tankH != null) waterLevelCm = tankH * waterLevel;

  pushSample(state.devices.water.history, {
    timestamp: Date.now(),
    waterLevel,
    waterLevelCm,
    distanceCm,
    tankHeightCm: tankH,
    zeroWaterThresholdCm: threshold,
    waterFlowLmin: normalizeNumber(raw.waterFlowLmin ?? raw.water_flow_lmin),
    waterRateCmPerSec: normalizeNumber(raw.waterRateCmPerSec ?? raw.water_rate_cm_per_sec),
    predictionReady: normalizeBool(raw.predictionReady),
    predictedWaterLevel10s: normalizeNumber(raw.predictedWaterLevel10s ?? raw.predicted_water_level_10s),
    valveOpen: raw.valveOpen === undefined ? null : normalizeBool(raw.valveOpen),
  });
}

/* ── Rendering ── */

function renderAll() {
  renderQuality();
  renderWater();
  renderHistoryChart();
  renderGauge();
  renderRecent();
}

function renderQuality() {
  const s = state.devices.quality.history;
  if (!s.length) return;
  const latest = s[s.length - 1];

  elements.turbValue.textContent = `${latest.turbidity.toFixed(2)} NTU`;
  elements.phValue.textContent = latest.ph.toFixed(2);
  elements.tdsValue.textContent = `${latest.tds.toFixed(0)} mg/L`;

  applyTrend(elements.turbTrend, s, 'turbidity', ' NTU');
  applyTrend(elements.phTrend, s, 'ph', '');
  applyTrend(elements.tdsTrend, s, 'tds', ' mg/L');
  renderTurbidityClarity(latest);
  renderFilterPrediction(s);

  elements.fTurbValue.textContent = elements.turbValue.textContent;
  elements.fPhValue.textContent = elements.phValue.textContent;
  elements.fTdsValue.textContent = elements.tdsValue.textContent;
  elements.fTurbTrend.textContent = elements.turbTrend.textContent;
  elements.fTurbTrend.className = elements.turbTrend.className;
  elements.fPhTrend.textContent = elements.phTrend.textContent;
  elements.fPhTrend.className = elements.phTrend.className;
  elements.fTdsTrend.textContent = elements.tdsTrend.textContent;
  elements.fTdsTrend.className = elements.tdsTrend.className;
  elements.fTurbClarity.textContent = elements.turbClarity.textContent;
  elements.fTurbClarity.className = elements.turbClarity.className;

  if (typeof latest.waterLevelCm === 'number') {
    elements.fWlValue.textContent = `${latest.waterLevelCm.toFixed(2)} cm`;
    applyTrend(elements.fWlTrend, s, 'waterLevelCm', ' cm', 2);
  } else {
    elements.fWlValue.textContent = '-- cm';
    elements.fWlTrend.textContent = '--';
    elements.fWlTrend.classList.remove('card__trend--down');
  }
}

function renderWater() {
  const s = state.devices.water.history;
  if (!s.length) return;
  const latest = s[s.length - 1];
  const currentPercent = (latest.waterLevel * 100).toFixed(0);
  const currentCm = typeof latest.waterLevelCm === 'number' ? latest.waterLevelCm.toFixed(2) : '--';

  elements.wlGaugeValue.textContent = `${currentPercent} %`;
  elements.wlCurrent.textContent = `${currentPercent} % (${currentCm} cm)`;
  applyTrendPercent(elements.wlTrend, s, 'waterLevel');

  if (typeof latest.distanceCm === 'number') {
    elements.distCurrent.textContent = `${latest.distanceCm.toFixed(1)} cm`;
    applyTrend(elements.distTrend, s, 'distanceCm', ' cm', 1);
  }

  elements.wlTankHeight.textContent = typeof latest.tankHeightCm === 'number' ? latest.tankHeightCm.toFixed(1) : '--';
  elements.wlCurrentCm.textContent = typeof latest.waterLevelCm === 'number' ? latest.waterLevelCm.toFixed(2) : '--';
  elements.wlRate.textContent = typeof latest.waterRateCmPerSec === 'number' ? latest.waterRateCmPerSec.toFixed(4) : '--';

  if (elements.wlFlow) {
    elements.wlFlow.textContent =
      typeof latest.waterFlowLmin === 'number' ? `${latest.waterFlowLmin.toFixed(2)} L/min` : '-- L/min';
    applyTrend(elements.wlFlowTrend, s, 'waterFlowLmin', ' L/min', 2);
  }

  if (elements.wlValve) {
    if (latest.valveOpen === true) setPill(elements.wlValve, 'VALVE OPEN', 'dirty');
    else if (latest.valveOpen === false) setPill(elements.wlValve, 'VALVE CLOSED', 'clear');
    else setPill(elements.wlValve, '--', 'unknown');
  }

  if (latest.predictionReady && typeof latest.predictedWaterLevel10s === 'number') {
    elements.wlPredicted.textContent = `${latest.predictedWaterLevel10s.toFixed(2)} cm`;
    setPill(elements.wlPredictionState, 'Prediction ready', 'ready');
  } else {
    elements.wlPredicted.textContent = '-- cm';
    setPill(elements.wlPredictionState, 'Warming up (filling history)', 'unknown');
  }
}

function initCharts() {
  state.charts.history = new Chart(elements.historyCanvas.getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Turbidity (NTU)', data: [], borderColor: '#2563eb', tension: 0.35 }, { label: 'pH', data: [], borderColor: '#22c55e', tension: 0.35 }, { label: 'TDS (mg/L)', data: [], borderColor: '#a855f7', tension: 0.35, yAxisID: 'y2' }] },
    options: { maintainAspectRatio: false, scales: { y2: { position: 'right', grid: { drawOnChartArea: false } } } },
  });
  state.charts.waterLevel = new Chart(elements.waterLevelCanvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels: ['Empty', 'Water'], datasets: [{ data: [50, 50], backgroundColor: ['rgba(209,213,219,.9)', '#2563eb'], borderWidth: 0 }] },
    options: { cutout: '75%', rotation: -90, circumference: 180, plugins: { legend: { display: false }, tooltip: { enabled: false } } },
  });
}

function renderHistoryChart() {
  const c = state.charts.history;
  if (!c) return;
  const cutoff = Date.now() - Number(elements.timeRange.value || 300) * 1000;
  const s = state.devices.quality.history.filter((x) => x.timestamp >= cutoff);
  if (!s.length) return;
  c.data.labels = s.map((x) => formatTime(x.timestamp));
  c.data.datasets[0].data = s.map((x) => x.turbidity);
  c.data.datasets[1].data = s.map((x) => x.ph);
  c.data.datasets[2].data = s.map((x) => x.tds);
  c.update('none');
}

function renderGauge() {
  const c = state.charts.waterLevel;
  const s = state.devices.water.history;
  if (!c || !s.length) return;
  const pct = Math.max(0, Math.min(1, s[s.length - 1].waterLevel)) * 100;
  c.data.datasets[0].data = [100 - pct, pct];
  c.update('none');
}

function renderRecent() {
  const merged = [];
  state.devices.water.history.slice(-4).forEach((s) => merged.push({ type: 'Level', s }));
  state.devices.quality.history.slice(-4).forEach((s) => merged.push({ type: 'Quality', s }));
  merged.sort((a, b) => b.s.timestamp - a.s.timestamp);

  elements.recentList.innerHTML = '';
  merged.slice(0, 8).forEach((item) => {
    const li = document.createElement('li');
    li.className = 'reading-list__item';
    li.innerHTML = `
      <div class="reading-list__left">
        <span class="reading-list__values">${item.type === 'Level' ? `Level ${(item.s.waterLevel * 100).toFixed(0)}% • Distance ${typeof item.s.distanceCm === 'number' ? item.s.distanceCm.toFixed(1) : '--'} cm` : `${item.s.turbidity.toFixed(2)} NTU • pH ${item.s.ph.toFixed(2)} • ${item.s.tds.toFixed(0)} mg/L`}</span>
        <span class="reading-list__timestamp">${formatTime(item.s.timestamp)}</span>
      </div>
      <span class="reading-list__badge">${item.type}</span>
    `;
    elements.recentList.appendChild(li);
  });
}

function renderFilterPrediction(samples) {
  const latest = samples[samples.length - 1];
  if (
    !Number.isFinite(latest.tds) ||
    !Number.isFinite(latest.turbidity) ||
    !Number.isFinite(latest.ph) ||
    !Number.isFinite(latest.waterLevelCm)
  ) {
    elements.fQualityPredicted.textContent = '--';
    setPredictionTone(elements.fQualityPredicted, 'unknown');
    setPredictionCardTone(elements.fQualityCard, 'unknown');
    return;
  }

  const efficiency = Number.isFinite(latest.efficiency)
    ? latest.efficiency
    : predictFilterEfficiency(latest.tds, latest.turbidity, latest.ph, latest.waterLevelCm);
  const prediction = latest.prediction === 1 || latest.prediction === 0
    ? latest.prediction
    : predictFilterClassFromEfficiency(efficiency);

  const needsChange = prediction === 1;
  const actionText = needsChange ? 'CHANGE FILTER' : 'FILTER OKAY';
  const klass = needsChange ? 'dirty' : 'clear';

  elements.fQualityPredicted.textContent = actionText;
  setPredictionTone(elements.fQualityPredicted, klass);
  setPredictionCardTone(elements.fQualityCard, klass);
}

function renderTurbidityClarity(s) {
  if (typeof s.turbidityRaw === 'number' && typeof s.clearRaw === 'number' && typeof s.dirtyRaw === 'number' && s.clearRaw !== s.dirtyRaw) {
    const min = Math.min(s.clearRaw, s.dirtyRaw);
    const max = Math.max(s.clearRaw, s.dirtyRaw);
    const pos = (s.turbidityRaw - min) / (max - min);
    const clarity = Math.max(0, Math.min(1, s.clearRaw > s.dirtyRaw ? pos : 1 - pos));
    if (clarity >= 0.6) return setPill(elements.turbClarity, `CLEAR (${Math.round(clarity * 100)}%)`, 'clear');
    if (clarity <= 0.4) return setPill(elements.turbClarity, `DIRTY (${Math.round(clarity * 100)}%)`, 'dirty');
    return setPill(elements.turbClarity, `MIXED (${Math.round(clarity * 100)}%)`, 'unknown');
  }
  if (s.turbidity <= TURBIDITY_CLEAR_NTU_MAX) return setPill(elements.turbClarity, 'CLEAR', 'clear');
  if (s.turbidity >= TURBIDITY_DIRTY_NTU_MIN) return setPill(elements.turbClarity, 'DIRTY', 'dirty');
  setPill(elements.turbClarity, 'MIXED', 'unknown');
}

function setPill(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('status-pill--clear', 'status-pill--dirty', 'status-pill--unknown', 'status-pill--ready');
  if (kind === 'clear') el.classList.add('status-pill--clear');
  else if (kind === 'dirty') el.classList.add('status-pill--dirty');
  else if (kind === 'ready') el.classList.add('status-pill--ready');
  else el.classList.add('status-pill--unknown');
}

function setPredictionTone(el, kind) {
  el.classList.remove('card__value--clear', 'card__value--dirty', 'card__value--unknown');
  if (kind === 'clear') el.classList.add('card__value--clear');
  else if (kind === 'dirty') el.classList.add('card__value--dirty');
  else el.classList.add('card__value--unknown');
}

function setPredictionCardTone(el, kind) {
  if (!el) return;
  el.classList.remove('card--prediction-clear', 'card--prediction-dirty', 'card--prediction-unknown');
  if (kind === 'clear') el.classList.add('card--prediction-clear');
  else if (kind === 'dirty') el.classList.add('card--prediction-dirty');
  else el.classList.add('card--prediction-unknown');
}

function applyTrend(el, samples, key, unit, decimals = 2) {
  if (!el) return;
  const latest = samples[samples.length - 1]?.[key];
  const prev = samples[Math.max(0, samples.length - 6)]?.[key];
  if (typeof latest !== 'number' || typeof prev !== 'number') return (el.textContent = '--');
  const diff = latest - prev;
  el.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(decimals)}${unit}`;
  el.classList.toggle('card__trend--down', diff < 0);
}

function applyTrendPercent(el, samples, key) {
  if (!el) return;
  const latest = samples[samples.length - 1]?.[key];
  const prev = samples[Math.max(0, samples.length - 6)]?.[key];
  if (typeof latest !== 'number' || typeof prev !== 'number') return (el.textContent = '--');
  const diff = (latest - prev) * 100;
  el.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(0)} %`;
  el.classList.toggle('card__trend--down', diff < 0);
}

function normalizeInt(v) { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; }
function normalizeNumber(v) {
  if (v == null) return null;
  // Firmware sometimes sends the literal string "null" for absent numbers.
  if (typeof v === 'string' && v.trim().toLowerCase() === 'null') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normalizeBool(v) { if (v === true || v === 'true') return true; if (v === false || v === 'false') return false; return Boolean(v); }
function normalizeLevel(v) { if (v == null) return null; let n = Number(v); if (!Number.isFinite(n)) return null; if (n > 1) n /= 100; return clamp01(n); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

function predictFilterEfficiency(tds, turbidity, ph, waterLevelCm) {
  const inputs = [tds, turbidity, ph, waterLevelCm];
  let y = FILTER_EFFICIENCY_BIAS;
  for (let i = 0; i < 4; i++) {
    const scaled = (inputs[i] - FILTER_EFFICIENCY_MEANS[i]) / FILTER_EFFICIENCY_SCALES[i];
    y += FILTER_EFFICIENCY_WEIGHTS[i] * scaled;
  }
  return y;
}

function predictFilterClassFromEfficiency(efficiency) {
  const prob = 1 / (1 + Math.exp(-efficiency));
  return prob >= 0.5 ? 1 : 0;
}

document.addEventListener('DOMContentLoaded', init);
