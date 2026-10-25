import * as THREE from 'three';
import { CAR_PAINTS, HALF_WORLD, LANDMARKS } from '../world/WorldConfig.js';
import {
  ROAD_HIGHWAY,
  ROAD_COUNTRY,
  ROAD_COBBLESTONE,
  ROAD_TRAIL,
} from '../world/RoadAndWaterNetwork.js';

export class CarController {
  constructor(scene, camera, domElement, network, colliders, treeColliders, gltfLoader, texLoader) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.network = network;
    this.colliders = colliders;
    this.treeColliders = treeColliders;
    this.gltfLoader = gltfLoader;
    this.texLoader = texLoader;

    this.root = new THREE.Group();
    this.chassisTilt = new THREE.Group();
    this.root.add(this.chassisTilt);
    scene.add(this.root);

    // Initial spawn at Horizon Festival Hub facing the M1 Arch!
    this.pos = new THREE.Vector3(-466, 17.6, 546);
    this.vel = new THREE.Vector2(0, 0);
    this.heading = -0.82;
    this.speed = 0; // signed m/s along forward
    this.steerAngle = 0;
    this.wheelSpin = 0;
    this.rpm = 1100;
    this.gear = 1;
    this.isDrifting = false;
    this.slipRatio = 0;
    this.totalDistanceKm = 0;
    this.currentSurface = 'АСФАЛЬТ';

    // Modes: 'drive' | 'drone' | 'tour'
    this.mode = 'drive';
    this.chasePreset = 0; // 0 = Horizon Chase, 1 = Close Action, 2 = Hood Cam
    this.headlightsOn = false;
    this.manualHeadlightOverride = null;

    // Mouse look / Drone state
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.16;
    this.lastMouseTime = -10;
    this.isPointerDragging = false;
    this.dronePos = new THREE.Vector3(-420, 65, 590);
    this.droneYaw = -0.6;
    this.dronePitch = -0.22;
    this.tourTime = 0;

    // Camera smoothing state
    this.camCurrentPos = new THREE.Vector3(-458, 21, 556);
    this.camCurrentLook = new THREE.Vector3(-466, 18.5, 546);

    // Model parts
    this.bodyMat = null;
    this.tailLightMat = null;
    this.headlightSpots = [];
    this.wheels = { fl: null, fr: null, rl: null, rr: null };
    this.frontSteerPivots = { fl: null, fr: null };
    this.steeringWheel = null;

