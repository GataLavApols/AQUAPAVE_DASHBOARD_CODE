// Dual-ESP32 dashboard:
// - One board for Water Level Monitoring
// - One board for Water Quality Monitoring
// Keeps all three tabs: Overview, Water Level, Filter Quality.

const DEFAULT_WATER_BASE_URL = 'http://192.168.1.101';
const DEFAULT_QUALITY_BASE_URL = 'http://192.168.1.102';
const POLL_MS = 3000;
const MAX_POINTS = 200;

const TURBIDITY_CLEAR_NTU_MAX = 40;
const TURBIDITY_DIRTY_NTU_MIN = 120;

const state = {
  paused: false,
  devices: {
    water: { baseUrl: DEFAULT_WATER_BASE_URL, connected: false, history: [], pollTimer: null },
    quality: { baseUrl: DEFAULT_QUALITY_BASE_URL, connected: false, history: [], pollTimer: null },
  },
  charts: {
    history: null,
    waterLevel: null,
  },
};

const elements = {
  waterUrlInput: document.getElementById('esp32-water-url'),
  qualityUrlInput: document.getElementById('esp32-quality-url'),
  connectWaterBtn: document.getElementById('connect-water-btn'),
  connectQualityBtn: document.getElementById('connect-quality-btn'),
  waterStatus: document.getElementById('water-connection-status'),
  qualityStatus: document.getElementById('quality-connection-status'),
  pauseBtn: document.getElementById('pause-btn'),
  timeRange: document.getElementById('time-range'),
  historyCanvas: document.getElementById('history-chart'),
  waterLevelCanvas: document.getElementById('waterlevel-chart'),
  recentList: document.getElementById('recent-readings'),
  // Overview KPIs
  turbValue: document.getElementById('turb-value'),
  turbMin: document.getElementById('turb-min'),
  turbMax: document.getElementById('turb-max'),
  turbTrend: document.getElementById('turb-trend'),
  turbClarity: document.getElementById('turb-clarity'),
  phValue: document.getElementById('ph-value'),
  phMin: document.getElementById('ph-min'),
  phMax: document.getElementById('ph-max'),
  phTrend: document.getElementById('ph-trend'),
  tdsValue: document.getElementById('tds-value'),
  tdsMin: document.getElementById('tds-min'),
  tdsMax: document.getElementById('tds-max'),
  tdsTrend: document.getElementById('tds-trend'),
  // Overview water level gauge
  wlGaugeValue: document.getElementById('waterlevel-value'),
  wlGaugeMin: document.getElementById('waterlevel-min'),
  wlGaugeMax: document.getElementById('waterlevel-max'),
  // Water level tab
  wlCurrent: document.getElementById('wl-current'),
  wlMin: document.getElementById('wl-min'),
  wlMax: document.getElementById('wl-max'),
  wlTrend: document.getElementById('wl-trend'),
  distCurrent: document.getElementById('dist-current'),
  distMin: document.getElementById('dist-min'),
  distMax: document.getElementById('dist-max'),
  distTrend: document.getElementById('dist-trend'),
  wlPredicted: document.getElementById('wl-predicted'),
  wlPredictionState: document.getElementById('wl-prediction-state'),
  wlCurrentCm: document.getElementById('wl-current-cm'),
  wlRate: document.getElementById('wl-rate'),
  wlTankHeight: document.getElementById('wl-tank-height'),
  // Filter quality tab
  fTurbValue: document.getElementById('f-turb-value'),
  fTurbMin: document.getElementById('f-turb-min'),
  fTurbMax: document.getElementById('f-turb-max'),
  fTurbTrend: document.getElementById('f-turb-trend'),
  fTurbClarity: document.getElementById('f-turb-clarity'),
  fPhValue: document.getElementById('f-ph-value'),
  fPhMin: document.getElementById('f-ph-min'),
  fPhMax: document.getElementById('f-ph-max'),
  fPhTrend: document.getElementById('f-ph-trend'),
  fTdsValue: document.getElementById('f-tds-value'),
  fTdsMin: document.getElementById('f-tds-min'),
  fTdsMax: document.getElementById('f-tds-max'),
  fTdsTrend: document.getElementById('f-tds-trend'),
  fQualityPredicted: document.getElementById('f-quality-predicted'),
  fQualityState: document.getElementById('f-quality-state'),
  fQualityScore: document.getElementById('f-quality-score'),
  fQualityAction: document.getElementById('f-quality-action'),
  tabButtons: document.querySelectorAll('.sidebar__nav-item[data-tab]'),
  views: document.querySelectorAll('.view'),
};

function setStatus(kind, text, tone = 'normal') {
  const el = kind === 'water' ? elements.waterStatus : elements.qualityStatus;
  if (!el) return;
  el.textContent = text;
  el.classList.remove('topbar__status--ok', 'topbar__status--error');
  if (tone === 'ok') el.classList.add('topbar__status--ok');
  if (tone === 'error') el.classList.add('topbar__status--error');
}

function init() {
  elements.waterUrlInput.value = DEFAULT_WATER_BASE_URL;
  elements.qualityUrlInput.value = DEFAULT_QUALITY_BASE_URL;

  bindEvents();
  bindTabs();
  initCharts();
  seedFakeData();
  renderAll();
}

function bindEvents() {
  elements.connectWaterBtn.addEventListener('click', () => {
    state.devices.water.baseUrl = elements.waterUrlInput.value.trim() || DEFAULT_WATER_BASE_URL;
    startPolling('water');
  });

  elements.connectQualityBtn.addEventListener('click', () => {
    state.devices.quality.baseUrl = elements.qualityUrlInput.value.trim() || DEFAULT_QUALITY_BASE_URL;
    startPolling('quality');
  });

  elements.pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    elements.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  });

  elements.timeRange.addEventListener('change', () => {
    renderHistoryChart();
  });
}

function bindTabs() {
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      elements.tabButtons.forEach((b) =>
        b.classList.toggle('sidebar__nav-item--active', b === btn)
      );
      elements.views.forEach((view) =>
        view.classList.toggle('view--active', view.id === `view-${target}`)
      );
    });
  });
}

