/* PRIMITIVE — app.js: three.js rendering, HUD, interaction. */
(function () {
'use strict';
const { World, SENSOR_ANGLES } = window.PRIMITIVE;

const params = new URLSearchParams(location.search);
const world = new World(params.has('seed') ? +params.get('seed') : 7);

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef1f4);
scene.fog = new THREE.Fog(0xeef1f4, 55, 130);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9099, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 80;
scene.add(sun);

// ground + arena floor
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300),
  new THREE.MeshStandardMaterial({ color: 0xf5f6f8, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
scene.add(ground);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(world.W, world.H),
  new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);

// yellow border lines
const borderMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.7 });
const bw = 0.35, inset = 0.8;
[[0, -world.H/2 + inset, world.W - inset*2 + bw, bw], [0, world.H/2 - inset, world.W - inset*2 + bw, bw],
 [-world.W/2 + inset, 0, bw, world.H - inset*2 + bw], [world.W/2 - inset, 0, bw, world.H - inset*2 + bw]]
.forEach(([x, z, w, d]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), borderMat);
  m.position.set(x, 0.021, z); m.receiveShadow = true; scene.add(m);
});

// low white walls
const wallMat = new THREE.MeshStandardMaterial({ color: 0xfbfbfc, roughness: 0.9 });
[[0, -world.H/2 - 0.3, world.W + 1.2, 0.6], [0, world.H/2 + 0.3, world.W + 1.2, 0.6],
 [-world.W/2 - 0.3, 0, 0.6, world.H + 1.2], [world.W/2 + 0.3, 0, 0.6, world.H + 1.2]]
.forEach(([x, z, w, d]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), wallMat);
  m.position.set(x, 0.35, z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
});

/* ---------------- obstacles ---------------- */
const obstacleGroup = new THREE.Group();
scene.add(obstacleGroup);
const meshByObstacle = new Map();

function buildShelf(o) {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.6, metalness: 0.3 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x2f5fb8, roughness: 0.8 });
  const post = new THREE.BoxGeometry(0.18, 3.4, 0.18);
  [[-o.hw + 0.1, -o.hd + 0.1], [o.hw - 0.1, -o.hd + 0.1], [-o.hw + 0.1, o.hd - 0.1], [o.hw - 0.1, o.hd - 0.1]]
    .forEach(([px, pz]) => {
      const m = new THREE.Mesh(post, frame);
      m.position.set(px, 1.7, pz); m.castShadow = true; g.add(m);
    });
  [0.15, 1.75].forEach(y => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 0.1, o.hd * 2), frame);
    slab.position.y = y; slab.castShadow = true; g.add(slab);
  });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.6), blue);
    b.position.set(0, 1.75 + 0.5, -o.hd + 1.1 + i * 2.0); b.castShadow = true; g.add(b);
  }
  const b2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.4), blue);
  b2.position.set(0, 0.15 + 0.45, 1.5); b2.castShadow = true; g.add(b2);
  g.position.set(o.x, 0, o.z);
  return g;
}

function rebuildObstacles() {
  while (obstacleGroup.children.length) obstacleGroup.remove(obstacleGroup.children[0]);
  meshByObstacle.clear();
  for (const o of world.obstacles) {
    let mesh;
    if (o.shelf) { mesh = buildShelf(o); obstacleGroup.add(mesh); meshByObstacle.set(o, mesh); continue; }
    if (o.type === 'box') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(o.hw * 2, o.h, o.hd * 2),
        new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.9 })
      );
      mesh.position.set(o.x, o.h / 2, o.z); mesh.rotation.y = o.rot;
    } else {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(o.r, o.r, o.h, 28),
        new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.65 })
      );
      mesh.position.set(o.x, o.h / 2, o.z);
    }
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.obstacle = o;
    obstacleGroup.add(mesh); meshByObstacle.set(o, mesh);
  }
  // decals
  for (const d of world.decals) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(d.r, d.r, 0.03, 36),
      new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 })
    );
    m.position.set(d.x, 0.016, d.z); m.receiveShadow = true;
    obstacleGroup.add(m);
  }
}
rebuildObstacles();

