import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ROAD_HIGHWAY,
  ROAD_COUNTRY,
  ROAD_COBBLESTONE,
  ROAD_TRAIL,
} from './RoadAndWaterNetwork.js';

export class RoadMeshAndInfraBuilder {
  constructor(network, texLoader) {
    this.network = network;
    this.texLoader = texLoader;
    this.lampBulbMat = null;
    this.reflectorMat = null;
  }

  _loadPBR(name) {
    const col = this.texLoader.load(`/textures/pbr/${name}_color.jpg`);
    const nrm = this.texLoader.load(`/textures/pbr/${name}_normal.jpg`);
    const rgh = this.texLoader.load(`/textures/pbr/${name}_roughness.jpg`);
    for (const t of [col, nrm, rgh]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
    }
    col.colorSpace = THREE.SRGBColorSpace;
    return { col, nrm, rgh };
  }

  buildAll(scene) {
    const asphaltPBR = this._loadPBR('asphalt');
    const cobblePBR = this._loadPBR('cobblestone');
    const gravelPBR = this._loadPBR('gravel');
    const stonePBR = this._loadPBR('stonewall');
    const woodCol = this.texLoader.load('/textures/pbr/wood_color.jpg');
    woodCol.wrapS = woodCol.wrapT = THREE.RepeatWrapping;
    woodCol.colorSpace = THREE.SRGBColorSpace;

    const highwayMat = this._createPaintedRoadMaterial(asphaltPBR, true);
    const countryMat = this._createPaintedRoadMaterial(asphaltPBR, false);
    const cobbleMat = this._createCobbleMaterial(cobblePBR);
    const trailMat = this._createTrailMaterial(gravelPBR);

    // 1. Build 3D Crowned Road Ribbons
    for (const road of this.network.roads) {
      let mat = countryMat;
      let yBias = 0.05;
      if (road.type === ROAD_HIGHWAY) { mat = highwayMat; yBias = 0.08; }
      else if (road.type === ROAD_COUNTRY) { mat = countryMat; yBias = 0.06; }
      else if (road.type === ROAD_COBBLESTONE) { mat = cobbleMat; yBias = 0.04; }
      else if (road.type === ROAD_TRAIL) { mat = trailMat; yBias = 0.03; }

      const mesh = this._extrudeRoadRibbon(road, mat, yBias);
      scene.add(mesh);

      // Add stone sidewalks/curbs along cobblestone village streets
      if (road.type === ROAD_COBBLESTONE) {
        const curbMesh = this._extrudeVillageCurbs(road, stonePBR);
        scene.add(curbMesh);
      }
    }

    // 2. Build Multi-Arch Stone Viaducts & Bridges over Rivers/Channels
    this._buildBridges(scene, stonePBR);

    // 3. Build Guardrails, Delineator Posts, Chevron Signs, Streetlamps & Power Poles
    this._buildRoadsideInfrastructure(scene, woodCol);
  }

