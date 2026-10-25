import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { TIME_PRESETS } from './WorldConfig.js';
import { mulberry32 } from './Noise.js';

export class AtmosphereAndSky {
  constructor(renderer, scene, texLoader) {
    this.renderer = renderer;
    this.scene = scene;
    this.texLoader = texLoader;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.rgbeLoader = new RGBELoader();

    this.envCache = new Map();
    this.sunDir = new THREE.Vector3(0.5, 0.25, -0.8).normalize();
    this.currentPreset = TIME_PRESETS.sunset;

    this._initSkyAndLights();
    this._initCumulusClouds();
  }

  _initSkyAndLights() {
    // 1. Preetham Atmospheric Scattering Sky Dome
    this.sky = new Sky();
    this.sky.scale.setScalar(18000);
    this.scene.add(this.sky);

    // 2. Starfield Dome for Festival Night preset
    const starCount = 1600;
    const starPos = new Float32Array(starCount * 3);
    const rng = mulberry32(424242);
    for (let i = 0; i < starCount; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(rng() * 0.88 + 0.08);
      const r = 7200;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xe2ecff,
      size: 16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.0,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.stars);

    // 3. Hemisphere Fill Light
    this.hemiLight = new THREE.HemisphereLight(0xffd2a6, 0x3f4a32, 0.72);
    this.scene.add(this.hemiLight);

    // 4. Camera-Tracking Directional Sun Light (2048x2048 Crisp Shadows Everywhere in 4x4 km!)
    this.sunLight = new THREE.DirectionalLight(0xffb36b, 3.5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const shadowHalf = 135;
    this.sunLight.shadow.camera.left = -shadowHalf;
    this.sunLight.shadow.camera.right = shadowHalf;
    this.sunLight.shadow.camera.top = shadowHalf;
    this.sunLight.shadow.camera.bottom = -shadowHalf;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 520;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.035;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 5. Cinematic Sun Lensflare
    const flare0 = this.texLoader.load('/textures/lensflare0.png');
    const flare3 = this.texLoader.load('/textures/lensflare3.png');
    this.lensflare = new Lensflare();
    this.lensflare.addElement(new LensflareElement(flare0, 420, 0.0, new THREE.Color(0xffd6a3)));
    this.lensflare.addElement(new LensflareElement(flare3, 65, 0.6));
    this.lensflare.addElement(new LensflareElement(flare3, 85, 0.72));
    this.lensflare.addElement(new LensflareElement(flare3, 120, 0.92));
    this.flareAnchor = new THREE.Object3D();
    this.flareAnchor.add(this.lensflare);
    this.scene.add(this.flareAnchor);

    // Exponential atmospheric depth haze
    this.scene.fog = new THREE.FogExp2(0xd9a882, 0.00024);
  }

  _initCumulusClouds() {
    const cloudTex = this.texLoader.load('/textures/cloud.png');
    cloudTex.colorSpace = THREE.SRGBColorSpace;
    this.cloudMat = new THREE.SpriteMaterial({
      map: cloudTex,
      color: 0xfff3e6,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      fog: false,
    });

    this.clouds = [];
    const rng = mulberry32(10899);
    const cloudGroup = new THREE.Group();
    for (let i = 0; i < 42; i++) {
      const sp = new THREE.Sprite(this.cloudMat);
      const x = (rng() - 0.5) * 6200;
      const z = (rng() - 0.5) * 6200;
      const y = 410 + rng() * 240;
      const w = 520 + rng() * 580;
      sp.position.set(x, y, z);
      sp.scale.set(w, w * 0.42, 1);
      cloudGroup.add(sp);
      this.clouds.push({ sprite: sp, speed: 3.2 + rng() * 2.8 });
    }
    this.scene.add(cloudGroup);
  }

  async applyPreset(presetKey) {
    const preset = TIME_PRESETS[presetKey] || TIME_PRESETS.sunset;
    this.currentPreset = preset;

    const phi = THREE.MathUtils.degToRad(90 - preset.sunElevation);
    const theta = THREE.MathUtils.degToRad(preset.sunAzimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    // Update Sky shader
    const skyU = this.sky.material.uniforms;
    skyU['turbidity'].value = preset.skyTurbidity;
    skyU['rayleigh'].value = preset.skyRayleigh;
    skyU['mieCoefficient'].value = 0.005;
    skyU['mieDirectionalG'].value = 0.82;
    skyU['sunPosition'].value.copy(this.sunDir);
    this.sky.visible = preset.nightFactor < 0.85;

    if (preset.nightFactor >= 0.85) {
      this.scene.background = new THREE.Color(0x070d1b);
    } else {
      this.scene.background = null;
    }
    this.starMat.opacity = preset.nightFactor > 0.5 ? 0.88 : 0.0;
    this.lensflare.visible = preset.nightFactor < 0.5;
    this.flareAnchor.position.copy(this.sunDir).multiplyScalar(4500);

    // Update Lights & Fog
    this.sunLight.color.setHex(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity;
    this.hemiLight.color.setHex(preset.hemiSky);
    this.hemiLight.groundColor.setHex(preset.hemiGround);
    this.hemiLight.intensity = preset.hemiIntensity;
    this.scene.fog.color.setHex(preset.fogColor);
    this.scene.fog.density = preset.fogDensity;
    this.renderer.toneMappingExposure = preset.exposure;
    this.scene.environmentIntensity = preset.envIntensity;

    // Cloud tint
    if (preset.id === 'sunset') this.cloudMat.color.setHex(0xffd2b3);
    else if (preset.id === 'dawn') this.cloudMat.color.setHex(0xf3d4dc);
    else if (preset.id === 'night') this.cloudMat.color.setHex(0x1f2d4a);
    else this.cloudMat.color.setHex(0xffffff);
    this.cloudMat.opacity = preset.id === 'night' ? 0.22 : 0.52;

    // Load & cache real 32-bit HDRI environment map for photorealistic reflections!
    if (!this.envCache.has(preset.hdri)) {
      try {
        const hdrTex = await this.rgbeLoader.loadAsync(preset.hdri);
        const envRT = this.pmrem.fromEquirectangular(hdrTex);
        hdrTex.dispose();
        this.envCache.set(preset.hdri, envRT.texture);
      } catch (e) {
        console.warn('HDRI load fallback:', e);
      }
    }
    if (this.envCache.has(preset.hdri)) {
      this.scene.environment = this.envCache.get(preset.hdri);
    }

    return preset;
  }

  update(dt, focusPos) {
    // Snap shadow camera target to 2m grid around viewer so shadows stay crisp without shimmer!
    if (focusPos) {
      const sx = Math.round(focusPos.x * 0.5) * 2.0;
      const sz = Math.round(focusPos.z * 0.5) * 2.0;
      this.sunLight.target.position.set(sx, focusPos.y, sz);
      this.sunLight.position.set(
        sx + this.sunDir.x * 230,
        focusPos.y + Math.max(65, this.sunDir.y * 230),
        sz + this.sunDir.z * 230
      );
      this.sunLight.target.updateMatrixWorld();
      this.flareAnchor.position.set(
        focusPos.x + this.sunDir.x * 4200,
        focusPos.y + this.sunDir.y * 4200,
        focusPos.z + this.sunDir.z * 4200
      );
    }

    for (const c of this.clouds) {
      c.sprite.position.x += c.speed * dt;
      if (c.sprite.position.x > 3100) c.sprite.position.x = -3100;
    }
  }
}
