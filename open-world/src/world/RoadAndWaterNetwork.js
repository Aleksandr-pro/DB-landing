import * as THREE from 'three';
import { fbm2D, ridged2D, noise2D, smoothstep, lerp } from './Noise.js';
import { WORLD_SIZE, HALF_WORLD, LAKE_WATER_Y, POND_WATER_Y } from './WorldConfig.js';

// Road surface types
export const ROAD_NONE = 0;
export const ROAD_HIGHWAY = 1;
export const ROAD_COUNTRY = 2;
export const ROAD_COBBLESTONE = 3;
export const ROAD_TRAIL = 4;

const GRID_RES = 1024; // 3.90625m per cell across 4000m x 4000m

export class RoadAndWaterNetwork {
  constructor() {
    this.gridRes = GRID_RES;
    this.cellSize = WORLD_SIZE / GRID_RES;

    // Spatial lookup arrays (1024 x 1024)
    const total = GRID_RES * GRID_RES;
    this.roadDist = new Float32Array(total).fill(9999);
    this.roadHeight = new Float32Array(total);
    this.roadHalfW = new Float32Array(total);
    this.roadType = new Uint8Array(total);
    this.bridgeMask = new Float32Array(total); // 0 = ground road, 1 = elevated bridge deck

    this.riverDist = new Float32Array(total).fill(9999);
    this.riverWaterY = new Float32Array(total);
    this.riverHalfW = new Float32Array(total);

    // Flattened plot zones (village homesteads, festival hub, marina, farmyards)
    this.plotBlend = new Float32Array(total);
    this.plotTargetY = new Float32Array(total);
    this.plotType = new Uint8Array(total); // 1=village, 2=festival, 3=farm, 4=marina

    this.roads = [];
    this.rivers = [];
    this.bridges = [];
    this.plots = [];

    this._buildWaterSplines();
    this._rasterizeRivers();
    this._registerFlattenedDistricts();
    this._buildRoadSplines();
    this._solveRoadElevationsAndBridges();
    this._rasterizeRoads();
  }

  // ---------- 1. BASE GEOMORPHOLOGY (4x4 km + Distant Horizon) ----------
  getBaseLandHeight(x, z) {
    // Gentle valley bowl + rolling hills
    const nx = x * 0.00055;
    const nz = z * 0.00055;

    const rolling = fbm2D(nx + 3.1, nz - 1.7, 5) * 20.0;
    const micro = fbm2D(x * 0.0032, z * 0.0032, 3) * 2.6;
    let h = 16.5 + rolling + micro;

    // Northern Highland Mountain Range (z < -850 rising smoothly northward)
    const northFactor = smoothstep(-820, -1920, z);
    if (northFactor > 0) {
      const ridge = ridged2D(x * 0.0009 + 4.2, z * 0.0009 - 2.1, 4) * 95.0;
      const foothills = (fbm2D(x * 0.0014, z * 0.0014, 4) * 0.5 + 0.5) * 48.0;
      // Carve a scenic driveable mountain pass around (-320, -1560)
      const passDist = Math.hypot((x + 280) * 0.7, z + 1540);
      const passDip = 1.0 - 0.36 * (1.0 - smoothstep(140, 620, passDist));
      h += northFactor * (32.0 + (ridge + foothills) * passDip);
    }

    // Western Cliff Bluffs framing Emerald Lake & SW Oak Hills
    const westFactor = smoothstep(-980, -1880, x);
    if (westFactor > 0) {
      const bluff = ridged2D(x * 0.0011 - 1.3, z * 0.0011 + 5.4, 4) * 58.0;
      h += westFactor * (14.0 + bluff);
    }

    // Silverpine Forest rolling hills in NE (x > 550, z < -250)
    const neFactor = smoothstep(450, 1450, x) * smoothstep(-180, -1100, z);
    if (neFactor > 0) {
      const pineHills = (fbm2D(x * 0.0013 + 7.7, z * 0.0013, 4) * 0.5 + 0.5) * 34.0;
      h += neFactor * pineHills;
    }

    // Whispering Oaks undulating terrain in SW (x < -450, z > 350)
    const swFactor = smoothstep(-380, -1350, x) * smoothstep(280, 1300, z);
    if (swFactor > 0) {
      const oakHills = (fbm2D(x * 0.0015 - 3.3, z * 0.0015 + 2.2, 4) * 0.5 + 0.5) * 26.0;
      h += swFactor * oakHills;
    }

    // Distant Perimeter Horizon Mountains outside [-1950, +1950] so world feels boundless
    const edgeDist = Math.max(Math.abs(x), Math.abs(z));
    if (edgeDist > 1860) {
      const rim = smoothstep(1860, 3400, edgeDist);
      const peaks = ridged2D(x * 0.00065 + 9.1, z * 0.00065 - 4.4, 4) * 190.0;
      h += rim * (26.0 + peaks);
    }

    // Flatten Village sunny river-bend terrace around (210, -30)
    const vilDist = Math.hypot((x - 215) * 0.82, z + 30);
    const vilFlat = 1.0 - smoothstep(160, 420, vilDist);
    if (vilFlat > 0) {
      h = lerp(h, 15.6 + noise2D(x * 0.004, z * 0.004) * 0.7, vilFlat * 0.88);
    }

    // Flatten Horizon Festival plateau around (-480, 560)
    const festDist = Math.hypot(x + 480, z - 560);
    const festFlat = 1.0 - smoothstep(130, 340, festDist);
    if (festFlat > 0) {
      h = lerp(h, 17.5, festFlat * 0.92);
    }

    // Golden Plains gentle open farmland slope around (860, 560)
    const farmDist = Math.hypot((x - 860) * 0.75, (z - 580) * 0.75);
    const farmFlat = 1.0 - smoothstep(240, 680, farmDist);
    if (farmFlat > 0) {
      const gentleRoll = Math.sin(x * 0.005) * 2.2 + Math.cos(z * 0.0045) * 1.8;
      h = lerp(h, 16.8 + gentleRoll, farmFlat * 0.72);
    }

    return h;
  }