/* ---------------- robot (e-puck) ---------------- */
const robot = new THREE.Group();
const puck = new THREE.Mesh(
  new THREE.CylinderGeometry(0.45, 0.45, 0.22, 36),
  new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.4, metalness: 0.2 })
);
puck.position.y = 0.16; puck.castShadow = true;
robot.add(puck);
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.36, 0.045, 12, 40),
  new THREE.MeshStandardMaterial({ color: 0xe33229, roughness: 0.45 })
);
ring.rotation.x = Math.PI / 2; ring.position.y = 0.28; ring.castShadow = true;
robot.add(ring);
const cap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.12, 0.12, 0.05, 20),
  new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.35 })
);
cap.position.y = 0.30; robot.add(cap);
const notch = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.03, 0.2),
  new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888 })
);
notch.position.set(0, 0.285, -0.25); robot.add(notch);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.8 });
[-1, 1].forEach(side => {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 18), wheelMat);
  w.rotation.x = Math.PI / 2; w.position.set(side * 0.44, 0.14, 0);
  robot.add(w);
});
scene.add(robot);
// heading in world: forward = (cos h, 0, sin h); three.js yaw for that:
function syncRobot() {
  robot.position.set(world.robot.x, 0, world.robot.z);
  robot.rotation.y = -world.robot.h;
}

/* ---------------- sensor rays ---------------- */
const rayGroup = new THREE.Group(); scene.add(rayGroup);
const rays = [];
for (let k = 0; k < 8; k++) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const mat = new THREE.LineBasicMaterial({ color: 0x35c9ff, transparent: true, opacity: 0.15 });
  const line = new THREE.Line(geo, mat);
  rayGroup.add(line); rays.push(line);
}
function syncRays() {
  const r = world.robot;
  for (let k = 0; k < 8; k++) {
    const ang = r.h + SENSOR_ANGLES[k];
    const d = world.rayDists[k];
    const pos = rays[k].geometry.attributes.position.array;
    pos[0] = r.x; pos[1] = 0.3; pos[2] = r.z;
    pos[3] = r.x + Math.cos(ang) * d; pos[4] = 0.3; pos[5] = r.z + Math.sin(ang) * d;
    rays[k].geometry.attributes.position.needsUpdate = true;
    const act = world.sensors[k];
    rays[k].material.opacity = 0.10 + act * 0.8;
    rays[k].material.color.setHSL(0.52 - act * 0.52, 1, 0.55);
  }
}

/* ---------------- cameras ---------------- */
const camMain = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
const camRobot = new THREE.PerspectiveCamera(100, 320 / 170, 0.1, 200);
let camMode = params.get('cam') || 'follow'; // follow | top
const camPos = new THREE.Vector3(0, 18, 22);
function updateCameras(dt) {
  const r = world.robot;
  const fx = Math.cos(r.h), fz = Math.sin(r.h);
  if (camMode === 'follow') {
    const target = new THREE.Vector3(r.x - fx * 8.5, 6.2, r.z - fz * 8.5);
    camPos.lerp(target, 1 - Math.pow(0.0015, dt));
    camMain.position.copy(camPos);
    camMain.lookAt(r.x + fx * 2.5, 0.6, r.z + fz * 2.5);
  } else {
    camPos.lerp(new THREE.Vector3(0, 46, 0.01), 1 - Math.pow(0.001, dt));
    camMain.position.copy(camPos);
    camMain.lookAt(0, 0, 0);
  }
  camRobot.position.set(r.x + fx * 0.4, 0.42, r.z + fz * 0.4);
  camRobot.lookAt(r.x + fx * 10, 0.42, r.z + fz * 10);
}

/* ---------------- HUD: raster / sensors / motors ---------------- */
const rasterCv = document.getElementById('raster');
const rasterCtx = rasterCv.getContext('2d');
const sensorCv = document.getElementById('sensors');
const sensorCtx = sensorCv.getContext('2d');
const motorCv = document.getElementById('motors');
const motorCtx = motorCv.getContext('2d');