  _createPaintedRoadMaterial(pbr, isHighway) {
    const mat = new THREE.MeshStandardMaterial({
      map: pbr.col,
      normalMap: pbr.nrm,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: pbr.rgh,
      roughness: 0.82,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: isHighway ? -3 : -2,
      polygonOffsetUnits: -2,
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aRoadCoord;\nvarying vec2 vRoadCoord;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadCoord = aRoadCoord;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoadCoord;')
        .replace(
          '#include <map_fragment>',
          `
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec3 roadCol = sampledDiffuseColor.rgb * ${isHighway ? '0.76' : '0.86'};

          // u in [-1.18, +1.18], where [-1, +1] is main paved carriageway, s is distance in meters
          float u = vRoadCoord.x;
          float s = vRoadCoord.y;
          float absU = abs(u);

          // Subtle darker polished dual tire-wear tracks per lane
          float laneCenter = ${isHighway ? '0.44' : '0.46'};
          float track1 = exp(-pow((absU - (laneCenter - 0.14)) * 9.0, 2.0));
          float track2 = exp(-pow((absU - (laneCenter + 0.14)) * 9.0, 2.0));
          roadCol *= 1.0 - 0.14 * (track1 + track2);

          // Outer shoulder gravel-asphalt transition
          float shoulder = smoothstep(0.94, 1.15, absU);
          roadCol = mix(roadCol, roadCol * vec3(1.18, 1.13, 1.04), shoulder);

          // Crisp Highway / Country Paint Markings
          vec3 whitePaint = vec3(0.92, 0.93, 0.90);
          vec3 yellowPaint = vec3(0.95, 0.74, 0.16);

          ${isHighway ? `
            // Double yellow center line on M1 Highway
            float centerDbl = (1.0 - smoothstep(0.011, 0.020, abs(absU - 0.024)));
            // Outer solid white edge lines
            float edgeLine = 1.0 - smoothstep(0.012, 0.022, abs(absU - 0.86));
            // Rumble strip ticks on shoulder
            float rumble = (1.0 - smoothstep(0.02, 0.04, abs(absU - 0.94))) * step(0.55, fract(s * 0.8));
            roadCol = mix(roadCol, yellowPaint, centerDbl * 0.92);
            roadCol = mix(roadCol, whitePaint, edgeLine * 0.90);
            roadCol = mix(roadCol, vec3(0.55), rumble * 0.35);
          ` : `
            // Dashed white centerline on Country Roads (4m dash every 10m)
            float dash = step(0.60, fract(s * 0.10));
            float centerDash = (1.0 - smoothstep(0.014, 0.025, absU)) * dash;
            float edgeLine = (1.0 - smoothstep(0.011, 0.022, abs(absU - 0.88))) * 0.78;
            roadCol = mix(roadCol, whitePaint, max(centerDash * 0.88, edgeLine));
          `}

          diffuseColor.rgb *= roadCol;
          `
        );
    };
    return mat;
  }

  _createCobbleMaterial(pbr) {
    return new THREE.MeshStandardMaterial({
      map: pbr.col,
      normalMap: pbr.nrm,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: pbr.rgh,
      roughness: 0.74,
      metalness: 0.03,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }

  _createTrailMaterial(pbr) {
    const mat = new THREE.MeshStandardMaterial({
      map: pbr.col,
      normalMap: pbr.nrm,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: pbr.rgh,
      roughness: 0.92,
      metalness: 0.0,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aRoadCoord;\nvarying vec2 vRoadCoord;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadCoord = aRoadCoord;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoadCoord;')
        .replace(
          '#include <map_fragment>',
          `
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          float u = vRoadCoord.x;
          float s = vRoadCoord.y;
          float absU = abs(u);

          // Dual dirt wheel tracks + grassy moss median hint in middle of forest trails
          float rut = exp(-pow((absU - 0.48) * 4.2, 2.0));
          float centerMoss = exp(-pow(absU * 4.5, 2.0)) * (0.4 + 0.4 * sin(s * 0.17));
          vec3 col = sampledDiffuseColor.rgb;
          col *= mix(1.04, 0.80, rut);
          col = mix(col, vec3(0.28, 0.38, 0.20), centerMoss * 0.48);

          // Soft organic feathered edges into forest floor / meadow
          float edgeNoise = 0.08 * sin(s * 0.9) + 0.05 * cos(s * 2.3);
          float alpha = 1.0 - smoothstep(0.72 + edgeNoise, 1.14 + edgeNoise, absU);
          diffuseColor.rgb *= col;
          diffuseColor.a *= alpha;
          `
        );
    };
    return mat;
  }

  _extrudeRoadRibbon(road, material, yBias) {
    const nodes = road.nodes;
    const N = nodes.length;
    // 5 vertices across width: [-1.16, -0.96, 0.0, +0.96, +1.16] * halfW
    const profU = [-1.15, -0.92, 0.0, 0.92, 1.15];
    const profDrop = [-0.20, -0.01, 0.05, -0.01, -0.20];
    const cols = profU.length;

    const positions = new Float32Array(N * cols * 3);
    const uvs = new Float32Array(N * cols * 2);
    const roadCoords = new Float32Array(N * cols * 2);
    const indices = [];

    let dist = 0;
    const texScale = road.type === ROAD_COBBLESTONE ? 0.28 : 0.16;

    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      if (i > 0) {
        dist += Math.hypot(n.x - nodes[i - 1].x, n.z - nodes[i - 1].z);
      }
      const rx = -n.tz;
      const rz = n.tx;
      const rLen = Math.hypot(rx, rz) || 1;
      const nx = rx / rLen;
      const nz = rz / rLen;

      for (let c = 0; c < cols; c++) {
        const u = profU[c];
        const drop = n.isBridge ? (Math.abs(u) > 1.0 ? -0.04 : 0.02) : profDrop[c];
        const off = u * road.halfW;
        const idx = i * cols + c;

        positions[idx * 3] = n.x + nx * off;
        positions[idx * 3 + 1] = n.y + yBias + drop;
        positions[idx * 3 + 2] = n.z + nz * off;

        uvs[idx * 2] = (off + road.halfW) * texScale;
        uvs[idx * 2 + 1] = dist * texScale;

        roadCoords[idx * 2] = u;
        roadCoords[idx * 2 + 1] = dist;
      }

      if (i < N - 1) {
        for (let c = 0; c < cols - 1; c++) {
          const a = i * cols + c;
          const b = a + 1;
          const d = (i + 1) * cols + c;
          const e = d + 1;
          indices.push(a, d, b, b, d, e);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aRoadCoord', new THREE.BufferAttribute(roadCoords, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  _extrudeVillageCurbs(road, stonePBR) {
    const group = new THREE.Group();
    const curbMat = new THREE.MeshStandardMaterial({
      map: stonePBR.col,
      normalMap: stonePBR.nrm,
      roughness: 0.78,
    });
    const nodes = road.nodes;
    const boxes = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < nodes.length - 1; i += 2) {
      const n0 = nodes[i];
      const n1 = nodes[Math.min(nodes.length - 1, i + 2)];
      if (n0.isBridge) continue;
      // Skip close to junctions with arterial road
      if (Math.hypot(n0.x - 180, n0.z + 42) < 12) continue;

      const mx = (n0.x + n1.x) * 0.5;
      const my = (n0.y + n1.y) * 0.5;
      const mz = (n0.z + n1.z) * 0.5;
      const dx = n1.x - n0.x;
      const dz = n1.z - n0.z;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 0.2) continue;
      const yaw = Math.atan2(dx, dz);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);

      for (const side of [-1, 1]) {
        const off = side * (road.halfW + 0.55);
        dummy.position.set(mx + rx * off, my + 0.08, mz + rz * off);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(1.1, 0.22, segLen + 0.15);
        dummy.updateMatrix();
        boxes.push(dummy.matrix.clone());
      }
    }

    if (boxes.length > 0) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const inst = new THREE.InstancedMesh(geo, curbMat, boxes.length);
      inst.receiveShadow = true;
      inst.castShadow = true;
      boxes.forEach((m, idx) => inst.setMatrixAt(idx, m));
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
    return group;
  }

  _buildBridges(scene, stonePBR) {
    const stoneMat = new THREE.MeshStandardMaterial({
      map: stonePBR.col,
      normalMap: stonePBR.nrm,
      roughnessMap: stonePBR.rgh,
      roughness: 0.78,
      metalness: 0.02,
    });

    const bridgeGroup = new THREE.Group();
    bridgeGroup.name = 'ViaductBridges';

    for (const br of this.network.bridges) {
      const nodes = br.nodes;
      if (nodes.length < 2) continue;
      const halfW = br.road.halfW + 0.95;

      // Build continuous bridge deck box segments + left/right stone parapets + piers
      let accumDist = 0;
      let nextPierAt = 7.0;

      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        const mz = (a.z + b.z) * 0.5;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const yaw = Math.atan2(dx, dz);
        const pitch = -Math.atan2(dy, len);

        const segGroup = new THREE.Group();
        segGroup.position.set(mx, my, mz);
        segGroup.rotation.order = 'YXZ';
        segGroup.rotation.set(pitch, yaw, 0);

        // Structural stone deck underside
        const deckGeo = new THREE.BoxGeometry(halfW * 2.0, 1.35, len + 0.35);
        const deck = new THREE.Mesh(deckGeo, stoneMat);
        deck.position.y = -0.68;
        deck.castShadow = true;
        deck.receiveShadow = true;
        segGroup.add(deck);

        // Stone parapet walls on both sides
        for (const side of [-1, 1]) {
          const wallGeo = new THREE.BoxGeometry(0.58, 1.18, len + 0.32);
          const wall = new THREE.Mesh(wallGeo, stoneMat);
          wall.position.set(side * (halfW - 0.28), 0.56, 0);
          wall.castShadow = true;
          wall.receiveShadow = true;
          segGroup.add(wall);
        }

        bridgeGroup.add(segGroup);

        // Tall tapered masonry viaduct piers down into riverbed every ~16m
        accumDist += len;
        if (accumDist >= nextPierAt && i < nodes.length - 2) {
          nextPierAt += 16.5;
          const bedY = this.network.getWaterCarvedHeight(mx, mz) - 2.5;
          const pierH = Math.max(3.0, (my - 1.1) - bedY);
          const pierGeo = new THREE.CylinderGeometry(halfW * 0.42, halfW * 0.54, pierH, 8);
          const pier = new THREE.Mesh(pierGeo, stoneMat);
          pier.position.set(mx, bedY + pierH * 0.5, mz);
          pier.rotation.y = yaw + Math.PI / 8;
          pier.castShadow = true;
          pier.receiveShadow = true;
          bridgeGroup.add(pier);

          // Arch capital flare at top of pier
          const capGeo = new THREE.BoxGeometry(halfW * 1.92, 1.6, 4.4);
          const cap = new THREE.Mesh(capGeo, stoneMat);
          cap.position.set(mx, my - 1.75, mz);
          cap.rotation.y = yaw;
          cap.castShadow = true;
          bridgeGroup.add(cap);
        }
      }
    }

    // Batch all static bridge stone segments & piers into a single draw call!
    bridgeGroup.updateMatrixWorld(true);
    const bridgeGeos = [];
    bridgeGroup.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      bridgeGeos.push(g);
    });
    if (bridgeGeos.length > 0) {
      const mergedBridge = mergeGeometries(bridgeGeos, false);
      mergedBridge.computeBoundingSphere();
      const singleBridgeMesh = new THREE.Mesh(mergedBridge, stoneMat);
      singleBridgeMesh.castShadow = true;
      singleBridgeMesh.receiveShadow = true;
      singleBridgeMesh.name = 'BatchedStoneViaducts';
      scene.add(singleBridgeMesh);
    }
  }

