import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { mulberry32, smoothstep } from './Noise.js';
import { WORLD_SIZE, HALF_WORLD, LAKE_WATER_Y } from './WorldConfig.js';

export class NatureAndWildlife {
  constructor(network, villageInfra, gltfLoader) {
    this.network = network;
    this.villageInfra = villageInfra;
    this.gltfLoader = gltfLoader;
    this.windUniforms = [];
    this.grassFocusUniforms = [];
    this.mixers = [];
    this.circlingBirds = [];
    this.trottingAnimals = [];
    this.treeColliders = []; // Trunk colliders near roads/trails
  }

  async buildAll(scene, onProgress) {
    onProgress?.('Генерация реалистичных лесов, сосен, дубов и садов (EZ-Tree PBR)...', 0.42);
    await this._yieldFrame();
    this._buildEZTreeForests(scene);

    onProgress?.('Размещение скал, валунов и береговых камней...', 0.62);
    await this._yieldFrame();
    await this._buildRocks(scene);

    onProgress?.('Создание живых лугов, 3D-травы и полевых цветов...', 0.76);
    await this._yieldFrame();
    await this._buildInfiniteGPUGrassAndFlowers(scene);

    onProgress?.('Заселение мира живой природой (лошади, птицы над озером, лисы)...', 0.88);
    await this._yieldFrame();
    await this._buildAnimatedWildlife(scene);
  }

  _yieldFrame() {
    return new Promise((r) => setTimeout(r, 16));
  }