  // ---------- 2. LAKE, POND & RIVER BASIN FUNCTIONS ----------
  getLakeSignedFactor(x, z) {
    // Organic multi-lobe alpine valley lake centered around (-760, -560)
    const warp = fbm2D(x * 0.0038 + 1.9, z * 0.0038 - 2.6, 3) * 0.18;
    const d1 = Math.hypot((x + 740) / 415, (z + 560) / 305) + warp;
    const d2 = Math.hypot((x + 1020) / 245, (z + 390) / 210) + warp * 0.8;
    const d3 = Math.hypot((x + 495) / 215, (z + 405) / 185) + warp * 0.7; // Marina bay
    return Math.min(d1, d2, d3); // < 1.0 means inside water shoreline!
  }

  getPondSignedFactor(x, z) {
    // Willow Forest Pond in Silverpine Woods at (1015, -675)
    const warp = noise2D(x * 0.011, z * 0.011) * 0.14;
    return Math.hypot((x - 1015) / 128, (z + 675) / 98) + warp;
  }

  _buildWaterSplines() {
    // Silver River: flows from Northern Gorge -> near Lake -> past Village -> Southern Delta
    const mainRiverPts = [
      [290, 0, -2050],
      [210, 0, -1620],
      [85, 0, -1240],
      [-95, 0, -890],
      [-235, 0, -560],
      [-190, 0, -260],
      [-55, 0, 125],   // Riverbend Stone Viaduct crossing!
      [145, 0, 390],
      [480, 0, 720],
      [665, 0, 1215],  // Southern Highway crossing!
      [1040, 0, 1620],
      [1380, 0, 2050],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));

