/* test.js — headless functional test: run the brain in the world, no renderer. */
const { World } = require('./brain.js');

function run(seed, seconds, scatterAt) {
  const w = new World(seed);
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  let minClear = Infinity, scattered = false;
  const path = [];
  for (let i = 0; i < steps; i++) {
    if (scatterAt && !scattered && w.time > scatterAt) { w.scatter(10); scattered = true; }
    w.step(dt);
    const r = w.robot;
    if (!isFinite(r.x) || !isFinite(r.z) || !isFinite(r.h)) throw new Error('NaN state at t=' + w.time.toFixed(1));
    let md = Infinity;
    for (let k = 0; k < 8; k++) md = Math.min(md, w.rayDists[k]);
    minClear = Math.min(minClear, md);
    if (i % 600 === 0) path.push([w.time.toFixed(0), r.x.toFixed(1), r.z.toFixed(1)]);
  }
  return {
    seed, seconds,
    dist: +w.dist.toFixed(1),
    collisions: w.collisions,
    nearMisses: w.nearMisses,
    endPos: [w.robot.x.toFixed(1), w.robot.z.toFixed(1)],
    energy: +w.net.energy().toFixed(3),
    events: w.events.length,
    path
  };
}

console.log('--- 180s default arena ---');
const a = run(7, 180, 0);
console.log(JSON.stringify(a, null, 1));
console.log('--- 180s with mid-run scatter of 10 extra obstacles ---');
const b = run(21, 180, 60);
console.log(JSON.stringify(b, null, 1));

const ok = a.dist > 100 && a.collisions <= 6 && b.collisions <= 10 && a.energy > 0.05 && a.energy < 0.95;
console.log(ok ? 'FUNCTIONAL TEST: PASS' : 'FUNCTIONAL TEST: REVIEW NEEDED');
