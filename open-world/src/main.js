import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { RoadAndWaterNetwork } from './world/RoadAndWaterNetwork.js';
import { TerrainAndWaterBuilder } from './world/TerrainAndWaterBuilder.js';
import { RoadMeshAndInfraBuilder } from './world/RoadMeshAndInfraBuilder.js';
import { VillageAndInfrastructure } from './world/VillageAndInfrastructure.js';
import { NatureAndWildlife } from './world/NatureAndWildlife.js';
import { AtmosphereAndSky } from './world/AtmosphereAndSky.js';
import { CarController } from './vehicles/CarController.js';
import { HorizonHUD } from './ui/HorizonHUD.js';
import { HorizonAudio } from './audio/HorizonAudio.js';

const loadingScreen = document.getElementById('loading-screen');
const loadingFill = document.getElementById('loading-bar-fill');
const loadingStatus = document.getElementById('loading-status');

function setProgress(msg, frac) {
  if (loadingStatus) loadingStatus.textContent = msg;
  if (loadingFill) loadingFill.style.width = `${Math.round(frac * 100)}%`;
}

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 12)));

async function bootstrap() {
  const container = document.getElementById('canvas-container');

  const isMobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 860;

  // 1. WebGL2 Physically-Based Renderer with ACES Filmic Tone Mapping
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.35, 14000);

  // Multisampled Post-Processing Pipeline (Mobile-safe render target!)
  const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: isMobile ? THREE.UnsignedByteType : THREE.HalfFloatType,
    samples: isMobile ? 0 : 4,
  });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.22, // Subtle photorealistic bloom strength (no washed-out glare)
    0.55,
    0.88
  );
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  // Asset Loaders (with local Draco WASM decoder for ferrari.glb!)
  const texLoader = new THREE.TextureLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('/draco/gltf/');
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  // 2. Build 4x4 km Master Geography, River, Lakes & 4-Tier Road Splines
  setProgress('Формирование географии 4×4 км, речного русла, озёр и дорожной сети...', 0.12);
  await nextPaint();
  const network = new RoadAndWaterNetwork();

  // 3. Atmosphere, Sky Scattering & Real 32-bit HDRI Lighting
  setProgress('Загрузка HDRI-освещения, атмосферного неба и теней...', 0.20);
  await nextPaint();
  const atmosphere = new AtmosphereAndSky(renderer, scene, texLoader);
  let activePreset = await atmosphere.applyPreset('sunset');

  // 4. Sculpted Multi-Biome PBR Terrain & Reflective Water
  setProgress('Построение PBR-рельефа 4000×4000 м, Изумрудного озера и реки...', 0.28);
  await nextPaint();
  const terrainWater = new TerrainAndWaterBuilder(network, texLoader);
  terrainWater.buildTerrain(scene);
  terrainWater.buildWater(scene);

  // 5. Roads, Stone Viaducts, Guardrails, Signs, Streetlamps & Power Lines
  setProgress('Строительство шоссе M1, мостов, отбойников, фонарей и лесных троп...', 0.36);
  await nextPaint();
  const roadInfra = new RoadMeshAndInfraBuilder(network, texLoader);
  roadInfra.buildAll(scene);
  roadInfra.updateNightLighting(activePreset.nightFactor);

  // 6. Oakwood Village (Houses, Fences, Gardens, Greenhouses), Farms, Marina & Horizon Hub
  setProgress('Возведение деревни Озёрной: дома, заборы, сады, мельница и фестиваль...', 0.44);
  await nextPaint();
  const villageInfra = new VillageAndInfrastructure(network, texLoader);
  villageInfra.buildAll(scene);

  // 7. Forests (EZ-Tree PBR), Rocks, GPU Infinite 3D Grass/Flowers & Animated Wildlife
  const nature = new NatureAndWildlife(network, villageInfra, gltfLoader);
  await nature.buildAll(scene, setProgress);

  // 8. Load Official Ferrari 458 Italia Supercar & Simcade Driving Physics
  setProgress('Подготовка суперкара Ferrari 458 Italia и физики вождения...', 0.94);
  await nextPaint();
  const car = new CarController(
    scene,
    camera,
    renderer.domElement,
    network,
    villageInfra.colliders,
    nature.treeColliders,
    gltfLoader,
    texLoader
  );
  await car.loadCarModel();
  car.setNightMode(activePreset.nightFactor);

  // 9. Audio & Forza Horizon Interactive HUD + 4x4 km World Map
  const audio = new HorizonAudio();
  const hud = new HorizonHUD({
    network,
    villageInfra,
    car,
    onSelectTime: async (presetKey) => {
      activePreset = await atmosphere.applyPreset(presetKey);
      roadInfra.updateNightLighting(activePreset.nightFactor);
      car.setNightMode(activePreset.nightFactor);
      bloomPass.strength = activePreset.nightFactor > 0.5 ? 0.42 : 0.22;
    },
    onToggleAudio: () => audio.toggle(),
  });

  setProgress('Добро пожаловать в Horizon Valley!', 1.0);
  await nextPaint();
  loadingScreen.classList.add('fade-out');

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  });

  // Main 60 FPS Render Loop
  let prevTime = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, Math.max(0.001, (now - prevTime) * 0.001));
    prevTime = now;
    const elapsed = now * 0.001;

    car.update(dt, elapsed);

    const focusPos = car.mode === 'drive' ? car.pos : camera.position;
    atmosphere.update(dt, focusPos);
    terrainWater.update(elapsed, activePreset, atmosphere.sunDir);
    villageInfra.update(elapsed, activePreset.nightFactor);
    nature.update(dt, elapsed, focusPos);
    hud.update(dt);
    audio.update(car.rpm, car.speed, car.isDrifting, car.mode === 'drive');

    composer.render();
  }
  requestAnimationFrame(animate);
}

bootstrap().catch((err) => {
  console.error('World bootstrap error:', err);
  if (loadingStatus) {
    loadingStatus.textContent = `Ошибка загрузки: ${err.message}`;
    loadingStatus.style.color = '#f87171';
  }
});