    const outletPts = [
      [-520, 0, -455], // From Emerald Lake SE bay
      [-355, 0, -495], // Lake Outlet Stone Bridge crossing!
      [-235, 0, -560], // Joins Silver River
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));

    this.rivers.push({
      id: 'silver_river',
      curve: new THREE.CatmullRomCurve3(mainRiverPts, false, 'catmullrom', 0.45),
      samples: 1800,
      widthFn: (t) => lerp(14, 23, smoothstep(0.0, 0.85, t)), // half-width 14m..23m (28m..46m wide!)
      waterYFn: (t) => {
        if (t < 0.36) return lerp(24.0, LAKE_WATER_Y, smoothstep(0.0, 0.36, t));
        return lerp(LAKE_WATER_Y, 2.8, smoothstep(0.36, 1.0, t));
      },
    });

    this.rivers.push({
      id: 'lake_outlet',
      curve: new THREE.CatmullRomCurve3(outletPts, false, 'catmullrom', 0.45),
      samples: 320,
      widthFn: () => 13.5,
      waterYFn: () => LAKE_WATER_Y,
    });
  }

  _rasterizeRivers() {
    const pt = new THREE.Vector3();
    for (const rv of this.rivers) {
      for (let i = 0; i <= rv.samples; i++) {
        const t = i / rv.samples;
        rv.curve.getPoint(t, pt);
        const hw = rv.widthFn(t);
        const wy = rv.waterYFn(t);
        const maxR = hw + 48.0;

        const gx0 = Math.max(0, Math.floor((pt.x + HALF_WORLD - maxR) / this.cellSize));
        const gx1 = Math.min(GRID_RES - 1, Math.ceil((pt.x + HALF_WORLD + maxR) / this.cellSize));
        const gz0 = Math.max(0, Math.floor((pt.z + HALF_WORLD - maxR) / this.cellSize));
        const gz1 = Math.min(GRID_RES - 1, Math.ceil((pt.z + HALF_WORLD + maxR) / this.cellSize));

        for (let gz = gz0; gz <= gz1; gz++) {
          const wz = -HALF_WORLD + (gz + 0.5) * this.cellSize;
          const dz = wz - pt.z;
          const row = gz * GRID_RES;
          for (let gx = gx0; gx <= gx1; gx++) {
            const wx = -HALF_WORLD + (gx + 0.5) * this.cellSize;
            const d = Math.hypot(wx - pt.x, dz);
            const idx = row + gx;
            if (d < this.riverDist[idx]) {
              this.riverDist[idx] = d;
              this.riverWaterY[idx] = wy;
              this.riverHalfW[idx] = hw;
            }
          }
        }
      }
    }
  }

  _sampleGridBilinear(arr, x, z) {
    const fx = (x + HALF_WORLD) / this.cellSize - 0.5;
    const fz = (z + HALF_WORLD) / this.cellSize - 0.5;
    const x0 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(GRID_RES - 1, Math.floor(fz)));
    const x1 = Math.min(GRID_RES - 1, x0 + 1);
    const z1 = Math.min(GRID_RES - 1, z0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));

    const v00 = arr[z0 * GRID_RES + x0];
    const v10 = arr[z0 * GRID_RES + x1];
    const v01 = arr[z1 * GRID_RES + x0];
    const v11 = arr[z1 * GRID_RES + x1];
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tz);
  }

  _nearestGridIdx(x, z) {
    const gx = Math.max(0, Math.min(GRID_RES - 1, Math.floor((x + HALF_WORLD) / this.cellSize)));
    const gz = Math.max(0, Math.min(GRID_RES - 1, Math.floor((z + HALF_WORLD) / this.cellSize)));
    return gz * GRID_RES + gx;
  }

  // Terrain with Lake, Pond, and River basins carved (before road embankments)
  getWaterCarvedHeight(x, z) {
    let h = this.getBaseLandHeight(x, z);

    // 1. Emerald Lake Basin
    const lf = this.getLakeSignedFactor(x, z);
    if (lf < 1.38) {
      // Shore transition [1.0 .. 1.38] -> slopes smoothly down to LAKE_WATER_Y + 0.2
      const shoreBlend = 1.0 - smoothstep(0.96, 1.38, lf);
      const depth = smoothstep(1.0, 0.25, lf) * 10.5;
      const basinY = LAKE_WATER_Y + 0.35 - (lf < 1.0 ? 0.55 + depth : 0.0);
      h = lerp(h, basinY, shoreBlend);
    }

    // 2. Willow Forest Pond Basin
    const pf = this.getPondSignedFactor(x, z);
    if (pf < 1.45) {
      const pondBlend = 1.0 - smoothstep(0.95, 1.45, pf);
      const depth = smoothstep(1.0, 0.2, pf) * 4.8;
      const basinY = POND_WATER_Y + 0.3 - (pf < 1.0 ? 0.45 + depth : 0.0);
      h = lerp(h, basinY, pondBlend);
    }

    // 3. Silver River Valley & Carved Channel
    const rDist = this._sampleGridBilinear(this.riverDist, x, z);
    if (rDist < 62.0) {
      const rWaterY = this._sampleGridBilinear(this.riverWaterY, x, z);
      const rHalfW = Math.max(12.0, this._sampleGridBilinear(this.riverHalfW, x, z));
      // Gentle river bank slope from rHalfW + 38m down to channel bed
      const bankBlend = 1.0 - smoothstep(rHalfW - 2.0, rHalfW + 38.0, rDist);
      const inChannel = 1.0 - smoothstep(rHalfW * 0.55, rHalfW + 1.5, rDist);
      const bedY = rWaterY + 0.5 - inChannel * 3.8;
      h = lerp(h, Math.min(h, bedY), bankBlend);
    }

    return h;
  }

  getWaterInfo(x, z) {
    const lf = this.getLakeSignedFactor(x, z);
    if (lf < 1.02) {
      return { inWater: true, waterY: LAKE_WATER_Y, kind: 'lake' };
    }
    const pf = this.getPondSignedFactor(x, z);
    if (pf < 1.02) {
      return { inWater: true, waterY: POND_WATER_Y, kind: 'pond' };
    }
    const rDist = this._sampleGridBilinear(this.riverDist, x, z);
    const rHalfW = this._sampleGridBilinear(this.riverHalfW, x, z);
    if (rDist < rHalfW + 0.8) {
      const rWaterY = this._sampleGridBilinear(this.riverWaterY, x, z);
      return { inWater: true, waterY: rWaterY, kind: 'river' };
    }
    return { inWater: false, waterY: -999, kind: 'none' };
  }

  _registerFlattenedDistricts() {
    // Register Marina waterfront terrace on SE shore of Emerald Lake
    this._stampPlot(-365, -315, 58, 95, LAKE_WATER_Y + 1.45, 4);
  }

  _stampPlot(cx, cz, innerR, outerR, targetY, typeId) {
    this.plots.push({ cx, cz, innerR, outerR, targetY, typeId });
    const gx0 = Math.max(0, Math.floor((cx + HALF_WORLD - outerR) / this.cellSize));
    const gx1 = Math.min(GRID_RES - 1, Math.ceil((cx + HALF_WORLD + outerR) / this.cellSize));
    const gz0 = Math.max(0, Math.floor((cz + HALF_WORLD - outerR) / this.cellSize));
    const gz1 = Math.min(GRID_RES - 1, Math.ceil((cz + HALF_WORLD + outerR) / this.cellSize));

    for (let gz = gz0; gz <= gz1; gz++) {
      const wz = -HALF_WORLD + (gz + 0.5) * this.cellSize;
      const row = gz * GRID_RES;
      for (let gx = gx0; gx <= gx1; gx++) {
        const wx = -HALF_WORLD + (gx + 0.5) * this.cellSize;
        const d = Math.hypot(wx - cx, wz - cz);
        if (d < outerR) {
          const w = 1.0 - smoothstep(innerR, outerR, d);
          const idx = row + gx;
          if (w > this.plotBlend[idx]) {
            this.plotBlend[idx] = w;
            this.plotTargetY[idx] = targetY;
            this.plotType[idx] = typeId;
          }
        }
      }
    }
  }

  // ---------- 3. COMPLETE 4-TIER ROAD & FOREST TRAIL NETWORK ----------
  _buildRoadSplines() {
    const addRoad = (id, name, type, width, closed, pts2d, snapStart = null, snapEnd = null) => {
      const pts = pts2d.map(([x, z]) => new THREE.Vector3(x, 0, z));
      const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.45);
      const length = curve.getLength();
      const count = Math.max(24, Math.ceil(length / 2.2));
      const nodes = [];
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const p = curve.getPointAt(t);
        const tan = curve.getTangentAt(t);
        nodes.push({
          x: p.x,
          z: p.z,
          y: 0,
          tx: tan.x,
          tz: tan.z,
          t,
          isBridge: false,
          groundY: 0,
        });
      }
      const road = { id, name, type, width, halfW: width * 0.5, closed, curve, length, nodes, snapStart, snapEnd };
      this.roads.push(road);
      return road;
    };

    // TIER 1: HORIZON RING HIGHWAY M1 (~11.8 km closed scenic loop!)
    addRoad('m1_highway', 'Шоссе Горизонт M1', ROAD_HIGHWAY, 12.6, true, [
      [-480, 560],    // Horizon Festival Hub
      [-940, 420],    // SW Approach
      [-1360, -40],   // West Valley Rise
      [-1340, -640],  // West Emerald Cliff Overlook
      [-980, -1240],  // NW Foothills Climb
      [-320, -1560],  // Highland Mountain Pass Vista
      [215, -1565],   // Northern Gorge High Viaduct over Silver River!
      [880, -1380],   // NE Highland Descent
      [1380, -920],   // Silverpine East Rim
      [1510, -240],   // East Valley Sweep
      [1440, 320],    // Farmland East Junction
      [1140, 920],    // Golden Plains Curve
      [665, 1215],    // Southern River Bridge!
      [60, 1080],     // South Meadow Straight (Top Speed Zone!)
    ]);

    // TIER 2: ARTERIAL COUNTRY ASPHALT ROADS (8.0m wide)
    // 2A. Central Valley Road: Festival Hub -> Riverbend Viaduct -> Oakwood Village -> Windmill Farm -> East M1
    addRoad('valley_arterial', 'Долинный Тракт', ROAD_COUNTRY, 8.2, false, [
      [-480, 560],
      [-260, 350],
      [-55, 125],     // Riverbend Stone Viaduct over Silver River!
      [75, 15],
      [180, -42],     // Oakwood Village Central Square
      [410, 45],
      [650, 240],
      [840, 425],     // Golden Plains Windmill Farm
      [1150, 395],
      [1440, 320],
    ], 'm1_highway', 'm1_highway');

    // 2B. Lakeshore Scenic Road: Oakwood Village -> Emerald Marina -> Lake Outlet Bridge -> Highland Pass
    addRoad('lakeshore_road', 'Озёрное Шоссе', ROAD_COUNTRY, 7.8, false, [
      [180, -42],
      [-40, -165],
      [-235, -245],
      [-355, -315],   // Emerald Lake Marina Promenade!
      [-355, -495],   // Lake Outlet Stone Bridge!
      [-285, -720],   // Dry Scenic Ridge between Lake & Gorge
      [-215, -1120],
      [-320, -1560],
    ], 'valley_arterial', 'm1_highway');

    // 2C. Silverpine North Connector: Oakwood Village -> Silverpine Forest Crossroads -> NE Highway
    addRoad('silverpine_road', 'Северный Тракт', ROAD_COUNTRY, 7.6, false, [
      [180, -42],
      [290, -220],
      [485, -430],
      [760, -780],
      [880, -1380],
    ], 'valley_arterial', 'm1_highway');

    // TIER 3: OAKWOOD VILLAGE COBBLESTONE STREETS (6.4m wide)
    // 3A. Residential Garden Ring around Oakwood Village
    addRoad('village_ring', 'Улица Садовая', ROAD_COBBLESTONE, 6.4, true, [
      [75, -145],
      [185, -178],
      [315, -148],
      [355, -42],
      [315, 72],
      [185, 96],
      [82, 58],
      [52, -45],
    ]);

    // 3B. North Orchard Lane in Oakwood Village
    addRoad('village_orchard_lane', 'Яблоневый Переулок', ROAD_COBBLESTONE, 5.8, false, [
      [180, -42],
      [185, -178],
      [190, -295],
    ], 'valley_arterial', null);

    // TIER 4: FOREST DIRT ROADS & WOODLAND RALLY TRAILS (3.8m - 4.4m wide)
    // 4A. Silverpine Firewatch & Willow Pond Trail Loop (NE Forest)
    addRoad('silverpine_firewatch_trail', 'Тропа Серебряного Бора', ROAD_TRAIL, 4.3, false, [
      [485, -430],
      [740, -520],
      [960, -535],    // Skirts South Shore of Willow Forest Pond!
      [1185, -620],
      [1315, -765],   // Firewatch Lookout Tower Clearing!
      [1210, -960],
      [980, -940],
      [760, -780],
    ], 'silverpine_road', 'silverpine_road');

    // 4B. Deep Pine Ridge Trail (NE Forest)
    addRoad('deep_pine_trail', 'Хвойная Лесная Тропа', ROAD_TRAIL, 3.8, false, [
      [760, -780],
      [610, -980],
      [510, -1210],
      [720, -1260],
      [980, -940],
    ], 'silverpine_road', 'silverpine_firewatch_trail');

    // 4C. Whispering Oaks Forest Rally Trail (SW Forest)
    addRoad('whispering_oaks_trail', 'Тропа Дубовой Рощи', ROAD_TRAIL, 4.4, false, [
      [-940, 420],
      [-1140, 680],
      [-1420, 980],
      [-1240, 1340],  // Forest Ranger Cabin & Glade!
      [-820, 1360],
      [-420, 1180],
      [60, 1080],
    ], 'm1_highway', 'm1_highway');

    // 4D. Woodland Creek Shortcut Path (SW Forest)
    addRoad('oak_creek_path', 'Лесной Ручейный Путь', ROAD_TRAIL, 3.6, false, [
      [-1140, 680],
      [-860, 820],
      [-740, 1080],
      [-820, 1360],
    ], 'whispering_oaks_trail', 'whispering_oaks_trail');

    // 4E. Golden Farmland Country Track (SE Pastures & Barns)
    addRoad('farmland_track', 'Полевой Мельничный Путь', ROAD_TRAIL, 4.2, false, [
      [840, 425],
      [945, 670],
      [885, 920],
      [665, 1215],
    ], 'valley_arterial', 'm1_highway');
  }

  _findClosestNodeY(roadId, x, z) {
    const target = this.roads.find((r) => r.id === roadId);
    if (!target) return null;
    let bestD = Infinity;
    let bestY = 0;
    for (const n of target.nodes) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bestD) {
        bestD = d;
        bestY = n.y;
      }
    }
    return bestY;
  }

  _solveRoadElevationsAndBridges() {
    // Step 1: Initialize each road node from water-carved terrain, lifting over rivers/water
    for (const road of this.roads) {
      const clearance = road.type === ROAD_HIGHWAY ? 7.8 : road.type === ROAD_COUNTRY ? 6.4 : 4.2;
      for (const n of road.nodes) {
        let gy = this.getWaterCarvedHeight(n.x, n.z);
        const idx = this._nearestGridIdx(n.x, n.z);
        if (this.plotBlend[idx] > 0.25) {
          gy = lerp(gy, this.plotTargetY[idx], this.plotBlend[idx]);
        }
        n.groundY = gy;

        const wInfo = this.getWaterInfo(n.x, n.z);
        // Also check slightly wider river corridor so bridge abutments start cleanly on dry banks!
        const rDist = this._sampleGridBilinear(this.riverDist, n.x, n.z);
        const rHalfW = this._sampleGridBilinear(this.riverHalfW, n.x, n.z);
        if (wInfo.inWater) {
          n.y = Math.max(gy, wInfo.waterY + clearance);
          n.minDeckY = wInfo.waterY + clearance;
        } else if (rDist < rHalfW + 14.0) {
          const rWY = this._sampleGridBilinear(this.riverWaterY, n.x, n.z);
          const ramp = 1.0 - smoothstep(rHalfW, rHalfW + 14.0, rDist);
          n.minDeckY = lerp(-999, rWY + clearance * 0.92, ramp);
          n.y = Math.max(gy, n.minDeckY);
        } else {
          n.minDeckY = -999;
          n.y = gy + 0.14; // Slight crown above grade for clean drainage!
        }
      }

      // Smooth longitudinal elevation profile (45 passes) while respecting bridge clearance & junctions
      const N = road.nodes.length;
      const tmp = new Float32Array(N);
      for (let iter = 0; iter < 48; iter++) {
        for (let i = 0; i < N; i++) {
          let prevIdx = i - 1;
          let nextIdx = i + 1;
          if (road.closed) {
            prevIdx = (i - 1 + N - 1) % (N - 1);
            nextIdx = (i + 1) % (N - 1);
          } else {
            if (i === 0) {
              const snapY = road.snapStart ? this._findClosestNodeY(road.snapStart, road.nodes[0].x, road.nodes[0].z) : null;
              tmp[0] = snapY !== null ? snapY : road.nodes[0].y;
              continue;
            }
            if (i === N - 1) {
              const snapY = road.snapEnd ? this._findClosestNodeY(road.snapEnd, road.nodes[N - 1].x, road.nodes[N - 1].z) : null;
              tmp[N - 1] = snapY !== null ? snapY : road.nodes[N - 1].y;
              continue;
            }
          }
          const avg = 0.28 * road.nodes[prevIdx].y + 0.44 * road.nodes[i].y + 0.28 * road.nodes[nextIdx].y;
          tmp[i] = Math.max(road.nodes[i].minDeckY, avg);
        }
        for (let i = 0; i < N; i++) road.nodes[i].y = tmp[i];
        if (road.closed) road.nodes[N - 1].y = road.nodes[0].y;
      }

      // Snap village ring intersections gently toward valley_arterial where they cross
      if (road.id === 'village_ring') {
        for (let pass = 0; pass < 12; pass++) {
          for (let i = 0; i < N; i++) {
            const n = road.nodes[i];
            const dArt = Math.hypot(n.x - 75, n.z - 15);
            const dArt2 = Math.hypot(n.x - 355, n.z + 42);
            if (dArt < 28 || dArt2 < 28) {
              const targetY = this._findClosestNodeY('valley_arterial', n.x, n.z);
              if (targetY !== null) n.y = lerp(n.y, targetY, 0.55);
            }
          }
          for (let i = 0; i < N; i++) {
            const prev = (i - 1 + N - 1) % (N - 1);
            const next = (i + 1) % (N - 1);
            tmp[i] = 0.25 * road.nodes[prev].y + 0.5 * road.nodes[i].y + 0.25 * road.nodes[next].y;
          }
          for (let i = 0; i < N; i++) road.nodes[i].y = tmp[i];
          road.nodes[N - 1].y = road.nodes[0].y;
        }
      }

      // Detect bridge spans (where road deck stands > 2.3m above carved riverbed/water)
      let currentSpan = null;
      for (let i = 0; i < N; i++) {
        const n = road.nodes[i];
        const wInfo = this.getWaterInfo(n.x, n.z);
        const rDist = this._sampleGridBilinear(this.riverDist, n.x, n.z);
        const rHalfW = this._sampleGridBilinear(this.riverHalfW, n.x, n.z);
        const overRiverZone = wInfo.inWater || rDist < rHalfW + 8.5;
        if (overRiverZone && n.y - n.groundY > 2.0) {
          n.isBridge = true;
          if (!currentSpan) {
            currentSpan = { road, startIdx: Math.max(0, i - 2), endIdx: i, nodes: [] };
          }
          currentSpan.endIdx = Math.min(N - 1, i + 2);
        } else if (currentSpan) {
          this.bridges.push(currentSpan);
          currentSpan = null;
        }
      }
      if (currentSpan) this.bridges.push(currentSpan);
    }

    for (const br of this.bridges) {
      for (let i = br.startIdx; i <= br.endIdx; i++) {
        br.road.nodes[i].isBridge = true;
        br.nodes.push(br.road.nodes[i]);
      }
    }
  }

  _rasterizeRoads() {
    // Rasterize in priority order: trails -> cobblestone -> country -> highway (higher priority wins close to centerline)
    const sorted = [...this.roads].sort((a, b) => b.type - a.type); // 4 -> 3 -> 2 -> 1 so highway overwrites last if closer
    for (const road of sorted) {
      const shoulder = road.type === ROAD_HIGHWAY ? 16.0 : road.type === ROAD_COUNTRY ? 11.5 : 8.0;
      const maxR = road.halfW + shoulder;

      for (const n of road.nodes) {
        const gx0 = Math.max(0, Math.floor((n.x + HALF_WORLD - maxR) / this.cellSize));
        const gx1 = Math.min(GRID_RES - 1, Math.ceil((n.x + HALF_WORLD + maxR) / this.cellSize));
        const gz0 = Math.max(0, Math.floor((n.z + HALF_WORLD - maxR) / this.cellSize));
        const gz1 = Math.min(GRID_RES - 1, Math.ceil((n.z + HALF_WORLD + maxR) / this.cellSize));

        for (let gz = gz0; gz <= gz1; gz++) {
          const wz = -HALF_WORLD + (gz + 0.5) * this.cellSize;
          const dz = wz - n.z;
          const row = gz * GRID_RES;
          for (let gx = gx0; gx <= gx1; gx++) {
            const wx = -HALF_WORLD + (gx + 0.5) * this.cellSize;
            const d = Math.hypot(wx - n.x, dz);
            if (d > maxR) continue;
            const idx = row + gx;

            // Normalize effective margin outside pavement edge so wider highways properly dominate junctions
            const edgeDist = d - road.halfW;
            const prevEdgeDist = this.roadDist[idx] - this.roadHalfW[idx];

            if (edgeDist < prevEdgeDist) {
              this.roadDist[idx] = d;
              this.roadHeight[idx] = n.y;
              this.roadHalfW[idx] = road.halfW;
              this.roadType[idx] = road.type;
              this.bridgeMask[idx] = n.isBridge ? 1.0 : 0.0;
            }
          }
        }
      }
    }
  }

  // ---------- 4. FINAL UNIFIED TERRAIN & ROAD QUERIES ----------
  getTerrainHeight(x, z) {
    let h = this.getWaterCarvedHeight(x, z);

    // Flattened district plots (Marina, Homesteads)
    const pBlend = this._sampleGridBilinear(this.plotBlend, x, z);
    if (pBlend > 0.001) {
      const pY = this._sampleGridBilinear(this.plotTargetY, x, z);
      h = lerp(h, pY, pBlend);
    }

    // Road embankment & cutting blend (EXCEPT underneath elevated bridge spans!)
    const rDist = this._sampleGridBilinear(this.roadDist, x, z);
    if (rDist < 28.0) {
      const bMask = this._sampleGridBilinear(this.bridgeMask, x, z);
      if (bMask < 0.65) {
        const rHalfW = this._sampleGridBilinear(this.roadHalfW, x, z);
        const rY = this._sampleGridBilinear(this.roadHeight, x, z);
        const shoulderOuter = rHalfW + 11.5;
        const roadWeight = (1.0 - smoothstep(rHalfW + 0.8, shoulderOuter, rDist)) * (1.0 - bMask);
        // Terrain sits 0.06m below road surface so ribbon mesh never z-fights
        h = lerp(h, rY - 0.06, roadWeight);
      }
    }

    return h;
  }

  // Drivable height for vehicles (follows elevated bridge decks seamlessly!)
  getDrivableHeight(x, z) {
    const tH = this.getTerrainHeight(x, z);
    const rDist = this._sampleGridBilinear(this.roadDist, x, z);
    const rHalfW = this._sampleGridBilinear(this.roadHalfW, x, z);
    if (rDist <= rHalfW + 1.4) {
      const rY = this._sampleGridBilinear(this.roadHeight, x, z);
      const bMask = this._sampleGridBilinear(this.bridgeMask, x, z);
      if (bMask > 0.25) {
        return Math.max(tH, rY);
      }
      return lerp(tH, rY, 1.0 - smoothstep(rHalfW, rHalfW + 1.4, rDist));
    }
    return tH;
  }

  getTerrainNormal(x, z, out = new THREE.Vector3()) {
    const eps = 1.6;
    const hL = this.getDrivableHeight(x - eps, z);
    const hR = this.getDrivableHeight(x + eps, z);
    const hD = this.getDrivableHeight(x, z - eps);
    const hU = this.getDrivableHeight(x, z + eps);
    out.set(hL - hR, 2.0 * eps, hD - hU).normalize();
    return out;
  }

  getSurfaceAt(x, z) {
    const idx = this._nearestGridIdx(x, z);
    const rDist = this._sampleGridBilinear(this.roadDist, x, z);
    const rHalfW = this._sampleGridBilinear(this.roadHalfW, x, z);
    if (rDist <= rHalfW + 0.6) {
      return {
        roadType: this.roadType[idx],
        isBridge: this.bridgeMask[idx] > 0.5,
        inWater: false,
        waterDepth: 0,
      };
    }
    const wInfo = this.getWaterInfo(x, z);
    if (wInfo.inWater) {
      const th = this.getTerrainHeight(x, z);
      return {
        roadType: ROAD_NONE,
        isBridge: false,
        inWater: true,
        waterY: wInfo.waterY,
        waterDepth: Math.max(0, wInfo.waterY - th),
      };
    }
    return { roadType: ROAD_NONE, isBridge: false, inWater: false, waterDepth: 0 };
  }

  isClearForNature(x, z, margin = 4.0) {
    // Check roads
    const rDist = this._sampleGridBilinear(this.roadDist, x, z);
    const rHalfW = this._sampleGridBilinear(this.roadHalfW, x, z);
    if (rDist < rHalfW + margin) return false;

    // Check water
    const wInfo = this.getWaterInfo(x, z);
    if (wInfo.inWater) return false;

    // Check Festival Hub & Village core plots
    if (Math.hypot(x + 480, z - 560) < 125) return false;
    if (Math.hypot(x + 360, z + 315) < 62) return false;

    return true;
  }

  // Biome densities for trees, grass, farmland
  getForestDensity(x, z) {
    // Silverpine Forest (NE)
    const ne = smoothstep(320, 720, x) * smoothstep(-180, -560, z) * (1.0 - smoothstep(-1420, -1720, z));
    // Whispering Oaks Forest (SW)
    const sw = smoothstep(-320, -760, x) * smoothstep(260, 620, z);
    // NW Lake Forest Rim
    const nw = smoothstep(-620, -1180, x) * smoothstep(-680, -1180, z) * 0.72;
    // Scattered groves elsewhere
    const groves = Math.max(0, fbm2D(x * 0.0022 + 5.1, z * 0.0022 - 3.4, 3) * 0.85);
    return Math.min(1.0, Math.max(ne, sw, nw) + groves * 0.28);
  }

  getFarmlandMask(x, z) {
    // SE Golden Plains & Pastures
    const se = smoothstep(280, 560, x) * smoothstep(80, 320, z) * (1.0 - smoothstep(1380, 1650, x)) * (1.0 - smoothstep(1150, 1450, z));
    return se;
  }
}
