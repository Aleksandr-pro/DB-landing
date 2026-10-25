import { WORLD_SIZE, HALF_WORLD, LANDMARKS, CAR_PAINTS, TIME_PRESETS } from '../world/WorldConfig.js';
import {
  ROAD_HIGHWAY,
  ROAD_COUNTRY,
  ROAD_COBBLESTONE,
  ROAD_TRAIL,
} from '../world/RoadAndWaterNetwork.js';

export class HorizonHUD {
  constructor({ network, villageInfra, car, onSelectTime, onToggleAudio }) {
    this.network = network;
    this.villageInfra = villageInfra;
    this.car = car;
    this.onSelectTime = onSelectTime;
    this.onToggleAudio = onToggleAudio;

    this.mapOpen = false;
    this.activeDistrictId = null;
    this.bannerTimer = 0;

    this._bakeWorldMapCanvas();
    this._mountDOM();
    this._bindEvents();
  }

  // Bake an ultra-crisp 768x768 Topographic & Road Network Map of the entire 4x4 km world!
  _bakeWorldMapCanvas() {
    const S = 768;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;

    for (let py = 0; py < S; py++) {
      const wz = -HALF_WORLD + (py / S) * WORLD_SIZE;
      for (let px = 0; px < S; px++) {
        const wx = -HALF_WORLD + (px / S) * WORLD_SIZE;
        const h = this.network.getTerrainHeight(wx, wz);
        const hEast = this.network.getTerrainHeight(wx + 8, wz);
        const hSouth = this.network.getTerrainHeight(wx, wz + 8);
        const shade = Math.max(0.68, Math.min(1.28, 1.0 + (h - hEast) * 0.045 + (h - hSouth) * 0.035));

        const wInfo = this.network.getWaterInfo(wx, wz);
        let r, g, b;

        if (wInfo.inWater) {
          const depth = Math.max(0, wInfo.waterY - h);
          const t = Math.min(1, depth / 7.5);
          r = 18 * (1 - t) + 9 * t;
          g = 132 * (1 - t) + 74 * t;
          b = 158 * (1 - t) + 112 * t;
        } else {
          const forest = this.network.getForestDensity(wx, wz);
          const farm = this.network.getFarmlandMask(wx, wz);
          // Meadow base
          r = 68; g = 104; b = 56;
          // Forest dark canopy
          r = r * (1 - forest * 0.65) + 34 * (forest * 0.65);
          g = g * (1 - forest * 0.65) + 68 * (forest * 0.65);
          b = b * (1 - forest * 0.65) + 38 * (forest * 0.65);
          // Golden farmland fields
          if (farm > 0.2) {
            const patch = Math.sin(wx * 0.011 + 0.6) * Math.cos(wz * 0.0105 - 0.4) > 0 ? 0.65 : 0.25;
            const fw = farm * patch * (1 - forest * 0.7);
            r = r * (1 - fw) + 156 * fw;
            g = g * (1 - fw) + 132 * fw;
            b = b * (1 - fw) + 64 * fw;
          }
          // Alpine rocky elevations
          if (h > 68) {
            const rw = Math.min(1, (h - 68) / 55);
            r = r * (1 - rw) + 124 * rw;
            g = g * (1 - rw) + 122 * rw;
            b = b * (1 - rw) + 120 * rw;
          }
          // Contour line every 20m
          if (Math.abs((h % 20) - 10) < 0.42) {
            r *= 0.90; g *= 0.90; b *= 0.90;
          }
          r *= shade; g *= shade; b *= shade;
        }

        const idx = (py * S + px) * 4;
        d[idx] = Math.min(255, Math.max(0, r));
        d[idx + 1] = Math.min(255, Math.max(0, g));
        d[idx + 2] = Math.min(255, Math.max(0, b));
        d[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const toPx = (wx) => ((wx + HALF_WORLD) / WORLD_SIZE) * S;
    const toPy = (wz) => ((wz + HALF_WORLD) / WORLD_SIZE) * S;

    // 1 km Grid Overlay
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    for (let km = -1000; km <= 1000; km += 1000) {
      const p = toPx(km);
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
    }

    // Draw Roads in order: Trails -> Cobblestone -> Country -> Highway M1
    const order = [ROAD_TRAIL, ROAD_COBBLESTONE, ROAD_COUNTRY, ROAD_HIGHWAY];
    for (const rType of order) {
      for (const road of this.network.roads) {
        if (road.type !== rType) continue;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        road.nodes.forEach((n, i) => {
          const x = toPx(n.x);
          const y = toPy(n.z);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });

        if (rType === ROAD_TRAIL) {
          ctx.strokeStyle = '#d6a874';
          ctx.lineWidth = 2.1;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
        } else if (rType === ROAD_COBBLESTONE) {
          ctx.strokeStyle = '#1e242b';
          ctx.lineWidth = 4.2;
          ctx.stroke();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.4;
          ctx.stroke();
        } else if (rType === ROAD_COUNTRY) {
          ctx.strokeStyle = '#181c22';
          ctx.lineWidth = 5.5;
          ctx.stroke();
          ctx.strokeStyle = '#f1f5f9';
          ctx.lineWidth = 3.1;
          ctx.stroke();
        } else if (rType === ROAD_HIGHWAY) {
          ctx.strokeStyle = '#14171d';
          ctx.lineWidth = 7.6;
          ctx.stroke();
          ctx.strokeStyle = '#ff3e6c';
          ctx.lineWidth = 4.5;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Draw Building Footprints in Village & Farms!
    ctx.fillStyle = '#fde68a';
    for (const col of this.villageInfra.colliders) {
      ctx.fillRect(toPx(col.x) - 2.2, toPy(col.z) - 2.2, 4.4, 4.4);
    }

    this.worldMapCanvas = c;
  }

  _mountDOM() {
    const hud = document.getElementById('hud-root');
    hud.innerHTML = `
      <!-- Top-Left World Brand & Scale Badge -->
      <div class="fh-brand-card">
        <div class="fh-brand-tag">HORIZON VALLEY • ОТКРЫТЫЙ МИР</div>
        <div class="fh-brand-sub">4.0 × 4.0 КМ (16 КМ²) • <span id="fh-coords">0, 0 м</span></div>
      </div>

      <!-- Top-Center Forza District Discovery Banner -->
      <div id="fh-district-banner" class="fh-district-banner">
        <div class="fh-district-line"></div>
        <div id="fh-district-title" class="fh-district-title">ФЕСТИВАЛЬ HORIZON</div>
        <div id="fh-district-sub" class="fh-district-sub">Главный фестивальный хаб</div>
      </div>

      <!-- Top-Right Interactive Toolbar -->
      <div class="fh-toolbar">
        <div class="fh-tool-row">
          <button class="fh-pill active" data-mode="drive" title="Вождение суперкара [V]">🏎️ Вождение</button>
          <button class="fh-pill" data-mode="drone" title="Свободный полёт над всей картой [V]">🛸 Дрон</button>
          <button class="fh-pill" data-mode="tour" title="Автоматический кинообзор локаций">🎬 Обзор</button>
          <button id="btn-open-map" class="fh-pill accent" title="Интерактивная карта и быстрое перемещение [M]">🗺️ Карта [M]</button>
          <button id="btn-audio" class="fh-pill" title="Звук двигателя V8 и природы">🔇 Звук</button>
        </div>
        <div class="fh-tool-row">
          ${Object.values(TIME_PRESETS).map((p, idx) => `
            <button class="fh-chip ${idx === 0 ? 'active' : ''}" data-time="${p.id}">${p.label}</button>
          `).join('')}
        </div>
        <div class="fh-tool-row fh-paints-row">
          <span class="fh-paint-label">Цвет кузова:</span>
          ${CAR_PAINTS.map((p, idx) => `
            <button class="fh-swatch ${idx === 0 ? 'active' : ''}" data-paint="${idx}" style="background:${p.hex}" title="${p.name}"></button>
          `).join('')}
        </div>
      </div>

      <!-- Bottom-Left Circular Live Radar Minimap -->
      <div id="fh-minimap-wrap" class="fh-minimap-wrap" title="Нажмите [M] для полной карты 4×4 км и телепортации">
        <canvas id="fh-minimap" width="210" height="210"></canvas>
        <div class="fh-minimap-North">N</div>
        <div class="fh-minimap-hint">M — КАРТА 4×4 КМ</div>
      </div>

      <!-- Bottom-Center Controls Hint -->
      <div id="fh-controls-hint" class="fh-controls-hint">
        <span><b>WASD / Стрелки</b> Газ и руль</span>
        <span><b>Пробел</b> Ручник / Дрифт</span>
        <span><b>Shift</b> Нитро</span>
        <span><b>C</b> Камера</span>
        <span><b>H</b> Фары</span>
        <span><b>R</b> На дорогу</span>
        <span><b>M</b> Карта мира</span>
      </div>

      <!-- Bottom-Right Forza Horizon Digital Tachometer & Speedometer -->
      <div id="fh-speedo" class="fh-speedo">
        <svg class="fh-rpm-svg" viewBox="0 0 180 180">
          <path d="M 30 145 A 72 72 0 1 1 150 145" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="9" stroke-linecap="round"/>
          <path id="fh-rpm-arc" d="M 30 145 A 72 72 0 1 1 150 145" fill="none" stroke="url(#fhGrad)" stroke-width="9" stroke-linecap="round" stroke-dasharray="282" stroke-dashoffset="240"/>
          <defs>
            <linearGradient id="fhGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#05d9e8"/>
              <stop offset="68%" stop-color="#ff9f1c"/>
              <stop offset="100%" stop-color="#ff2a6d"/>
            </linearGradient>
          </defs>
        </svg>
        <div class="fh-speedo-center">
          <div id="fh-drift-tag" class="fh-drift-tag">ДРИФТ</div>
          <div id="fh-speed-val" class="fh-speed-val">0</div>
          <div class="fh-speed-unit">КМ/Ч</div>
          <div class="fh-gear-row">
            <span id="fh-gear" class="fh-gear">1</span>
            <span id="fh-surface" class="fh-surface">ШОССЕ</span>
          </div>
          <div id="fh-odo" class="fh-odo">0.0 км</div>
        </div>
      </div>

      <!-- Full-Screen 4x4 km Interactive World Map & Fast Travel Modal -->
      <div id="fh-map-modal" class="fh-map-modal hidden">
        <div class="fh-map-dialog">
          <div class="fh-map-sidebar">
            <div class="fh-map-header">
              <h2>КАРТА МИРА • 4 × 4 КМ</h2>
              <p>Выберите локацию для мгновенного перемещения или кликните в любую точку карты</p>
            </div>
            <div class="fh-landmark-list">
              ${LANDMARKS.map((lm, idx) => `
                <button class="fh-lm-btn" data-lm="${idx}">
                  <span class="fh-lm-icon" style="background:${lm.color}22;border-color:${lm.color}">${lm.icon}</span>
                  <span class="fh-lm-info">
                    <strong>${lm.name}</strong>
                    <small>${lm.subtitle}</small>
                  </span>
                </button>
              `).join('')}
            </div>
            <div class="fh-map-legend">
              <span><i style="background:#ff3e6c"></i> Шоссе M1</span>
              <span><i style="background:#f1f5f9"></i> Дороги</span>
              <span><i style="background:#f59e0b"></i> Деревня</span>
              <span><i style="background:#d6a874"></i> Лесные тропы</span>
            </div>
            <button id="btn-close-map" class="fh-close-map-btn">Закрыть карту [Esc / M]</button>
          </div>
          <div class="fh-map-canvas-box">
            <canvas id="fh-fullmap" width="768" height="768"></canvas>
          </div>
        </div>
      </div>
    `;

    this.minimapCtx = document.getElementById('fh-minimap').getContext('2d');
    this.fullMapCanvas = document.getElementById('fh-fullmap');
    this.fullMapCtx = this.fullMapCanvas.getContext('2d');

    this.elCoords = document.getElementById('fh-coords');
    this.elBanner = document.getElementById('fh-district-banner');
    this.elBannerTitle = document.getElementById('fh-district-title');
    this.elBannerSub = document.getElementById('fh-district-sub');
    this.elSpeedVal = document.getElementById('fh-speed-val');
    this.elGear = document.getElementById('fh-gear');
    this.elSurface = document.getElementById('fh-surface');
    this.elOdo = document.getElementById('fh-odo');
    this.elRpmArc = document.getElementById('fh-rpm-arc');
    this.elDriftTag = document.getElementById('fh-drift-tag');
    this.elSpeedo = document.getElementById('fh-speedo');
    this.elHint = document.getElementById('fh-controls-hint');
    this.elMapModal = document.getElementById('fh-map-modal');
  }

  _bindEvents() {
    // Mode buttons
    document.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this._setModeUI(mode);
      });
    });

    // Time of Day buttons
    document.querySelectorAll('[data-time]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-time]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.onSelectTime?.(btn.dataset.time);
      });
    });