function drawRaster() {
  const N = world.net.N;
  const cols = Math.ceil(Math.sqrt(N * 1.6));
  const rows = Math.ceil(N / cols);
  const cw = rasterCv.width / cols, ch = rasterCv.height / rows;
  rasterCtx.fillStyle = '#0b0e12'; rasterCtx.fillRect(0, 0, rasterCv.width, rasterCv.height);
  for (let i = 0; i < N; i++) {
    const a = Math.tanh(world.net.x[i]);
    if (a >= 0) rasterCtx.fillStyle = `rgba(255,${Math.round(90 + 32 * (1 - a))},47,${0.15 + a * 0.85})`;
    else rasterCtx.fillStyle = `rgba(58,111,216,${0.15 - a * 0.85})`;
    rasterCtx.fillRect((i % cols) * cw, ((i / cols) | 0) * ch, Math.max(1, cw - 0.5), Math.max(1, ch - 0.5));
  }
}
function drawSensors() {
  const c = sensorCtx, W = sensorCv.width, H = sensorCv.height;
  c.fillStyle = '#0b0e12'; c.fillRect(0, 0, W, H);
  const bw = W / 8;
  for (let k = 0; k < 8; k++) {
    const v = world.sensors[k];
    c.fillStyle = v > 0.6 ? '#e33229' : v > 0.25 ? '#f2c230' : '#35c163';
    c.fillRect(k * bw + 2, H - v * (H - 6), bw - 4, v * (H - 6));
    c.fillStyle = '#3a4150'; c.fillRect(k * bw + 2, H - 2, bw - 4, 2);
  }
}
function drawMotors() {
  const c = motorCtx, W = motorCv.width, H = motorCv.height;
  c.fillStyle = '#0b0e12'; c.fillRect(0, 0, W, H);
  const bw = W / 2;
  ['L', 'R'].forEach((lab, i) => {
    const v = world.motors[i];
    const midY = H / 2;
    c.fillStyle = '#232a36'; c.fillRect(i * bw + 4, 4, bw - 8, H - 8);
    c.fillStyle = v >= 0 ? '#35c9ff' : '#e33229';
    const h = Math.abs(v) * (H / 2 - 6);
    c.fillRect(i * bw + 6, v >= 0 ? midY - h : midY, bw - 12, h);
    c.fillStyle = '#8d96a5'; c.font = '10px monospace';
    c.fillText(lab, i * bw + bw / 2 - 3, H - 8);
  });
}

