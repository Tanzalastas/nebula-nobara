import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// --- Tunables -----------------------------------------------------------
const SPIRAL_ARMS = 8;
const SPIRAL_TURNS = 2.4;
const SPIRAL_PARTICLE_COUNT = 22000;
const SPIRAL_RADIUS = 220;
const SPIRAL_PARTICLE_SIZE = 2.0;
const SPIRAL_ARM_SPREAD = 14;
const STAR_RING_RADIUS_MIN = 52;
const STAR_ARM_JITTER = 0.55; 
const CORE_RADIUS = 18; 
const MAX_PLANETS = 24;
const PLANET_ORBIT_BASE = 0.7; 
const PLANET_ORBIT_STEP = 0.5; 
const BLOOM_STRENGTH = 1.2;
const BLOOM_RADIUS = 0.45;
const BLOOM_THRESHOLD = 0.4;
const LABEL_FONT = "700 58px Inter, sans-serif";
const CAMERA_FLY_DURATION = 0.9;
const GALAXY_MAX_ZOOM = SPIRAL_RADIUS * 1.625;

const CRITICALITY_COLOR = {
  critical: 0xff3b3b,
  high: 0xff9d3b,
  important: 0xffd83b,
  normal: 0x3bd6ff,
  low: 0x7dff8a,
  virtual: 0xb66bff,
};

// 8 thematic spiral arms, each grouping top-level dirs by role.
const ARM_META = [
  { name: "Boot", subtitle: "System Startup", color: 0xff3b3b },
  { name: "System", subtitle: "Core OS", color: 0xff9d3b },
  { name: "Runtime", subtitle: "Live System State", color: 0xb66bff },
  { name: "User", subtitle: "Users & Personal Data", color: 0x7dff8a },
  { name: "Application", subtitle: "Installed Software", color: 0xffd83b },
  { name: "Storage", subtitle: "Devices & Mounts", color: 0x3bd6ff },
  { name: "Service", subtitle: "Daemons & Servers", color: 0x4dd9c0 },
  { name: "Cache", subtitle: "Temporary & Ephemeral", color: 0xe8e8f0 },
];
const ARM_BOOT = 0, ARM_SYSTEM = 1, ARM_RUNTIME = 2, ARM_USER = 3,
      ARM_APPLICATION = 4, ARM_STORAGE = 5, ARM_SERVICE = 6, ARM_CACHE = 7;

const ARM_BY_PATH = {
  "/boot": ARM_BOOT,
  "/usr": ARM_SYSTEM, "/etc": ARM_SYSTEM, "/bin": ARM_SYSTEM, "/sbin": ARM_SYSTEM,
  "/lib": ARM_SYSTEM, "/lib64": ARM_SYSTEM,
  "/proc": ARM_RUNTIME, "/sys": ARM_RUNTIME, "/run": ARM_RUNTIME,
  "/home": ARM_USER, "/root": ARM_USER,
  "/opt": ARM_APPLICATION,
  "/dev": ARM_STORAGE, "/media": ARM_STORAGE, "/mnt": ARM_STORAGE,
  "/var": ARM_SERVICE, "/srv": ARM_SERVICE,
  "/tmp": ARM_CACHE,
};

function armForStar(star) {
  if (star.path in ARM_BY_PATH) return ARM_BY_PATH[star.path];
  // Deterministic fallback for top-level dirs the model doesn't name explicitly
  // (e.g. /lost+found, /afs) so they still land in a stable arm.
  let h = 0;
  for (let i = 0; i < star.path.length; i++) h = (h * 31 + star.path.charCodeAt(i)) >>> 0;
  return h % SPIRAL_ARMS;
}