function initCharts() {
  state.charts.history = new Chart(elements.historyCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Turbidity (NTU)',
          data: [],
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.10)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'pH',
          data: [],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.10)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'TDS (mg/L)',
          data: [],
          borderColor: '#a855f7',
          backgroundColor: 'rgba(168, 85, 247, 0.08)',
          tension: 0.35,
          yAxisID: 'y2',
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { position: 'left', title: { display: true, text: 'Turbidity / pH' } },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'TDS (mg/L)' },
        },
      },
    },
  });

  state.charts.waterLevel = new Chart(elements.waterLevelCanvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Empty', 'Water'],
      datasets: [
        {
          data: [50, 50],
          backgroundColor: ['rgba(209, 213, 219, 0.9)', '#2563eb'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      cutout: '75%',
      rotation: -90,
      circumference: 180,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

function startPolling(kind) {
  const device = state.devices[kind];
  if (!device) return;

  if (device.pollTimer) clearInterval(device.pollTimer);
  setStatus(kind, 'Connecting...');
  device.connected = true;

  if (kind === 'water') elements.connectWaterBtn.disabled = true;
  if (kind === 'quality') elements.connectQualityBtn.disabled = true;

  const fetchAndUpdate = async () => {
    if (state.paused) return;
    try {
      const res = await fetch(`${device.baseUrl}/api/sensors/latest`, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      if (kind === 'water') ingestWaterSample(data);
      else ingestQualitySample(data);

      renderAll();
      setStatus(kind, `Connected to ${kind} ESP32`, 'ok');
      device.connected = true;
    } catch (err) {
      console.error(`${kind} fetch error`, err);
      device.connected = false;
      setStatus(kind, `Connection failed for ${kind} board`, 'error');
    } finally {
      if (kind === 'water') elements.connectWaterBtn.disabled = false;
      if (kind === 'quality') elements.connectQualityBtn.disabled = false;
    }
  };

  fetchAndUpdate();
  device.pollTimer = setInterval(fetchAndUpdate, POLL_MS);
}

function pushHistory(list, sample) {
  list.push(sample);
  if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
}

function ingestQualitySample(raw) {
  const sample = {
    timestamp: Date.now(),
    turbidity: Number(raw.turbidity ?? 0),
    turbidityRaw: normalizeInt(raw.turbidityRaw ?? raw.turbidity_raw ?? raw.raw),
    clearRaw: normalizeInt(raw.clearRaw ?? raw.clear_raw),
    dirtyRaw: normalizeInt(raw.dirtyRaw ?? raw.dirty_raw),
    ph: Number(raw.ph ?? 7),
    tds: Number(raw.tds ?? 0),
  };
  pushHistory(state.devices.quality.history, sample);
}

function ingestWaterSample(raw) {
  const tankHeightCm = normalizeNumber(raw.tankHeightCm ?? raw.tank_height_cm);
  const zeroWaterThresholdCm =
    normalizeNumber(raw.zeroWaterThresholdCm ?? raw.zero_water_threshold_cm) ?? 0.5;

  let waterLevelCm = normalizeNumber(raw.waterLevelCm ?? raw.water_level_cm);
  let distanceCm = normalizeDistanceCm(
    raw.distanceCm ?? raw.distance_cm ?? raw.ultrasonicCm ?? raw.ultrasonic_cm
  );

  const tankH = tankHeightCm != null && tankHeightCm > 0 ? tankHeightCm : null;
  if (waterLevelCm == null && tankH != null && distanceCm != null) {
    waterLevelCm = clampFloat(tankH - distanceCm, 0, tankH);
  }
  if (distanceCm == null && tankH != null && waterLevelCm != null) {
    distanceCm = clampFloat(tankH - waterLevelCm, 0, tankH);
  }

  let waterLevel = normalizeLevelOrNull(raw.waterLevel ?? raw.waterLevelNormalized);
  if (waterLevel == null && waterLevelCm != null && tankH != null) {
    waterLevel = clamp01(waterLevelCm / tankH);
  } else if (waterLevel == null && distanceCm != null && tankH != null) {
    waterLevel = clamp01((tankH - distanceCm) / tankH);
  } else if (waterLevel == null) {
    waterLevel = 0;
  } else {
    waterLevel = clamp01(waterLevel);
  }

  const sample = {
    timestamp: Date.now(),
    waterLevel,
    waterLevelCm: waterLevelCm != null ? waterLevelCm : tankH != null ? waterLevel * tankH : null,
    tankHeightCm: tankH,
    zeroWaterThresholdCm,
    waterRateCmPerSec: normalizeNumber(raw.waterRateCmPerSec ?? raw.water_rate_cm_per_sec),
    predictionReady: normalizeBool(raw.predictionReady),
    predictedWaterLevel10s: normalizeNumber(raw.predictedWaterLevel10s ?? raw.predicted_water_level_10s),
    distanceCm,
  };

  pushHistory(state.devices.water.history, sample);
}

function seedFakeData() {
  const now = Date.now();
  const tankHeightCm = 30;

  for (let i = 60; i >= 0; i--) {
    const t = now - i * 5000;
    const level = Math.max(0, 0.75 - i * 0.002);
    const dist = (1 - level) * tankHeightCm;

    pushHistory(state.devices.water.history, {
      timestamp: t,
      waterLevel: level,
      waterLevelCm: level * tankHeightCm,
      tankHeightCm,
      zeroWaterThresholdCm: 0.5,
      waterRateCmPerSec: 0.01 * Math.sin(i / 5),
      predictionReady: i > 15,
      predictedWaterLevel10s: i > 15 ? level * tankHeightCm + 0.4 : null,
      distanceCm: dist,
    });

    pushHistory(state.devices.quality.history, {
      timestamp: t,
      turbidity: Math.max(0.5, 15 + Math.sin(i / 6) * 12),
      turbidityRaw: 1200 + Math.round(Math.sin(i / 6) * 120),
      clearRaw: 1400,
      dirtyRaw: 900,
      ph: 7 + Math.cos(i / 10) * 0.2,
      tds: 200 + Math.sin(i / 8) * 40,
    });
  }
}

function renderAll() {
  if (!state.devices.water.history.length && !state.devices.quality.history.length) return;
  renderKpis();
  renderHistoryChart();
  renderWaterLevelGauge();
  renderRecentList();
}

function renderKpis() {
  renderQualityKpis();
  renderWaterKpis();
}

function renderQualityKpis() {
  const samples = state.devices.quality.history;
  if (!samples.length) return;
  const latest = samples[samples.length - 1];

  const turbVals = samples.map((s) => s.turbidity);
  const phVals = samples.map((s) => s.ph);
  const tdsVals = samples.map((s) => s.tds);

  elements.turbValue.textContent = `${latest.turbidity.toFixed(2)} NTU`;
  elements.turbMin.textContent = Math.min(...turbVals).toFixed(2);
  elements.turbMax.textContent = Math.max(...turbVals).toFixed(2);
  renderTurbidityClarity(latest);

  elements.phValue.textContent = latest.ph.toFixed(2);
  elements.phMin.textContent = Math.min(...phVals).toFixed(2);
  elements.phMax.textContent = Math.max(...phVals).toFixed(2);

  elements.tdsValue.textContent = `${latest.tds.toFixed(0)} mg/L`;
  elements.tdsMin.textContent = Math.min(...tdsVals).toFixed(0);
  elements.tdsMax.textContent = Math.max(...tdsVals).toFixed(0);

  applyTrend(elements.turbTrend, samples, 'turbidity', ' NTU');
  applyTrend(elements.phTrend, samples, 'ph', '');
  applyTrend(elements.tdsTrend, samples, 'tds', ' mg/L');

  elements.fTurbValue.textContent = elements.turbValue.textContent;
  elements.fTurbMin.textContent = elements.turbMin.textContent;
  elements.fTurbMax.textContent = elements.turbMax.textContent;
  elements.fPhValue.textContent = elements.phValue.textContent;
  elements.fPhMin.textContent = elements.phMin.textContent;
  elements.fPhMax.textContent = elements.phMax.textContent;
  elements.fTdsValue.textContent = elements.tdsValue.textContent;
  elements.fTdsMin.textContent = elements.tdsMin.textContent;
  elements.fTdsMax.textContent = elements.tdsMax.textContent;

  elements.fTurbTrend.textContent = elements.turbTrend.textContent;
  elements.fTurbTrend.className = elements.turbTrend.className;
  elements.fTurbClarity.textContent = elements.turbClarity.textContent;
  elements.fTurbClarity.className = elements.turbClarity.className;
  elements.fPhTrend.textContent = elements.phTrend.textContent;
  elements.fPhTrend.className = elements.phTrend.className;
  elements.fTdsTrend.textContent = elements.tdsTrend.textContent;
  elements.fTdsTrend.className = elements.tdsTrend.className;

  renderFilterPrediction(samples);
}

function renderWaterKpis() {
  const samples = state.devices.water.history;
  if (!samples.length) return;
  const latest = samples[samples.length - 1];

  const levelVals = samples.map((s) => s.waterLevel * 100);
  const distVals = samples.map((s) => s.distanceCm).filter((v) => typeof v === 'number');

  elements.wlGaugeValue.textContent = `${(latest.waterLevel * 100).toFixed(0)} %`;
  elements.wlGaugeMin.textContent = Math.min(...levelVals).toFixed(0);
  elements.wlGaugeMax.textContent = Math.max(...levelVals).toFixed(0);

  elements.wlCurrent.textContent = `${(latest.waterLevel * 100).toFixed(0)} %`;
  elements.wlMin.textContent = elements.wlGaugeMin.textContent;
  elements.wlMax.textContent = elements.wlGaugeMax.textContent;
  applyTrendPercent(elements.wlTrend, samples, 'waterLevel');
  renderWaterPrediction(latest);

  if (typeof latest.distanceCm === 'number') {
    elements.distCurrent.textContent = `${latest.distanceCm.toFixed(1)} cm`;
    elements.distMin.textContent = distVals.length ? Math.min(...distVals).toFixed(1) : '--';
    elements.distMax.textContent = distVals.length ? Math.max(...distVals).toFixed(1) : '--';
    applyTrend(elements.distTrend, samples, 'distanceCm', ' cm', 1);
  } else {
    elements.distCurrent.textContent = '-- cm';
    elements.distMin.textContent = '--';
    elements.distMax.textContent = '--';
    elements.distTrend.textContent = '--';
    elements.distTrend.classList.remove('card__trend--down');
  }
}

function renderWaterPrediction(latest) {
  if (elements.wlTankHeight) {
    elements.wlTankHeight.textContent =
      typeof latest.tankHeightCm === 'number' ? latest.tankHeightCm.toFixed(1) : '--';
  }
  elements.wlCurrentCm.textContent =
    typeof latest.waterLevelCm === 'number' ? latest.waterLevelCm.toFixed(2) : '--';
  elements.wlRate.textContent =
    typeof latest.waterRateCmPerSec === 'number' ? latest.waterRateCmPerSec.toFixed(4) : '--';

  const threshold = typeof latest.zeroWaterThresholdCm === 'number' ? latest.zeroWaterThresholdCm : 0.5;
  const noWater = typeof latest.waterLevelCm === 'number' && latest.waterLevelCm < threshold;

  const setPredictionPill = (text, variant) => {
    elements.wlPredictionState.textContent = text;
    elements.wlPredictionState.classList.remove(
      'status-pill--ready',
      'status-pill--dirty',
      'status-pill--clear',
      'status-pill--unknown'
    );
    if (variant === 'ready') elements.wlPredictionState.classList.add('status-pill--ready');
    else if (variant === 'nowater') elements.wlPredictionState.classList.add('status-pill--dirty');
    else elements.wlPredictionState.classList.add('status-pill--unknown');
  };

  if (noWater) {
    elements.wlPredicted.textContent = '-- cm';
    setPredictionPill('No water (prediction off)', 'nowater');
    return;
  }

  const canShow = latest.predictionReady && typeof latest.predictedWaterLevel10s === 'number';
  if (canShow) {
    elements.wlPredicted.textContent = `${latest.predictedWaterLevel10s.toFixed(2)} cm`;
    setPredictionPill('Prediction ready', 'ready');
  } else {
    elements.wlPredicted.textContent = '-- cm';
    setPredictionPill('Warming up (filling history)', 'unknown');
  }
}

function renderFilterPrediction(samples) {
  if (!elements.fQualityPredicted || !elements.fQualityState) return;
  const latest = samples[samples.length - 1];
  const previous = samples[Math.max(0, samples.length - 6)] ?? latest;

  const turbidityRisk = Math.min(1, Math.max(0, latest.turbidity / 180));
  const tdsRisk = Math.min(1, Math.max(0, latest.tds / 600));
  const phRisk = Math.min(1, Math.abs(latest.ph - 7) / 1.5);
  const turbidityTrendRisk = Math.min(1, Math.max(0, (latest.turbidity - previous.turbidity) / 40));
  const tdsTrendRisk = Math.min(1, Math.max(0, (latest.tds - previous.tds) / 100));
  const weightedRisk =
    turbidityRisk * 0.35 +
    tdsRisk * 0.25 +
    phRisk * 0.2 +
    turbidityTrendRisk * 0.1 +
    tdsTrendRisk * 0.1;
  const qualityScore = Math.max(0, Math.min(100, Math.round((1 - weightedRisk) * 100)));

  let qualityLabel = 'Good';
  let stateText = 'Filter healthy';
  let stateClass = 'status-pill--clear';
  let actionText = 'Monitor';

  if (qualityScore <= 40) {
    qualityLabel = 'Poor';
    stateText = 'Maintenance needed';
    stateClass = 'status-pill--dirty';
    actionText = 'Replace soon';
  } else if (qualityScore <= 70) {
    qualityLabel = 'Fair';
    stateText = 'Degrading';
    stateClass = 'status-pill--unknown';
    actionText = 'Check filter';
  }

  elements.fQualityPredicted.textContent = qualityLabel;
  elements.fQualityScore.textContent = qualityScore.toFixed(0);
  elements.fQualityAction.textContent = actionText;
  elements.fQualityState.textContent = stateText;
  elements.fQualityState.classList.remove('status-pill--clear', 'status-pill--dirty', 'status-pill--unknown', 'status-pill--ready');
  elements.fQualityState.classList.add(stateClass);
}

function renderHistoryChart() {
  const chart = state.charts.history;
  if (!chart) return;
  const windowSeconds = Number(elements.timeRange.value || 300);
  const cutoff = Date.now() - windowSeconds * 1000;
  const samples = state.devices.quality.history.filter((s) => s.timestamp >= cutoff);
  if (!samples.length) return;

  chart.data.labels = samples.map((s) => formatTime(s.timestamp));
  chart.data.datasets[0].data = samples.map((s) => s.turbidity);
  chart.data.datasets[1].data = samples.map((s) => s.ph);
  chart.data.datasets[2].data = samples.map((s) => s.tds);
  chart.update('none');
}

function renderWaterLevelGauge() {
  const chart = state.charts.waterLevel;
  const samples = state.devices.water.history;
  if (!chart || !samples.length) return;
  const latest = samples[samples.length - 1];
  const filled = Math.max(0, Math.min(1, latest.waterLevel)) * 100;
  chart.data.datasets[0].data = [100 - filled, filled];
  chart.update('none');
}

function renderRecentList() {
  const container = elements.recentList;
  container.innerHTML = '';

  const merged = [];
  state.devices.water.history.slice(-4).forEach((s) => merged.push({ type: 'Water', s }));
  state.devices.quality.history.slice(-4).forEach((s) => merged.push({ type: 'Quality', s }));
  merged.sort((a, b) => b.s.timestamp - a.s.timestamp);

  merged.slice(0, 8).forEach((item) => {
    const li = document.createElement('li');
    li.className = 'reading-list__item';

    const values =
      item.type === 'Water'
        ? `Level ${(item.s.waterLevel * 100).toFixed(0)}% • Distance ${typeof item.s.distanceCm === 'number' ? item.s.distanceCm.toFixed(1) : '--'} cm`
        : `${item.s.turbidity.toFixed(2)} NTU • pH ${item.s.ph.toFixed(2)} • ${item.s.tds.toFixed(0)} mg/L`;

    li.innerHTML = `
      <div class="reading-list__left">
        <span class="reading-list__values">${values}</span>
        <span class="reading-list__timestamp">${formatTime(item.s.timestamp)}</span>
      </div>
      <span class="reading-list__badge">${item.type}</span>
    `;
    container.appendChild(li);
  });
}

function renderTurbidityClarity(sample) {
  const { turbidity, turbidityRaw, clearRaw, dirtyRaw } = sample;
  if (
    typeof turbidityRaw === 'number' &&
    typeof clearRaw === 'number' &&
    typeof dirtyRaw === 'number' &&
    clearRaw !== dirtyRaw
  ) {
    const min = Math.min(clearRaw, dirtyRaw);
    const max = Math.max(clearRaw, dirtyRaw);
    const pos = (turbidityRaw - min) / (max - min);
    const clarity = Math.max(0, Math.min(1, clearRaw > dirtyRaw ? pos : 1 - pos));
    if (clarity >= 0.6) return setPill(elements.turbClarity, `CLEAR (${Math.round(clarity * 100)}%)`, 'clear');
    if (clarity <= 0.4) return setPill(elements.turbClarity, `DIRTY (${Math.round(clarity * 100)}%)`, 'dirty');
    return setPill(elements.turbClarity, `MIXED (${Math.round(clarity * 100)}%)`, 'unknown');
  }
  if (!Number.isFinite(turbidity)) return setPill(elements.turbClarity, '--', 'unknown');
  if (turbidity <= TURBIDITY_CLEAR_NTU_MAX) return setPill(elements.turbClarity, 'CLEAR', 'clear');
  if (turbidity >= TURBIDITY_DIRTY_NTU_MIN) return setPill(elements.turbClarity, 'DIRTY', 'dirty');
  setPill(elements.turbClarity, 'MIXED', 'unknown');
}

function setPill(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('status-pill--clear', 'status-pill--dirty', 'status-pill--unknown');
  if (kind === 'clear') el.classList.add('status-pill--clear');
  else if (kind === 'dirty') el.classList.add('status-pill--dirty');
  else el.classList.add('status-pill--unknown');
}

function applyTrend(el, samples, key, unit, decimals = 2) {
  const latest = samples[samples.length - 1]?.[key];
  const prev = samples[Math.max(0, samples.length - 6)]?.[key];
  if (typeof latest !== 'number' || typeof prev !== 'number') {
    el.textContent = '--';
    el.classList.remove('card__trend--down');
    return;
  }
  const diff = latest - prev;
  const sign = diff >= 0 ? '+' : '';
  el.textContent = `${sign}${diff.toFixed(decimals)}${unit}`;
  el.classList.remove('card__trend--down');
  if (diff < 0) el.classList.add('card__trend--down');
}

function applyTrendPercent(el, samples, key) {
  const latest = samples[samples.length - 1]?.[key];
  const prev = samples[Math.max(0, samples.length - 6)]?.[key];
  if (typeof latest !== 'number' || typeof prev !== 'number') {
    el.textContent = '--';
    el.classList.remove('card__trend--down');
    return;
  }
  const diff = (latest - prev) * 100;
  const sign = diff >= 0 ? '+' : '';
  el.textContent = `${sign}${diff.toFixed(0)} %`;
  el.classList.remove('card__trend--down');
  if (diff < 0) el.classList.add('card__trend--down');
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clampFloat(x, lo, hi) {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function normalizeLevelOrNull(rawLevel) {
  if (rawLevel == null) return null;
  let v = Number(rawLevel);
  if (Number.isNaN(v)) return null;
  if (v > 1) v = v / 100;
  return v;
}

function normalizeBool(v) {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return Boolean(v);
}

function normalizeDistanceCm(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n < 0 ? 0 : n;
}

function normalizeInt(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

document.addEventListener('DOMContentLoaded', init);
// ESP32 dashboard with dual-board support:
// - Water-level ESP32 feeds water metrics
// - Water-quality ESP32 feeds turbidity/pH/TDS metrics

const DEFAULT_WATER_BASE_URL = 'http://192.168.1.101';
const DEFAULT_QUALITY_BASE_URL = 'http://192.168.1.102';
const POLL_MS = 3000;
const MAX_POINTS = 200;

const TURBIDITY_CLEAR_NTU_MAX = 40;
const TURBIDITY_DIRTY_NTU_MIN = 120;

const state = {
  paused: false,
  devices: {
    water: {
      baseUrl: DEFAULT_WATER_BASE_URL,
      connected: false,
      history: [],
      pollTimer: null,
    },
    quality: {
      baseUrl: DEFAULT_QUALITY_BASE_URL,
      connected: false,
      history: [],
      pollTimer: null,
    },
  },
  charts: {
    history: null,
    waterLevel: null,
  },
};

const elements = {
  waterUrlInput: document.getElementById('esp32-water-url'),
  qualityUrlInput: document.getElementById('esp32-quality-url'),
  connectWaterBtn: document.getElementById('connect-water-btn'),
  connectQualityBtn: document.getElementById('connect-quality-btn'),
  waterStatus: document.getElementById('water-connection-status'),
  qualityStatus: document.getElementById('quality-connection-status'),
  pauseBtn: document.getElementById('pause-btn'),
  timeRange: document.getElementById('time-range'),
  historyCanvas: document.getElementById('history-chart'),
  waterLevelCanvas: document.getElementById('waterlevel-chart'),
  recentList: document.getElementById('recent-readings'),
  // Overview KPIs
  turbValue: document.getElementById('turb-value'),
  turbMin: document.getElementById('turb-min'),
  turbMax: document.getElementById('turb-max'),
  turbTrend: document.getElementById('turb-trend'),
  turbClarity: document.getElementById('turb-clarity'),
  phValue: document.getElementById('ph-value'),
  phMin: document.getElementById('ph-min'),
  phMax: document.getElementById('ph-max'),
  phTrend: document.getElementById('ph-trend'),
  tdsValue: document.getElementById('tds-value'),
  tdsMin: document.getElementById('tds-min'),
  tdsMax: document.getElementById('tds-max'),
  tdsTrend: document.getElementById('tds-trend'),
  // Overview water level gauge
  wlGaugeValue: document.getElementById('waterlevel-value'),
  wlGaugeMin: document.getElementById('waterlevel-min'),
  wlGaugeMax: document.getElementById('waterlevel-max'),
  // Water level tab
  wlCurrent: document.getElementById('wl-current'),
  wlMin: document.getElementById('wl-min'),
  wlMax: document.getElementById('wl-max'),
  wlTrend: document.getElementById('wl-trend'),
  distCurrent: document.getElementById('dist-current'),
  distMin: document.getElementById('dist-min'),
  distMax: document.getElementById('dist-max'),
  distTrend: document.getElementById('dist-trend'),
  wlPredicted: document.getElementById('wl-predicted'),
  wlPredictionState: document.getElementById('wl-prediction-state'),
  wlCurrentCm: document.getElementById('wl-current-cm'),
  wlRate: document.getElementById('wl-rate'),
  wlTankHeight: document.getElementById('wl-tank-height'),
  // Filter quality tab
  fTurbValue: document.getElementById('f-turb-value'),
  fTurbMin: document.getElementById('f-turb-min'),
  fTurbMax: document.getElementById('f-turb-max'),
  fTurbTrend: document.getElementById('f-turb-trend'),
  fTurbClarity: document.getElementById('f-turb-clarity'),
  fPhValue: document.getElementById('f-ph-value'),
  fPhMin: document.getElementById('f-ph-min'),
  fPhMax: document.getElementById('f-ph-max'),
  fPhTrend: document.getElementById('f-ph-trend'),
  fTdsValue: document.getElementById('f-tds-value'),
  fTdsMin: document.getElementById('f-tds-min'),
  fTdsMax: document.getElementById('f-tds-max'),
  fTdsTrend: document.getElementById('f-tds-trend'),
  fQualityPredicted: document.getElementById('f-quality-predicted'),
  fQualityState: document.getElementById('f-quality-state'),
  fQualityScore: document.getElementById('f-quality-score'),
  fQualityAction: document.getElementById('f-quality-action'),
  // Tabs/views
  tabButtons: document.querySelectorAll('.sidebar__nav-item[data-tab]'),
  views: document.querySelectorAll('.view'),
};

function setStatus(kind, text, tone = 'normal') {
  const el = kind === 'water' ? elements.waterStatus : elements.qualityStatus;
  if (!el) return;
  el.textContent = text;
  el.classList.remove('topbar__status--ok', 'topbar__status--error');
  if (tone === 'ok') el.classList.add('topbar__status--ok');
  if (tone === 'error') el.classList.add('topbar__status--error');
}

function init() {
  elements.waterUrlInput.value = DEFAULT_WATER_BASE_URL;
  elements.qualityUrlInput.value = DEFAULT_QUALITY_BASE_URL;
  bindEvents();
  bindTabs();
  initCharts();
  seedFakeData();
  renderAll();
}

function bindEvents() {
  elements.connectWaterBtn.addEventListener('click', () => {
    state.devices.water.baseUrl =
      elements.waterUrlInput.value.trim() || DEFAULT_WATER_BASE_URL;
    startPolling('water');
  });

  elements.connectQualityBtn.addEventListener('click', () => {
    state.devices.quality.baseUrl =
      elements.qualityUrlInput.value.trim() || DEFAULT_QUALITY_BASE_URL;
    startPolling('quality');
  });

  elements.pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    elements.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  });

  elements.timeRange.addEventListener('change', () => {
    renderHistoryChart();
  });
}

function bindTabs() {
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      elements.tabButtons.forEach((b) =>
        b.classList.toggle('sidebar__nav-item--active', b === btn)
      );
      elements.views.forEach((view) =>
        view.classList.toggle('view--active', view.id === `view-${target}`)
      );
    });
  });
}

function initCharts() {
  state.charts.history = new Chart(elements.historyCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Turbidity (NTU)',
          data: [],
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.10)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'pH',
          data: [],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.10)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'TDS (mg/L)',
          data: [],
          borderColor: '#a855f7',
          backgroundColor: 'rgba(168, 85, 247, 0.08)',
          tension: 0.35,
          yAxisID: 'y2',
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { boxWidth: 10, usePointStyle: true },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { position: 'left', title: { display: true, text: 'Turbidity / pH' } },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'TDS (mg/L)' },
        },
      },
    },
  });

  state.charts.waterLevel = new Chart(elements.waterLevelCanvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Empty', 'Water'],
      datasets: [
        {
          data: [50, 50],
          backgroundColor: ['rgba(209, 213, 219, 0.9)', '#2563eb'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      cutout: '75%',
      rotation: -90,
      circumference: 180,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

function getDevice(kind) {
  return state.devices[kind];
}

function startPolling(kind) {
  const device = getDevice(kind);
  if (!device) return;

  if (device.pollTimer) clearInterval(device.pollTimer);
  device.connected = true;

  if (kind === 'water') elements.connectWaterBtn.disabled = true;
  if (kind === 'quality') elements.connectQualityBtn.disabled = true;
  setStatus(kind, 'Connecting...');

  const fetchAndUpdate = async () => {
    if (state.paused) return;
    try {
      const res = await fetch(`${device.baseUrl}/api/sensors/latest`, {
        cache: 'no-cache',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      if (kind === 'water') ingestWaterSample(data);
      else ingestQualitySample(data);

      renderAll();
      setStatus(kind, `Connected to ${kind} ESP32`, 'ok');
      device.connected = true;
    } catch (err) {
      console.error(`${kind} fetch error`, err);
      device.connected = false;
      setStatus(kind, `Connection failed for ${kind} board`, 'error');
    } finally {
      if (kind === 'water') elements.connectWaterBtn.disabled = false;
      if (kind === 'quality') elements.connectQualityBtn.disabled = false;
    }
  };

  fetchAndUpdate();
  device.pollTimer = setInterval(fetchAndUpdate, POLL_MS);
}

function pushHistory(list, sample) {
  list.push(sample);
  if (list.length > MAX_POINTS) {
    list.splice(0, list.length - MAX_POINTS);
  }
}

function ingestQualitySample(raw) {
  const sample = {
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    turbidity: Number(raw.turbidity ?? 0),
    turbidityRaw: normalizeInt(raw.turbidityRaw ?? raw.turbidity_raw ?? raw.raw),
    clearRaw: normalizeInt(raw.clearRaw ?? raw.clear_raw),
    dirtyRaw: normalizeInt(raw.dirtyRaw ?? raw.dirty_raw),
    ph: Number(raw.ph ?? 7),
    tds: Number(raw.tds ?? 0),
  };
  pushHistory(state.devices.quality.history, sample);
}

function ingestWaterSample(raw) {
  const ts = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
  const tankHeightCm = normalizeNumber(raw.tankHeightCm ?? raw.tank_height_cm);
  const zeroWaterThresholdCm =
    normalizeNumber(raw.zeroWaterThresholdCm ?? raw.zero_water_threshold_cm) ?? 0.5;

  let waterLevelCm = normalizeNumber(raw.waterLevelCm ?? raw.water_level_cm);
  let distanceCm = normalizeDistanceCm(
    raw.distanceCm ?? raw.distance_cm ?? raw.ultrasonicCm ?? raw.ultrasonic_cm
  );

  const tankH = tankHeightCm != null && tankHeightCm > 0 ? tankHeightCm : null;

  if (waterLevelCm == null && tankH != null && distanceCm != null) {
    waterLevelCm = clampFloat(tankH - distanceCm, 0, tankH);
  }
  if (distanceCm == null && tankH != null && waterLevelCm != null) {
    distanceCm = clampFloat(tankH - waterLevelCm, 0, tankH);
  }

  let waterLevel = normalizeLevelOrNull(raw.waterLevel ?? raw.waterLevelNormalized);
  if (waterLevel == null && waterLevelCm != null && tankH != null) {
    waterLevel = clamp01(waterLevelCm / tankH);
  } else if (waterLevel == null && distanceCm != null && tankH != null) {
    waterLevel = clamp01((tankH - distanceCm) / tankH);
  } else if (waterLevel != null) {
    waterLevel = clamp01(waterLevel);
  }

  const sample = {
    timestamp: ts,
    waterLevel: waterLevel ?? 0,
    waterLevelCm:
      waterLevelCm != null ? waterLevelCm : tankH != null && waterLevel != null ? waterLevel * tankH : null,
    tankHeightCm: tankH,
    zeroWaterThresholdCm,
    waterRateCmPerSec: normalizeNumber(
      raw.waterRateCmPerSec ?? raw.water_rate_cm_per_sec
    ),
    predictionReady: normalizeBool(raw.predictionReady),
    predictedWaterLevel10s: normalizeNumber(
      raw.predictedWaterLevel10s ?? raw.predicted_water_level_10s
    ),
    distanceCm,
  };
  pushHistory(state.devices.water.history, sample);
}

function seedFakeData() {
  const now = Date.now();
  const tankHeightCm = 30;

  for (let i = 60; i >= 0; i--) {
    const t = now - i * 5000;
    const level = 0.75 - i * 0.002;
    const dist = (1 - Math.max(0, Math.min(1, level))) * tankHeightCm;

    ingestWaterSample({
      timestamp: t,
      tankHeightCm,
      zeroWaterThresholdCm: 0.5,
      waterLevel: level,
      distanceCm: dist,
      waterLevelCm: level * tankHeightCm,
      waterRateCmPerSec: 0.01 * Math.sin(i / 5),
      predictionReady: i > 15,
      predictedWaterLevel10s: i > 15 ? level * tankHeightCm + 0.4 : null,
    });

    ingestQualitySample({
      timestamp: t,
      turbidity: Math.max(0.5, 15 + Math.sin(i / 6) * 12),
      ph: 7 + Math.cos(i / 10) * 0.2,
      tds: 200 + Math.sin(i / 8) * 40,
      turbidityRaw: 1200 + Math.round(Math.sin(i / 6) * 120),
      clearRaw: 1400,
      dirtyRaw: 900,
    });
  }
}

function clamp01(x) {
  if (Number.isNaN(x) || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clampFloat(x, lo, hi) {
  if (Number.isNaN(x) || !Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function normalizeLevelOrNull(rawLevel) {
  if (rawLevel == null) return null;
  let v = Number(rawLevel);
  if (Number.isNaN(v)) return null;
  if (v > 1) v = v / 100;
  return v;
}

function normalizeBool(v) {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return Boolean(v);
}

function normalizeDistanceCm(rawDistance) {
  if (rawDistance == null) return null;
  const v = Number(rawDistance);
  if (Number.isNaN(v)) return null;
  if (v < 0) return 0;
  return v;
}

function normalizeInt(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function renderAll() {
  const hasWater = state.devices.water.history.length > 0;
  const hasQuality = state.devices.quality.history.length > 0;
  if (!hasWater && !hasQuality) return;

  renderKpis();
  renderHistoryChart();
  renderWaterLevelGauge();
  renderRecentList();
}

function setText(el, text) {
  if (el) el.textContent = text;
}

function renderKpis() {
  const waterSamples = state.devices.water.history;
  const qualitySamples = state.devices.quality.history;
  const latestWater = waterSamples[waterSamples.length - 1];
  const latestQuality = qualitySamples[qualitySamples.length - 1];

  if (latestQuality) {
    const turbVals = qualitySamples.map((s) => s.turbidity);
    const phVals = qualitySamples.map((s) => s.ph);
    const tdsVals = qualitySamples.map((s) => s.tds);

    setText(elements.turbValue, `${latestQuality.turbidity.toFixed(2)} NTU`);
    setText(elements.turbMin, Math.min(...turbVals).toFixed(2));
    setText(elements.turbMax, Math.max(...turbVals).toFixed(2));
    renderTurbidityClarity(latestQuality);

    setText(elements.phValue, latestQuality.ph.toFixed(2));
    setText(elements.phMin, Math.min(...phVals).toFixed(2));
    setText(elements.phMax, Math.max(...phVals).toFixed(2));

    setText(elements.tdsValue, `${latestQuality.tds.toFixed(0)} mg/L`);
    setText(elements.tdsMin, Math.min(...tdsVals).toFixed(0));
    setText(elements.tdsMax, Math.max(...tdsVals).toFixed(0));

    applyTrend(elements.turbTrend, qualitySamples, 'turbidity', ' NTU');
    applyTrend(elements.phTrend, qualitySamples, 'ph', '');
    applyTrend(elements.tdsTrend, qualitySamples, 'tds', ' mg/L');

    setText(elements.fTurbValue, elements.turbValue.textContent);
    setText(elements.fTurbMin, elements.turbMin.textContent);
    setText(elements.fTurbMax, elements.turbMax.textContent);
    setText(elements.fPhValue, elements.phValue.textContent);
    setText(elements.fPhMin, elements.phMin.textContent);
    setText(elements.fPhMax, elements.phMax.textContent);
    setText(elements.fTdsValue, elements.tdsValue.textContent);
    setText(elements.fTdsMin, elements.tdsMin.textContent);
    setText(elements.fTdsMax, elements.tdsMax.textContent);

    elements.fTurbTrend.textContent = elements.turbTrend.textContent;
    elements.fTurbTrend.className = elements.turbTrend.className;
    elements.fTurbClarity.textContent = elements.turbClarity.textContent;
    elements.fTurbClarity.className = elements.turbClarity.className;
    elements.fPhTrend.textContent = elements.phTrend.textContent;
    elements.fPhTrend.className = elements.phTrend.className;
    elements.fTdsTrend.textContent = elements.tdsTrend.textContent;
    elements.fTdsTrend.className = elements.tdsTrend.className;
    renderFilterPrediction(qualitySamples);
  }

  if (latestWater) {
    const levelVals = waterSamples.map((s) => s.waterLevel * 100);
    const distVals = waterSamples
      .map((s) => s.distanceCm)
      .filter((v) => typeof v === 'number');

    setText(elements.wlGaugeValue, `${(latestWater.waterLevel * 100).toFixed(0)} %`);
    setText(elements.wlGaugeMin, Math.min(...levelVals).toFixed(0));
    setText(elements.wlGaugeMax, Math.max(...levelVals).toFixed(0));

    setText(elements.wlCurrent, `${(latestWater.waterLevel * 100).toFixed(0)} %`);
    setText(elements.wlMin, elements.wlGaugeMin.textContent);
    setText(elements.wlMax, elements.wlGaugeMax.textContent);
    applyTrendPercent(elements.wlTrend, waterSamples, 'waterLevel');
    renderWaterPrediction(latestWater);

    if (typeof latestWater.distanceCm === 'number') {
      setText(elements.distCurrent, `${latestWater.distanceCm.toFixed(1)} cm`);
      setText(elements.distMin, distVals.length ? Math.min(...distVals).toFixed(1) : '--');
      setText(elements.distMax, distVals.length ? Math.max(...distVals).toFixed(1) : '--');
      applyTrend(elements.distTrend, waterSamples, 'distanceCm', ' cm', 1);
    } else {
      setText(elements.distCurrent, '-- cm');
      setText(elements.distMin, '--');
      setText(elements.distMax, '--');
      setText(elements.distTrend, '--');
      elements.distTrend.classList.remove('card__trend--down');
    }
  }
}

function renderWaterPrediction(latest) {
  if (!elements.wlPredicted || !elements.wlPredictionState) return;

  if (typeof latest.tankHeightCm === 'number') {
    elements.wlTankHeight.textContent = latest.tankHeightCm.toFixed(1);
  } else {
    elements.wlTankHeight.textContent = '--';
  }

  if (typeof latest.waterLevelCm === 'number') {
    elements.wlCurrentCm.textContent = latest.waterLevelCm.toFixed(2);
  } else {
    elements.wlCurrentCm.textContent = '--';
  }

  if (typeof latest.waterRateCmPerSec === 'number') {
    elements.wlRate.textContent = latest.waterRateCmPerSec.toFixed(4);
  } else {
    elements.wlRate.textContent = '--';
  }

  const threshold =
    typeof latest.zeroWaterThresholdCm === 'number' ? latest.zeroWaterThresholdCm : 0.5;
  const wlCm = latest.waterLevelCm;
  const noWater = typeof wlCm === 'number' && wlCm < threshold;

  const setPredictionPill = (text, variant) => {
    elements.wlPredictionState.textContent = text;
    elements.wlPredictionState.classList.remove(
      'status-pill--ready',
      'status-pill--dirty',
      'status-pill--clear',
      'status-pill--unknown'
    );
    if (variant === 'ready') elements.wlPredictionState.classList.add('status-pill--ready');
    else if (variant === 'nowater')
      elements.wlPredictionState.classList.add('status-pill--dirty');
    else elements.wlPredictionState.classList.add('status-pill--unknown');
  };

  if (noWater) {
    elements.wlPredicted.textContent = '-- cm';
    setPredictionPill('No water (prediction off)', 'nowater');
    return;
  }

  const canShowPrediction =
    latest.predictionReady && typeof latest.predictedWaterLevel10s === 'number';

  if (canShowPrediction) {
    elements.wlPredicted.textContent = `${latest.predictedWaterLevel10s.toFixed(2)} cm`;
    setPredictionPill('Prediction ready', 'ready');
  } else {
    elements.wlPredicted.textContent = '-- cm';
    setPredictionPill('Warming up (filling history)', 'unknown');
  }
}

function renderFilterPrediction(samples) {
  if (
    !elements.fQualityPredicted ||
    !elements.fQualityState ||
    !elements.fQualityScore ||
    !elements.fQualityAction
  ) {
    return;
  }

  const latest = samples[samples.length - 1];
  const previous = samples[Math.max(0, samples.length - 6)] ?? latest;
  const turbidityRisk = Math.min(1, Math.max(0, latest.turbidity / 180));
  const tdsRisk = Math.min(1, Math.max(0, latest.tds / 600));
  const phRisk = Math.min(1, Math.abs(latest.ph - 7) / 1.5);
  const turbidityTrendRisk = Math.min(
    1,
    Math.max(0, (latest.turbidity - previous.turbidity) / 40)
  );
  const tdsTrendRisk = Math.min(1, Math.max(0, (latest.tds - previous.tds) / 100));

  const weightedRisk =
    turbidityRisk * 0.35 +
    tdsRisk * 0.25 +
    phRisk * 0.2 +
    turbidityTrendRisk * 0.1 +
    tdsTrendRisk * 0.1;

  const qualityScore = Math.max(0, Math.min(100, Math.round((1 - weightedRisk) * 100)));

  let qualityLabel = 'Good';
  let stateText = 'Filter healthy';
  let stateClass = 'status-pill--clear';
  let actionText = 'Monitor';

  if (qualityScore <= 40) {
    qualityLabel = 'Poor';
    stateText = 'Maintenance needed';
    stateClass = 'status-pill--dirty';
    actionText = 'Replace soon';
  } else if (qualityScore <= 70) {
    qualityLabel = 'Fair';
    stateText = 'Degrading';
    stateClass = 'status-pill--unknown';
    actionText = 'Check filter';
  }

  elements.fQualityPredicted.textContent = qualityLabel;
  elements.fQualityScore.textContent = qualityScore.toFixed(0);
  elements.fQualityAction.textContent = actionText;
  elements.fQualityState.textContent = stateText;
  elements.fQualityState.classList.remove(
    'status-pill--clear',
    'status-pill--dirty',
    'status-pill--unknown',
    'status-pill--ready'
  );
  elements.fQualityState.classList.add(stateClass);
}

function renderTurbidityClarity(sample) {
  const { turbidity, turbidityRaw, clearRaw, dirtyRaw } = sample;
  if (
    typeof turbidityRaw === 'number' &&
    typeof clearRaw === 'number' &&
    typeof dirtyRaw === 'number' &&
    clearRaw !== dirtyRaw
  ) {
    const min = Math.min(clearRaw, dirtyRaw);
    const max = Math.max(clearRaw, dirtyRaw);
    const pos = (turbidityRaw - min) / (max - min);
    const clarity = Math.max(0, Math.min(1, clearRaw > dirtyRaw ? pos : 1 - pos));

    if (clarity >= 0.6) {
      setPill(elements.turbClarity, `CLEAR (${Math.round(clarity * 100)}%)`, 'clear');
      return;
    }
    if (clarity <= 0.4) {
      setPill(elements.turbClarity, `DIRTY (${Math.round(clarity * 100)}%)`, 'dirty');
      return;
    }
    setPill(elements.turbClarity, `MIXED (${Math.round(clarity * 100)}%)`, 'unknown');
    return;
  }

  if (typeof turbidity !== 'number' || !Number.isFinite(turbidity)) {
    setPill(elements.turbClarity, '--', 'unknown');
    return;
  }
  if (turbidity <= TURBIDITY_CLEAR_NTU_MAX) {
    setPill(elements.turbClarity, 'CLEAR', 'clear');
    return;
  }
  if (turbidity >= TURBIDITY_DIRTY_NTU_MIN) {
    setPill(elements.turbClarity, 'DIRTY', 'dirty');
    return;
  }
  setPill(elements.turbClarity, 'MIXED', 'unknown');
}

function setPill(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('status-pill--clear', 'status-pill--dirty', 'status-pill--unknown');
  if (kind === 'clear') el.classList.add('status-pill--clear');
  else if (kind === 'dirty') el.classList.add('status-pill--dirty');
  else el.classList.add('status-pill--unknown');
}

function applyTrend(el, samples, key, unit, decimals = 2) {
  const latest = samples[samples.length - 1]?.[key];
  const prev = samples[Math.max(0, samples.length - 6)]?.[key];
  if (typeof latest !== 'number' || typeof prev !== 'number') {
    el.textContent = '--';
    el.classList.remove('card__trend--down');
    return;
  }
  const diff = latest - prev;
  const sign = diff >= 0 ? '+' : '';
  el.textContent = `${sign}${diff.toFixed(decimals)}${unit}`;
  el.classList.remove('card__trend--down');
  if (diff < 0) el.classList.add('card__trend--down');
}

function applyTrendPercent(el, samples, key) {
  const latest = samples[samples.length - 1]?.[key];
  const prev = samples[Math.max(0, samples.length - 6)]?.[key];
  if (typeof latest !== 'number' || typeof prev !== 'number') {
    el.textContent = '--';
    el.classList.remove('card__trend--down');
    return;
  }
  const diff = (latest - prev) * 100;
  const sign = diff >= 0 ? '+' : '';
  el.textContent = `${sign}${diff.toFixed(0)} %`;
  el.classList.remove('card__trend--down');
  if (diff < 0) el.classList.add('card__trend--down');
}

function renderHistoryChart() {
  const historyChart = state.charts.history;
  if (!historyChart) return;

  const windowSeconds = Number(elements.timeRange.value || 300);
  const cutoff = Date.now() - windowSeconds * 1000;
  const samples = state.devices.quality.history.filter((s) => s.timestamp >= cutoff);

  if (!samples.length) return;
  historyChart.data.labels = samples.map((s) => formatTime(s.timestamp));
  historyChart.data.datasets[0].data = samples.map((s) => s.turbidity);
  historyChart.data.datasets[1].data = samples.map((s) => s.ph);
  historyChart.data.datasets[2].data = samples.map((s) => s.tds);
  historyChart.update('none');
}

function renderWaterLevelGauge() {
  const chart = state.charts.waterLevel;
  const waterSamples = state.devices.water.history;
  if (!chart || !waterSamples.length) return;
  const latest = waterSamples[waterSamples.length - 1];
  const remaining = Math.max(0, Math.min(1, latest.waterLevel)) * 100;
  const empty = 100 - remaining;
  chart.data.datasets[0].data = [empty, remaining];
  chart.update('none');
}

function renderRecentList() {
  const container = elements.recentList;
  container.innerHTML = '';

  const merged = [];
  const water = state.devices.water.history.slice(-4);
  const quality = state.devices.quality.history.slice(-4);

  for (const s of water) merged.push({ kind: 'Water', sample: s });
  for (const s of quality) merged.push({ kind: 'Quality', sample: s });

  merged.sort((a, b) => b.sample.timestamp - a.sample.timestamp);

  merged.slice(0, 8).forEach((entry) => {
    const { kind, sample } = entry;
    const li = document.createElement('li');
    li.className = 'reading-list__item';

    const valuesText =
      kind === 'Water'
        ? `Level ${(sample.waterLevel * 100).toFixed(0)}% • Distance ${typeof sample.distanceCm === 'number' ? sample.distanceCm.toFixed(1) : '--'} cm`
        : `${sample.turbidity.toFixed(2)} NTU • pH ${sample.ph.toFixed(2)} • ${sample.tds.toFixed(0)} mg/L`;

    li.innerHTML = `
      <div class="reading-list__left">
        <span class="reading-list__values">${valuesText}</span>
        <span class="reading-list__timestamp">${formatTime(sample.timestamp)}</span>
      </div>
      <span class="reading-list__badge">${kind}</span>
    `;
    container.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', init);
// ESP32 water monitor dashboard — expects JSON from GET /api/sensors/latest
// (Arduino firmware: ultrasonic water level, pH, turbidity NTU, TDS mg/L, 10s prediction)

const DEFAULT_BASE_URL = 'http://192.168.4.1';
const POLL_MS = 3000;
const MAX_POINTS = 200;

// Turbidity fallback (NTU) — firmware maps ~0.5 (very clear) … 500 (very dirty)
const TURBIDITY_CLEAR_NTU_MAX = 40;
const TURBIDITY_DIRTY_NTU_MIN = 120;

const state = {
  baseUrl: DEFAULT_BASE_URL,
  connected: false,
  paused: false,
  history: [],
  charts: {
    history: null,
    waterLevel: null,
  },
};

const elements = {
  urlInput: document.getElementById('esp32-url'),
  connectBtn: document.getElementById('connect-btn'),
  status: document.getElementById('connection-status'),
  pauseBtn: document.getElementById('pause-btn'),
  timeRange: document.getElementById('time-range'),
  historyCanvas: document.getElementById('history-chart'),
  waterLevelCanvas: document.getElementById('waterlevel-chart'),
  recentList: document.getElementById('recent-readings'),
  // Overview KPIs
  turbValue: document.getElementById('turb-value'),
  turbMin: document.getElementById('turb-min'),
  turbMax: document.getElementById('turb-max'),
  turbTrend: document.getElementById('turb-trend'),
  turbClarity: document.getElementById('turb-clarity'),
  phValue: document.getElementById('ph-value'),
  phMin: document.getElementById('ph-min'),
  phMax: document.getElementById('ph-max'),
  phTrend: document.getElementById('ph-trend'),
  tdsValue: document.getElementById('tds-value'),
  tdsMin: document.getElementById('tds-min'),
  tdsMax: document.getElementById('tds-max'),
  tdsTrend: document.getElementById('tds-trend'),
  // Overview water level gauge
  wlGaugeValue: document.getElementById('waterlevel-value'),
  wlGaugeMin: document.getElementById('waterlevel-min'),
  wlGaugeMax: document.getElementById('waterlevel-max'),
  // Water level tab
  wlCurrent: document.getElementById('wl-current'),
  wlMin: document.getElementById('wl-min'),
  wlMax: document.getElementById('wl-max'),
  wlTrend: document.getElementById('wl-trend'),
  distCurrent: document.getElementById('dist-current'),
  distMin: document.getElementById('dist-min'),
  distMax: document.getElementById('dist-max'),
  distTrend: document.getElementById('dist-trend'),
  wlPredicted: document.getElementById('wl-predicted'),
  wlPredictionState: document.getElementById('wl-prediction-state'),
  wlCurrentCm: document.getElementById('wl-current-cm'),
  wlRate: document.getElementById('wl-rate'),
  wlTankHeight: document.getElementById('wl-tank-height'),
  // Filter quality tab
  fTurbValue: document.getElementById('f-turb-value'),
  fTurbMin: document.getElementById('f-turb-min'),
  fTurbMax: document.getElementById('f-turb-max'),
  fTurbTrend: document.getElementById('f-turb-trend'),
  fTurbClarity: document.getElementById('f-turb-clarity'),
  fPhValue: document.getElementById('f-ph-value'),
  fPhMin: document.getElementById('f-ph-min'),
  fPhMax: document.getElementById('f-ph-max'),
  fPhTrend: document.getElementById('f-ph-trend'),
  fTdsValue: document.getElementById('f-tds-value'),
  fTdsMin: document.getElementById('f-tds-min'),
  fTdsMax: document.getElementById('f-tds-max'),
  fTdsTrend: document.getElementById('f-tds-trend'),
  fQualityPredicted: document.getElementById('f-quality-predicted'),
  fQualityState: document.getElementById('f-quality-state'),
  fQualityScore: document.getElementById('f-quality-score'),
  fQualityAction: document.getElementById('f-quality-action'),
  // Tabs/views
  tabButtons: document.querySelectorAll('.sidebar__nav-item[data-tab]'),
  views: document.querySelectorAll('.view'),
};

let pollTimer = null;

function setStatus(text, kind = 'normal') {
  elements.status.textContent = text;
  elements.status.classList.remove('topbar__status--ok', 'topbar__status--error');
  if (kind === 'ok') elements.status.classList.add('topbar__status--ok');
  if (kind === 'error') elements.status.classList.add('topbar__status--error');
}

function init() {
  elements.urlInput.value = DEFAULT_BASE_URL;
  bindEvents();
  bindTabs();
  initCharts();
  // Start with fake data so UI is not empty
  seedFakeData();
  renderAll();
}

function bindEvents() {
  elements.connectBtn.addEventListener('click', () => {
    state.baseUrl = elements.urlInput.value.trim() || DEFAULT_BASE_URL;
    startPolling();
  });

  elements.pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    elements.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  });

  elements.timeRange.addEventListener('change', () => {
    renderHistoryChart();
  });
}

function bindTabs() {
  elements.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      // button active state
      elements.tabButtons.forEach((b) =>
        b.classList.toggle(
          'sidebar__nav-item--active',
          b === btn
        )
      );
      // view switching
      elements.views.forEach((view) =>
        view.classList.toggle(
          'view--active',
          view.id === `view-${target}`
        )
      );
    });
  });
}

function initCharts() {
  // History line chart (multi-sensor overview)
  state.charts.history = new Chart(elements.historyCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Turbidity (NTU)',
          data: [],
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.10)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'pH',
          data: [],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.10)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'TDS (mg/L)',
          data: [],
          borderColor: '#a855f7',
          backgroundColor: 'rgba(168, 85, 247, 0.08)',
          tension: 0.35,
          yAxisID: 'y2',
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            boxWidth: 10,
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            title(items) {
              if (!items.length) return '';
              return items[0].label;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 6 },
        },
        y: {
          position: 'left',
          title: { display: true, text: 'Turbidity / pH' },
        },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'TDS (mg/L)' },
        },
      },
    },
  });

  // Water level gauge
  state.charts.waterLevel = new Chart(
    elements.waterLevelCanvas.getContext('2d'),
    {
    type: 'doughnut',
    data: {
      labels: ['Empty', 'Water'],
      datasets: [
        {
          data: [50, 50],
          backgroundColor: ['rgba(209, 213, 219, 0.9)', '#2563eb'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      cutout: '75%',
      rotation: -90,
      circumference: 180,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  }
  );
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  setStatus('Connecting...');
  state.connected = true; // optimistic until first error
  elements.connectBtn.disabled = true;

  const fetchAndUpdate = async () => {
    if (state.paused) return;
    try {
      const res = await fetch(`${state.baseUrl}/api/sensors/latest`, {
        cache: 'no-cache',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      ingestSample(data);
      renderAll();
      setStatus('Connected to ESP32', 'ok');
      state.connected = true;
    } catch (err) {
      console.error('Fetch error', err);
      state.connected = false;
      setStatus('Connection failed – showing last data', 'error');
      // keep interval running; ESP32 might come back
    } finally {
      elements.connectBtn.disabled = false;
    }
  };

  fetchAndUpdate(); // immediate
  pollTimer = setInterval(fetchAndUpdate, POLL_MS);
}

function ingestSample(raw) {
  const ts =
    typeof raw.timestamp === 'number'
      ? raw.timestamp
      : Date.now();

  const tankHeightCm = normalizeNumber(raw.tankHeightCm ?? raw.tank_height_cm);
  const zeroWaterThresholdCm =
    normalizeNumber(raw.zeroWaterThresholdCm ?? raw.zero_water_threshold_cm) ??
    0.5;

  let waterLevelCm = normalizeNumber(raw.waterLevelCm ?? raw.water_level_cm);
  let distanceCm = normalizeDistanceCm(
    raw.distanceCm ?? raw.distance_cm ?? raw.ultrasonicCm ?? raw.ultrasonic_cm
  );

  const tankH =
    tankHeightCm != null && tankHeightCm > 0 ? tankHeightCm : null;

  if (waterLevelCm == null && tankH != null && distanceCm != null) {
    waterLevelCm = clampFloat(tankH - distanceCm, 0, tankH);
  }
  if (distanceCm == null && tankH != null && waterLevelCm != null) {
    distanceCm = clampFloat(tankH - waterLevelCm, 0, tankH);
  }

  let waterLevel = normalizeLevelOrNull(raw.waterLevel ?? raw.waterLevelNormalized);
  if (waterLevel == null && waterLevelCm != null && tankH != null) {
    waterLevel = clamp01(waterLevelCm / tankH);
  } else if (waterLevel == null && distanceCm != null && tankH != null) {
    waterLevel = clamp01((tankH - distanceCm) / tankH);
  } else if (waterLevel == null) {
    waterLevel = 0.5;
  } else {
    waterLevel = clamp01(waterLevel);
  }

  const sample = {
    timestamp: ts,
    turbidity: Number(raw.turbidity ?? 0),
    turbidityRaw: normalizeInt(raw.turbidityRaw ?? raw.turbidity_raw ?? raw.raw),
    clearRaw: normalizeInt(raw.clearRaw ?? raw.clear_raw),
    dirtyRaw: normalizeInt(raw.dirtyRaw ?? raw.dirty_raw),
    ph: Number(raw.ph ?? 7),
    tds: Number(raw.tds ?? 0),
    waterLevel,
    waterLevelCm:
      waterLevelCm != null
        ? waterLevelCm
        : tankH != null
          ? waterLevel * tankH
          : null,
    tankHeightCm: tankH,
    zeroWaterThresholdCm,
    waterRateCmPerSec: normalizeNumber(
      raw.waterRateCmPerSec ?? raw.water_rate_cm_per_sec
    ),
    predictionReady: normalizeBool(raw.predictionReady),
    predictedWaterLevel10s: normalizeNumber(
      raw.predictedWaterLevel10s ?? raw.predicted_water_level_10s
    ),
    distanceCm,
  };
  state.history.push(sample);
  if (state.history.length > MAX_POINTS) {
    state.history.splice(0, state.history.length - MAX_POINTS);
  }
}

function seedFakeData() {
  const now = Date.now();
  const tankHeightCm = 30;
  for (let i = 60; i >= 0; i--) {
    const t = now - i * 5000;
    const level = 0.75 - i * 0.002;
    const dist = (1 - Math.max(0, Math.min(1, level))) * tankHeightCm;
    ingestSample({
      timestamp: t,
      turbidity: Math.max(0.5, 15 + Math.sin(i / 6) * 12),
      ph: 7 + Math.cos(i / 10) * 0.2,
      tds: 200 + Math.sin(i / 8) * 40,
      tankHeightCm,
      zeroWaterThresholdCm: 0.5,
      waterLevel: level,
      distanceCm: dist,
      waterLevelCm: level * tankHeightCm,
      waterRateCmPerSec: 0.01 * Math.sin(i / 5),
      predictionReady: i > 15,
      predictedWaterLevel10s: i > 15 ? level * tankHeightCm + 0.4 : null,
    });
  }
}

function clamp01(x) {
  if (Number.isNaN(x) || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clampFloat(x, lo, hi) {
  if (Number.isNaN(x) || !Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function normalizeLevelOrNull(rawLevel) {
  if (rawLevel == null) return null;
  let v = Number(rawLevel);
  if (Number.isNaN(v)) return null;
  if (v > 1) v = v / 100;
  return v;
}

function normalizeLevel(rawLevel) {
  const v = normalizeLevelOrNull(rawLevel);
  if (v == null) return 0.5;
  return clamp01(v);
}

function normalizeBool(v) {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return Boolean(v);
}

function normalizeDistanceCm(rawDistance) {
  if (rawDistance == null) return null;
  const v = Number(rawDistance);
  if (Number.isNaN(v)) return null;
  if (v < 0) return 0;
  return v;
}

function normalizeInt(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function renderAll() {
  if (!state.history.length) return;
  renderKpis();
  renderHistoryChart();
  renderWaterLevelGauge();
  renderRecentList();
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderKpis() {
  const samples = state.history;
  const latest = samples[samples.length - 1];

  const turbVals = samples.map((s) => s.turbidity);
  const phVals = samples.map((s) => s.ph);
  const tdsVals = samples.map((s) => s.tds);
  const levelVals = samples.map((s) => s.waterLevel * 100);
  const distVals = samples
    .map((s) => s.distanceCm)
    .filter((v) => typeof v === 'number');

  const turbMin = Math.min(...turbVals).toFixed(2);
  const turbMax = Math.max(...turbVals).toFixed(2);
  const phMin = Math.min(...phVals).toFixed(2);
  const phMax = Math.max(...phVals).toFixed(2);
  const tdsMin = Math.min(...tdsVals).toFixed(0);
  const tdsMax = Math.max(...tdsVals).toFixed(0);

  elements.turbValue.textContent = `${latest.turbidity.toFixed(2)} NTU`;
  elements.turbMin.textContent = turbMin;
  elements.turbMax.textContent = turbMax;
  renderTurbidityClarity(latest);

  elements.phValue.textContent = latest.ph.toFixed(2);
  elements.phMin.textContent = phMin;
  elements.phMax.textContent = phMax;

  elements.tdsValue.textContent = `${latest.tds.toFixed(0)} mg/L`;
  elements.tdsMin.textContent = tdsMin;
  elements.tdsMax.textContent = tdsMax;

  applyTrend(elements.turbTrend, samples, 'turbidity', ' NTU');
  applyTrend(elements.phTrend, samples, 'ph', '');
  applyTrend(elements.tdsTrend, samples, 'tds', ' mg/L');

  // Water level overview gauge stats
  elements.wlGaugeValue.textContent = `${(latest.waterLevel * 100).toFixed(0)} %`;
  elements.wlGaugeMin.textContent = Math.min(...levelVals).toFixed(0);
  elements.wlGaugeMax.textContent = Math.max(...levelVals).toFixed(0);

  // Water level tab stats
  elements.wlCurrent.textContent = `${(latest.waterLevel * 100).toFixed(0)} %`;
  elements.wlMin.textContent = elements.wlGaugeMin.textContent;
  elements.wlMax.textContent = elements.wlGaugeMax.textContent;
  applyTrendPercent(elements.wlTrend, samples, 'waterLevel');
  renderWaterPrediction(latest);

  // Ultrasonic distance (optional)
  if (typeof latest.distanceCm === 'number') {
    elements.distCurrent.textContent = `${latest.distanceCm.toFixed(1)} cm`;
    elements.distMin.textContent = distVals.length
      ? Math.min(...distVals).toFixed(1)
      : '--';
    elements.distMax.textContent = distVals.length
      ? Math.max(...distVals).toFixed(1)
      : '--';
    applyTrend(elements.distTrend, samples, 'distanceCm', ' cm', 1);
  } else {
    elements.distCurrent.textContent = '-- cm';
    elements.distMin.textContent = '--';
    elements.distMax.textContent = '--';
    elements.distTrend.textContent = '--';
    elements.distTrend.classList.remove('card__trend--down');
  }

  // Filter tab mirrors overview stats
  elements.fTurbValue.textContent = elements.turbValue.textContent;
  elements.fTurbMin.textContent = turbMin;
  elements.fTurbMax.textContent = turbMax;
  elements.fPhValue.textContent = elements.phValue.textContent;
  elements.fPhMin.textContent = phMin;
  elements.fPhMax.textContent = phMax;
  elements.fTdsValue.textContent = elements.tdsValue.textContent;
  elements.fTdsMin.textContent = tdsMin;
  elements.fTdsMax.textContent = tdsMax;

  // Filter tab live trend badges
  elements.fTurbTrend.textContent = elements.turbTrend.textContent;
  elements.fTurbTrend.className = elements.turbTrend.className;
  elements.fTurbClarity.textContent = elements.turbClarity.textContent;
  elements.fTurbClarity.className = elements.turbClarity.className;
  elements.fPhTrend.textContent = elements.phTrend.textContent;
  elements.fPhTrend.className = elements.phTrend.className;
  elements.fTdsTrend.textContent = elements.tdsTrend.textContent;
  elements.fTdsTrend.className = elements.tdsTrend.className;
  renderFilterPrediction(samples);
}

function renderWaterPrediction(latest) {
  if (!elements.wlPredicted || !elements.wlPredictionState) return;

  if (elements.wlTankHeight) {
    if (typeof latest.tankHeightCm === 'number') {
      elements.wlTankHeight.textContent = latest.tankHeightCm.toFixed(1);
    } else {
      elements.wlTankHeight.textContent = '--';
    }
  }

  if (typeof latest.waterLevelCm === 'number') {
    elements.wlCurrentCm.textContent = latest.waterLevelCm.toFixed(2);
  } else {
    elements.wlCurrentCm.textContent = '--';
  }

  if (typeof latest.waterRateCmPerSec === 'number') {
    elements.wlRate.textContent = latest.waterRateCmPerSec.toFixed(4);
  } else {
    elements.wlRate.textContent = '--';
  }

  const threshold =
    typeof latest.zeroWaterThresholdCm === 'number'
      ? latest.zeroWaterThresholdCm
      : 0.5;
  const wlCm = latest.waterLevelCm;
  const noWater = typeof wlCm === 'number' && wlCm < threshold;

  const setPredictionPill = (text, variant) => {
    elements.wlPredictionState.textContent = text;
    elements.wlPredictionState.classList.remove(
      'status-pill--ready',
      'status-pill--dirty',
      'status-pill--clear',
      'status-pill--unknown'
    );
    if (variant === 'ready') elements.wlPredictionState.classList.add('status-pill--ready');
    else if (variant === 'nowater') elements.wlPredictionState.classList.add('status-pill--dirty');
    else elements.wlPredictionState.classList.add('status-pill--unknown');
  };

  if (noWater) {
    elements.wlPredicted.textContent = '-- cm';
    setPredictionPill('No water (prediction off)', 'nowater');
    return;
  }

  const canShowPrediction =
    latest.predictionReady && typeof latest.predictedWaterLevel10s === 'number';

  if (canShowPrediction) {
    elements.wlPredicted.textContent = `${latest.predictedWaterLevel10s.toFixed(2)} cm`;
    setPredictionPill('Prediction ready', 'ready');
  } else {
    elements.wlPredicted.textContent = '-- cm';
    setPredictionPill('Warming up (filling history)', 'unknown');
  }
}

function renderFilterPrediction(samples) {
  if (
    !elements.fQualityPredicted ||
    !elements.fQualityState ||
    !elements.fQualityScore ||
    !elements.fQualityAction
  ) {
    return;
  }

  const latest = samples[samples.length - 1];
  const previous = samples[Math.max(0, samples.length - 6)] ?? latest;

  const turbidityRisk = Math.min(1, Math.max(0, latest.turbidity / 180));
  const tdsRisk = Math.min(1, Math.max(0, latest.tds / 600));
  const phRisk = Math.min(1, Math.abs(latest.ph - 7) / 1.5);

  const turbidityTrendRisk = Math.min(
    1,
    Math.max(0, (latest.turbidity - previous.turbidity) / 40)
  );
  const tdsTrendRisk = Math.min(1, Math.max(0, (latest.tds - previous.tds) / 100));

  const weightedRisk =
    turbidityRisk * 0.35 +
    tdsRisk * 0.25 +
    phRisk * 0.2 +
    turbidityTrendRisk * 0.1 +
    tdsTrendRisk * 0.1;

  const qualityScore = Math.max(0, Math.min(100, Math.round((1 - weightedRisk) * 100)));

  let qualityLabel = 'Good';
  let stateText = 'Filter healthy';
  let stateClass = 'status-pill--clear';
  let actionText = 'Monitor';

  if (qualityScore <= 40) {
    qualityLabel = 'Poor';
    stateText = 'Maintenance needed';
    stateClass = 'status-pill--dirty';
    actionText = 'Replace soon';
  } else if (qualityScore <= 70) {
    qualityLabel = 'Fair';
    stateText = 'Degrading';
    stateClass = 'status-pill--unknown';
    actionText = 'Check filter';
  }

  elements.fQualityPredicted.textContent = qualityLabel;
  elements.fQualityScore.textContent = qualityScore.toFixed(0);
  elements.fQualityAction.textContent = actionText;
  elements.fQualityState.textContent = stateText;
  elements.fQualityState.classList.remove(
    'status-pill--clear',
    'status-pill--dirty',
    'status-pill--unknown',
    'status-pill--ready'
  );
  elements.fQualityState.classList.add(stateClass);
}

function renderTurbidityClarity(sample) {
  const { turbidity, turbidityRaw, clearRaw, dirtyRaw } = sample;

  // Prefer raw calibration if present (matches your ESP32 Serial calibration logic).
  // Your code saves "clearRaw" and "dirtyRaw" from averaged ADC raw readings.
  if (
    typeof turbidityRaw === 'number' &&
    typeof clearRaw === 'number' &&
    typeof dirtyRaw === 'number' &&
    clearRaw !== dirtyRaw
  ) {
    // Compute "clarity" based on where raw sits between the two calibration points.
    // Assumption: larger raw is clearer (you can swap if your sensor behaves opposite).
    const min = Math.min(clearRaw, dirtyRaw);
    const max = Math.max(clearRaw, dirtyRaw);
    const pos = (turbidityRaw - min) / (max - min); // 0..1
    const clarity = Math.max(0, Math.min(1, clearRaw > dirtyRaw ? pos : 1 - pos));

    if (clarity >= 0.6) {
      setPill(elements.turbClarity, `CLEAR (${Math.round(clarity * 100)}%)`, 'clear');
      return;
    }
    if (clarity <= 0.4) {
      setPill(elements.turbClarity, `DIRTY (${Math.round(clarity * 100)}%)`, 'dirty');
      return;
    }
    setPill(elements.turbClarity, `MIXED (${Math.round(clarity * 100)}%)`, 'unknown');
    return;
  }

  // Fallback classification using NTU only.
  if (typeof turbidity !== 'number' || !Number.isFinite(turbidity)) {
    setPill(elements.turbClarity, '--', 'unknown');
    return;
  }

  if (turbidity <= TURBIDITY_CLEAR_NTU_MAX) {
    setPill(elements.turbClarity, 'CLEAR', 'clear');
    return;
  }
  if (turbidity >= TURBIDITY_DIRTY_NTU_MIN) {
    setPill(elements.turbClarity, 'DIRTY', 'dirty');
    return;
  }
  setPill(elements.turbClarity, 'MIXED', 'unknown');
}

function setPill(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('status-pill--clear', 'status-pill--dirty', 'status-pill--unknown');
  if (kind === 'clear') el.classList.add('status-pill--clear');
  else if (kind === 'dirty') el.classList.add('status-pill--dirty');
  else el.classList.add('status-pill--unknown');
}

function applyTrend(el, samples, key, unit, decimals = 2) {
  const latest = samples[samples.length - 1][key];
  const prev = samples[Math.max(0, samples.length - 6)][key];
  if (typeof latest !== 'number' || typeof prev !== 'number') {
    el.textContent = '--';
    el.classList.remove('card__trend--down');
    return;
  }
  const diff = latest - prev;
  const sign = diff >= 0 ? '+' : '';
  el.textContent = `${sign}${diff.toFixed(decimals)}${unit}`;
  el.classList.remove('card__trend--down');
  if (diff < 0) el.classList.add('card__trend--down');
}

function applyTrendPercent(el, samples, key) {
  const latest = samples[samples.length - 1][key];
  const prev = samples[Math.max(0, samples.length - 6)][key];
  if (typeof latest !== 'number' || typeof prev !== 'number') {
    el.textContent = '--';
    el.classList.remove('card__trend--down');
    return;
  }
  const diff = (latest - prev) * 100;
  const sign = diff >= 0 ? '+' : '';
  el.textContent = `${sign}${diff.toFixed(0)} %`;
  el.classList.remove('card__trend--down');
  if (diff < 0) el.classList.add('card__trend--down');
}

function renderHistoryChart() {
  const historyChart = state.charts.history;
  if (!historyChart) return;

  const windowSeconds = Number(elements.timeRange.value || 300);
  const cutoff = Date.now() - windowSeconds * 1000;
  const samples = state.history.filter((s) => s.timestamp >= cutoff);
  if (!samples.length) return;

  historyChart.data.labels = samples.map((s) => formatTime(s.timestamp));
  historyChart.data.datasets[0].data = samples.map((s) => s.turbidity);
  historyChart.data.datasets[1].data = samples.map((s) => s.ph);
  historyChart.data.datasets[2].data = samples.map((s) => s.tds);

  historyChart.update('none');
}

function renderWaterLevelGauge() {
  const chart = state.charts.waterLevel;
  if (!chart || !state.history.length) return;
  const latest = state.history[state.history.length - 1];
  const remaining = Math.max(0, Math.min(1, latest.waterLevel)) * 100;
  const empty = 100 - remaining;
  chart.data.datasets[0].data = [empty, remaining];
  chart.update('none');
}

function renderRecentList() {
  const container = elements.recentList;
  container.innerHTML = '';
  const last = state.history.slice(-8).reverse();
  last.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'reading-list__item';
    li.innerHTML = `
      <div class="reading-list__left">
        <span class="reading-list__values">
          ${s.turbidity.toFixed(2)} NTU •
          pH ${s.ph.toFixed(2)} •
          ${s.tds.toFixed(0)} mg/L
        </span>
        <span class="reading-list__timestamp">${formatTime(s.timestamp)}</span>
      </div>
      <span class="reading-list__badge">
        Level ${(s.waterLevel * 100).toFixed(0)} %
      </span>
    `;
    container.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', init);