    // Input state
    this.keys = {};
    this._bindInputs();
    this._initParticles(scene);
  }

  _bindInputs() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys[e.code] = true;

      if (e.code === 'KeyC' && this.mode === 'drive') {
        this.chasePreset = (this.chasePreset + 1) % 3;
      } else if (e.code === 'KeyR' && this.mode === 'drive') {
        this.resetToNearestRoad();
      } else if (e.code === 'KeyH') {
        this.headlightsOn = !this.headlightsOn;
        this.manualHeadlightOverride = this.headlightsOn;
        this._syncHeadlights();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    this.domElement.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.isPointerDragging = true;
      }
    });
    window.addEventListener('pointerup', () => {
      this.isPointerDragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.isPointerDragging) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (this.mode === 'drone') {
        this.droneYaw -= dx * 0.0032;
        this.dronePitch = Math.max(-1.42, Math.min(1.35, this.dronePitch - dy * 0.0032));
      } else if (this.mode === 'drive') {
        this.orbitYawOffset -= dx * 0.0042;
        this.orbitPitchOffset = Math.max(0.03, Math.min(0.65, this.orbitPitchOffset + dy * 0.003));
        this.lastMouseTime = performance.now() * 0.001;
      }
    });
  }

  async loadCarModel() {
    const paint = CAR_PAINTS[0];
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: paint.hex,
      metalness: paint.metalness,
      roughness: paint.roughness,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.4,
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x111924,
      metalness: 0.15,
      roughness: 0.06,
      transparent: true,
      opacity: 0.68,
      envMapIntensity: 1.6,
    });

    this.tailLightMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c,
      emissive: 0xff1111,
      emissiveIntensity: 0.8,
      roughness: 0.18,
    });

    const gltf = await this.gltfLoader.loadAsync('/models/ferrari.glb');
    const carModel = gltf.scene;
    // Official ferrari.glb faces -Z; rotate Math.PI so +Z is forward!
    carModel.rotation.y = Math.PI;

    carModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const bodyMesh = carModel.getObjectByName('body');
    if (bodyMesh) bodyMesh.material = this.bodyMat;

    const glassMesh = carModel.getObjectByName('glass');
    if (glassMesh) glassMesh.material = glassMat;

    const lightsRed = carModel.getObjectByName('lights_red');
    if (lightsRed) lightsRed.material = this.tailLightMat;

    this.steeringWheel = carModel.getObjectByName('steering_wheel');

    // Wrap front wheels in steer pivots so spin (X) and steer (Y) compose cleanly!
    for (const key of ['fl', 'fr', 'rl', 'rr']) {
      const wObj = carModel.getObjectByName(`wheel_${key}`);
      if (!wObj) continue;
      if (key === 'fl' || key === 'fr') {
        const pivot = new THREE.Group();
        pivot.position.copy(wObj.position);
        wObj.parent.add(pivot);
        wObj.position.set(0, 0, 0);
        pivot.add(wObj);
        this.frontSteerPivots[key] = pivot;
      }
      this.wheels[key] = wObj;
    }

    // Contact Ambient Occlusion shadow decal under Ferrari
    const aoTex = this.texLoader.load('/models/ferrari_ao.png');
    const aoPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
      new THREE.MeshBasicMaterial({
        map: aoTex,
        blending: THREE.MultiplyBlending,
        toneMapped: false,
        transparent: true,
        premultipliedAlpha: true,
      })
    );
    aoPlane.rotation.x = -Math.PI / 2;
    aoPlane.position.y = 0.03;
    carModel.add(aoPlane);

    // Dual Xenon Headlight SpotLights (+Z forward in chassisTilt space)
    for (const sx of [-0.68, 0.68]) {
      const spot = new THREE.SpotLight(0xfff6e5, 0, 95, Math.PI / 4.8, 0.48, 1.35);
      spot.position.set(sx, 0.68, 2.05);
      const target = new THREE.Object3D();
      target.position.set(sx * 0.6, 0.1, 28.0);
      this.chassisTilt.add(spot, target);
      spot.target = target;
      this.headlightSpots.push(spot);
    }

    this.chassisTilt.add(carModel);
    this.pos.y = this.network.getDrivableHeight(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
  }

  setPaint(index) {
    const p = CAR_PAINTS[index % CAR_PAINTS.length];
    if (this.bodyMat && p) {
      this.bodyMat.color.set(p.hex);
      this.bodyMat.metalness = p.metalness;
      this.bodyMat.roughness = p.roughness;
    }
  }

  setNightMode(nightFactor) {
    if (this.manualHeadlightOverride === null) {
      this.headlightsOn = nightFactor > 0.2;
      this._syncHeadlights();
    }
  }

  _syncHeadlights() {
    for (const s of this.headlightSpots) {
      s.intensity = this.headlightsOn ? 38.0 : 0.0;
    }
  }

  setMode(newMode) {
    if (newMode === this.mode) return;
    if (newMode === 'drone') {
      this.dronePos.copy(this.camera.position);
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.droneYaw = Math.atan2(-dir.x, -dir.z);
      this.dronePitch = Math.asin(Math.max(-0.98, Math.min(0.98, dir.y)));
    }
    this.mode = newMode;
  }

  teleportTo(x, z, heading = 0) {
    const y = this.network.getDrivableHeight(x, z);
    this.pos.set(x, y, z);
    this.vel.set(0, 0);
    this.speed = 0;
    this.heading = heading;
    this.root.position.copy(this.pos);
    this.root.rotation.y = heading;

    const backX = x - Math.sin(heading) * 7.5;
    const backZ = z - Math.cos(heading) * 7.5;
    this.camCurrentPos.set(backX, y + 2.8, backZ);
    this.camCurrentLook.set(x, y + 1.1, z);

    if (this.mode === 'drone') {
      this.dronePos.set(x - Math.sin(heading) * 18, y + 16, z - Math.cos(heading) * 18);
      this.droneYaw = heading + Math.PI;
      this.dronePitch = -0.25;
    }
  }

  resetToNearestRoad() {
    let bestDist = Infinity;
    let bestNode = null;
    for (const road of this.network.roads) {
      for (let i = 0; i < road.nodes.length; i += 3) {
        const n = road.nodes[i];
        const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
        if (d < bestDist) {
          bestDist = d;
          bestNode = n;
        }
      }
    }
    if (bestNode) {
      const yaw = Math.atan2(bestNode.tx, bestNode.tz);
      this.teleportTo(bestNode.x, bestNode.z, yaw);
    }
  }

  // ---------- SMOKE, DUST & WATER SPRAY PARTICLES ----------
  _initParticles(scene) {
    const MAX_P = 180;
    this.pData = Array.from({ length: MAX_P }, () => ({
      life: 0, maxLife: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, size: 1, r: 1, g: 1, b: 1,
    }));
    this.pCursor = 0;

    const geo = new THREE.SphereGeometry(0.42, 7, 6);
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.particleMesh = new THREE.InstancedMesh(geo, mat, MAX_P);
    this.particleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3);
    this.particleMesh.frustumCulled = false;
    scene.add(this.particleMesh);
    this._pDummy = new THREE.Object3D();
    this._pColor = new THREE.Color();
  }

  _spawnParticle(x, y, z, vx, vy, vz, size, r, g, b, maxLife = 0.75) {
    const p = this.pData[this.pCursor];
    this.pCursor = (this.pCursor + 1) % this.pData.length;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size;
    p.r = r; p.g = g; p.b = b;
  }

  _updateParticles(dt) {
    for (let i = 0; i < this.pData.length; i++) {
      const p = this.pData[i];
      if (p.life <= 0) {
        this._pDummy.position.set(0, -999, 0);
        this._pDummy.scale.setScalar(0.001);
        this._pDummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this._pDummy.matrix);
        continue;
      }
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy += 0.65 * dt;
      const frac = 1.0 - p.life / p.maxLife;
      const sc = p.size * (0.55 + frac * 1.85) * Math.max(0, 1.0 - frac * 0.75);
      this._pDummy.position.set(p.x, p.y, p.z);
      this._pDummy.scale.setScalar(sc);
      this._pDummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this._pDummy.matrix);
      this._pColor.setRGB(p.r, p.g, p.b);
      this.particleMesh.setColorAt(i, this._pColor);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  // ---------- MAIN UPDATE ----------
  update(dt, elapsed) {
    if (this.mode === 'drone') {
      this._updateDroneMode(dt);
    } else if (this.mode === 'tour') {
      this._updateTourMode(dt, elapsed);
    } else {
      this._updateDrivePhysics(dt, elapsed);
      this._updateDriveCamera(dt);
    }
    this._updateParticles(dt);
  }

  _updateDrivePhysics(dt, elapsed) {
    const throttle = (this.keys['KeyW'] || this.keys['ArrowUp']) ? 1 : 0;
    const brake = (this.keys['KeyS'] || this.keys['ArrowDown']) ? 1 : 0;
    const steerLeft = (this.keys['KeyA'] || this.keys['ArrowLeft']) ? 1 : 0;
    const steerRight = (this.keys['KeyD'] || this.keys['ArrowRight']) ? 1 : 0;
    const handbrake = this.keys['Space'] ? 1 : 0;
    const nitro = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1 : 0;

    const surf = this.network.getSurfaceAt(this.pos.x, this.pos.z);
    let grip = 1.0;
    let dragMul = 1.0;
    if (surf.roadType === ROAD_HIGHWAY) {
      this.currentSurface = surf.isBridge ? 'МОСТ / ВИАДУК' : 'ШОССЕ АСФАЛЬТ';
      grip = 1.0;
    } else if (surf.roadType === ROAD_COUNTRY) {
      this.currentSurface = surf.isBridge ? 'КАМЕННЫЙ МОСТ' : 'ЗАГОРОДНОЕ ШОССЕ';
      grip = 0.96;
    } else if (surf.roadType === ROAD_COBBLESTONE) {
      this.currentSurface = 'БРУСЧАТКА';
      grip = 0.92;
    } else if (surf.roadType === ROAD_TRAIL) {
      this.currentSurface = 'ЛЕСНАЯ ТРОПА';
      grip = 0.80;
      dragMul = 1.15;
    } else if (surf.inWater) {
      this.currentSurface = 'БРОД / ВОДА';
      grip = 0.62;
      dragMul = 2.8;
    } else {
      this.currentSurface = 'ПОЛЕ / БЕЗДОРОЖЬЕ';
      grip = 0.75;
      dragMul = 1.32;
    }

    const fwdX = Math.sin(this.heading);
    const fwdZ = Math.cos(this.heading);
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);

    // Decompose velocity into forward & lateral components
    let vFwd = this.vel.x * fwdX + this.vel.y * fwdZ;
    let vLat = this.vel.x * rightX + this.vel.y * rightZ;

    // Steering response (smooth speed-sensitive turn angle)
    const steerInput = steerLeft - steerRight;
    const speedAbs = Math.abs(vFwd);
    const maxSteer = THREE.MathUtils.lerp(0.54, 0.19, Math.min(1, speedAbs / 68.0));
    const targetSteer = steerInput * maxSteer;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, targetSteer, Math.min(1, dt * 9.5));

    // Engine thrust & braking
    const maxTopSpeed = nitro ? 86.0 : 72.0; // ~260 - 310 km/h Ferrari 458 top speed!
    let accel = 0;
    if (throttle > 0) {
      const powerCurve = 1.0 - 0.45 * Math.min(1, Math.max(0, vFwd) / maxTopSpeed);
      accel += (26.5 + (nitro ? 14.0 : 0)) * powerCurve * grip;
    }
    if (brake > 0) {
      if (vFwd > 1.2) {
        accel -= 38.0 * grip;
      } else {
        // Reverse gear
        accel -= 14.5;
      }
    }
    if (handbrake > 0) {
      vFwd *= Math.max(0, 1.0 - dt * 2.2);
    }

    // Aerodynamic & rolling resistance
    const drag = (0.0042 * vFwd * Math.abs(vFwd) + 0.32 * vFwd) * dragMul;
    vFwd += (accel - drag) * dt;
    vFwd = Math.max(-18.0, Math.min(maxTopSpeed, vFwd));

    // Heading angular velocity & Forza Horizon Drift lateral grip!
    if (Math.abs(vFwd) > 0.35) {
      const dirSign = vFwd >= 0 ? 1 : -1;
      const turnRate = this.steerAngle * dirSign * Math.min(1.0, Math.abs(vFwd) / 6.5) * (handbrake ? 3.1 : 2.35);
      this.heading += turnRate * dt;
    }

    const latFriction = handbrake ? 2.1 : 8.5 * grip;
    vLat *= Math.exp(-latFriction * dt);

    // Recompose world velocity
    const nFwdX = Math.sin(this.heading);
    const nFwdZ = Math.cos(this.heading);
    const nRightX = Math.cos(this.heading);
    const nRightZ = -Math.sin(this.heading);

    this.vel.x = nFwdX * vFwd + nRightX * vLat;
    this.vel.y = nFwdZ * vFwd + nRightZ * vLat;
    this.speed = vFwd;
    this.slipRatio = Math.abs(vLat) / Math.max(4.0, Math.abs(vFwd));
    this.isDrifting = (handbrake > 0 && speedAbs > 8) || Math.abs(vLat) > 4.2;

    // Integrate position within 4x4 km world bounds
    let nextX = this.pos.x + this.vel.x * dt;
    let nextZ = this.pos.z + this.vel.y * dt;
    const bound = HALF_WORLD - 22;
    nextX = Math.max(-bound, Math.min(bound, nextX));
    nextZ = Math.max(-bound, Math.min(bound, nextZ));

    // Prevent driving into deep lake water (> 1.35m deep when not on a bridge!)
    const nextSurf = this.network.getSurfaceAt(nextX, nextZ);
    if (nextSurf.inWater && nextSurf.waterDepth > 1.35) {
      this.vel.multiplyScalar(-0.35);
      nextX = this.pos.x;
      nextZ = this.pos.z;
    }

    // Check building & trunk colliders
    const carRadius = 1.65;
    for (const c of this.colliders) {
      const dx = nextX - c.x;
      const dz = nextZ - c.z;
      const minD = c.r + carRadius;
      const dSq = dx * dx + dz * dz;
      if (dSq < minD * minD && dSq > 0.0001) {
        const d = Math.sqrt(dSq);
        const nx = dx / d;
        const nz = dz / d;
        nextX = c.x + nx * minD;
        nextZ = c.z + nz * minD;
        const vn = this.vel.x * nx + this.vel.y * nz;
        if (vn < 0) {
          this.vel.x -= 1.35 * vn * nx;
          this.vel.y -= 1.35 * vn * nz;
        }
      }
    }

    for (const tc of this.treeColliders) {
      const dx = nextX - tc.x;
      const dz = nextZ - tc.z;
      if (Math.abs(dx) > 3.0 || Math.abs(dz) > 3.0) continue;
      const minD = tc.r + 1.15;
      const dSq = dx * dx + dz * dz;
      if (dSq < minD * minD && dSq > 0.0001) {
        const d = Math.sqrt(dSq);
        const nx = dx / d;
        const nz = dz / d;
        nextX = tc.x + nx * minD;
        nextZ = tc.z + nz * minD;
        this.vel.multiplyScalar(0.6);
      }
    }

    const stepDist = Math.hypot(nextX - this.pos.x, nextZ - this.pos.z);
    this.totalDistanceKm += stepDist * 0.001;
    this.pos.x = nextX;
    this.pos.z = nextZ;
    this.pos.y = this.network.getDrivableHeight(nextX, nextZ);

    // Align chassis pitch & roll to terrain + dynamic suspension transfer!
    const hFront = this.network.getDrivableHeight(nextX + nFwdX * 1.6, nextZ + nFwdZ * 1.6);
    const hBack = this.network.getDrivableHeight(nextX - nFwdX * 1.6, nextZ - nFwdZ * 1.6);
    const hLeft = this.network.getDrivableHeight(nextX - nRightX * 0.9, nextZ - nRightZ * 0.9);
    const hRight = this.network.getDrivableHeight(nextX + nRightX * 0.9, nextZ + nRightZ * 0.9);

    const terrainPitch = -Math.atan2(hFront - hBack, 3.2);
    const terrainRoll = Math.atan2(hLeft - hRight, 1.8);
    const suspPitch = (brake > 0 && vFwd > 2 ? 0.025 : 0) - (throttle > 0 ? 0.018 : 0);
    const suspRoll = -this.steerAngle * Math.min(1, speedAbs / 30) * 0.055;

    this.root.position.copy(this.pos);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.heading;
    this.chassisTilt.rotation.x = THREE.MathUtils.lerp(this.chassisTilt.rotation.x, terrainPitch + suspPitch, Math.min(1, dt * 10));
    this.chassisTilt.rotation.z = THREE.MathUtils.lerp(this.chassisTilt.rotation.z, terrainRoll + suspRoll, Math.min(1, dt * 10));

    // Spin wheels & steer front wheels (Note: ferrari.glb is rotated PI around Y so +X spin rolls forward!)
    this.wheelSpin -= (vFwd * dt) / 0.34;
    for (const k of ['fl', 'fr', 'rl', 'rr']) {
      if (this.wheels[k]) this.wheels[k].rotation.x = this.wheelSpin;
    }
    if (this.frontSteerPivots.fl) this.frontSteerPivots.fl.rotation.y = this.steerAngle;
    if (this.frontSteerPivots.fr) this.frontSteerPivots.fr.rotation.y = this.steerAngle;
    if (this.steeringWheel) this.steeringWheel.rotation.z = -this.steerAngle * 3.5;

    // 7-Speed Gearbox & RPM simulation
    const kmh = Math.abs(vFwd) * 3.6;
    const gearThresholds = [0, 42, 78, 118, 160, 205, 250, 340];
    if (vFwd < -0.8) {
      this.gear = -1; // Reverse
      this.rpm = THREE.MathUtils.lerp(this.rpm, 1400 + Math.min(6200, kmh * 110), dt * 10);
    } else {
      let g = 1;
      while (g < 7 && kmh > gearThresholds[g]) g++;
      this.gear = g;
      const lo = gearThresholds[g - 1] * 0.72;
      const hi = gearThresholds[g];
      const gearRatio = Math.max(0, Math.min(1, (kmh - lo) / Math.max(10, hi - lo)));
      const targetRpm = 1150 + gearRatio * 7250 + (throttle ? 450 : 0);
      this.rpm = THREE.MathUtils.lerp(this.rpm, Math.min(8800, targetRpm), dt * 12);
    }

    // Brake light glow
    if (this.tailLightMat) {
      const braking = brake > 0 || handbrake > 0;
      this.tailLightMat.emissiveIntensity = braking ? 4.8 : (this.headlightsOn ? 1.4 : 0.45);
    }

    // Emit drift tire smoke, trail dust, or shallow ford water splash!
    if (speedAbs > 5.0) {
      const rearX = this.pos.x - nFwdX * 1.55;
      const rearZ = this.pos.z - nFwdZ * 1.55;
      if (this.isDrifting && (surf.roadType === ROAD_HIGHWAY || surf.roadType === ROAD_COUNTRY || surf.roadType === ROAD_COBBLESTONE)) {
        for (const side of [-0.82, 0.82]) {
          this._spawnParticle(
            rearX + nRightX * side, this.pos.y + 0.22, rearZ + nRightZ * side,
            (Math.random() - 0.5) * 1.8, 0.7 + Math.random() * 0.8, (Math.random() - 0.5) * 1.8,
            0.95, 0.92, 0.93, 0.95, 0.85
          );
        }
      } else if (surf.roadType === ROAD_TRAIL || (surf.roadType === 0 && !surf.inWater && speedAbs > 10)) {
        if (Math.random() < 0.75) {
          const side = Math.random() > 0.5 ? 0.8 : -0.8;
          this._spawnParticle(
            rearX + nRightX * side, this.pos.y + 0.25, rearZ + nRightZ * side,
            (Math.random() - 0.5) * 1.5, 0.5 + Math.random() * 0.7, (Math.random() - 0.5) * 1.5,
            0.85, 0.68, 0.56, 0.42, 0.75
          );
        }
      } else if (surf.inWater) {
        for (const side of [-0.85, 0.85]) {
          this._spawnParticle(
            rearX + nRightX * side, this.pos.y + 0.35, rearZ + nRightZ * side,
            nRightX * side * 2.5, 2.2 + Math.random() * 1.5, nRightZ * side * 2.5,
            0.75, 0.82, 0.94, 1.0, 0.55
          );
        }
      }
    }
  }

  _updateDriveCamera(dt) {
    const now = performance.now() * 0.001;
    if (!this.isPointerDragging && now - this.lastMouseTime > 2.4) {
      this.orbitYawOffset = THREE.MathUtils.lerp(this.orbitYawOffset, 0, Math.min(1, dt * 2.8));
      this.orbitPitchOffset = THREE.MathUtils.lerp(this.orbitPitchOffset, 0.17, Math.min(1, dt * 2.8));
    }

    if (this.chasePreset === 2) {
      // Hood / Bonnet Motorsport Camera!
      const fwdX = Math.sin(this.heading);
      const fwdZ = Math.cos(this.heading);
      this.camera.position.set(
        this.pos.x + fwdX * 0.38,
        this.pos.y + 1.18,
        this.pos.z + fwdZ * 0.38
      );
      this.camera.lookAt(
        this.pos.x + fwdX * 32.0,
        this.pos.y + 1.05,
        this.pos.z + fwdZ * 32.0
      );
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 64 + Math.min(12, Math.abs(this.speed) * 0.16), dt * 6);
      this.camera.updateProjectionMatrix();
      return;
    }

    const dist = this.chasePreset === 0 ? 7.1 : 5.3;
    const height = (this.chasePreset === 0 ? 2.15 : 1.55) + this.orbitPitchOffset * 3.8;
    const camAngle = this.heading + this.orbitYawOffset;

    const targetPos = new THREE.Vector3(
      this.pos.x - Math.sin(camAngle) * dist,
      this.pos.y + height,
      this.pos.z - Math.cos(camAngle) * dist
    );

    // Ensure camera never dips below ground surface!
    const groundAtCam = this.network.getTerrainHeight(targetPos.x, targetPos.z);
    if (targetPos.y < groundAtCam + 0.85) targetPos.y = groundAtCam + 0.85;

    this.camCurrentPos.lerp(targetPos, Math.min(1, dt * 8.5));

    const lookAhead = new THREE.Vector3(
      this.pos.x + Math.sin(this.heading) * 3.4,
      this.pos.y + 1.15,
      this.pos.z + Math.cos(this.heading) * 3.4
    );
    this.camCurrentLook.lerp(lookAhead, Math.min(1, dt * 11.0));

    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentLook);

    // Speed-reactive FOV like Forza Horizon
    const targetFov = 55 + Math.min(14, Math.abs(this.speed) * 0.19);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 5));
      this.camera.updateProjectionMatrix();
    }
  }

  _updateDroneMode(dt) {
    const turbo = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 210.0 : 48.0;
    const fwd = new THREE.Vector3(
      -Math.sin(this.droneYaw) * Math.cos(this.dronePitch),
      Math.sin(this.dronePitch),
      -Math.cos(this.droneYaw) * Math.cos(this.dronePitch)
    );
    const right = new THREE.Vector3(Math.cos(this.droneYaw), 0, -Math.sin(this.droneYaw));

    if (this.keys['KeyW'] || this.keys['ArrowUp']) this.dronePos.addScaledVector(fwd, turbo * dt);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) this.dronePos.addScaledVector(fwd, -turbo * dt);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) this.dronePos.addScaledVector(right, turbo * dt);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.dronePos.addScaledVector(right, -turbo * dt);
    if (this.keys['KeyE'] || this.keys['Space']) this.dronePos.y += turbo * 0.75 * dt;
    if (this.keys['KeyQ'] || this.keys['ControlLeft']) this.dronePos.y -= turbo * 0.75 * dt;

    this.dronePos.x = Math.max(-HALF_WORLD + 10, Math.min(HALF_WORLD - 10, this.dronePos.x));
    this.dronePos.z = Math.max(-HALF_WORLD + 10, Math.min(HALF_WORLD - 10, this.dronePos.z));
    const minGround = this.network.getTerrainHeight(this.dronePos.x, this.dronePos.z) + 1.6;
    if (this.dronePos.y < minGround) this.dronePos.y = minGround;

    this.camera.position.copy(this.dronePos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.dronePitch, this.droneYaw, 0);
  }

  _updateTourMode(dt, elapsed) {
    this.tourTime += dt * 0.085;
    const idx = Math.floor(this.tourTime) % LANDMARKS.length;
    const lm = LANDMARKS[idx];
    const phase = this.tourTime - Math.floor(this.tourTime);
    const angle = phase * Math.PI * 1.4 - 0.7;
    const r = 78;
    const cx = lm.x + Math.cos(angle) * r;
    const cz = lm.z + Math.sin(angle) * r;
    const cy = Math.max(this.network.getTerrainHeight(cx, cz) + 12, this.network.getTerrainHeight(lm.x, lm.z) + 28);

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(lm.x, this.network.getTerrainHeight(lm.x, lm.z) + 5, lm.z);
  }
}