  _buildRoadsideInfrastructure(scene, woodCol) {
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0xb9c2cc,
      roughness: 0.36,
      metalness: 0.82,
    });
    const darkIronMat = new THREE.MeshStandardMaterial({
      color: 0x232931,
      roughness: 0.45,
      metalness: 0.78,
    });
    const whitePostMat = new THREE.MeshStandardMaterial({
      color: 0xf4f6f8,
      roughness: 0.5,
      metalness: 0.1,
    });
    this.reflectorMat = new THREE.MeshStandardMaterial({
      color: 0xff3b1f,
      emissive: 0xff2a00,
      emissiveIntensity: 0.55,
      roughness: 0.25,
    });
    this.lampBulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff0c2,
      emissive: 0xffb84d,
      emissiveIntensity: 0.4,
      roughness: 0.15,
    });
    const chevronSignMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.35,
      metalness: 0.25,
    });
    const woodPoleMat = new THREE.MeshStandardMaterial({
      map: woodCol,
      color: 0x7c5c43,
      roughness: 0.88,
    });

    const railBeamMatrices = [];
    const railPostMatrices = [];
    const delinPostMatrices = [];
    const delinReflMatrices = [];
    const lampPoleMatrices = [];
    const lampArmMatrices = [];
    const lampBulbMatrices = [];
    const chevronMatrices = [];
    const powerPoleMatrices = [];
    const powerLinePts = [];

    const dummy = new THREE.Object3D();

    for (const road of this.network.roads) {
      const nodes = road.nodes;
      let dist = 0;
      let nextDelin = 14;
      let nextLamp = 18;
      let nextChevron = 20;
      let nextPole = 25;
      let prevPoleTop = null;

      for (let i = 1; i < nodes.length - 1; i++) {
        const prev = nodes[i - 1];
        const curr = nodes[i];
        const next = nodes[i + 1];
        const step = Math.hypot(curr.x - prev.x, curr.z - prev.z);
        dist += step;

        const yaw = Math.atan2(next.x - prev.x, next.z - prev.z);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);

        // Curvature estimate for chevron warning signs & curve guardrails
        const yaw1 = Math.atan2(curr.x - prev.x, curr.z - prev.z);
        const yaw2 = Math.atan2(next.x - curr.x, next.z - curr.z);
        let dYaw = yaw2 - yaw1;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        const curvature = Math.abs(dYaw) / Math.max(0.5, step);

        // Check if near another road intersection so we never block cross-traffic!
        const checkCrossClear = (px, pz) => {
          for (const other of this.network.roads) {
            if (other === road) continue;
            // Quick sample check every 8th node
            for (let k = 0; k < other.nodes.length; k += 6) {
              const on = other.nodes[k];
              if (Math.abs(on.x - px) < other.halfW + 4.5 && Math.abs(on.z - pz) < other.halfW + 4.5) {
                return false;
              }
            }
          }
          return true;
        };

        // 1. Steel W-Beam Guardrails on Highway & Arterial embankments / curves
        if ((road.type === ROAD_HIGHWAY || road.type === ROAD_COUNTRY) && !curr.isBridge && i % 2 === 0) {
          const segLen = step * 2.05;
          for (const side of [-1, 1]) {
            const outX = curr.x + rx * side * (road.halfW + 6.5);
            const outZ = curr.z + rz * side * (road.halfW + 6.5);
            const drop = curr.y - this.network.getTerrainHeight(outX, outZ);
            const isOuterSharpTurn = curvature > 0.011 && Math.sign(dYaw) === -side;

            if ((drop > 1.55 || isOuterSharpTurn) && checkCrossClear(curr.x + rx * side * (road.halfW + 0.9), curr.z + rz * side * (road.halfW + 0.9))) {
              const gx = curr.x + rx * side * (road.halfW + 0.85);
              const gz = curr.z + rz * side * (road.halfW + 0.85);
              dummy.position.set(gx, curr.y + 0.58, gz);
              dummy.rotation.set(0, yaw, 0);
              dummy.scale.set(0.14, 0.32, segLen);
              dummy.updateMatrix();
              railBeamMatrices.push(dummy.matrix.clone());

              dummy.position.set(gx + rx * side * 0.08, curr.y + 0.36, gz + rz * side * 0.08);
              dummy.scale.set(0.12, 0.78, 0.12);
              dummy.updateMatrix();
              railPostMatrices.push(dummy.matrix.clone());
            }
          }
        }

        // 2. Reflective Roadside Delineator Posts every 34m on Highway & Country roads
        if ((road.type === ROAD_HIGHWAY || road.type === ROAD_COUNTRY) && dist >= nextDelin && !curr.isBridge) {
          nextDelin = dist + 34;
          for (const side of [-1, 1]) {
            const px = curr.x + rx * side * (road.halfW + 1.25);
            const pz = curr.z + rz * side * (road.halfW + 1.25);
            if (!checkCrossClear(px, pz)) continue;
            const py = this.network.getTerrainHeight(px, pz);

            dummy.position.set(px, py + 0.48, pz);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(0.13, 0.98, 0.08);
            dummy.updateMatrix();
            delinPostMatrices.push(dummy.matrix.clone());

            dummy.position.set(px, py + 0.82, pz);
            dummy.scale.set(0.15, 0.16, 0.10);
            dummy.updateMatrix();
            delinReflMatrices.push(dummy.matrix.clone());
          }
        }

        // 3. Sharp Curve Chevron Signs on M1 Highway & Highland Pass
        if (road.type === ROAD_HIGHWAY && curvature > 0.013 && dist >= nextChevron && !curr.isBridge) {
          nextChevron = dist + 22;
          const side = dYaw > 0 ? -1 : 1;
          const sx = curr.x + rx * side * (road.halfW + 2.1);
          const sz = curr.z + rz * side * (road.halfW + 2.1);
          if (checkCrossClear(sx, sz)) {
            const sy = this.network.getTerrainHeight(sx, sz);
            dummy.position.set(sx, sy + 1.85, sz);
            dummy.rotation.set(0, yaw + (side > 0 ? -0.35 : 0.35), 0);
            dummy.scale.set(0.95, 0.95, 0.08);
            dummy.updateMatrix();
            chevronMatrices.push(dummy.matrix.clone());

            dummy.position.set(sx, sy + 0.95, sz);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(0.09, 1.9, 0.09);
            dummy.updateMatrix();
            railPostMatrices.push(dummy.matrix.clone());
          }
        }

        // 4. Streetlamps in Village, near Festival Hub, Marina, and Bridges!
        const nearFestival = Math.hypot(curr.x + 480, curr.z - 560) < 260;
        const nearVillage = Math.hypot(curr.x - 195, curr.z + 40) < 245;
        const nearMarina = Math.hypot(curr.x + 355, curr.z + 315) < 150;
        const wantLamp = road.type === ROAD_COBBLESTONE || curr.isBridge || nearFestival || nearVillage || nearMarina;
        const lampSpacing = road.type === ROAD_COBBLESTONE ? 26 : 42;

        if (wantLamp && road.type !== ROAD_TRAIL && dist >= nextLamp) {
          nextLamp = dist + lampSpacing;
          const side = (Math.floor(dist / lampSpacing) % 2 === 0) ? 1 : -1;
          const lx = curr.x + rx * side * (road.halfW + (curr.isBridge ? 0.65 : 1.35));
          const lz = curr.z + rz * side * (road.halfW + (curr.isBridge ? 0.65 : 1.35));
          if (curr.isBridge || checkCrossClear(lx, lz)) {
            const ly = curr.isBridge ? curr.y + 0.9 : this.network.getTerrainHeight(lx, lz);
            const poleH = road.type === ROAD_COBBLESTONE ? 4.4 : 6.4;

            dummy.position.set(lx, ly + poleH * 0.5, lz);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(0.14, poleH, 0.14);
            dummy.updateMatrix();
            lampPoleMatrices.push(dummy.matrix.clone());

            // Overhanging arm toward road center
            const armLen = road.type === ROAD_COBBLESTONE ? 0.85 : 1.65;
            dummy.position.set(lx - rx * side * (armLen * 0.5), ly + poleH - 0.1, lz - rz * side * (armLen * 0.5));
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(armLen, 0.11, 0.11);
            dummy.updateMatrix();
            lampArmMatrices.push(dummy.matrix.clone());

            // Warm glowing lantern fixture
            dummy.position.set(lx - rx * side * armLen, ly + poleH - 0.28, lz - rz * side * armLen);
            dummy.scale.set(0.36, 0.28, 0.36);
            dummy.updateMatrix();
            lampBulbMatrices.push(dummy.matrix.clone());
          }
        }

        // 5. Countryside Wooden Utility Poles + Sagging Power Lines along Arterial Roads
        if ((road.id === 'valley_arterial' || road.id === 'silverpine_road') && !curr.isBridge && !nearVillage && dist >= nextPole) {
          nextPole = dist + 56;
          const px = curr.x + rx * (road.halfW + 3.8);
          const pz = curr.z + rz * (road.halfW + 3.8);
          if (checkCrossClear(px, pz) && !this.network.getWaterInfo(px, pz).inWater) {
            const py = this.network.getTerrainHeight(px, pz);
            const poleH = 8.2;
            dummy.position.set(px, py + poleH * 0.5, pz);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(0.22, poleH, 0.22);
            dummy.updateMatrix();
            powerPoleMatrices.push(dummy.matrix.clone());

            // Crossbar at top
            dummy.position.set(px, py + poleH - 0.55, pz);
            dummy.scale.set(2.1, 0.14, 0.14);
            dummy.updateMatrix();
            powerPoleMatrices.push(dummy.matrix.clone());

            const topPt = new THREE.Vector3(px, py + poleH - 0.5, pz);
            if (prevPoleTop && prevPoleTop.distanceTo(topPt) < 85) {
              // Catenary sagging wire segments (2 parallel wires)
              for (const wOff of [-0.8, 0.8]) {
                const segs = 8;
                for (let s = 0; s < segs; s++) {
                  const t0 = s / segs;
                  const t1 = (s + 1) / segs;
                  const sag0 = Math.sin(t0 * Math.PI) * 1.15;
                  const sag1 = Math.sin(t1 * Math.PI) * 1.15;
                  powerLinePts.push(
                    new THREE.Vector3().lerpVectors(prevPoleTop, topPt, t0).add(new THREE.Vector3(rx * wOff, -sag0, rz * wOff)),
                    new THREE.Vector3().lerpVectors(prevPoleTop, topPt, t1).add(new THREE.Vector3(rx * wOff, -sag1, rz * wOff))
                  );
                }
              }
            }
            prevPoleTop = topPt;
          } else {
            prevPoleTop = null;
          }
        }
      }
    }

    const addInstanced = (geo, mat, matrices, castShadow = true) => {
      if (!matrices.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
    };

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const cylGeo = new THREE.CylinderGeometry(0.5, 0.65, 1, 8);

    addInstanced(boxGeo, steelMat, railBeamMatrices, true);
    addInstanced(boxGeo, steelMat, railPostMatrices, false);
    addInstanced(boxGeo, whitePostMat, delinPostMatrices, false);
    addInstanced(boxGeo, this.reflectorMat, delinReflMatrices, false);
    addInstanced(cylGeo, darkIronMat, lampPoleMatrices, true);
    addInstanced(boxGeo, darkIronMat, lampArmMatrices, false);
    addInstanced(boxGeo, this.lampBulbMat, lampBulbMatrices, false);
    addInstanced(boxGeo, chevronSignMat, chevronMatrices, true);
    addInstanced(cylGeo, woodPoleMat, powerPoleMatrices, true);

    if (powerLinePts.length > 0) {
      const wireGeo = new THREE.BufferGeometry().setFromPoints(powerLinePts);
      const wireMat = new THREE.LineBasicMaterial({ color: 0x1e242b, transparent: true, opacity: 0.72 });
      scene.add(new THREE.LineSegments(wireGeo, wireMat));
    }
  }

  updateNightLighting(nightFactor) {
    if (this.lampBulbMat) {
      this.lampBulbMat.emissiveIntensity = 0.25 + nightFactor * 3.8;
    }
    if (this.reflectorMat) {
      this.reflectorMat.emissiveIntensity = 0.35 + nightFactor * 1.8;
    }
  }
}