function sizeToRadius(bytes, min = 1.2, max = 9) {
  const mb = Math.max(1, (bytes || 0) / (1024 * 1024));
  const scaled = Math.log10(mb + 1);
  return THREE.MathUtils.clamp(min + scaled * 1.4, min, max);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

let _softDotTexture = null;
function softDotTexture() {
  if (_softDotTexture) return _softDotTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _softDotTexture = new THREE.CanvasTexture(canvas);
  return _softDotTexture;
}

// Paints a wide equirectangular-ish nebula backdrop: starfield speckle, soft
// arm-hued cloud blobs (additive), and a few darker dust-lane bands. This is
// a static atmospheric layer behind the live, data-driven star field --
// real-time particles alone can't reach the painterly look of a reference
// nebula photo, so we bake one once instead of faking it as "live."
function buildNebulaSkyTexture() {
  const w = 2048, h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#02030a";
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = Math.random() * 1.1 + 0.15;
    const b = Math.random() * 0.8 + 0.15;
    ctx.fillStyle = `rgba(255,255,255,${b})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "lighter";
  const blobColors = ARM_META.map((a) => a.color);
  for (let i = 0; i < 34; i++) {
    const cx = Math.random() * w;
    const cy = h * 0.2 + Math.random() * h * 0.6;
    const radius = 90 + Math.random() * 200;
    const c = new THREE.Color(blobColors[i % blobColors.length]);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(${rgb},0.09)`);
    grad.addColorStop(0.5, `rgba(${rgb},0.035)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < 5; i++) {
    const y = Math.random() * h;
    const band = 50 + Math.random() * 40;
    const grad = ctx.createLinearGradient(0, y - band, 0, y + band);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(35,28,45,1)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - band, w, band * 2);
  }
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function makeLabelSprite(text, color = "#ffffff") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Soft drop shadow and a light stroke for legibility, without a heavy outline
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 14;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.strokeText(text, 256, 64);
  
  ctx.shadowBlur = 0; // Reset for actual text fill
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(32, 8, 1);
  return sprite;
}

function makeListSprite(items, color = "#a0b0d0", width = 22) {
  if (!items || items.length === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = Math.max(256, items.length * 40 + 40);
  const ctx = canvas.getContext("2d");
  ctx.font = "500 32px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Soft glow behind list items
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;

  items.forEach((item, idx) => {
    ctx.fillText(`./${item}`, 20, 20 + idx * 40);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true, opacity: 0.8 });
  const sprite = new THREE.Sprite(material);
  // Scale dynamically based on line count height
  sprite.scale.set(width, width * (canvas.height / canvas.width), 1);
  return sprite;
}

export function createGalaxy(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030611);
  scene.fog = new THREE.FogExp2(0x030611, 0.0014);

  const skyGeo = new THREE.SphereGeometry(2800, 32, 24);
  const skyMat = new THREE.MeshBasicMaterial({ map: buildNebulaSkyTexture(), side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 6000);
  camera.position.set(0, 117, 208);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = GALAXY_MAX_ZOOM;
  // Keep the camera from grazing edge-on through the disk/nebula layers --
  // besides looking disorienting, that angle stacks enough bloom sources to
  // blow out the frame.
  controls.minPolarAngle = Math.PI * 0.06;
  controls.maxPolarAngle = Math.PI * 0.82;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD
  );
  composer.addPass(bloomPass);

  scene.add(new THREE.AmbientLight(0x6677aa, 0.6));

  const galaxyGroup = new THREE.Group();
  scene.add(galaxyGroup);

  const coreGeo = new THREE.SphereGeometry(CORE_RADIUS, 48, 48);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffd28a, emissive: 0xffb060, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.0,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  galaxyGroup.add(coreMesh);
  
  const coreLight = new THREE.PointLight(0xffd6a0, 2.4, 0, 0);
  galaxyGroup.add(coreLight);

  const haloGeo = new THREE.SphereGeometry(CORE_RADIUS * 1.9, 32, 32);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.18, depthWrite: false });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  galaxyGroup.add(haloMesh);

  const coreLabelTop = makeLabelSprite("/", "#ffd6a0");
  coreLabelTop.position.set(0, CORE_RADIUS + 8, 0);
  galaxyGroup.add(coreLabelTop);
  
  const coreLabelBottom = makeLabelSprite("Galaxy Core", "#ffd6a0");
  coreLabelBottom.position.set(0, CORE_RADIUS - 8, 0);
  galaxyGroup.add(coreLabelBottom);

  galaxyGroup.add(buildSpiralBackdrop());

  const starGroup = new THREE.Group();
  galaxyGroup.add(starGroup);

  const dependencyGroup = new THREE.Group();
  galaxyGroup.add(dependencyGroup);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const pickables = [];
  const nodeIndex = new Map();
  let rotationSpeed = 0.2;
  let selected = null;
  let hovered = null;
  let viewMode = "galactic";
  let overlay = "none";
  let criticalityFilter = new Set();
  let onSelectCb = null;
  let activityClock = 0;
  let focusedStarMesh = null; 
  let camAnim = null; 
  let galacticFitDistance = 208;
  let galacticFitHeight = 117;
  let currentStars = []; 

  function buildSpiralBackdrop() {
    const positions = new Float32Array(SPIRAL_PARTICLE_COUNT * 3);
    const colors = new Float32Array(SPIRAL_PARTICLE_COUNT * 3);
    const color = new THREE.Color();
    const coreWarm = new THREE.Color(0xffb060);
    const dustBlue = new THREE.Color(0x3a5fd9);
    const dustPurple = new THREE.Color(0x8a4fe0);
    const dustWhite = new THREE.Color(0xd8e2ff);
    // Each arm gets a faint hue nudge so the 8-arm structure still reads up
    // close, without turning the backdrop into a rainbow from a distance.
    const armTints = ARM_META.map((a) => new THREE.Color(a.color));

    for (let i = 0; i < SPIRAL_PARTICLE_COUNT; i++) {
      const armIndex = i % SPIRAL_ARMS;
      const t = Math.random();
      const armOffset = (armIndex / SPIRAL_ARMS) * Math.PI * 2;
      const angle = armOffset + t * SPIRAL_TURNS * Math.PI * 2;
      const radius = t * SPIRAL_RADIUS;
      const spread = (Math.random() - 0.5) * SPIRAL_ARM_SPREAD * (0.3 + t);
      const x = Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * spread;
      const z = Math.sin(angle) * radius + Math.sin(angle + Math.PI / 2) * spread;
      const y = (Math.random() - 0.5) * SPIRAL_ARM_SPREAD * 0.4 * (1 - t * 0.6);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Base dust gradient: blue near the core, blending to purple, fading to white at the rim.
      if (t < 0.45) {
        color.copy(dustBlue).lerp(dustPurple, t / 0.45);
      } else {
        color.copy(dustPurple).lerp(dustWhite, (t - 0.45) / 0.55);
      }
      // Warm bleed from the galactic core.
      const warmth = Math.max(0, 1 - t / 0.3);
      if (warmth > 0) color.lerp(coreWarm, warmth * 0.55);
      // Subtle per-arm tint so the 8 categories are still faintly legible.
      color.lerp(armTints[armIndex], 0.16);

      const brightness = 0.5 + Math.random() * 0.4 - t * 0.1;
      color.multiplyScalar(brightness);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: SPIRAL_PARTICLE_SIZE * 1.5,
      map: softDotTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return new THREE.Points(geometry, material);
  }

  function clearStars() {
    while (starGroup.children.length) starGroup.remove(starGroup.children[0]);
    pickables.length = 0;
    nodeIndex.clear();
    focusedStarMesh = null;
  }

  function colorFor(node) {
    return CRITICALITY_COLOR[node.criticality] ?? CRITICALITY_COLOR.normal;
  }

  function buildBody(node, radius, segments = 24, isPrimary = node.kind === "star") {
    let geometry;
    if (node.kind === "wormhole") {
      geometry = new THREE.TorusGeometry(radius, radius * 0.32, 10, 24);
    } else if (node.kind === "nebula") {
      geometry = new THREE.IcosahedronGeometry(radius, 1);
    } else if (node.kind === "asteroid") {
      geometry = new THREE.DodecahedronGeometry(radius, 0);
    } else {
      geometry = new THREE.SphereGeometry(radius, segments, segments);
    }
    const color = colorFor(node);
    const material = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: isPrimary ? 1.3 : 0.4,
      roughness: 0.4, metalness: 0.15, transparent: node.kind === "nebula", opacity: node.kind === "nebula" ? 0.55 : 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.baseEmissive = material.emissiveIntensity;
    return mesh;
  }

  function placeStars(stars) {
    if (!Array.isArray(stars)) stars = [];
    clearStars();
    currentStars = stars;
    const active = stars.filter((s) => !criticalityFilter.has(s.criticality));
    const n = active.length;
    if (n === 0) {
      galacticFitDistance = SPIRAL_RADIUS * 1.3;
      galacticFitHeight = galacticFitDistance * 0.55;
      return;
    }
    let maxExtent = STAR_RING_RADIUS_MIN;

    const armBuckets = Array.from({ length: SPIRAL_ARMS }, () => []);
    active.forEach((star) => armBuckets[armForStar(star)].push(star));

    armBuckets.forEach((bucket, armIndex) => {
      const slotsInArm = bucket.length;
      if (slotsInArm === 0) return;
      const armOffset = (armIndex / SPIRAL_ARMS) * Math.PI * 2;
      const armColor = ARM_META[armIndex].color;
      // Pale blue-white base with just a touch of the arm's hue, not the full saturated color.
      const ringColor = new THREE.Color(0xbfe0ff).lerp(new THREE.Color(armColor), 0.3).getHex();

      bucket.forEach((star, slotInArm) => {
        const starRadius = sizeToRadius(star.size_bytes, 5.0, 22);
        const renderedChildren = (star.children || []).slice(0, MAX_PLANETS);
        const maxOrbit = renderedChildren.length > 0
          ? starRadius + PLANET_ORBIT_BASE + (renderedChildren.length - 1) * PLANET_ORBIT_STEP
          : starRadius;
        const footprint = maxOrbit + 4;

        const t = (slotInArm + 0.5) / slotsInArm;
        const angle = armOffset + t * SPIRAL_TURNS * Math.PI * 2;
        const radius = STAR_RING_RADIUS_MIN + t * (SPIRAL_RADIUS - STAR_RING_RADIUS_MIN);
        const spread = (Math.random() - 0.5) * SPIRAL_ARM_SPREAD * STAR_ARM_JITTER * (0.3 + t);
        const x = Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * spread;
        const z = Math.sin(angle) * radius + Math.sin(angle + Math.PI / 2) * spread;

        maxExtent = Math.max(maxExtent, radius + footprint);

        const starMesh = buildBody(star, starRadius, 32, true);
        starMesh.position.set(x, 0, z);
        starMesh.userData.node = star;
        starMesh.userData.depth = 0;
        starMesh.userData.footprint = footprint;
        starMesh.userData.armIndex = armIndex;
        starGroup.add(starMesh);
        pickables.push(starMesh);
        nodeIndex.set(star.path, { mesh: starMesh, node: star });

        // Subtle glow behind the star body -- kept tight so the body itself
        // stays crisp and saturated instead of dissolving into a soft blob.
        const haloMat = new THREE.SpriteMaterial({
          map: softDotTexture(), color: colorFor(star), transparent: true,
          opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const halo = new THREE.Sprite(haloMat);
        halo.position.set(x, 0, z);
        halo.scale.setScalar(starRadius * 2.0);
        starGroup.add(halo);

        // Add the much more legible label
        const label = makeLabelSprite(star.name);
        label.position.set(x, starRadius + 9, z);
        starGroup.add(label);

        // Add the new child directories list sprite slightly offset from the star,
        // sized relative to the star so it doesn't overwhelm the frame on zoom-in.
        const childNames = renderedChildren.slice(0, 6).map(c => c.name || c.path.split('/').pop());
        if (childNames.length > 0) {
          const listWidth = THREE.MathUtils.clamp(starRadius * 0.9, 6, 14);
          const listSprite = makeListSprite(childNames, "#6f8cb8", listWidth);
          if (listSprite) {
            listSprite.position.set(x + starRadius + listWidth * 0.55, starRadius * 0.5, z);
            starGroup.add(listSprite);
          }
        }

        const orbitGroup = new THREE.Group();
        orbitGroup.position.set(x, 0, z);
        starGroup.add(orbitGroup);

        renderedChildren.forEach((child, j) => {
          if (criticalityFilter.has(child.criticality)) return;
          const orbitRadius = starRadius + PLANET_ORBIT_BASE + j * PLANET_ORBIT_STEP;
          const planetAngle = (j / renderedChildren.length) * Math.PI * 2;
          const planetRadius = sizeToRadius(child.size_bytes, 0.3, 1.8);
          const planetMesh = buildBody(child, planetRadius, 16, false);
          planetMesh.position.set(Math.cos(planetAngle) * orbitRadius, 0, Math.sin(planetAngle) * orbitRadius);
          planetMesh.userData.node = child;
          planetMesh.userData.depth = 1;
          planetMesh.userData.orbitRadius = orbitRadius;
          planetMesh.userData.orbitAngle = planetAngle;
          planetMesh.userData.orbitSpeed = 0.15 + Math.random() * 0.25;
          orbitGroup.add(planetMesh);
          pickables.push(planetMesh);
          nodeIndex.set(child.path, { mesh: planetMesh, node: child });

          const ringGeo = new THREE.RingGeometry(orbitRadius - 0.05, orbitRadius + 0.05, 48);
          const ringMat = new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = Math.PI / 2;
          orbitGroup.add(ring);
        });
      });
    });

    galacticFitDistance = Math.max(208, maxExtent * 1.15);
    galacticFitHeight = galacticFitDistance * 0.55;
  }

  function applyOverlay() {
    starGroup.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !obj.userData.node) return;
      const node = obj.userData.node;
      const base = obj.userData.baseEmissive ?? 0.5;
      if (overlay === "ownership") {
        obj.material.emissive.set(node.criticality === "critical" || node.criticality === "high" ? 0xff3b3b : 0x7dff8a);
        obj.material.emissiveIntensity = 0.8;
      } else if (overlay === "size") {
        obj.material.emissiveIntensity = base * 1.6;
      } else {
        obj.material.emissive.set(colorFor(node));
        obj.material.emissiveIntensity = base;
      }
    });
    dependencyGroup.clear();
    if (overlay === "dependencies" && selected) {
      drawDependencyArcs(selected);
    }
  }

  function drawDependencyArcs(node) {
    const from = nodeIndex.get(node.path);
    if (!from) return;
    const fromPos = new THREE.Vector3();
    from.mesh.getWorldPosition(fromPos);
    for (const dep of node.dependencies || []) {
      const target = nodeIndex.get(dep.target);
      if (!target) continue;
      const toPos = new THREE.Vector3();
      target.mesh.getWorldPosition(toPos);
      const mid = fromPos.clone().lerp(toPos, 0.5).add(new THREE.Vector3(0, 20, 0));
      const curve = new THREE.QuadraticBezierCurve3(fromPos, mid, toPos);
      const geometry = new THREE.TubeGeometry(curve, 24, 0.25, 6, false);
      const material = new THREE.MeshBasicMaterial({ color: 0x3bd6ff, transparent: true, opacity: 0.7 });
      dependencyGroup.add(new THREE.Mesh(geometry, material));
    }
  }

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.length ? hits[0].object : null;
  }

  const DRAG_THRESHOLD_PX = 6;
  let pointerDownPos = null;
  canvas.addEventListener("pointerdown", (e) => { pointerDownPos = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("click", (e) => {
    if (pointerDownPos) {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) return;
    }
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return;
    const node = hit.userData.node;
    select(node);
    if (hit.userData.depth === 0) flyToNode(node, hit, { lockRotation: true });
  });

  canvas.addEventListener("pointermove", (e) => {
    const hit = pick(e.clientX, e.clientY);
    canvas.style.cursor = hit ? "pointer" : "default";
    if (hovered && hovered !== hit) hovered.scale.set(1, 1, 1);
    if (hit) hit.scale.set(1.15, 1.15, 1.15);
    hovered = hit;
  });

  function select(node) {
    selected = node;
    if (overlay === "dependencies") applyOverlay();
    onSelectCb?.(node);
  }

  function startCameraAnim(toPos, toTarget, duration = CAMERA_FLY_DURATION) {
    camAnim = {
      fromPos: camera.position.clone(), toPos: toPos.clone(),
      fromTarget: controls.target.clone(), toTarget: toTarget.clone(),
      elapsed: 0, duration,
    };
    controls.enabled = false;
  }

  function flyToNode(node, mesh, { lockRotation = false } = {}) {
    const targetMesh = mesh || nodeIndex.get(node.path)?.mesh;
    if (!targetMesh) return false;
    const pos = new THREE.Vector3();
    targetMesh.getWorldPosition(pos);
    const footprint = targetMesh.userData.footprint ?? sizeToRadius(node.size_bytes, 0.4, 1.8) * 4;
    const viewDistance = Math.max(18, footprint * 1.7);
    const offset = new THREE.Vector3(viewDistance * 0.55, viewDistance * 0.62, viewDistance * 0.55);
    startCameraAnim(pos.clone().add(offset), pos);
    focusedStarMesh = lockRotation ? targetMesh : focusedStarMesh;
    return true;
  }

  function focusByPath(path) {
    const entry = nodeIndex.get(path);
    if (!entry) return false;
    select(entry.node);
    flyToNode(entry.node, entry.mesh, { lockRotation: entry.mesh.userData.depth === 0 });
    return true;
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  function animate() {
    const dt = clock.getDelta();
    activityClock += dt;
    if (viewMode !== "list") {
      if (!focusedStarMesh) starGroup.rotation.y += dt * rotationSpeed * 0.05;
      starGroup.traverse((obj) => {
        if (obj.userData?.orbitSpeed) {
          obj.userData.orbitAngle += dt * obj.userData.orbitSpeed;
          obj.position.x = Math.cos(obj.userData.orbitAngle) * obj.userData.orbitRadius;
          obj.position.z = Math.sin(obj.userData.orbitAngle) * obj.userData.orbitRadius;
        }
        if (overlay === "activity" && obj.material?.emissiveIntensity !== undefined && obj.userData.baseEmissive) {
          obj.material.emissiveIntensity = obj.userData.baseEmissive * (0.7 + 0.3 * Math.sin(activityClock * 2 + obj.id));
        }
      });
    }

    if (camAnim) {
      camAnim.elapsed += dt;
      const t = Math.min(1, camAnim.elapsed / camAnim.duration);
      const e = easeInOutCubic(t);
      camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
      controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, e);

      if (t >= 1) {
        camAnim = null;
        controls.enabled = true;
      }
    }

    controls.update();
    composer.render();
    animationFrameId = requestAnimationFrame(animate);
  }

  let animationFrameId = requestAnimationFrame(animate);

  // --- Public API -----------------------------------------------------------
  return {
    setData: (stars) => {
      placeStars(stars);
      applyOverlay();
    },
    setOverlay: (mode) => {
      overlay = mode;
      applyOverlay();
    },
    setViewMode: (mode) => {
      viewMode = mode;
      if (mode === "galactic") {
        focusedStarMesh = null;
        startCameraAnim(
          new THREE.Vector3(0, galacticFitHeight, galacticFitDistance),
                        new THREE.Vector3(0, 0, 0)
        );
      }
    },
    setCriticalityFilter: (tier, enabled) => {
      if (enabled) criticalityFilter.delete(tier);
      else criticalityFilter.add(tier);
      placeStars(currentStars);
      applyOverlay();
    },
    setGlow: (v) => {
      bloomPass.enabled = !!v;
    },
    setRotationSpeed: (v) => {
      rotationSpeed = v;
    },
    setZoom: (v) => {
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 1);
      dir.normalize().multiplyScalar(v);
      camera.position.copy(controls.target).add(dir);
    },
    focus: focusByPath,
    getCameraPosition: () => camera.position.clone(),
    onSelect: (cb) => {
      onSelectCb = cb;
    },
    dispose: () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      canvas.removeEventListener("pointerdown", null);
      canvas.removeEventListener("click", null);
      canvas.removeEventListener("pointermove", null);
    }
  };
}
// EOF