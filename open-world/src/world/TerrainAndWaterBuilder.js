import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { WORLD_SIZE, HALF_WORLD, LAKE_WATER_Y, POND_WATER_Y } from './WorldConfig.js';
import { ROAD_TRAIL } from './RoadAndWaterNetwork.js';
import { fbm2D, smoothstep } from './Noise.js';

export class TerrainAndWaterBuilder {
  constructor(network, texLoader) {
    this.network = network;
    this.texLoader = texLoader;
    this.waterObjects = [];
    this.riverMaterials = [];
  }

  _loadRepeatTex(url, isSRGB = true) {
    const t = this.texLoader.load(url);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (isSRGB) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  buildTerrain(scene) {
    const segs = 480; // High-detail 4000m x 4000m core terrain (~8.3m spacing)
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const count = pos.count;
    const biomeAttr = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.network.getTerrainHeight(x, z);
      pos.setY(i, y);

      // Compute biome weights
      const forest = this.network.getForestDensity(x, z);
      // Patchwork field pattern for SE farmlands
      const rawFarm = this.network.getFarmlandMask(x, z);
      const fieldPatch = smoothstep(-0.15, 0.25, Math.sin(x * 0.011 + 0.6) * Math.cos(z * 0.0105 - 0.4) + fbm2D(x * 0.004, z * 0.004, 2) * 0.35);
      const farm = rawFarm * fieldPatch * (1.0 - forest * 0.8);

      // Shoreline gravel/sand & dirt trail verge
      const lf = this.network.getLakeSignedFactor(x, z);
      const pf = this.network.getPondSignedFactor(x, z);
      const rDist = this.network._sampleGridBilinear(this.network.riverDist, x, z);
      const rHalfW = this.network._sampleGridBilinear(this.network.riverHalfW, x, z);

      const lakeShore = 1.0 - smoothstep(0.92, 1.24, lf);
      const pondShore = 1.0 - smoothstep(0.92, 1.28, pf);
      const riverShore = 1.0 - smoothstep(rHalfW - 2.0, rHalfW + 14.0, rDist);

      const roadDist = this.network._sampleGridBilinear(this.network.roadDist, x, z);
      const roadHalfW = this.network._sampleGridBilinear(this.network.roadHalfW, x, z);
      const gridIdx = this.network._nearestGridIdx(x, z);
      const rType = this.network.roadType[gridIdx];
      const trailVerge = rType === ROAD_TRAIL
        ? 1.0 - smoothstep(roadHalfW * 0.6, roadHalfW + 5.5, roadDist)
        : (1.0 - smoothstep(roadHalfW + 0.2, roadHalfW + 4.2, roadDist)) * 0.55;

      const gravelShore = Math.min(1.0, Math.max(lakeShore, pondShore, riverShore, trailVerge));

      // Wetness near water surface
      const wInfo = this.network.getWaterInfo(x, z);
      const nearLakeWet = (1.0 - smoothstep(0.98, 1.12, lf)) * (1.0 - smoothstep(LAKE_WATER_Y, LAKE_WATER_Y + 1.3, y));
      const nearRiverWet = (1.0 - smoothstep(rHalfW - 1.0, rHalfW + 5.5, rDist));
      const wetness = wInfo.inWater ? 0.95 : Math.min(1.0, Math.max(nearLakeWet, nearRiverWet));

      biomeAttr[i * 4] = forest;
      biomeAttr[i * 4 + 1] = farm;
      biomeAttr[i * 4 + 2] = gravelShore;
      biomeAttr[i * 4 + 3] = wetness;
    }

    geo.setAttribute('aBiome', new THREE.BufferAttribute(biomeAttr, 4));
    geo.computeVertexNormals();

    // Load seamless PBR maps
    const grassCol = this._loadRepeatTex('/textures/pbr/grass_lush_color.jpg', true);
    const grassNrm = this._loadRepeatTex('/textures/pbr/grass_lush_normal.jpg', false);
    const forestCol = this._loadRepeatTex('/textures/pbr/forest_floor_color.jpg', true);
    const forestNrm = this._loadRepeatTex('/textures/pbr/forest_floor_normal.jpg', false);
    const farmCol = this._loadRepeatTex('/textures/pbr/farmland_color.jpg', true);
    const gravelCol = this._loadRepeatTex('/textures/pbr/gravel_color.jpg', true);
    const gravelNrm = this._loadRepeatTex('/textures/pbr/gravel_normal.jpg', false);
    const rockCol = this._loadRepeatTex('/textures/pbr/cliffrock_color.jpg', true);
    const rockNrm = this._loadRepeatTex('/textures/pbr/cliffrock_normal.jpg', false);

    const terrainMat = new THREE.MeshStandardMaterial({
      roughness: 0.86,
      metalness: 0.02,
      envMapIntensity: 0.65,
    });

    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGrassCol = { value: grassCol };
      shader.uniforms.uGrassNrm = { value: grassNrm };
      shader.uniforms.uForestCol = { value: forestCol };
      shader.uniforms.uForestNrm = { value: forestNrm };
      shader.uniforms.uFarmCol = { value: farmCol };
      shader.uniforms.uGravelCol = { value: gravelCol };
      shader.uniforms.uGravelNrm = { value: gravelNrm };
      shader.uniforms.uRockCol = { value: rockCol };
      shader.uniforms.uRockNrm = { value: rockNrm };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aBiome;
          varying vec4 vBiome;
          varying vec3 vWorldPos;
          varying vec3 vWorldNorm;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vBiome = aBiome;
          vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uGrassCol;
          uniform sampler2D uGrassNrm;
          uniform sampler2D uForestCol;
          uniform sampler2D uForestNrm;
          uniform sampler2D uFarmCol;
          uniform sampler2D uGravelCol;
          uniform sampler2D uGravelNrm;
          uniform sampler2D uRockCol;
          uniform sampler2D uRockNrm;
          varying vec4 vBiome;
          varying vec3 vWorldPos;
          varying vec3 vWorldNorm;

          float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }
          float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash21(i);
            float b = hash21(i + vec2(1.0, 0.0));
            float c = hash21(i + vec2(0.0, 1.0));
            float d = hash21(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }`
        )
        .replace(
          '#include <map_fragment>',
          `
          vec2 uvDetail = vWorldPos.xz * 0.085;
          vec2 uvMacro  = vWorldPos.xz * 0.014;