    // Paint swatches
    document.querySelectorAll('[data-paint]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-paint]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.car.setPaint(Number(btn.dataset.paint));
      });
    });

    // Audio toggle
    const audioBtn = document.getElementById('btn-audio');
    audioBtn.addEventListener('click', () => {
      const on = this.onToggleAudio?.();
      audioBtn.textContent = on ? '🔊 Звук V8' : '🔇 Звук';
      audioBtn.classList.toggle('active', !!on);
    });

    // Map modal open/close
    document.getElementById('btn-open-map').addEventListener('click', () => this.toggleMap(true));
    document.getElementById('fh-minimap-wrap').addEventListener('click', () => this.toggleMap(true));
    document.getElementById('btn-close-map').addEventListener('click', () => this.toggleMap(false));

    // Landmark fast travel buttons
    document.querySelectorAll('[data-lm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lm = LANDMARKS[Number(btn.dataset.lm)];
        if (lm) {
          this.car.teleportTo(lm.x, lm.z, lm.heading);
          this.showDistrictBanner(lm.name, lm.subtitle);
          this.toggleMap(false);
        }
      });
    });

    // Click anywhere on 4x4 km full map to teleport!
    this.fullMapCanvas.addEventListener('click', (e) => {
      const rect = this.fullMapCanvas.getBoundingClientRect();
      const ux = (e.clientX - rect.left) / rect.width;
      const uz = (e.clientY - rect.top) / rect.height;
      const wx = -HALF_WORLD + ux * WORLD_SIZE;
      const wz = -HALF_WORLD + uz * WORLD_SIZE;
      // Avoid deep lake center teleport if in drive mode
      if (this.car.mode === 'drive' && this.network.getWaterInfo(wx, wz).inWater) {
        // Snap to nearest road if user clicked water while driving
        this.car.pos.set(wx, 10, wz);
        this.car.resetToNearestRoad();
      } else {
        this.car.teleportTo(wx, wz, this.car.heading);
      }
      this.toggleMap(false);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        this.toggleMap(!this.mapOpen);
      } else if (e.code === 'Escape' && this.mapOpen) {
        this.toggleMap(false);
      } else if (e.code === 'KeyV') {
        const next = this.car.mode === 'drive' ? 'drone' : 'drive';
        this._setModeUI(next);
      }
    });
  }

  _setModeUI(mode) {
    this.car.setMode(mode);
    document.querySelectorAll('[data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    this.elSpeedo.style.display = mode === 'drive' ? 'block' : 'none';
    if (mode === 'drone') {
      this.elHint.innerHTML = `
        <span><b>WASD</b> Полёт по 4×4 км</span>
        <span><b>Мышь (зажать ЛКМ)</b> Обзор</span>
        <span><b>E / Q</b> Вверх / Вниз</span>
        <span><b>Shift</b> Турбо 210 м/с</span>
        <span><b>V</b> Вернуться в Ferrari</span>
        <span><b>M</b> Карта мира</span>
      `;
    } else if (mode === 'tour') {
      this.elHint.innerHTML = `
        <span><b>Кинематографический облет</b> всех ключевых биомов открытого мира 4×4 км</span>
        <span><b>V</b> Управление Ferrari</span>
        <span><b>M</b> Карта мира</span>
      `;
    } else {
      this.elHint.innerHTML = `
        <span><b>WASD / Стрелки</b> Газ и руль</span>
        <span><b>Пробел</b> Ручник / Дрифт</span>
        <span><b>Shift</b> Нитро</span>
        <span><b>C</b> Камера</span>
        <span><b>H</b> Фары</span>
        <span><b>R</b> На дорогу</span>
        <span><b>M</b> Карта мира</span>
      `;
    }
  }

  toggleMap(open) {
    this.mapOpen = open;
    this.elMapModal.classList.toggle('hidden', !open);
    if (open) this._drawFullMap();
  }

  showDistrictBanner(title, subtitle) {
    this.elBannerTitle.textContent = title.toUpperCase();
    this.elBannerSub.textContent = subtitle;
    this.elBanner.classList.add('visible');
    this.bannerTimer = 4.2;
  }

  _drawFullMap() {
    const ctx = this.fullMapCtx;
    const S = 768;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.worldMapCanvas, 0, 0);

    const toPx = (wx) => ((wx + HALF_WORLD) / WORLD_SIZE) * S;
    const toPy = (wz) => ((wz + HALF_WORLD) / WORLD_SIZE) * S;

    // Scale Bar (1 km)
    const barLen = (1000 / WORLD_SIZE) * S;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.fillRect(18, S - 44, barLen + 24, 28);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(30, S - 26);
    ctx.lineTo(30 + barLen, S - 26);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText('1.0 КМ', 30 + barLen * 0.38, S - 31);

    // Landmark pins
    for (const lm of LANDMARKS) {
      const lx = toPx(lm.x);
      const ly = toPy(lm.z);
      ctx.beginPath();
      ctx.arc(lx, ly, 12, 0, Math.PI * 2);
      ctx.fillStyle = lm.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillStyle = 'rgba(10, 14, 23, 0.82)';
      const w = ctx.measureText(lm.name).width + 12;
      ctx.fillRect(lx - w * 0.5, ly + 15, w, 19);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(lm.name, lx, ly + 29);
    }
    ctx.textAlign = 'start';

    // Current Player Marker
    const focus = this.car.mode === 'drive' ? this.car.pos : this.car.camera.position;
    const px = toPx(focus.x);
    const py = toPy(focus.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-this.car.heading + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fillStyle = '#05d9e8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();
    ctx.restore();
  }

  _drawMinimap(focusX, focusZ, heading) {
    const ctx = this.minimapCtx;
    const W = 210;
    const R = W * 0.5;
    ctx.clearRect(0, 0, W, W);

    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 3, 0, Math.PI * 2);
    ctx.clip();

    const mapS = this.worldMapCanvas.width;
    const srcX = ((focusX + HALF_WORLD) / WORLD_SIZE) * mapS;
    const srcY = ((focusZ + HALF_WORLD) / WORLD_SIZE) * mapS;
    // Show ~950m diameter on radar
    const viewSpanPx = (950 / WORLD_SIZE) * mapS;

    ctx.fillStyle = '#18241d';
    ctx.fillRect(0, 0, W, W);

    ctx.drawImage(
      this.worldMapCanvas,
      srcX - viewSpanPx * 0.5,
      srcY - viewSpanPx * 0.5,
      viewSpanPx,
      viewSpanPx,
      0,
      0,
      W,
      W
    );

    // Landmark dots in radar range
    for (const lm of LANDMARKS) {
      const dx = ((lm.x - focusX) / 950) * W;
      const dz = ((lm.z - focusZ) / 950) * W;
      if (dx * dx + dz * dz < (R - 10) * (R - 10)) {
        ctx.beginPath();
        ctx.arc(R + dx, R + dz, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = lm.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Player heading arrow in center
    ctx.translate(R, R);
    // In world: +X right, +Z down on canvas; heading=0 -> +Z (down), heading=PI/2 -> +X (right)
    const canvasRot = Math.atan2(Math.sin(heading), Math.cos(heading));
    ctx.rotate(-canvasRot + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#05d9e8';
    ctx.fill();
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.restore();
  }

  update(dt) {
    const focus = this.car.mode === 'drive' ? this.car.pos : this.car.camera.position;
    this.elCoords.textContent = `${Math.round(focus.x)} м, ${Math.round(focus.z)} м • выс. ${Math.round(focus.y)} м`;

    // Check Landmark Discovery Banner
    for (const lm of LANDMARKS) {
      const d = Math.hypot(focus.x - lm.x, focus.z - lm.z);
      if (d < lm.radius && this.activeDistrictId !== lm.id) {
        this.activeDistrictId = lm.id;
        this.showDistrictBanner(lm.name, lm.subtitle);
        break;
      }
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.elBanner.classList.remove('visible');
      }
    }

    // Update Speedometer & Tachometer
    if (this.car.mode === 'drive') {
      const kmh = Math.round(Math.abs(this.car.speed) * 3.6);
      this.elSpeedVal.textContent = String(kmh);
      this.elGear.textContent = this.car.gear === -1 ? 'R' : kmh === 0 ? 'N' : String(this.car.gear);
      this.elSurface.textContent = this.car.currentSurface;
      this.elOdo.textContent = `${this.car.totalDistanceKm.toFixed(2)} км`;

      const rpmNorm = Math.max(0.06, Math.min(1.0, (this.car.rpm - 900) / 7900));
      const dashLen = 282;
      this.elRpmArc.setAttribute('stroke-dashoffset', String((1.0 - rpmNorm) * dashLen));
      this.elDriftTag.classList.toggle('show', this.car.isDrifting);
    }

    const heading = this.car.mode === 'drive' ? this.car.heading : (-this.car.droneYaw + Math.PI);
    this._drawMinimap(focus.x, focus.z, heading);
  }
}
