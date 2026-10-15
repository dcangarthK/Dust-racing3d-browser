import * as THREE from 'three';
import { parseTrk, tileToWorld, nodeToWorld, worldToScene, TILE_UNITS, METERS_PER_UNIT } from './trk.mjs';
import { sampleAt } from './playback.mjs';

const params = new URLSearchParams(location.search);
const trackName = params.get('track') ?? 'monza';
const feedUrl = params.get('feed') ?? '/samples/mock-12car-3lap.telemetry.ndjson';
let camMode = params.get('cam') ?? 'chase';
const followId = Number(params.get('follow') ?? 0);
const hud = document.getElementById('hud');
const TILE_M = TILE_UNITS * METERS_PER_UNIT; // 12.8 m

// Tile colours by family; textures are a stretch goal (see findings).
const tileColor = (type) =>
  type.startsWith('grass') ? 0x3f7d3a
  : type.startsWith('sand') ? 0xc8b07a
  : type === 'finish' ? 0xdddddd
  : type.includes('bridge') ? 0x6b6b6b
  : 0x4a4d52; // asphalt: straight, corner*, etc.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec9f0);
scene.fog = new THREE.Fog(0x9ec9f0, 150, 600);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(100, 200, 50);
sun.castShadow = true;
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener('keydown', (e) => { if (e.key === 'c') camMode = camMode === 'chase' ? 'top' : 'chase'; });

function buildTrack(trk) {
  const group = new THREE.Group();
  const geom = new THREE.PlaneGeometry(TILE_M, TILE_M);
  geom.rotateX(-Math.PI / 2);
  const mats = new Map();
  for (const t of trk.tiles) {
    if (!mats.has(t.type)) mats.set(t.type, new THREE.MeshStandardMaterial({ color: tileColor(t.type), roughness: 0.95 }));
    const m = new THREE.Mesh(geom, mats.get(t.type));
    const p = worldToScene(tileToWorld(t, trk.rows));
    m.position.set(p.x, 0, p.z);
    m.rotation.y = THREE.MathUtils.degToRad(-t.o);
    m.receiveShadow = true;
    group.add(m);
  }
  // Racing route as a line + simple barrier posts at nodes (spike stand-in for real barriers).
  const pts = trk.nodes.map((n) => { const p = worldToScene(nodeToWorld(n, trk.rows)); return new THREE.Vector3(p.x, 0.05, p.z); });
  pts.push(pts[0].clone());
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd400 })));
  return group;
}

function makeCar(color) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.0, 1.9), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }));
  body.position.y = 0.6;
  body.castShadow = true;
  const g = new THREE.Group();
  g.add(body);
  return g;
}

async function loadFeed(url) {
  const text = await (await fetch(url)).text();
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((m) => m.type === 'snapshot');
}

const trk = parseTrk(await (await fetch(`/levels/${trackName}.trk`)).text());
scene.add(buildTrack(trk));
const frames = await loadFeed(feedUrl);
// Live mode (S5): `?live=ws://localhost:8787/watch?session=<id>` replaces the file feed with the relay stream.
const liveUrl = params.get('live');
if (liveUrl) {
  frames.length = 0;
  const ws = new WebSocket(liveUrl);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== 'snapshot') return;
    frames.push({ tMs: m.tMs, cars: m.cars });
    for (const c of m.cars) if (!cars.has(c.id)) { const mesh = makeCar(palette[c.id % palette.length]); cars.set(c.id, mesh); scene.add(mesh); }
    if (frames.length > 400) frames.splice(0, frames.length - 400);
  };
}
const palette = [0xe10600, 0x00a3e0, 0xffd400, 0x00c853, 0xaa00ff, 0xff6d00, 0xffffff, 0x222222, 0x795548, 0x00bfa5, 0xff4081, 0x9e9e9e];
const cars = new Map();
for (const c of frames[0]?.cars ?? []) { const m = makeCar(palette[c.id % palette.length]); cars.set(c.id, m); scene.add(m); }

const stats = { samples: [] };
window.__frameStats = stats;
const t0 = performance.now();
const simStart = frames[0]?.tMs ?? 0;
let last = performance.now();

function frame(now) {
  stats.samples.push(now - last);
  last = now;
  const tMs = liveUrl && frames.length ? frames[frames.length - 1].tMs - 100 : simStart + (now - t0);
  const poses = sampleAt(frames, tMs);
  for (const [id, p] of poses) {
    const mesh = cars.get(id);
    if (!mesh) continue;
    const s = worldToScene({ x: p.x / METERS_PER_UNIT, y: p.y / METERS_PER_UNIT }); // contract is metres; convert back to units then to scene
    mesh.position.set(s.x, 0, s.z);
    mesh.rotation.y = p.heading; // world heading CCW from +x; scene: x→x, y→-z keeps CCW about +y
  }
  const target = cars.get(followId);
  if (camMode === 'map') {
    // Overview of the whole tile grid (URL-only, `&cam=map`); added to verify the track render independent of the feed.
    const cx = (trk.cols * TILE_M) / 2, cz = -(trk.rows * TILE_M) / 2;
    camera.position.set(cx, 340, cz + 0.01);
    camera.lookAt(cx, 0, cz);
  } else if (target) {
    const fwd = new THREE.Vector3(Math.cos(target.rotation.y), 0, -Math.sin(target.rotation.y));
    if (camMode === 'chase') {
      camera.position.copy(target.position).addScaledVector(fwd, -14).add(new THREE.Vector3(0, 5, 0));
      camera.lookAt(target.position.clone().addScaledVector(fwd, 10));
    } else {
      camera.position.set(target.position.x, 120, target.position.z + 0.01);
      camera.lookAt(target.position);
    }
  }
  const recent = stats.samples.slice(-120).sort((a, b) => a - b);
  hud.textContent = `${trk.name} · ${frames.length} frames · cam ${camMode} (c) · p50 ${recent[60]?.toFixed(1) ?? '—'} ms p95 ${recent[114]?.toFixed(1) ?? '—'} ms`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
