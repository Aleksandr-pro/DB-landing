import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './Noise.js';
import { LAKE_WATER_Y, POND_WATER_Y } from './WorldConfig.js';

export class VillageAndInfrastructure {
  constructor(network, texLoader) {
    this.network = network;
    this.texLoader = texLoader;
    this.colliders = []; // { x, z, r } or { x, z, hx, hz, yaw }
    this.orchardTreeSpots = []; // { x, z } inside village & farm gardens!
    this.horsePastureCenters = [];
    this.animatedObjects = []; // { mesh, type, speed, baseY, phase }
    this.windowGlassMat = null;
    this.festivalNeonMats = [];
  }

  _loadPBR(name, repeatX = 1, repeatY = 1) {
    const col = this.texLoader.load(`/textures/pbr/${name}_color.jpg`);
    const nrm = this.texLoader.load(`/textures/pbr/${name}_normal.jpg`);
    const rgh = this.texLoader.load(`/textures/pbr/${name}_roughness.jpg`);
    for (const t of [col, nrm, rgh]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeatX, repeatY);
      t.anisotropy = 8;
    }
    col.colorSpace = THREE.SRGBColorSpace;
    return { col, nrm, rgh };
  }

  _isSpotClearOfRoadsAndWater(x, z, margin = 12) {
    const rDist = this.network._sampleGridBilinear(this.network.roadDist, x, z);
    const rHalfW = this.network._sampleGridBilinear(this.network.roadHalfW, x, z);
    if (rDist < rHalfW + margin) return false;
    if (this.network.getWaterInfo(x, z).inWater) return false;
    // Also check 4 corners of margin box
    const c = margin * 0.7;
    for (const [dx, dz] of [[-c, -c], [c, -c], [-c, c], [c, c]]) {
      const rd = this.network._sampleGridBilinear(this.network.roadDist, x + dx, z + dz);
      const rw = this.network._sampleGridBilinear(this.network.roadHalfW, x + dx, z + dz);
      if (rd < rw + 3.2) return false;
      if (this.network.getWaterInfo(x + dx, z + dz).inWater) return false;
    }
    return true;
  }

  buildAll(scene) {
    // Shared Architectural PBR Materials
    const stone = this._loadPBR('stonewall', 2.2, 1.4);
    const plaster = this._loadPBR('plaster', 2.0, 1.4);
    const roof = this._loadPBR('rooftiles', 3.2, 2.2);
    const cobble = this._loadPBR('cobblestone', 3.0, 3.0);

    const brickCol = this.texLoader.load('/textures/pbr/brick_color.jpg');
    const brickBump = this.texLoader.load('/textures/pbr/brick_bump.jpg');
    const brickRgh = this.texLoader.load('/textures/pbr/brick_roughness.jpg');
    for (const t of [brickCol, brickBump, brickRgh]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2.5, 1.6);
    }
    brickCol.colorSpace = THREE.SRGBColorSpace;

    const woodCol = this.texLoader.load('/textures/pbr/wood_color.jpg');
    const woodBump = this.texLoader.load('/textures/pbr/wood_bump.jpg');
    for (const t of [woodCol, woodBump]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 2);
    }
    woodCol.colorSpace = THREE.SRGBColorSpace;

    this.mats = {
      stoneWall: new THREE.MeshStandardMaterial({ map: stone.col, normalMap: stone.nrm, roughnessMap: stone.rgh, roughness: 0.78 }),
      plasterWarm: new THREE.MeshStandardMaterial({ map: plaster.col, normalMap: plaster.nrm, roughnessMap: plaster.rgh, color: 0xf6ebd9, roughness: 0.74 }),
      plasterCream: new THREE.MeshStandardMaterial({ map: plaster.col, normalMap: plaster.nrm, roughnessMap: plaster.rgh, color: 0xefe3ce, roughness: 0.74 }),
      plasterSage: new THREE.MeshStandardMaterial({ map: plaster.col, normalMap: plaster.nrm, roughnessMap: plaster.rgh, color: 0xdde5d5, roughness: 0.76 }),
      brickWall: new THREE.MeshStandardMaterial({ map: brickCol, bumpMap: brickBump, bumpScale: 0.04, roughnessMap: brickRgh, roughness: 0.8 }),
      roofTerra: new THREE.MeshStandardMaterial({ map: roof.col, normalMap: roof.nrm, roughnessMap: roof.rgh, roughness: 0.65 }),
      roofSlate: new THREE.MeshStandardMaterial({ map: roof.col, normalMap: roof.nrm, roughnessMap: roof.rgh, color: 0x5c6672, roughness: 0.58 }),
      roofBrown: new THREE.MeshStandardMaterial({ map: roof.col, normalMap: roof.nrm, roughnessMap: roof.rgh, color: 0x8b5a42, roughness: 0.66 }),
      darkTimber: new THREE.MeshStandardMaterial({ map: woodCol, bumpMap: woodBump, bumpScale: 0.02, color: 0x4a3525, roughness: 0.82 }),
      naturalWood: new THREE.MeshStandardMaterial({ map: woodCol, bumpMap: woodBump, bumpScale: 0.02, color: 0x9b7653, roughness: 0.80 }),
      whiteWood: new THREE.MeshStandardMaterial({ map: woodCol, color: 0xedece6, roughness: 0.65 }),
      barnRed: new THREE.MeshStandardMaterial({ map: woodCol, bumpMap: woodBump, bumpScale: 0.03, color: 0x8f241e, roughness: 0.78 }),
      hedge: new THREE.MeshStandardMaterial({ color: 0x2d5426, roughness: 0.92 }),
      gardenSoil: new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.96 }),
      cobblePath: new THREE.MeshStandardMaterial({ map: cobble.col, normalMap: cobble.nrm, roughness: 0.78 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.32, metalness: 0.82 }),
      darkIron: new THREE.MeshStandardMaterial({ color: 0x22272e, roughness: 0.44, metalness: 0.78 }),
      greenhouseGlass: new THREE.MeshPhysicalMaterial({
        color: 0xdcf4ff,
        roughness: 0.12,
        metalness: 0.05,
        transparent: true,
        opacity: 0.46,
      }),
    };

    this.windowGlassMat = new THREE.MeshStandardMaterial({
      color: 0x1e2d3d,
      emissive: 0xffb347,
      emissiveIntensity: 0.15,
      roughness: 0.12,
      metalness: 0.65,
    });

    const root = new THREE.Group();
    root.name = 'WorldSettlementsAndInfra';

    // 1. Oakwood Village (Central Square, Chapel Tower, Fountain + 26 Complete Homesteads!)
    this._buildOakwoodVillage(root);

    // 2. Emerald Lake Marina, Piers & Moored Sailboats
    this._buildEmeraldMarina(root);

    // 3. Golden Plains Stone Windmill, Red Barns, Silos, Hay Bales & Fenced Horse Pastures
    this._buildGoldenPlainsFarms(root);

    // 4. Forest Infrastructure: Silverpine Firewatch Tower, Willow Pond Dock, Ranger Log Cabin, Highland Overlook
    this._buildForestAndHighlandLandmarks(root);

    // 5. Horizon Festival Hub, Highway Arch, Giant Ferris Wheel & Hot Air Balloons
    this._buildHorizonFestivalAndBalloons(root);

    scene.add(root);
  }

  // =========================================================================
  // 1. OAKWOOD VILLAGE (ДЕРЕВНЯ ОЗЁРНАЯ)
  // =========================================================================
  _buildOakwoodVillage(root) {
    const rng = mulberry32(77123);
    const villageGroup = new THREE.Group();
    villageGroup.name = 'OakwoodVillage';

    // A. Central Piazza Fountain & Parish Clock-Tower Church on the Village Green (212, -16)
    if (this._isSpotClearOfRoadsAndWater(216, -12, 11)) {
      const fy = this.network.getTerrainHeight(216, -12);
      const piazza = this._createVillagePiazzaAndFountain();
      piazza.position.set(216, fy, -12);
      villageGroup.add(piazza);
      this.colliders.push({ x: 216, z: -12, r: 4.5 });
    }

    if (this._isSpotClearOfRoadsAndWater(248, -68, 13)) {
      const cy = this.network.getTerrainHeight(248, -68);
      const church = this._createParishChurch();
      church.position.set(248, cy, -68);
      church.rotation.y = -0.35;
      villageGroup.add(church);
      this.colliders.push({ x: 248, z: -68, r: 9.5 });
    }

    // B. Generate Homestead Plots along Village Ring, Orchard Lane, and Valley Arterial approaches!
    const candidateRoads = this.network.roads.filter((r) =>
      r.id === 'village_ring' || r.id === 'village_orchard_lane' || r.id === 'valley_arterial'
    );

    const placedCenters = [
      { x: 216, z: -12, minD: 28 },
      { x: 248, z: -68, minD: 30 },
    ];

    let styleIdx = 0;
    for (const road of candidateRoads) {
      const stepNodes = road.id === 'valley_arterial' ? 14 : 9;
      for (let i = 4; i < road.nodes.length - 4; i += stepNodes) {
        const n = road.nodes[i];
        // On valley_arterial, only place houses within the greater village outskirts (x in [20..560])
        if (road.id === 'valley_arterial' && (n.x < 35 || n.x > 540)) continue;
        if (n.isBridge) continue;

        const yaw = Math.atan2(n.tx, n.tz);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);

        for (const side of [-1, 1]) {
          const plotW = 22 + rng() * 5.5;
          const plotD = 24 + rng() * 6.0;
          const setback = road.halfW + plotD * 0.5 + 3.2;

          const px = n.x + rx * side * setback;
          const pz = n.z + rz * side * setback;

          // Ensure no overlap with roads, water, or already placed homesteads
          if (!this._isSpotClearOfRoadsAndWater(px, pz, Math.max(plotW, plotD) * 0.44)) continue;

          let tooClose = false;
          for (const pc of placedCenters) {
            if (Math.hypot(px - pc.x, pz - pc.z) < pc.minD) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;

          // Check terrain slope isn't extreme
          const hC = this.network.getTerrainHeight(px, pz);
          const h1 = this.network.getTerrainHeight(px + 8, pz);
          const h2 = this.network.getTerrainHeight(px, pz + 8);
          if (Math.abs(h1 - hC) > 2.6 || Math.abs(h2 - hC) > 2.6) continue;

          placedCenters.push({ x: px, z: pz, minD: Math.max(plotW, plotD) * 0.96 });

          // Orient front gate toward the road!
          const faceYaw = Math.atan2(n.x - px, n.z - pz);
          const homestead = this._createCompleteHomestead(px, hC, pz, plotW, plotD, faceYaw, styleIdx++, rng);
          villageGroup.add(homestead);
        }
      }
    }

    this._batchStaticMeshes(villageGroup);
    root.add(villageGroup);
  }

  _batchStaticMeshes(containerGroup) {
    containerGroup.updateMatrixWorld(true);
    const byMat = new Map();
    const toRemove = [];

    containerGroup.traverse((obj) => {
      if (!obj.isMesh || obj.isInstancedMesh) return;
      const geo = obj.geometry.clone();
      // Normalize non-indexed / indexed so mergeGeometries succeeds cleanly
      const nonIdx = geo.index ? geo.toNonIndexed() : geo;
      // Keep only position, normal, uv so ExtrudeGeometry & BoxGeometry match attributes!
      for (const attrName of Object.keys(nonIdx.attributes)) {
        if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
          nonIdx.deleteAttribute(attrName);
        }
      }
      if (!nonIdx.attributes.uv) {
        const cnt = nonIdx.attributes.position.count;
        nonIdx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cnt * 2), 2));
      }
      nonIdx.applyMatrix4(obj.matrixWorld);
      if (!byMat.has(obj.material)) byMat.set(obj.material, []);
      byMat.get(obj.material).push(nonIdx);
      toRemove.push(obj);
    });

    for (const m of toRemove) {
      if (m.parent) m.parent.remove(m);
    }

    for (const [mat, geos] of byMat.entries()) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const batchedMesh = new THREE.Mesh(merged, mat);
      batchedMesh.castShadow = true;
      batchedMesh.receiveShadow = true;
      containerGroup.add(batchedMesh);
    }
  }

  _createPitchedRoofGeometry(width, depth, ridgeHeight, overhang = 0.55) {
    const hw = width * 0.5 + overhang;
    const hd = depth * 0.5 + overhang;
    // Two sloped rectangular roof planes + two gable end triangles (or we build gable walls on house)
    const slopeGroup = new THREE.Group();
    const slopeLen = Math.hypot(hw, ridgeHeight);
    const angle = Math.atan2(ridgeHeight, hw);

    const buildSlope = (side) => {
      const g = new THREE.BoxGeometry(slopeLen, 0.22, hd * 2.0);
      g.translate(side * (slopeLen * 0.5 - 0.06), 0, 0);
      g.rotateZ(-side * angle);
      g.translate(0, ridgeHeight, 0);
      return g;
    };
    return { leftGeo: buildSlope(-1), rightGeo: buildSlope(1), angle, hw, hd };
  }

  _createDetailedHouse(style, rng) {
    const g = new THREE.Group();
    const w = 8.4 + rng() * 2.6;
    const d = 7.2 + rng() * 2.2;
    const wallH = (style % 2 === 0 ? 5.6 : 4.2) + rng() * 0.5; // Mix 2-story & 1.5-story cottages!
    const ridgeH = 2.5 + rng() * 0.8;

    const wallMat = [
      this.mats.stoneWall,
      this.mats.plasterWarm,
      this.mats.brickWall,
      this.mats.plasterCream,
      this.mats.plasterSage,
    ][style % 5];

    const roofMat = [this.mats.roofTerra, this.mats.roofSlate, this.mats.roofBrown][style % 3];
    const trimMat = style % 2 === 0 ? this.mats.darkTimber : this.mats.whiteWood;

    // 1. Stone Foundation Plinth (extends 1.4m underground so sloped yards never show gaps!)
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.35, 1.8, d + 0.35), this.mats.stoneWall);
    plinth.position.y = -0.5;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    g.add(plinth);

    // 2. Main House Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    body.position.y = 0.4 + wallH * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // 3. Gable End Triangles (front & back along Z, or left & right along X)
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-w * 0.5, 0);
    gableShape.lineTo(w * 0.5, 0);
    gableShape.lineTo(0, ridgeH);
    gableShape.closePath();
    const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: d, bevelEnabled: false });
    gableGeo.translate(0, 0.4 + wallH, -d * 0.5);
    const gableMesh = new THREE.Mesh(gableGeo, wallMat);
    gableMesh.castShadow = true;
    gableMesh.receiveShadow = true;
    g.add(gableMesh);

    // 4. Pitched Tile Roof Slopes + Timber Corner Posts
    const { leftGeo, rightGeo } = this._createPitchedRoofGeometry(w, d, ridgeH, 0.62);
    const roofL = new THREE.Mesh(leftGeo, roofMat);
    const roofR = new THREE.Mesh(rightGeo, roofMat);
    roofL.position.y = 0.4 + wallH;
    roofR.position.y = 0.4 + wallH;
    roofL.castShadow = roofR.castShadow = true;
    roofL.receiveShadow = roofR.receiveShadow = true;
    g.add(roofL, roofR);

    // Timber framing accents on Tudor / Cottage houses
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, wallH + 0.05, 0.24), trimMat);
        post.position.set(sx * (w * 0.5 - 0.06), 0.4 + wallH * 0.5, sz * (d * 0.5 - 0.06));
        g.add(post);
      }
    }

    // 5. Chimney with stone cap
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.95, ridgeH + 1.8, 0.95), this.mats.brickWall);
    chim.position.set((rng() > 0.5 ? 1 : -1) * (w * 0.26), 0.4 + wallH + ridgeH * 0.55, -d * 0.18);
    chim.castShadow = true;
    g.add(chim);

    // 6. Covered Front Porch (+Z side faces the gate/street!)
    const porchW = 3.2;
    const porchD = 1.85;
    const porchDeck = new THREE.Mesh(new THREE.BoxGeometry(porchW, 0.48, porchD), this.mats.stoneWall);
    porchDeck.position.set(0, 0.24, d * 0.5 + porchD * 0.5 - 0.1);
    porchDeck.receiveShadow = true;
    g.add(porchDeck);

    const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(porchW + 0.4, 0.18, porchD + 0.35), roofMat);
    porchRoof.position.set(0, 2.85, d * 0.5 + porchD * 0.5);
    porchRoof.rotation.x = 0.18;
    porchRoof.castShadow = true;
    g.add(porchRoof);

    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.45, 0.16), trimMat);
      col.position.set(sx * (porchW * 0.5 - 0.18), 1.62, d * 0.5 + porchD - 0.24);
      col.castShadow = true;
      g.add(col);
    }

    // Front Oak Door
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.15, 0.14), this.mats.darkTimber);
    door.position.set(0, 1.48, d * 0.5 + 0.03);
    g.add(door);

    // 7. Recessed Reflective Windows + Shutters on all 4 facades
    const addWindow = (wx, wy, wz, rotY) => {
      const wg = new THREE.Group();
      wg.position.set(wx, wy, wz);
      wg.rotation.y = rotY;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.28, 1.42, 0.14), trimMat);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.20, 0.16), this.windowGlassMat);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.12, 0.26), this.mats.stoneWall);
      sill.position.set(0, -0.72, 0.05);
      wg.add(frame, pane, sill);
      g.add(wg);
    };

    const floors = wallH > 5.0 ? [1.75, 4.15] : [1.85];
    for (const fy of floors) {
      addWindow(-w * 0.30, fy, d * 0.5 + 0.02, 0);
      addWindow(w * 0.30, fy, d * 0.5 + 0.02, 0);
      if (fy > 3.2) addWindow(0, fy, d * 0.5 + 0.02, 0);
      addWindow(-w * 0.28, fy, -d * 0.5 - 0.02, Math.PI);
      addWindow(w * 0.28, fy, -d * 0.5 - 0.02, Math.PI);
      addWindow(-w * 0.5 - 0.02, fy, -d * 0.22, -Math.PI / 2);
      addWindow(-w * 0.5 - 0.02, fy, d * 0.22, -Math.PI / 2);
      addWindow(w * 0.5 + 0.02, fy, -d * 0.22, Math.PI / 2);
      addWindow(w * 0.5 + 0.02, fy, d * 0.22, Math.PI / 2);
    }

    return { group: g, houseW: w, houseD: d };
  }

  _createCompleteHomestead(px, py, pz, plotW, plotD, faceYaw, styleIdx, rng) {
    const plot = new THREE.Group();
    plot.position.set(px, py, pz);
    plot.rotation.y = faceYaw;

    // Helper: local (lx, lz) -> world ground offset dy relative to py so fences/beds hug slope!
    const cosY = Math.cos(faceYaw);
    const sinY = Math.sin(faceYaw);
    const localGroundOffset = (lx, lz) => {
      const wx = px + lx * cosY + lz * sinY;
      const wz = pz - lx * sinY + lz * cosY;
      return this.network.getTerrainHeight(wx, wz) - py;
    };

    // 1. Place House slightly toward front-center of plot
    const houseZ = 1.5;
    const houseShiftX = (rng() - 0.5) * 2.2;
    const { group: houseMesh, houseW, houseD } = this._createDetailedHouse(styleIdx, rng);
    houseMesh.position.set(houseShiftX, localGroundOffset(houseShiftX, houseZ), houseZ);
    plot.add(houseMesh);

    // Register solid collision radius for house
    const hWorldX = px + houseShiftX * cosY + houseZ * sinY;
    const hWorldZ = pz - houseShiftX * sinY + houseZ * cosY;
    this.colliders.push({ x: hWorldX, z: hWorldZ, r: Math.max(houseW, houseD) * 0.52 });

    // 2. Cobblestone Garden Walkway from Front Gate (+plotD/2) to Front Porch!
    const gateZ = plotD * 0.5;
    const porchFrontZ = houseZ + houseD * 0.5 + 1.6;
    const pathLen = Math.max(2.0, gateZ - porchFrontZ);
    const pathSegs = Math.ceil(pathLen / 1.5);
    for (let s = 0; s < pathSegs; s++) {
      const sz = porchFrontZ + (s + 0.5) * (pathLen / pathSegs);
      const sx = THREE.MathUtils.lerp(houseShiftX, 0, (s + 0.5) / pathSegs);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.14, pathLen / pathSegs + 0.15), this.mats.cobblePath);
      slab.position.set(sx, localGroundOffset(sx, sz) + 0.04, sz);
      slab.receiveShadow = true;
      plot.add(slab);
    }

    // 3. Perimeter Fence & Front Gate Pillars (Заборы и ограждения усадьбы!)
    const fenceType = styleIdx % 3; // 0 = Picket Fence, 1 = Stone Wall + Hedge, 2 = Timber Rail Fence
    const hw = plotW * 0.5;
    const hd = plotD * 0.5;

    const addFenceSpan = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const segCount = Math.max(1, Math.round(len / 2.6));
      const ang = Math.atan2(x2 - x1, z2 - z1);

      for (let k = 0; k < segCount; k++) {
        const t = (k + 0.5) / segCount;
        const fx = THREE.MathUtils.lerp(x1, x2, t);
        const fz = THREE.MathUtils.lerp(z1, z2, t);
        const fy = localGroundOffset(fx, fz);
        const sl = len / segCount;

        if (fenceType === 0) {
          // Wooden Picket / Slat Fence with posts
          const fMat = styleIdx % 2 === 0 ? this.mats.whiteWood : this.mats.naturalWood;
          const rail1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, sl), fMat);
          rail1.position.set(fx, fy + 0.42, fz);
          rail1.rotation.y = ang;
          const rail2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, sl), fMat);
          rail2.position.set(fx, fy + 0.92, fz);
          rail2.rotation.y = ang;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.28, 0.16), fMat);
          post.position.set(THREE.MathUtils.lerp(x1, x2, k / segCount), localGroundOffset(THREE.MathUtils.lerp(x1, x2, k / segCount), THREE.MathUtils.lerp(z1, z2, k / segCount)) + 0.56, THREE.MathUtils.lerp(z1, z2, k / segCount));
          post.castShadow = true;
          plot.add(rail1, rail2, post);

          // Vertical pickets
          for (let p = -1; p <= 1; p++) {
            const pt = (k + 0.5 + p * 0.3) / segCount;
            const pxL = THREE.MathUtils.lerp(x1, x2, pt);
            const pzL = THREE.MathUtils.lerp(z1, z2, pt);
            const picket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.16, 0.34), fMat);
            picket.position.set(pxL, localGroundOffset(pxL, pzL) + 0.56, pzL);
            picket.rotation.y = ang;
            picket.castShadow = true;
            plot.add(picket);
          }
        } else if (fenceType === 1) {
          // Cotswold Low Stone Wall + Trimmed Green Privet Hedge
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.95, sl + 0.06), this.mats.stoneWall);
          wall.position.set(fx, fy + 0.38, fz);
          wall.rotation.y = ang;
          wall.castShadow = true;
          wall.receiveShadow = true;
          plot.add(wall);

          const hedge = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, sl * 0.96), this.mats.hedge);
          hedge.position.set(fx, fy + 1.05, fz);
          hedge.rotation.y = ang;
          hedge.castShadow = true;
          plot.add(hedge);
        } else {
          // Rustic Country Split-Rail Timber Fence
          for (const ry of [0.46, 0.92]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.13, sl + 0.05), this.mats.darkTimber);
            rail.position.set(fx, fy + ry, fz);
            rail.rotation.y = ang;
            rail.castShadow = true;
            plot.add(rail);
          }
          const postX = THREE.MathUtils.lerp(x1, x2, k / segCount);
          const postZ = THREE.MathUtils.lerp(z1, z2, k / segCount);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.11, 1.32, 6), this.mats.darkTimber);
          post.position.set(postX, localGroundOffset(postX, postZ) + 0.55, postZ);
          post.castShadow = true;
          plot.add(post);
        }
      }
    };

    // Front fence with 3.2m open driveway/garden gate at x=0!
    addFenceSpan(-hw, hd, -1.65, hd);
    addFenceSpan(1.65, hd, hw, hd);
    // Left, Right & Back fences enclosing the entire garden!
    addFenceSpan(-hw, -hd, -hw, hd);
    addFenceSpan(hw, -hd, hw, hd);
    addFenceSpan(-hw, -hd, hw, -hd);

    // Stone Gate Pillars & Mailbox at Front Entrance
    for (const gx of [-1.75, 1.75]) {
      const gy = localGroundOffset(gx, hd);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.48, 0.52), this.mats.stoneWall);
      pillar.position.set(gx, gy + 0.68, hd);
      pillar.castShadow = true;
      plot.add(pillar);
    }

    // 4. Backyard Raised Vegetable Beds (Огороды и грядки!)
    const bedBaseX = -hw * 0.52;
    const bedBaseZ = -hd * 0.52;
    for (let b = 0; b < 3; b++) {
      const bz = bedBaseZ + b * 2.15;
      const by = localGroundOffset(bedBaseX, bz);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.34, 1.35), this.mats.naturalWood);
      frame.position.set(bedBaseX, by + 0.14, bz);
      frame.castShadow = true;
      const soil = new THREE.Mesh(new THREE.BoxGeometry(3.95, 0.38, 1.12), this.mats.gardenSoil);
      soil.position.set(bedBaseX, by + 0.16, bz);
      plot.add(frame, soil);

      // Green crops (cabbages / bushes) in neat rows
      for (let c = -1.4; c <= 1.45; c += 0.72) {
        const crop = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26, 1), this.mats.hedge);
        crop.position.set(bedBaseX + c, by + 0.44, bz);
        crop.scale.set(1.1, 0.75, 1.1);
        plot.add(crop);
      }
    }

    // 5. Backyard Glass Greenhouse or Wooden Garden Shed / Pergola!
    const ghX = hw * 0.50;
    const ghZ = -hd * 0.52;
    const ghY = localGroundOffset(ghX, ghZ);
    if (styleIdx % 2 === 0) {
      // Glass Greenhouse
      const ghBase = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.45, 5.2), this.mats.stoneWall);
      ghBase.position.set(ghX, ghY + 0.18, ghZ);
      const ghBody = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.0, 5.0), this.mats.greenhouseGlass);
      ghBody.position.set(ghX, ghY + 1.4, ghZ);
      const ghFrame = new THREE.Mesh(new THREE.BoxGeometry(3.48, 2.05, 5.08), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, wireframe: true }));
      ghFrame.position.copy(ghBody.position);
      plot.add(ghBase, ghBody, ghFrame);
    } else {
      // Rustic Timber Garden Shed / Gazebo
      const shed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.3, 3.6), this.mats.naturalWood);
      shed.position.set(ghX, ghY + 1.1, ghZ);
      shed.castShadow = true;
      const shedRoof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.2, 4), this.mats.roofBrown);
      shedRoof.position.set(ghX, ghY + 2.85, ghZ);
      shedRoof.rotation.y = Math.PI / 4;
      shedRoof.castShadow = true;
      plot.add(shed, shedRoof);
    }

    // 6. Register 2-3 Orchard Fruit Tree Spots inside this Fenced Garden!
    const treeLocalOffsets = [
      [-hw * 0.62, 1.8],
      [hw * 0.64, 2.2],
      [0.2, -hd * 0.62],
    ];
    for (const [tlx, tlz] of treeLocalOffsets) {
      if (Math.hypot(tlx - houseShiftX, tlz - houseZ) < Math.max(houseW, houseD) * 0.68) continue;
      const twx = px + tlx * cosY + tlz * sinY;
      const twz = pz - tlx * sinY + tlz * cosY;
      if (this._isSpotClearOfRoadsAndWater(twx, twz, 3.5)) {
        this.orchardTreeSpots.push({ x: twx, z: twz });
      }
    }

    return plot;
  }

  _createVillagePiazzaAndFountain() {
    const g = new THREE.Group();
    // Circular cobblestone plaza disc
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11.8, 0.24, 28), this.mats.cobblePath);
    disc.position.y = 0.06;
    disc.receiveShadow = true;
    g.add(disc);

    // Octagonal Stone Fountain Basin
    const outerRim = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.95, 8), this.mats.stoneWall);
    outerRim.position.y = 0.52;
    outerRim.castShadow = true;
    const waterPool = new THREE.Mesh(
      new THREE.CylinderGeometry(3.15, 3.15, 0.78, 16),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.08, metalness: 0.2 })
    );
    waterPool.position.y = 0.56;
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 2.8, 8), this.mats.stoneWall);
    pedestal.position.y = 1.5;
    pedestal.castShadow = true;
    const upperBowl = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 0.65, 0.45, 12), this.mats.stoneWall);
    upperBowl.position.y = 2.65;
    upperBowl.castShadow = true;
    g.add(outerRim, waterPool, pedestal, upperBowl);

    // 4 Wooden Park Benches around the fountain
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 0.65), this.mats.darkTimber);
      bench.position.set(Math.cos(a) * 6.8, 0.42, Math.sin(a) * 6.8);
      bench.rotation.y = -a + Math.PI / 2;
      bench.castShadow = true;
      g.add(bench);
    }
    return g;
  }

  _createParishChurch() {
    const g = new THREE.Group();
    // Nave
    const nave = new THREE.Mesh(new THREE.BoxGeometry(10.5, 8.2, 18.0), this.mats.stoneWall);
    nave.position.y = 3.8;
    nave.castShadow = nave.receiveShadow = true;
    g.add(nave);

    const { leftGeo, rightGeo } = this._createPitchedRoofGeometry(10.5, 18.0, 4.2, 0.65);
    const rL = new THREE.Mesh(leftGeo, this.mats.roofSlate);
    const rR = new THREE.Mesh(rightGeo, this.mats.roofSlate);
    rL.position.y = rR.position.y = 7.9;
    rL.castShadow = rR.castShadow = true;
    g.add(rL, rR);

    // Tall Bell & Clock Tower (+Z front)
    const tower = new THREE.Mesh(new THREE.BoxGeometry(5.6, 19.5, 5.6), this.mats.stoneWall);
    tower.position.set(0, 9.4, 9.2);
    tower.castShadow = tower.receiveShadow = true;
    g.add(tower);

    // Spire
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3.8, 8.5, 4), this.mats.roofSlate);
    spire.position.set(0, 23.3, 9.2);
    spire.rotation.y = Math.PI / 4;
    spire.castShadow = true;
    g.add(spire);

    // Clock dials on all 4 sides of tower
    const dialMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfde68a, emissiveIntensity: 0.45, roughness: 0.3 });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.14, 20), dialMat);
      dial.rotation.x = Math.PI / 2;
      dial.rotation.z = a;
      dial.position.set(Math.sin(a) * 2.84, 15.8, 9.2 + Math.cos(a) * 2.84);
      g.add(dial);
    }

    return g;
  }

  // =========================================================================
  // 2. EMERALD LAKE MARINA, WOODEN PIERS & MOORED SAILBOATS
  // =========================================================================
  _buildEmeraldMarina(root) {
    const marina = new THREE.Group();
    marina.name = 'EmeraldMarina';

    // Shore promenade centered at (-375, -328), extending NW into Emerald Lake (-740, -560)
    const dirX = -0.80;
    const dirZ = -0.60;
    const yaw = Math.atan2(dirX, dirZ);

    for (const offsetSide of [-18, 16]) {
      const perpX = -dirZ * offsetSide;
      const perpZ = dirX * offsetSide;
      const startX = -388 + perpX;
      const startZ = -336 + perpZ;

      const pier = new THREE.Group();
      pier.position.set(startX, LAKE_WATER_Y + 0.85, startZ);
      pier.rotation.y = yaw;

      const pierLen = 46;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.28, pierLen), this.mats.naturalWood);
      deck.position.set(0, 0, pierLen * 0.5);
      deck.castShadow = deck.receiveShadow = true;
      pier.add(deck);

      // Wooden pilings into the lakebed
      for (let z = 2; z <= pierLen; z += 5.5) {
        for (const sx of [-1.6, 1.6]) {
          const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 7.5, 8), this.mats.darkTimber);
          piling.position.set(sx, -3.5, z);
          piling.castShadow = true;
          pier.add(piling);
        }
      }
      marina.add(pier);

      // Moored Sailboats beside the piers!
      for (const bz of [18, 36]) {
        const boat = this._createSailboat(offsetSide > 0 ? 0x1d4ed8 : 0xb91c1c);
        const bx = startX + dirX * bz - dirZ * (offsetSide > 0 ? 5.2 : -5.2);
        const bzW = startZ + dirZ * bz + dirX * (offsetSide > 0 ? 5.2 : -5.2);
        boat.position.set(bx, LAKE_WATER_Y + 0.12, bzW);
        boat.rotation.y = yaw + (offsetSide > 0 ? 0.15 : -0.15);
        marina.add(boat);
        this.animatedObjects.push({ mesh: boat, type: 'boat', baseY: LAKE_WATER_Y + 0.12, phase: bz * 0.3 });
      }
    }

    // Timber Boathouse on Waterfront
    const bhX = -376, bhZ = -318;
    const bhY = this.network.getTerrainHeight(bhX, bhZ);
    const boathouse = new THREE.Group();
    boathouse.position.set(bhX, bhY, bhZ);
    boathouse.rotation.y = yaw;
    const bhBody = new THREE.Mesh(new THREE.BoxGeometry(11, 4.8, 9), this.mats.naturalWood);
    bhBody.position.y = 2.2;
    bhBody.castShadow = bhBody.receiveShadow = true;
    const { leftGeo, rightGeo } = this._createPitchedRoofGeometry(11, 9, 2.6, 0.6);
    const rl = new THREE.Mesh(leftGeo, this.mats.roofSlate);
    const rr = new THREE.Mesh(rightGeo, this.mats.roofSlate);
    rl.position.y = rr.position.y = 4.6;
    rl.castShadow = rr.castShadow = true;
    boathouse.add(bhBody, rl, rr);
    marina.add(boathouse);
    this.colliders.push({ x: bhX, z: bhZ, r: 6.5 });

    root.add(marina);
  }

  _createSailboat(accentHex) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 1.05, 8.2),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 })
    );
    hull.position.y = 0.3;
    hull.castShadow = true;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.56, 0.25, 8.25),
      new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.3 })
    );
    stripe.position.y = 0.55;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.10, 10.5, 8), this.mats.steel);
    mast.position.set(0, 5.5, 0.4);
    mast.castShadow = true;

    // Furled / Half-raised White Sail triangle
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(0, 8.2);
    sailShape.lineTo(-3.4, 0.5);
    sailShape.closePath();
    const sailGeo = new THREE.ShapeGeometry(sailShape);
    const sail = new THREE.Mesh(
      sailGeo,
      new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.65, side: THREE.DoubleSide })
    );
    sail.rotation.y = Math.PI / 2;
    sail.position.set(0, 1.4, 0.3);
    sail.castShadow = true;

    b.add(hull, stripe, mast, sail);
    return b;
  }

  // =========================================================================
  // 3. GOLDEN PLAINS STONE WINDMILL, RED BARNS, SILOS & HORSE PASTURES
  // =========================================================================
  _buildGoldenPlainsFarms(root) {
    const farms = new THREE.Group();
    farms.name = 'GoldenPlainsFarms';
    const rng = mulberry32(99441);

    // A. Iconic Old Stone Windmill on the Hill (875, 372)
    const wmX = 875, wmZ = 372;
    if (this._isSpotClearOfRoadsAndWater(wmX, wmZ, 12)) {
      const wmY = this.network.getTerrainHeight(wmX, wmZ);
      const wm = new THREE.Group();
      wm.position.set(wmX, wmY, wmZ);

      const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 5.2, 16.5, 16), this.mats.stoneWall);
      tower.position.y = 7.8;
      tower.castShadow = tower.receiveShadow = true;

      const cap = new THREE.Mesh(new THREE.ConeGeometry(3.85, 4.2, 16), this.mats.darkTimber);
      cap.position.y = 18.1;
      cap.castShadow = true;

      const rotor = new THREE.Group();
      rotor.position.set(0, 15.6, 3.9);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 10), this.mats.darkTimber);
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);

      const sailCanvasMat = new THREE.MeshStandardMaterial({ color: 0xfef9ec, roughness: 0.8, side: THREE.DoubleSide });
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Group();
        blade.rotation.z = (i * Math.PI) / 2;
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 9.6, 0.24), this.mats.darkTimber);
        spar.position.y = 4.8;
        spar.castShadow = true;
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.55, 7.6, 0.06), sailCanvasMat);
        cloth.position.set(0.85, 5.5, 0.06);
        cloth.castShadow = true;
        blade.add(spar, cloth);
        rotor.add(blade);
      }

      wm.add(tower, cap, rotor);
      farms.add(wm);
      this.animatedObjects.push({ mesh: rotor, type: 'spinZ', speed: 0.52 });
      this.colliders.push({ x: wmX, z: wmZ, r: 5.5 });
    }

    // B. Two Large Country Red-Timber Barns + Grain Silos + Fenced Horse Paddocks!
    const farmSites = [
      { x: 785, z: 515, yaw: 0.42 },
      { x: 1015, z: 660, yaw: -0.65 },
    ];

    for (const site of farmSites) {
      if (!this._isSpotClearOfRoadsAndWater(site.x, site.z, 18)) continue;
      const fy = this.network.getTerrainHeight(site.x, site.z);
      const fg = new THREE.Group();
      fg.position.set(site.x, fy, site.z);
      fg.rotation.y = site.yaw;

      // Classic Red Barn
      const barn = new THREE.Mesh(new THREE.BoxGeometry(13.5, 7.2, 20.0), this.mats.barnRed);
      barn.position.y = 3.2;
      barn.castShadow = barn.receiveShadow = true;
      const { leftGeo, rightGeo } = this._createPitchedRoofGeometry(13.5, 20.0, 4.2, 0.65);
      const rL = new THREE.Mesh(leftGeo, this.mats.roofSlate);
      const rR = new THREE.Mesh(rightGeo, this.mats.roofSlate);
      rL.position.y = rR.position.y = 6.8;
      rL.castShadow = rR.castShadow = true;

      // White X-braced Barn Doors
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(4.8, 4.6, 0.25), this.mats.whiteWood);
      doorFrame.position.set(0, 2.3, 10.05);
      const doorInner = new THREE.Mesh(new THREE.BoxGeometry(4.3, 4.2, 0.30), this.mats.barnRed);
      doorInner.position.set(0, 2.3, 10.06);

      // Steel Grain Silo beside Barn
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 14.5, 18), this.mats.steel);
      silo.position.set(9.8, 6.8, -4.5);
      silo.castShadow = silo.receiveShadow = true;
      const siloDome = new THREE.Mesh(new THREE.SphereGeometry(3.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.steel);
      siloDome.position.set(9.8, 14.0, -4.5);

      fg.add(barn, rL, rR, doorFrame, doorInner, silo, siloDome);
      farms.add(fg);
      this.colliders.push({ x: site.x, z: site.z, r: 10.5 });

      // Adjacent Fenced Horse Pasture Paddock (46m x 46m split-rail enclosure!)
      const padX = site.x - Math.sin(site.yaw) * 44;
      const padZ = site.z + Math.cos(site.yaw) * 44;
      if (this._isSpotClearOfRoadsAndWater(padX, padZ, 26)) {
        this._buildFencedPaddock(farms, padX, padZ, 44, 42);
        this.horsePastureCenters.push({ x: padX, z: padZ, r: 16 });
      }
    }

    // C. Scatter 95 Golden Round Hay Bales across the Golden Farmlands!
    const hayMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.92 });
    const hayGeo = new THREE.CylinderGeometry(0.95, 0.95, 1.65, 14);
    hayGeo.rotateZ(Math.PI / 2);
    const hayMatrices = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < 240 && hayMatrices.length < 95; i++) {
      const hx = 420 + rng() * 920;
      const hz = 160 + rng() * 940;
      if (!this._isSpotClearOfRoadsAndWater(hx, hz, 9)) continue;
      if (Math.hypot(hx - 785, hz - 515) < 40 || Math.hypot(hx - 1015, hz - 660) < 40) continue;
      const hy = this.network.getTerrainHeight(hx, hz);
      dummy.position.set(hx, hy + 0.88, hz);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.setScalar(0.95 + rng() * 0.25);
      dummy.updateMatrix();
      hayMatrices.push(dummy.matrix.clone());
    }
    if (hayMatrices.length > 0) {
      const hayInst = new THREE.InstancedMesh(hayGeo, hayMat, hayMatrices.length);
      hayInst.castShadow = hayInst.receiveShadow = true;
      hayMatrices.forEach((m, idx) => hayInst.setMatrixAt(idx, m));
      hayInst.instanceMatrix.needsUpdate = true;
      farms.add(hayInst);
    }

    root.add(farms);
  }

  _buildFencedPaddock(parent, cx, cz, w, d) {
    const hw = w * 0.5;
    const hd = d * 0.5;
    const corners = [
      [cx - hw, cz - hd],
      [cx + hw, cz - hd],
      [cx + hw, cz + hd],
      [cx - hw, cz + hd],
    ];
    for (let s = 0; s < 4; s++) {
      const [x1, z1] = corners[s];
      const [x2, z2] = corners[(s + 1) % 4];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const segs = Math.round(len / 3.4);
      const ang = Math.atan2(x2 - x1, z2 - z1);

      for (let k = 0; k < segs; k++) {
        // Leave an open farm gate on side 0 center!
        if (s === 0 && Math.abs(k - segs * 0.5) < 1.2) continue;
        const t = (k + 0.5) / segs;
        const fx = THREE.MathUtils.lerp(x1, x2, t);
        const fz = THREE.MathUtils.lerp(z1, z2, t);
        const fy = this.network.getTerrainHeight(fx, fz);

        for (const ry of [0.55, 1.08]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, len / segs + 0.08), this.mats.darkTimber);
          rail.position.set(fx, fy + ry, fz);
          rail.rotation.y = ang;
          rail.castShadow = true;
          parent.add(rail);
        }
        const px = THREE.MathUtils.lerp(x1, x2, k / segs);
        const pz = THREE.MathUtils.lerp(z1, z2, k / segs);
        const py = this.network.getTerrainHeight(px, pz);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 1.45, 6), this.mats.darkTimber);
        post.position.set(px, py + 0.65, pz);
        post.castShadow = true;
        parent.add(post);
      }
    }
  }

  // =========================================================================
  // 4. FOREST FIREWATCH TOWER, RANGER CABIN & HIGHLAND SCENIC OVERLOOK
  // =========================================================================
  _buildForestAndHighlandLandmarks(root) {
    // A. Silverpine Timber Firewatch Lookout Tower at (1332, -772)
    const tx = 1332, tz = -772;
    const ty = this.network.getTerrainHeight(tx, tz);
    const tower = new THREE.Group();
    tower.position.set(tx, ty, tz);

    const towerH = 20.0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.30, towerH + 1.2, 8), this.mats.darkTimber);
        leg.position.set(sx * 3.1, towerH * 0.5, sz * 3.1);
        leg.rotation.set(sz * -0.07, 0, sx * 0.07);
        leg.castShadow = true;
        tower.add(leg);
      }
    }
    for (let h = 4; h <= 16; h += 4) {
      const span = 6.2 - (h / towerH) * 2.0;
      const ring = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, span), this.mats.naturalWood);
      ring.position.y = h;
      tower.add(ring);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.35, 6.8), this.mats.naturalWood);
    deck.position.y = towerH;
    deck.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.2, 4.6), this.mats.naturalWood);
    cabin.position.y = towerH + 1.75;
    cabin.castShadow = true;
    const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(4.7, 1.4, 4.7), this.windowGlassMat);
    cabGlass.position.y = towerH + 2.05;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2.1, 4), this.mats.roofBrown);
    roof.position.y = towerH + 4.35;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    tower.add(deck, cabin, cabGlass, roof);
    root.add(tower);
    this.colliders.push({ x: tx, z: tz, r: 4.2 });

    // B. Willow Forest Pond Angler's Wooden Pier at (992, -592)
    const pondPier = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, 18), this.mats.naturalWood);
    pondPier.position.set(996, POND_WATER_Y + 0.55, -596);
    pondPier.rotation.y = 0.25;
    pondPier.castShadow = pondPier.receiveShadow = true;
    root.add(pondPier);

    // C. Whispering Oaks Forest Ranger Log Cabin & Glade (-1258, 1348)
    const rx = -1258, rz = 1348;
    if (this._isSpotClearOfRoadsAndWater(rx, rz, 10)) {
      const ry = this.network.getTerrainHeight(rx, rz);
      const ranger = new THREE.Group();
      ranger.position.set(rx, ry, rz);
      ranger.rotation.y = 0.65;
      const logBody = new THREE.Mesh(new THREE.BoxGeometry(9.2, 4.0, 7.6), this.mats.darkTimber);
      logBody.position.y = 1.9;
      logBody.castShadow = logBody.receiveShadow = true;
      const { leftGeo, rightGeo } = this._createPitchedRoofGeometry(9.2, 7.6, 2.5, 0.7);
      const rl = new THREE.Mesh(leftGeo, this.mats.roofBrown);
      const rr = new THREE.Mesh(rightGeo, this.mats.roofBrown);
      rl.position.y = rr.position.y = 3.9;
      rl.castShadow = rr.castShadow = true;
      ranger.add(logBody, rl, rr);
      root.add(ranger);
      this.colliders.push({ x: rx, z: rz, r: 5.5 });
    }

    // D. Highland Mountain Pass Scenic Overlook Deck (-320, -1536, facing South over the Valley!)
    const ox = -320, oz = -1536;
    if (this._isSpotClearOfRoadsAndWater(ox, oz, 9)) {
      const oy = this.network.getTerrainHeight(ox, oz);
      const overlook = new THREE.Group();
      overlook.position.set(ox, oy, oz);
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 10.5, 1.8, 12), this.mats.stoneWall);
      plat.position.y = 0.4;
      plat.castShadow = plat.receiveShadow = true;
      const rail = new THREE.Mesh(new THREE.TorusGeometry(9.1, 0.12, 8, 24, Math.PI), this.mats.steel);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = 2.15;
      overlook.add(plat, rail);
      root.add(overlook);
    }
  }

  // =========================================================================
  // 5. HORIZON FESTIVAL HUB, FERRIS WHEEL & SKY HOT AIR BALLOONS
  // =========================================================================
  _buildHorizonFestivalAndBalloons(root) {
    const fest = new THREE.Group();
    fest.name = 'HorizonFestivalHub';

    const pinkNeon = new THREE.MeshStandardMaterial({ color: 0xff2a6d, emissive: 0xff2a6d, emissiveIntensity: 1.4, roughness: 0.25 });
    const cyanNeon = new THREE.MeshStandardMaterial({ color: 0x05d9e8, emissive: 0x05d9e8, emissiveIntensity: 1.3, roughness: 0.25 });
    const amberNeon = new THREE.MeshStandardMaterial({ color: 0xff9f1c, emissive: 0xff9f1c, emissiveIntensity: 1.2, roughness: 0.25 });
    this.festivalNeonMats.push(pinkNeon, cyanNeon, amberNeon);

    // A. Iconic Horizon Highway Gantry Arch spanning M1 at (-480, 560)
    const roadNode = this.network.roads[0].nodes[0];
    const archYaw = Math.atan2(roadNode.tx, roadNode.tz);
    const arch = new THREE.Group();
    arch.position.set(roadNode.x, roadNode.y, roadNode.z);
    arch.rotation.y = archYaw;

    const spanW = 19.5;
    const archH = 9.2;
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.3, archH, 1.6), this.mats.darkIron);
      pillar.position.set(sx * spanW * 0.5, archH * 0.5, 0);
      pillar.castShadow = true;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, archH - 0.8, 1.7), pinkNeon);
      strip.position.set(sx * (spanW * 0.5 - sx * 0.52), archH * 0.5, 0);
      arch.add(pillar, strip);
    }
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(spanW + 2.4, 2.1, 1.8), this.mats.darkIron);
    crossBeam.position.y = archH + 0.8;
    crossBeam.castShadow = true;
    const neonBanner = new THREE.Mesh(new THREE.BoxGeometry(spanW - 1.5, 0.55, 1.95), pinkNeon);
    neonBanner.position.y = archH + 0.8;
    const cyanTrim = new THREE.Mesh(new THREE.BoxGeometry(spanW + 1.8, 0.22, 1.92), cyanNeon);
    cyanTrim.position.y = archH + 1.82;
    arch.add(crossBeam, neonBanner, cyanTrim);
    fest.add(arch);

    // B. Giant Rotating Horizon Observation Ferris Wheel at (-535, 598)
    const wx = -538, wz = 602;
    const wy = this.network.getTerrainHeight(wx, wz);
    const ferris = new THREE.Group();
    ferris.position.set(wx, wy, wz);
    ferris.rotation.y = 0.6;

    const wheelR = 22.0;
    const hubY = wheelR + 4.5;
    for (const sz of [-2.8, 2.8]) {
      for (const sx of [-1, 1]) {
        const aLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, hubY + 2, 10), this.mats.steel);
        aLeg.position.set(sx * 7.5, hubY * 0.5, sz);
        aLeg.rotation.z = sx * 0.28;
        aLeg.castShadow = true;
        ferris.add(aLeg);
      }
    }

    const wheelGroup = new THREE.Group();
    wheelGroup.position.y = hubY;
    for (const sz of [-1.4, 1.4]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(wheelR, 0.32, 10, 36), pinkNeon);
      rim.position.z = sz;
      wheelGroup.add(rim);
      const innerRim = new THREE.Mesh(new THREE.TorusGeometry(wheelR * 0.58, 0.18, 8, 28), cyanNeon);
      innerRim.position.z = sz;
      wheelGroup.add(innerRim);
    }

    const spokeCount = 16;
    for (let i = 0; i < spokeCount; i++) {
      const a = (i / spokeCount) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, wheelR * 2, 6), this.mats.steel);
      spoke.rotation.z = a;
      wheelGroup.add(spoke);

      // Gondola capsule on rim
      const gondola = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 2.0, 2.4),
        i % 2 === 0 ? amberNeon : cyanNeon
      );
      gondola.position.set(Math.cos(a) * wheelR, Math.sin(a) * wheelR, 0);
      wheelGroup.add(gondola);
    }

    ferris.add(wheelGroup);
    fest.add(ferris);
    this.animatedObjects.push({ mesh: wheelGroup, type: 'spinZ', speed: 0.18 });
    this.colliders.push({ x: wx, z: wz, r: 9.5 });

    // C. Festival Stage Pavilion & Pit Garages at (-435, 608)
    const sx = -435, sz = 608;
    if (this._isSpotClearOfRoadsAndWater(sx, sz, 15)) {
      const sy = this.network.getTerrainHeight(sx, sz);
      const stage = new THREE.Group();
      stage.position.set(sx, sy, sz);
      stage.rotation.y = -0.85;
      const podium = new THREE.Mesh(new THREE.BoxGeometry(24, 1.6, 12), this.mats.darkIron);
      podium.position.y = 0.8;
      podium.receiveShadow = true;
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(25, 1.2, 13), this.mats.darkIron);
      canopy.position.y = 9.5;
      canopy.castShadow = true;
      const backdrop = new THREE.Mesh(new THREE.BoxGeometry(22, 7.2, 0.8), pinkNeon);
      backdrop.position.set(0, 5.2, -5.2);
      stage.add(podium, canopy, backdrop);
      fest.add(stage);
      this.colliders.push({ x: sx, z: sz, r: 11.5 });
    }

    // D. 8 Forza Horizon Sky Hot Air Balloons Drifting Over the 4x4 km Valley!
    const balloonSpecs = [
      { x: -620, y: 175, z: -420, c1: 0xff2a6d, c2: 0xffbe0b },
      { x: -850, y: 215, z: -690, c1: 0x00b4d8, c2: 0xf72585 },
      { x: 140,  y: 168, z: -120, c1: 0xfb5607, c2: 0xffbe0b },
      { x: 520,  y: 195, z: 320,  c1: 0x8338ec, c2: 0x3a86ff },
      { x: 980,  y: 205, z: -580, c1: 0x06d6a0, c2: 0x118ab2 },
      { x: -380, y: 185, z: 620,  c1: 0xef476f, c2: 0xffd166 },
      { x: -220, y: 245, z: -1380,c1: 0x3a86ff, c2: 0xff006e },
      { x: -1080,y: 190, z: 820,  c1: 0xff9f1c, c2: 0xe71d36 },
    ];

    for (let i = 0; i < balloonSpecs.length; i++) {
      const b = balloonSpecs[i];
      const bg = new THREE.Group();
      bg.position.set(b.x, b.y, b.z);

      const envGeo = new THREE.SphereGeometry(14, 20, 16);
      envGeo.scale(1.0, 1.24, 1.0);
      const envMat = new THREE.MeshStandardMaterial({ color: b.c1, roughness: 0.55 });
      const env = new THREE.Mesh(envGeo, envMat);
      env.position.y = 14;

      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(13.8, 12.6, 5.2, 20, 1, true),
        new THREE.MeshStandardMaterial({ color: b.c2, roughness: 0.5, side: THREE.DoubleSide })
      );
      band.position.y = 14;

      const throat = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 2.4, 7.5, 16), envMat);
      throat.position.y = 1.5;

      const burnerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffaa33 })
      );
      burnerGlow.position.y = -2.2;

      const basket = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.2, 2.8), this.mats.naturalWood);
      basket.position.y = -5.5;

      bg.add(env, band, throat, burnerGlow, basket);
      fest.add(bg);
      this.animatedObjects.push({
        mesh: bg,
        type: 'balloon',
        baseY: b.y,
        baseX: b.x,
        baseZ: b.z,
        phase: i * 1.15,
      });
    }

    root.add(fest);
  }

  update(elapsed, nightFactor) {
    if (this.windowGlassMat) {
      this.windowGlassMat.emissiveIntensity = 0.08 + nightFactor * 2.6;
    }
    for (const nm of this.festivalNeonMats) {
      nm.emissiveIntensity = 0.85 + nightFactor * 2.1;
    }

    for (const item of this.animatedObjects) {
      if (item.type === 'spinZ') {
        item.mesh.rotation.z = elapsed * item.speed;
      } else if (item.type === 'boat') {
        item.mesh.position.y = item.baseY + Math.sin(elapsed * 1.6 + item.phase) * 0.07;
        item.mesh.rotation.z = Math.sin(elapsed * 1.3 + item.phase) * 0.035;
      } else if (item.type === 'balloon') {
        item.mesh.position.y = item.baseY + Math.sin(elapsed * 0.35 + item.phase) * 4.5;
        item.mesh.position.x = item.baseX + Math.cos(elapsed * 0.12 + item.phase) * 18.0;
        item.mesh.rotation.y = elapsed * 0.08 + item.phase;
      }
    }
  }
}