          // Macro natural meadow color variation (eliminates tiling across 4x4 km!)
          float macroVar = vnoise(vWorldPos.xz * 0.0045) * 0.6 + vnoise(vWorldPos.xz * 0.017) * 0.4;

          vec3 grassDetail = texture2D(uGrassCol, uvDetail).rgb;
          vec3 grassMacro  = texture2D(uGrassCol, uvMacro + vec2(0.37, 0.71)).rgb;
          vec3 grassAlb = mix(grassDetail, grassMacro, 0.42);
          // Forza Horizon sunlit olive-emerald variation
          grassAlb *= mix(vec3(0.84, 0.96, 0.74), vec3(1.12, 1.06, 0.82), macroVar);

          vec3 forestAlb = texture2D(uForestCol, vWorldPos.xz * 0.095).rgb * mix(0.85, 1.08, macroVar);

          // Farmland with subtle directional crop furrow rows
          vec2 farmUV = vWorldPos.xz * 0.065;
          float cropRows = 0.93 + 0.07 * sin(vWorldPos.x * 1.85 + vWorldPos.z * 0.65);
          vec3 farmAlb = texture2D(uFarmCol, farmUV).rgb * cropRows;

          vec3 gravelAlb = texture2D(uGravelCol, vWorldPos.xz * 0.12).rgb;

          // Triplanar rock cliff projection for steep mountain slopes & gorges
          vec3 triW = pow(abs(vWorldNorm), vec3(4.0));
          triW /= max(0.0001, triW.x + triW.y + triW.z);
          vec3 rockX = texture2D(uRockCol, vWorldPos.zy * 0.055).rgb;
          vec3 rockY = texture2D(uRockCol, vWorldPos.xz * 0.055).rgb;
          vec3 rockZ = texture2D(uRockCol, vWorldPos.xy * 0.055).rgb;
          vec3 rockAlb = rockX * triW.x + rockY * triW.y + rockZ * triW.z;

          float slope = 1.0 - clamp(vWorldNorm.y, 0.0, 1.0);
          float highAlt = smoothstep(72.0, 122.0, vWorldPos.y);
          float cliffMask = clamp(smoothstep(0.17, 0.36, slope) + highAlt * smoothstep(0.08, 0.24, slope), 0.0, 1.0);

          vec3 col = grassAlb;
          col = mix(col, forestAlb, clamp(vBiome.x * 0.92, 0.0, 1.0));
          col = mix(col, farmAlb, clamp(vBiome.y, 0.0, 1.0));
          col = mix(col, gravelAlb, clamp(vBiome.z, 0.0, 1.0));
          col = mix(col, rockAlb, cliffMask);

          // Wet shoreline darkening & alpine peak snow dusting above y=132m
          col *= mix(1.0, 0.56, vBiome.w);
          float peakFrost = smoothstep(126.0, 155.0, vWorldPos.y) * smoothstep(0.35, 0.12, slope);
          col = mix(col, vec3(0.92, 0.94, 0.97), peakFrost * 0.65);