/* ---------------- console ---------------- */
const consoleEl = document.getElementById('console');
const lines = [];
let lastEventIdx = 0, lastTelem = 0;
function pushLine(txt, cls) {
  lines.push({ txt, cls: cls || '' });
  if (lines.length > 9) lines.shift();
  consoleEl.innerHTML = lines.map(l => `<div class="${l.cls}">${l.txt}</div>`).join('');
}
function fmtT(t) {
  const m = (t / 60) | 0, s = (t % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}
function pumpConsole() {
  for (; lastEventIdx < world.events.length; lastEventIdx++) {
    const e = world.events[lastEventIdx];
    pushLine(`[${fmtT(e.t)}] ${e.msg}`, 'evt');
  }
  if (world.time - lastTelem > 2.5) {
    lastTelem = world.time;
    const e = world.net.energy();
    let smax = 0; for (let k = 0; k < 8; k++) smax = Math.max(smax, world.sensors[k]);
    pushLine(`[${fmtT(world.time)}] E=${e.toFixed(3)} sMax=${smax.toFixed(2)} mL=${world.motors[0].toFixed(2)} mR=${world.motors[1].toFixed(2)} v=${world.robot.v.toFixed(2)}`);
  }
}

/* ---------------- stats ---------------- */
const statEls = {
  time: document.getElementById('st-time'), dist: document.getElementById('st-dist'),
  near: document.getElementById('st-near'), coll: document.getElementById('st-coll'),
  energy: document.getElementById('st-energy'), seed: document.getElementById('st-seed'),
  neurons: document.getElementById('st-neurons'), obstacles: document.getElementById('st-obstacles')
};
function pumpStats() {
  statEls.time.textContent = fmtT(world.time);
  statEls.dist.textContent = world.dist.toFixed(0) + ' u';
  statEls.near.textContent = world.nearMisses;
  statEls.coll.textContent = world.collisions;
  statEls.energy.textContent = world.net.energy().toFixed(3);
  statEls.seed.textContent = world.net.seed;
  statEls.neurons.textContent = world.net.N;
  statEls.obstacles.textContent = world.obstacles.length;
}

/* ---------------- controls ---------------- */
let paused = false;
const camBtn = document.getElementById('btn-cam');
function refreshCamBtn() { camBtn.textContent = camMode === 'follow' ? 'CAM: FOLLOW' : 'CAM: TOP'; }
refreshCamBtn();
camBtn.onclick = () => { camMode = camMode === 'follow' ? 'top' : 'follow'; refreshCamBtn(); };
document.getElementById('btn-pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'RESUME' : 'PAUSE'; };
document.getElementById('btn-brain').onclick = () => {
  const N = +document.getElementById('sel-neurons').value;
  world.resetBrain(N);
};
document.getElementById('btn-perturb').onclick = () => { world.net.perturb(world.rnd, 2.0); world.log('manual perturbation injected'); };
document.getElementById('btn-box').onclick = () => {
  const r = world.rnd; world.addBox((r() - 0.5) * 30, (r() - 0.5) * 20); rebuildObstacles();
};
document.getElementById('btn-cyl').onclick = () => {
  const r = world.rnd; world.addCylinder((r() - 0.5) * 30, (r() - 0.5) * 20); rebuildObstacles();
};
document.getElementById('btn-scatter').onclick = () => { world.scatter(8); rebuildObstacles(); };
document.getElementById('btn-clear').onclick = () => { world.clearObstacles(); rebuildObstacles(); };
document.getElementById('sel-neurons').onchange = (e) => world.resetBrain(+e.target.value);
document.getElementById('sl-speed').oninput = (e) => { world.speedScale = +e.target.value / 100; };
document.getElementById('sl-gain').oninput = (e) => { world.netGain = +e.target.value / 100; };
document.getElementById('sl-tau').oninput = (e) => { world.net.tauScale = +e.target.value / 100; };

/* ---------------- drag obstacles ---------------- */
const raycaster = new THREE.Raycaster();
const planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let drag = null;
function pointerNDC(e) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
}
canvas.addEventListener('pointerdown', (e) => {
  raycaster.setFromCamera(pointerNDC(e), camMain);
  const hits = raycaster.intersectObjects(obstacleGroup.children, true);
  for (const h of hits) {
    let m = h.object;
    while (m && !m.userData.obstacle && m.parent) m = m.parent;
    const o = m && m.userData.obstacle;
    if (o && !o.static) {
      drag = o; canvas.style.cursor = 'grabbing';
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  raycaster.setFromCamera(pointerNDC(e), camMain);
  const p = new THREE.Vector3();
  raycaster.ray.intersectPlane(planeY, p);
  if (p) {
    drag.x = Math.max(-world.W / 2 + 1, Math.min(world.W / 2 - 1, p.x));
    drag.z = Math.max(-world.H / 2 + 1, Math.min(world.H / 2 - 1, p.z));
    const mesh = meshByObstacle.get(drag);
    if (mesh) mesh.position.set(drag.x, mesh.position.y, drag.z);
  }
});
canvas.addEventListener('pointerup', () => { drag = null; canvas.style.cursor = 'default'; });

/* ---------------- resize ---------------- */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camMain.aspect = w / h; camMain.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ---------------- main loop ---------------- */
if (params.has('shot')) {
  const secs = +params.get('shot') || 5;
  for (let i = 0; i < secs * 60; i++) world.step(1 / 60);
}
updateCameras(10); // snap camera to robot on load (no swoop-in)
drawRaster(); drawSensors(); drawMotors(); pumpConsole(); pumpStats();
let last = performance.now();
let hudT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!paused) world.step(dt);
  syncRobot(); syncRays();
  updateCameras(dt);

  const w = innerWidth, h = innerHeight;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.render(scene, camMain);

  // robot camera inset (top-left)
  const iw = Math.min(320, Math.round(w * 0.28)), ih = Math.round(iw * 170 / 320);
  renderer.setScissorTest(true);
  renderer.setScissor(0, h - ih, iw, ih);
  renderer.setViewport(0, h - ih, iw, ih);
  camRobot.aspect = iw / ih; camRobot.updateProjectionMatrix();
  renderer.render(scene, camRobot);
  renderer.setScissorTest(false);
  document.getElementById('camframe').style.width = iw + 'px';
  document.getElementById('camframe').style.height = ih + 'px';

  hudT += dt;
  if (hudT > 0.08) { hudT = 0; drawRaster(); drawSensors(); drawMotors(); pumpConsole(); pumpStats(); }
  requestAnimationFrame(frame);
}
pushLine('[00:00.0] reservoir online: ' + world.net.N + ' neurons, seed ' + world.net.seed, 'evt');
pushLine('[00:00.0] no learned policy. no RL. dynamics only.', 'evt');
requestAnimationFrame(frame);
})();