  // =========================================================================
  // 1. REALISTIC 3D FORESTS, GROVES & VILLAGE ORCHARDS (@dgreenheck/ez-tree)
  // =========================================================================
  _createOptimizedPresetTree(presetName, seed, scaleOverrides = {}) {
    const t = new Tree();
    t.loadPreset(presetName);
    t.options.seed = seed;

    // Optimize vertex count per tree (~900 - 2,400 verts) while keeping full PBR bark & dense foliage!
    const isBush = presetName.startsWith('Bush');
    if (!isBush) {
      t.options.branch.levels = Math.min(t.options.branch.levels, 2);
      t.options.branch.sections[0] = 5;
      t.options.branch.sections[1] = 4;
      t.options.branch.sections[2] = 3;
      t.options.branch.segments[0] = 6;
      t.options.branch.segments[1] = 4;
      t.options.branch.segments[2] = 3;
      t.options.branch.children[0] = Math.min(t.options.branch.children[0] || 5, 5);
      t.options.branch.children[1] = Math.min(t.options.branch.children[1] || 4, 4);
      t.options.leaves.count = 7;
      t.options.leaves.size = (t.options.leaves.size || 2.5) * 1.48;
    } else {
      t.options.branch.levels = 1;
      t.options.branch.sections[0] = 4;
      t.options.branch.sections[1] = 3;
      t.options.branch.segments[0] = 5;
      t.options.branch.segments[1] = 3;
      t.options.leaves.count = 6;
    }

    if (scaleOverrides.leafTint) {
      t.options.leaves.tint = scaleOverrides.leafTint;
    }
    t.generate();

    const barkGeo = t.branchesMesh.geometry;
    const barkMat = t.branchesMesh.material;
    const leafGeo = t.leavesMesh.geometry;
    const leafMat = t.leavesMesh.material;

    leafMat.alphaTest = 0.42;
    leafMat.side = THREE.DoubleSide;
    leafMat.depthWrite = true;

    // Inject gentle canopy wind sway into leaf shader!
    const uTime = { value: 0 };
    this.windUniforms.push(uTime);
    leafMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float hFactor = smoothstep(1.5, 14.0, transformed.y);
          #ifdef USE_INSTANCING
            vec3 instOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 instOrigin = vec3(0.0);
          #endif
          float gust = sin(uWindTime * 1.65 + instOrigin.x * 0.04 + instOrigin.z * 0.04 + transformed.y * 0.25);
          transformed.x += gust * 0.28 * hFactor;
          transformed.z += cos(uWindTime * 1.35 + instOrigin.z * 0.05) * 0.20 * hFactor;`
        );
    };

    return { barkGeo, barkMat, leafGeo, leafMat };
  }

  _buildEZTreeForests(scene) {
    const speciesDefs = [
      { id: 'pine_tall', preset: 'Pine Large', seed: 101, baseScale: 0.34, leafTint: 0x3b6e38 },
      { id: 'pine_med', preset: 'Pine Medium', seed: 202, baseScale: 0.31, leafTint: 0x477a3f },
      { id: 'oak_ancient', preset: 'Oak Large', seed: 303, baseScale: 0.33, leafTint: 0x4f8336 },
      { id: 'oak_med', preset: 'Oak Medium', seed: 404, baseScale: 0.30, leafTint: 0x5c8f3d },
      { id: 'aspen_gold', preset: 'Aspen Large', seed: 505, baseScale: 0.33, leafTint: 0xb8a938 },
      { id: 'ash_lush', preset: 'Ash Medium', seed: 606, baseScale: 0.31, leafTint: 0x568b42 },
      { id: 'orchard_apple', preset: 'Oak Small', seed: 707, baseScale: 0.26, leafTint: 0x629c44 },
      { id: 'bush_forest', preset: 'Bush 1', seed: 808, baseScale: 0.34, leafTint: 0x4a7c36 },
    ];

    const prototypes = speciesDefs.map((s) => ({
      ...s,
      ...this._createOptimizedPresetTree(s.preset, s.seed, { leafTint: s.leafTint }),
    }));

    // 4x4 Spatial Sector Chunking (1km x 1km sectors) for automatic GPU frustum culling!
    const SECTORS = 4;
    const sectorSize = WORLD_SIZE / SECTORS;
    // buckets[speciesIdx][sectorIdx] = Matrix4[]
    const buckets = prototypes.map(() => Array.from({ length: SECTORS * SECTORS }, () => []));

    const dummy = new THREE.Object3D();
    const rng = mulberry32(20260424);

    const addTreeInstance = (spIdx, x, z, scaleMul = 1.0) => {
      if (Math.abs(x) > HALF_WORLD - 15 || Math.abs(z) > HALF_WORLD - 15) return;
      const y = this.network.getTerrainHeight(x, z);
      const sp = prototypes[spIdx];
      const s = sp.baseScale * scaleMul;

      dummy.position.set(x, y - 0.18, z);
      dummy.rotation.set((rng() - 0.5) * 0.05, rng() * Math.PI * 2, (rng() - 0.5) * 0.05);
      dummy.scale.set(s * (0.92 + rng() * 0.18), s * (0.88 + rng() * 0.28), s * (0.92 + rng() * 0.18));
      dummy.updateMatrix();

      const sx = Math.min(SECTORS - 1, Math.max(0, Math.floor((x + HALF_WORLD) / sectorSize)));
      const sz = Math.min(SECTORS - 1, Math.max(0, Math.floor((z + HALF_WORLD) / sectorSize)));
      buckets[spIdx][sz * SECTORS + sx].push(dummy.matrix.clone());
    };

    // A. Plant Apple & Pear Orchard Trees inside every Village Homestead Garden!
    for (const spot of this.villageInfra.orchardTreeSpots) {
      addTreeInstance(6, spot.x, spot.z, 0.95 + rng() * 0.25);
    }

    // B. Plant Natural Forests, Lakeside Groves, Riverbank Willows/Aspens & Roadside Hedgerows across 4x4 km!
    const CANDIDATES = 26000;
    let placedCount = 0;

    for (let i = 0; i < CANDIDATES && placedCount < 6400; i++) {
      const x = (rng() - 0.5) * (WORLD_SIZE - 50);
      const z = (rng() - 0.5) * (WORLD_SIZE - 50);

      // Keep roads, trails, water, village yards, and barn paddocks clear!
      const rDist = this.network._sampleGridBilinear(this.network.roadDist, x, z);
      const rHalfW = this.network._sampleGridBilinear(this.network.roadHalfW, x, z);
      if (rDist < rHalfW + 4.6) continue;
      if (this.network.getWaterInfo(x, z).inWater) continue;

      // Keep Oakwood Village core plots clear (already have curated orchard trees!)
      if (Math.hypot(x - 205, z + 35) < 195) continue;
      // Keep Horizon Festival stage/wheel clear
      if (Math.hypot(x + 485, z - 575) < 120) continue;
      // Keep Emerald Marina clear
      if (Math.hypot(x + 375, z + 325) < 62) continue;
      // Keep Horse Paddocks & Windmill clear
      let inFarmYard = false;
      for (const hp of this.villageInfra.horsePastureCenters) {
        if (Math.hypot(x - hp.x, z - hp.z) < 34) inFarmYard = true;
      }
      if (inFarmYard || Math.hypot(x - 875, z - 372) < 35) continue;

      const y = this.network.getTerrainHeight(x, z);
      if (y > 128) continue; // Alpine rocky timberline!

      const forestD = this.network.getForestDensity(x, z);
      const farmMask = this.network.getFarmlandMask(x, z);
      const rRiver = this.network._sampleGridBilinear(this.network.riverDist, x, z);
      const riparian = rRiver < 62 ? 0.55 : 0.0;

      // Probability of tree based on biome
      let prob = forestD * 0.88 + riparian;
      if (farmMask > 0.35 && forestD < 0.3) {
        // Sparse picturesque hedgerow trees along field borders
        const fieldLine = Math.abs(Math.sin(x * 0.011 + 0.6) * Math.cos(z * 0.0105 - 0.4));
        prob = fieldLine < 0.09 ? 0.48 : 0.015;
      } else if (forestD < 0.22) {
        prob = Math.max(prob, 0.045);
      }

      if (rng() > prob) continue;

      // Choose realistic biome-appropriate tree species!
      let spIdx = 3;
      const roll = rng();
      if (x > 250 && z < -180) {
        // NE Silverpine Forest: Conifer pines + golden aspens + undergrowth bushes
        if (roll < 0.42) spIdx = 0;
        else if (roll < 0.72) spIdx = 1;
        else if (roll < 0.86) spIdx = 4;
        else spIdx = 7;
      } else if (x < -300 && z > 200) {
        // SW Whispering Oaks Forest: Ancient oaks + ashes + bushes
        if (roll < 0.38) spIdx = 2;
        else if (roll < 0.68) spIdx = 3;
        else if (roll < 0.84) spIdx = 5;
        else spIdx = 7;
      } else if (riparian > 0.2 || this.network.getLakeSignedFactor(x, z) < 1.32) {
        // Waterfront Aspens & Ashes
        spIdx = roll < 0.48 ? 4 : roll < 0.82 ? 5 : 7;
      } else if (z < -850) {
        // Northern Alpine Foothills: Pines & Aspens
        spIdx = roll < 0.55 ? 1 : roll < 0.82 ? 0 : 4;
      } else {
        // Open Valley Groves
        spIdx = roll < 0.35 ? 2 : roll < 0.68 ? 5 : roll < 0.86 ? 4 : 7;
      }

      const scaleMul = 0.82 + rng() * 0.44;
      addTreeInstance(spIdx, x, z, scaleMul);
      placedCount++;

      // Register trunk collider if close to a drivable road/trail (keeps physics super fast!)
      if (spIdx !== 7 && rDist < rHalfW + 18) {
        this.treeColliders.push({ x, z, r: 0.65 });
      }
    }

    // Build Frustum-Culled Sector InstancedMeshes
    const forestGroup = new THREE.Group();
    forestGroup.name = 'EZTreeForestSectors';

    for (let s = 0; s < prototypes.length; s++) {
      const proto = prototypes[s];
      for (let sec = 0; sec < SECTORS * SECTORS; sec++) {
        const mats = buckets[s][sec];
        if (!mats.length) continue;

        const barkInst = new THREE.InstancedMesh(proto.barkGeo, proto.barkMat, mats.length);
        const leafInst = new THREE.InstancedMesh(proto.leafGeo, proto.leafMat, mats.length);
        barkInst.castShadow = proto.id !== 'bush_forest';
        barkInst.receiveShadow = true;
        leafInst.castShadow = true;
        leafInst.receiveShadow = true;

        for (let k = 0; k < mats.length; k++) {
          barkInst.setMatrixAt(k, mats[k]);
          leafInst.setMatrixAt(k, mats[k]);
        }
        barkInst.instanceMatrix.needsUpdate = true;
        leafInst.instanceMatrix.needsUpdate = true;
        barkInst.computeBoundingSphere();
        leafInst.computeBoundingSphere();

        forestGroup.add(barkInst, leafInst);
      }
    }

    scene.add(forestGroup);
  }

  // =========================================================================
  // 2. REAL SCULPTED 3D ROCKS & CLIFF BOULDERS (rock1.glb, rock2.glb, rock3.glb)
  // =========================================================================
  async _buildRocks(scene) {
    const rockUrls = ['/models/rock1.glb', '/models/rock2.glb', '/models/rock3.glb'];
    const rockProtos = [];

    for (const url of rockUrls) {
      try {
        const gltf = await this.gltfLoader.loadAsync(url);
        gltf.scene.traverse((c) => {
          if (c.isMesh) {
            rockProtos.push({ geometry: c.geometry, material: c.material });
          }
        });
      } catch (e) {
        console.warn('Rock fallback:', e);
      }
    }
    if (!rockProtos.length) return;

    const rng = mulberry32(55109);
    const buckets = rockProtos.map(() => []);
    const dummy = new THREE.Object3D();
    const norm = new THREE.Vector3();

    for (let i = 0; i < 9500 && buckets[0].length < 850; i++) {
      const x = (rng() - 0.5) * (WORLD_SIZE - 40);
      const z = (rng() - 0.5) * (WORLD_SIZE - 40);

      const rDist = this.network._sampleGridBilinear(this.network.roadDist, x, z);
      const rHalfW = this.network._sampleGridBilinear(this.network.roadHalfW, x, z);
      if (rDist < rHalfW + 3.2) continue;
      if (Math.hypot(x - 205, z + 35) < 175) continue;

      const y = this.network.getTerrainHeight(x, z);
      this.network.getTerrainNormal(x, z, norm);
      const slope = 1.0 - norm.y;

      const lf = this.network.getLakeSignedFactor(x, z);
      const rRiver = this.network._sampleGridBilinear(this.network.riverDist, x, z);
      const nearShore = (lf > 0.96 && lf < 1.18) || (rRiver > 10 && rRiver < 32);
      const inForest = this.network.getForestDensity(x, z) > 0.55;
      const onCliff = slope > 0.16 || y > 68;

      let prob = 0.015;
      if (onCliff) prob = 0.55;
      else if (nearShore) prob = 0.42;
      else if (inForest) prob = 0.12;

      if (rng() > prob) continue;
      if (y < LAKE_WATER_Y - 0.6) continue;

      const idx = Math.floor(rng() * rockProtos.length);
      const baseScale = onCliff ? 1.6 + rng() * 3.2 : nearShore ? 0.65 + rng() * 1.4 : 0.55 + rng() * 1.1;

      dummy.position.set(x, y - baseScale * 0.18, z);
      dummy.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
      dummy.scale.set(baseScale * (0.8 + rng() * 0.5), baseScale * (0.65 + rng() * 0.5), baseScale * (0.8 + rng() * 0.5));
      dummy.updateMatrix();
      buckets[idx].push(dummy.matrix.clone());
    }

    for (let k = 0; k < rockProtos.length; k++) {
      const mats = buckets[k];
      if (!mats.length) continue;
      const inst = new THREE.InstancedMesh(rockProtos[k].geometry, rockProtos[k].material, mats.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      mats.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      scene.add(inst);
    }
  }

  // =========================================================================
  // 3. GPU CAMERA-FOLLOWING INFINITE 3D GRASS & WILDFLOWERS (grass.glb + flower_*.glb)
  // =========================================================================
  _createHeightAndGrassMaskTexture() {
    const RES = 512;
    const data = new Uint8Array(RES * RES * 4);

    for (let gz = 0; gz < RES; gz++) {
      const wz = -HALF_WORLD + ((gz + 0.5) / RES) * WORLD_SIZE;
      for (let gx = 0; gx < RES; gx++) {
        const wx = -HALF_WORLD + ((gx + 0.5) / RES) * WORLD_SIZE;
        const h = this.network.getTerrainHeight(wx, wz);

        // Encode height [-20m .. +235m] into 16-bit (R = high byte, G = low byte) -> 3.8mm precision!
        const normH = Math.max(0, Math.min(1, (h + 20.0) / 255.0));
        const h16 = Math.round(normH * 65535);
        const rByte = (h16 >> 8) & 255;
        const gByte = h16 & 255;

        // Grass mask: 0 on roads, water, steep cliffs, high snow
        const rDist = this.network._sampleGridBilinear(this.network.roadDist, wx, wz);
        const rHalfW = this.network._sampleGridBilinear(this.network.roadHalfW, wx, wz);
        const wInfo = this.network.getWaterInfo(wx, wz);

        let mask = smoothstep(rHalfW + 0.5, rHalfW + 2.6, rDist);
        if (wInfo.inWater || h < LAKE_WATER_Y + 0.25) mask = 0;
        if (h > 118) mask *= 1.0 - smoothstep(118, 136, h);

        // Flower richness in meadows & orchards
        const flowerMask = mask * (1.0 - this.network.getForestDensity(wx, wz) * 0.55);

        const idx = (gz * RES + gx) * 4;
        data[idx] = rByte;
        data[idx + 1] = gByte;
        data[idx + 2] = Math.round(mask * 255);
        data[idx + 3] = Math.round(flowerMask * 255);
      }
    }

    const tex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  async _buildInfiniteGPUGrassAndFlowers(scene) {
    const heightMaskTex = this._createHeightAndGrassMaskTexture();

    const loadFirstMesh = async (url) => {
      const gltf = await this.gltfLoader.loadAsync(url);
      let found = null;
      gltf.scene.traverse((c) => {
        if (!found && c.isMesh) found = c;
      });
      return found;
    };

    const [grassMesh, flWhite, flYellow, flBlue] = await Promise.all([
      loadFirstMesh('/models/grass.glb'),
      loadFirstMesh('/models/flower_white.glb'),
      loadFirstMesh('/models/flower_yellow.glb'),
      loadFirstMesh('/models/flower_blue.glb'),
    ]);

    const patchSpan = 164.0; // 164m x 164m dense meadow carpet centered on viewer!

    const attachToroidalShader = (baseMat, isFlower = false) => {
      const mat = baseMat.clone();
      mat.alphaTest = 0.38;
      mat.side = THREE.DoubleSide;
      const uFocus = { value: new THREE.Vector3(-480, 18, 560) };
      const uTime = { value: 0 };
      this.grassFocusUniforms.push(uFocus);
      this.windUniforms.push(uTime);

      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uFocusPos = uFocus;
        shader.uniforms.uWindTime = uTime;
        shader.uniforms.uHeightMask = { value: heightMaskTex };
        shader.uniforms.uPatchSpan = { value: patchSpan };

        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
            uniform vec3 uFocusPos;
            uniform float uWindTime;
            uniform sampler2D uHeightMask;
            uniform float uPatchSpan;
            attribute vec4 aSlot; // x, z base offset in [0..span), y=rotY, w=scale

            vec3 sampleWorldHeightMask(vec2 wxz) {
              vec2 uv = clamp((wxz + ${HALF_WORLD.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)}, 0.001, 0.999);
              vec2 f = uv * 512.0 - 0.5;
              vec2 i0 = floor(f);
              vec2 fr = fract(f);
              vec2 t00 = (i0 + vec2(0.5, 0.5)) / 512.0;
              vec2 t10 = (i0 + vec2(1.5, 0.5)) / 512.0;
              vec2 t01 = (i0 + vec2(0.5, 1.5)) / 512.0;
              vec2 t11 = (i0 + vec2(1.5, 1.5)) / 512.0;

              vec4 s00 = texture2D(uHeightMask, t00);
              vec4 s10 = texture2D(uHeightMask, t10);
              vec4 s01 = texture2D(uHeightMask, t01);
              vec4 s11 = texture2D(uHeightMask, t11);

              float h00 = (s00.r * 255.0 * 256.0 + s00.g * 255.0) / 65535.0 * 255.0 - 20.0;
              float h10 = (s10.r * 255.0 * 256.0 + s10.g * 255.0) / 65535.0 * 255.0 - 20.0;
              float h01 = (s01.r * 255.0 * 256.0 + s01.g * 255.0) / 65535.0 * 255.0 - 20.0;
              float h11 = (s11.r * 255.0 * 256.0 + s11.g * 255.0) / 65535.0 * 255.0 - 20.0;

              float h = mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);
              float mGrass = mix(mix(s00.b, s10.b, fr.x), mix(s01.b, s11.b, fr.x), fr.y);
              float mFlower = mix(mix(s00.a, s10.a, fr.x), mix(s01.a, s11.a, fr.x), fr.y);
              return vec3(h, mGrass, mFlower);
            }`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            // Toroidally wrap each clump around uFocusPos.xz with zero CPU overhead!
            vec2 rel = mod(aSlot.xz - uFocusPos.xz + uPatchSpan * 0.5, uPatchSpan) - uPatchSpan * 0.5;
            vec2 worldXZ = uFocusPos.xz + rel;

            vec3 hm = sampleWorldHeightMask(worldXZ);
            float distFade = 1.0 - smoothstep(uPatchSpan * 0.36, uPatchSpan * 0.49, length(rel));
            float allow = smoothstep(0.42, 0.78, ${isFlower ? 'hm.z' : 'hm.y'});
            float finalScale = aSlot.w * distFade * allow;

            float cy = cos(aSlot.y);
            float sy = sin(aSlot.y);
            vec3 localP = transformed * finalScale;
            vec3 rotP = vec3(localP.x * cy + localP.z * sy, localP.y, -localP.x * sy + localP.z * cy);

            // Rolling meadow wind wave
            float bend = smoothstep(0.05, 0.85, transformed.y) * finalScale;
            float wave = sin(uWindTime * 2.3 + worldXZ.x * 0.14 + worldXZ.y * 0.11) * 0.18;
            rotP.x += wave * bend;
            rotP.z += cos(uWindTime * 1.9 + worldXZ.y * 0.13) * 0.12 * bend;

            transformed = vec3(worldXZ.x + rotP.x, hm.x - 0.04 + rotP.y, worldXZ.y + rotP.z);`
          );
      };
      return mat;
    };

    const spawnLayer = (meshProto, count, baseScale, isFlower) => {
      if (!meshProto) return;
      const geo = meshProto.geometry.clone();
      const rng = mulberry32(isFlower ? 88412 : 33917);
      const slots = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        slots[i * 4] = rng() * patchSpan;
        slots[i * 4 + 1] = rng() * Math.PI * 2;
        slots[i * 4 + 2] = rng() * patchSpan;
        slots[i * 4 + 3] = baseScale * (0.75 + rng() * 0.65);
      }
      geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 4));

      const mat = attachToroidalShader(meshProto.material, isFlower);
      const inst = new THREE.InstancedMesh(geo, mat, count);
      inst.frustumCulled = false; // Always surrounds active camera!
      inst.castShadow = false;
      inst.receiveShadow = true;

      const identity = new THREE.Matrix4();
      for (let i = 0; i < count; i++) inst.setMatrixAt(i, identity);
      inst.instanceMatrix.needsUpdate = true;
      scene.add(inst);
    };

    spawnLayer(grassMesh, 14000, 0.92, false);
    spawnLayer(flWhite, 900, 0.72, true);
    spawnLayer(flYellow, 900, 0.72, true);
    spawnLayer(flBlue, 750, 0.70, true);
  }

  // =========================================================================
  // 4. ANIMATED 3D WILDLIFE (Horses in Pastures, Birds over Lake, Forest Foxes)
  // =========================================================================
  async _buildAnimatedWildlife(scene) {
    const rng = mulberry32(60419);

    // A. Galloping / Grazing Horses in Fenced Golden Plains Pastures!
    try {
      const horseGltf = await this.gltfLoader.loadAsync('/models/Horse.glb');
      for (const pad of this.villageInfra.horsePastureCenters) {
        for (let h = 0; h < 3; h++) {
          const model = horseGltf.scene.clone(true);
          model.scale.setScalar(0.0115); // Official Three.js Horse.glb is in cm (~200 units tall) -> ~2.1m!
          model.traverse((c) => {
            if (c.isMesh) {
              c.castShadow = true;
              c.receiveShadow = true;
            }
          });
          scene.add(model);

          if (horseGltf.animations?.length) {
            const mixer = new THREE.AnimationMixer(model);
            const action = mixer.clipAction(horseGltf.animations[0]);
            action.timeScale = 0.75 + rng() * 0.35;
            action.time = rng() * 2.0;
            action.play();
            this.mixers.push(mixer);
          }

          this.trottingAnimals.push({
            mesh: model,
            cx: pad.x,
            cz: pad.z,
            radius: 7.0 + h * 4.2,
            angle: rng() * Math.PI * 2,
            speed: (0.28 + rng() * 0.16) * (h % 2 === 0 ? 1 : -1),
          });
        }
      }
    } catch (e) {
      console.warn('Horse load skipped:', e);
    }

    // B. Flocks of Storks & Flamingos Soaring Over Emerald Mirror Lake & Silver River!
    for (const [birdUrl, flockCenter] of [
      ['/models/Stork.glb', { x: -640, y: 58, z: -480, count: 6, r: 120 }],
      ['/models/Flamingo.glb', { x: -120, y: 52, z: 45, count: 5, r: 95 }],
    ]) {
      try {
        const gltf = await this.gltfLoader.loadAsync(birdUrl);
        for (let b = 0; b < flockCenter.count; b++) {
          const bird = gltf.scene.clone(true);
          bird.scale.setScalar(0.028);
          scene.add(bird);

          if (gltf.animations?.length) {
            const mixer = new THREE.AnimationMixer(bird);
            const act = mixer.clipAction(gltf.animations[0]);
            act.timeScale = 0.9 + rng() * 0.25;
            act.time = rng() * 1.5;
            act.play();
            this.mixers.push(mixer);
          }

          this.circlingBirds.push({
            mesh: bird,
            cx: flockCenter.x,
            cz: flockCenter.z,
            baseY: flockCenter.y + b * 3.5,
            radius: flockCenter.r + b * 14,
            angle: (b / flockCenter.count) * Math.PI * 2,
            speed: 0.16 + rng() * 0.05,
          });
        }
      } catch (e) {
        console.warn('Bird load skipped:', e);
      }
    }

    // C. Forest Foxes near Silverpine & Whispering Oaks Trails!
    try {
      const foxGltf = await this.gltfLoader.loadAsync('/models/Fox.glb');
      const foxZones = [
        { x: 1060, z: -565, r: 18 },
        { x: -1215, z: 1320, r: 16 },
      ];
      for (const fz of foxZones) {
        const fox = foxGltf.scene.clone(true);
        fox.scale.setScalar(0.014);
        fox.traverse((c) => { if (c.isMesh) c.castShadow = true; });
        scene.add(fox);

        if (foxGltf.animations?.length) {
          const clip = foxGltf.animations[1] || foxGltf.animations[0];
          const mixer = new THREE.AnimationMixer(fox);
          mixer.clipAction(clip).play();
          this.mixers.push(mixer);
        }
        this.trottingAnimals.push({
          mesh: fox,
          cx: fz.x,
          cz: fz.z,
          radius: fz.r,
          angle: rng() * Math.PI * 2,
          speed: 0.42,
        });
      }
    } catch (e) {
      console.warn('Fox load skipped:', e);
    }
  }

  update(dt, elapsed, focusPos) {
    for (const u of this.windUniforms) u.value = elapsed;
    if (focusPos) {
      for (const f of this.grassFocusUniforms) f.value.copy(focusPos);
    }
    for (const m of this.mixers) m.update(dt);

    for (const b of this.circlingBirds) {
      b.angle += dt * b.speed;
      const bx = b.cx + Math.cos(b.angle) * b.radius;
      const bz = b.cz + Math.sin(b.angle) * b.radius;
      b.mesh.position.set(bx, b.baseY + Math.sin(elapsed * 0.9 + b.angle) * 2.5, bz);
      b.mesh.rotation.y = -b.angle;
    }

    for (const a of this.trottingAnimals) {
      a.angle += dt * a.speed;
      const ax = a.cx + Math.cos(a.angle) * a.radius;
      const az = a.cz + Math.sin(a.angle) * a.radius;
      const ay = this.network.getTerrainHeight(ax, az);
      a.mesh.position.set(ax, ay, az);
      // Tangent heading along circle
      const dx = -Math.sin(a.angle) * Math.sign(a.speed);
      const dz = Math.cos(a.angle) * Math.sign(a.speed);
      a.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }
}