          diffuseColor.rgb *= col;
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
          roughnessFactor = mix(roughnessFactor, 0.76, smoothstep(0.17, 0.36, 1.0 - clamp(vWorldNorm.y, 0.0, 1.0)));
          roughnessFactor = mix(roughnessFactor, 0.24, vBiome.w * 0.85);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `
          vec3 nGrass  = texture2D(uGrassNrm, vWorldPos.xz * 0.085).xyz * 2.0 - 1.0;
          vec3 nForest = texture2D(uForestNrm, vWorldPos.xz * 0.095).xyz * 2.0 - 1.0;
          vec3 nGravel = texture2D(uGravelNrm, vWorldPos.xz * 0.12).xyz * 2.0 - 1.0;
          vec3 nRock   = texture2D(uRockNrm, vWorldPos.xz * 0.055).xyz * 2.0 - 1.0;

          float slpN = smoothstep(0.17, 0.36, 1.0 - clamp(vWorldNorm.y, 0.0, 1.0));
          vec3 detailN = mix(nGrass, nForest, vBiome.x);
          detailN = mix(detailN, nGravel, vBiome.z);
          detailN = mix(detailN, nRock * 1.4, slpN);

          // Perturb view-space normal subtly for crisp sunlight micro-relief
          vec3 worldPerturb = normalize(vWorldNorm + vec3(detailN.x * 0.38, 0.0, detailN.y * 0.38));
          normal = normalize((viewMatrix * vec4(worldPerturb, 0.0)).xyz);
          `
        );
    };

    const terrainMesh = new THREE.Mesh(geo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = false;
    terrainMesh.name = 'CoreTerrain4x4km';
    scene.add(terrainMesh);

    // Distant Horizon Mountain Ring (4km -> 11km) so world never ends abruptly
    this._buildDistantHorizonBackdrop(scene, rockCol, grassCol);

    return terrainMesh;
  }

  _buildDistantHorizonBackdrop(scene, rockCol, grassCol) {
    const outerSize = 11500;
    const segs = 140;
    const geo = new THREE.PlaneGeometry(outerSize, outerSize, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const insideCore = Math.abs(x) < HALF_WORLD - 45 && Math.abs(z) < HALF_WORLD - 45;
      if (insideCore) {
        // Depress well underneath core terrain & lakebed so it never pokes through
        pos.setY(i, -26.0);
      } else {
        const edgeBlend = smoothstep(HALF_WORLD - 45, HALF_WORLD + 220, Math.max(Math.abs(x), Math.abs(z)));
        const coreH = this.network.getTerrainHeight(
          Math.max(-HALF_WORLD, Math.min(HALF_WORLD, x)),
          Math.max(-HALF_WORLD, Math.min(HALF_WORLD, z))
        );
        const farH = this.network.getBaseLandHeight(x, z);
        pos.setY(i, THREE.MathUtils.lerp(coreH - 1.2, farH, edgeBlend));
      }
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x5c7252,
      roughness: 0.92,
      metalness: 0.0,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRock = { value: rockCol };
      shader.uniforms.uGrass = { value: grassCol };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix)*objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uRock;\nuniform sampler2D uGrass;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace(
          '#include <map_fragment>',
          `vec3 g = texture2D(uGrass, vWPos.xz * 0.015).rgb * vec3(0.85, 0.95, 0.80);
           vec3 r = texture2D(uRock, vWPos.xz * 0.02).rgb;
           float sl = smoothstep(0.15, 0.38, 1.0 - clamp(vWNrm.y, 0.0, 1.0));
           vec3 c = mix(g, r, clamp(sl + smoothstep(85.0, 165.0, vWPos.y) * 0.7, 0.0, 1.0));
           c = mix(c, vec3(0.90, 0.93, 0.97), smoothstep(145.0, 210.0, vWPos.y) * 0.75);
           diffuseColor.rgb = c;`
        );
    };

    const backdrop = new THREE.Mesh(geo, mat);
    backdrop.receiveShadow = false;
    scene.add(backdrop);
  }

  buildWater(scene) {
    const waterNormals = this._loadRepeatTex('/textures/water/waternormals.jpg', false);

    // 1. Emerald Mirror Lake (Real-time planar reflection Water!)
    const lakeGeo = new THREE.PlaneGeometry(1260, 940);
    const lakeWater = new Water(lakeGeo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: waterNormals,
      sunDirection: new THREE.Vector3(0.6, 0.3, -0.7).normalize(),
      sunColor: 0xffb36b,
      waterColor: 0x0a5468,
      distortionScale: 2.2,
      fog: true,
    });
    lakeWater.rotation.x = -Math.PI / 2;
    lakeWater.position.set(-745, LAKE_WATER_Y, -490);
    scene.add(lakeWater);
    this.waterObjects.push(lakeWater);

    // 2. Willow Forest Pond
    const pondGeo = new THREE.PlaneGeometry(310, 240);
    const pondWater = new Water(pondGeo, {
      textureWidth: 256,
      textureHeight: 256,
      waterNormals: waterNormals,
      sunDirection: new THREE.Vector3(0.6, 0.3, -0.7).normalize(),
      sunColor: 0xffb36b,
      waterColor: 0x0d4f56,
      distortionScale: 1.4,
      fog: true,
    });
    pondWater.rotation.x = -Math.PI / 2;
    pondWater.position.set(1015, POND_WATER_Y, -675);
    scene.add(pondWater);
    this.waterObjects.push(pondWater);

    // 3. Silver River & Lake Outlet (Sloping Flowing Water Ribbon Shader!)
    for (const rv of this.network.rivers) {
      this._buildFlowingRiverRibbon(scene, rv, waterNormals);
    }
  }

  _buildFlowingRiverRibbon(scene, rv, waterNormals) {
    const segs = Math.floor(rv.samples / 3);
    const positions = new Float32Array((segs + 1) * 2 * 3);
    const uvs = new Float32Array((segs + 1) * 2 * 2);
    const indices = [];

    const pt = new THREE.Vector3();
    const tan = new THREE.Vector3();
    let distAcc = 0;
    let prevPt = null;

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      rv.curve.getPoint(t, pt);
      rv.curve.getTangent(t, tan);
      if (prevPt) distAcc += pt.distanceTo(prevPt);
      prevPt = pt.clone();

      const hw = rv.widthFn(t) + 3.5; // Tuck cleanly under sloped riverbanks
      const wy = rv.waterYFn(t);
      const nx = -tan.z;
      const nz = tan.x;
      const nLen = Math.hypot(nx, nz) || 1;
      const rx = (nx / nLen) * hw;
      const rz = (nz / nLen) * hw;

      const vIdx = i * 2;
      positions[vIdx * 3] = pt.x - rx;
      positions[vIdx * 3 + 1] = wy;
      positions[vIdx * 3 + 2] = pt.z - rz;

      positions[(vIdx + 1) * 3] = pt.x + rx;
      positions[(vIdx + 1) * 3 + 1] = wy;
      positions[(vIdx + 1) * 3 + 2] = pt.z + rz;

      uvs[vIdx * 2] = 0;
      uvs[vIdx * 2 + 1] = distAcc * 0.04;
      uvs[(vIdx + 1) * 2] = 1;
      uvs[(vIdx + 1) * 2 + 1] = distAcc * 0.04;

      if (i < segs) {
        const a = vIdx;
        const b = vIdx + 1;
        const c = vIdx + 2;
        const d = vIdx + 3;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const riverMat = new THREE.MeshPhysicalMaterial({
      color: 0x115e72,
      roughness: 0.08,
      metalness: 0.12,
      transmission: 0.0,
      reflectivity: 0.95,
      clearcoat: 1.0,
      clearcoatRoughness: 0.09,
      normalMap: waterNormals,
      normalScale: new THREE.Vector2(0.55, 0.55),
      transparent: true,
      opacity: 0.90,
    });

    riverMat.onBeforeCompile = (shader) => {
      shader.uniforms.uFlowTime = { value: 0 };
      riverMat.userData.shader = shader;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFlowTime;')
        .replace(
          '#include <normal_fragment_maps>',
          `vec2 flowUV1 = vNormalMapUv * vec2(2.2, 1.0) + vec2(0.0, -uFlowTime * 0.16);
           vec2 flowUV2 = vNormalMapUv * vec2(3.7, 1.6) + vec2(0.31, -uFlowTime * 0.24);
           vec3 rn1 = texture2D(normalMap, flowUV1).xyz * 2.0 - 1.0;
           vec3 rn2 = texture2D(normalMap, flowUV2).xyz * 2.0 - 1.0;
           vec3 rBlend = normalize(rn1 + rn2);
           rBlend.xy *= normalScale;
           normal = normalize(tbn * rBlend);`
        );
    };

    const mesh = new THREE.Mesh(geo, riverMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    this.riverMaterials.push(riverMat);
  }

  update(elapsed, preset, sunDir) {
    for (const w of this.waterObjects) {
      w.material.uniforms.time.value = elapsed * 0.65;
      if (sunDir) w.material.uniforms.sunDirection.value.copy(sunDir);
      if (preset) {
        w.material.uniforms.sunColor.value.setHex(preset.waterSunColor);
        w.material.uniforms.waterColor.value.setHex(preset.waterColor);
      }
    }
    for (const rm of this.riverMaterials) {
      if (rm.userData.shader) {
        rm.userData.shader.uniforms.uFlowTime.value = elapsed;
      }
      if (preset) {
        rm.color.setHex(preset.waterColor);
      }
    }
  }
}
