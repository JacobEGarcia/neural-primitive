/* ============================================================================
 * PRIMITIVE — brain.js
 * A small "primitive" of an artificial brain: ~300 untrained neurons with
 * continuous-time recurrent neural dynamics (CTRNN) driving an e-puck style
 * differential-drive robot. No learned policy. No RL. No training loop.
 * Innate sensor->motor priors + recurrent dynamics do all the work.
 * Pure JS: no rendering deps, runs in browser and Node (test harness).
 * ==========================================================================*/
(function (global) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------------- Continuous-time recurrent neural network -------------
   * tau_i * dx_i/dt = -x_i + sum_j W_ij * tanh(x_j) + I_i(t)
   * Sparse random recurrent W scaled to a target spectral radius so activity
   * sits near the edge of chaos: rich, reactive, never dead, never exploding.
   * -----------------------------------------------------------------------*/
  class CTRNN {
    constructor(N, seed, opts) {
      opts = opts || {};
      this.N = N; this.seed = seed;
      const rnd = mulberry32(seed);
      const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;
      this.x = new Float32Array(N);
      this.a = new Float32Array(N);
      this.tau = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        this.x[i] = (rnd() - 0.5) * 0.4;
        this.tau[i] = 0.05 + rnd() * 0.45;
      }
      const density = opts.density || 0.08;
      this.cols = new Array(N);
      for (let i = 0; i < N; i++) {
        const list = [];
        for (let j = 0; j < N; j++) {
          if (i !== j && rnd() < density) list.push({ j: j, w: gauss() });
        }
        this.cols[i] = list;
      }
      // power iteration to estimate spectral radius of W
      let v = new Float32Array(N);
      for (let i = 0; i < N; i++) v[i] = rnd() - 0.5;
      let lambda = 1;
      for (let it = 0; it < 40; it++) {
        const w = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          let s = 0; const l = this.cols[i];
          for (let k = 0; k < l.length; k++) s += l[k].w * v[l[k].j];
          w[i] = s;
        }
        let n = 0, nv = 0;
        for (let i = 0; i < N; i++) { n += w[i] * w[i]; nv += v[i] * v[i]; }
        n = Math.sqrt(n) || 1e-9;
        lambda = n / (Math.sqrt(nv) || 1e-9);
        for (let i = 0; i < N; i++) v[i] = w[i] / n;
      }
      const scale = (opts.spectralRadius || 1.05) / (lambda || 1);
      for (let i = 0; i < N; i++) {
        const l = this.cols[i];
        for (let k = 0; k < l.length; k++) l[k].w *= scale;
      }
      this.inGain = opts.inGain || 2.4;
      this.input = new Float32Array(N);
      // two random readout populations
      this.readA = []; this.readB = [];
      for (let i = 0; i < N; i++) (rnd() < 0.5 ? this.readA : this.readB).push(i);
      this.tauScale = 1;
    }
    setSensors(s) {
      this.input.fill(0);
      const g = this.inGain;
      for (let k = 0; k < 8; k++) {
        this.input[2 * k] = g * s[k];
        this.input[2 * k + 1] = -0.7 * g * s[k];
      }
    }
    injectCurrent(idx, amount) { this.input[idx % this.N] += amount; }
    step(dt) {
      const { N, x, a, tau, cols, input, tauScale } = this;
      const eff = dt / tauScale;
      for (let i = 0; i < N; i++) a[i] = Math.tanh(x[i]);
      for (let i = 0; i < N; i++) {
        let s = input[i]; const l = cols[i];
        for (let k = 0; k < l.length; k++) s += l[k].w * a[l[k].j];
        x[i] += eff * (-x[i] + s) / tau[i];
      }
    }
    readouts() {
      let A = 0, B = 0;
      for (let q = 0; q < this.readA.length; q++) A += Math.tanh(this.x[this.readA[q]]);
      for (let q = 0; q < this.readB.length; q++) B += Math.tanh(this.x[this.readB[q]]);
      return [A / this.readA.length, B / this.readB.length];
    }
    perturb(rnd, amp) {
      const r = rnd || Math.random;
      for (let i = 0; i < this.N; i++) this.x[i] += (r() - 0.5) * (amp || 1.5);
    }
    energy() {
      let s = 0;
      for (let i = 0; i < this.N; i++) s += Math.abs(Math.tanh(this.x[i]));
      return s / this.N;
    }
  }

  /* ---------------- e-puck proximity sensor geometry ----------------------
   * 8 IR sensors, angles in radians relative to heading, + rotates the
   * forward vector counter-clockwise in the (x,z) plane. Mirrors e-puck
   * ps0..ps7 placement (front-biased).                              */
  const SENSOR_ANGLES = [17, 45, 90, 150, -150, -90, -45, -17].map(d => d * Math.PI / 180);

  /* ---------------- World: arena, obstacles, robot physics ----------------*/
  class World {
    constructor(seed) {
      seed = seed || 1;
      this.seed = seed;
      this.rnd = mulberry32(seed * 7919 + 13);
      this.W = 44; this.H = 30;              // arena inner dimensions
      this.obstacles = [];
      this.decals = [];                       // non-collidable floor markings
      this.robot = { x: -14, z: 8, h: -0.5, r: 0.45, v: 0, w: 0 };
      this.time = 0; this.dist = 0;
      this.collisions = 0; this.nearMisses = 0;
      this.speedMax = 2.4; this.turnMax = 2.8;
      this.K = 3.4;                           // prior turn gain
      this.Krev = 1.6;                        // reverse gain on frontal saturation
      this.netGain = 1.0;
      this.sensorRange = 3.2;
      this.sensorNoise = 0.02;
      this.speedScale = 1;
      this.net = new CTRNN(300, seed);
      this.rayDists = new Float32Array(8);
      this.sensors = new Float32Array(8);
      this.motors = [0, 0];
      this.events = [];
      this._collCd = 0; this._startleCd = 0;
      this._nearArmed = true;
      this._watchT = 0; this._watchX = this.robot.x; this._watchZ = this.robot.z;
      this.buildDefault();
    }

    log(msg) { this.events.push({ t: this.time, msg: msg }); }

    buildDefault() {
      const O = this.obstacles, D = this.decals;
      O.length = 0; D.length = 0;
      const B = (x, z, hw, hd, rot, h, color) => O.push({ type: 'box', x, z, hw, hd, rot: rot || 0, h: h || 2, color: color || '#b98a56', static: false });
      const C = (x, z, r, h, color) => O.push({ type: 'cyl', x, z, r, h: h || 2.6, color, static: false });
      const PAD = (x, z, r) => D.push({ type: 'pad', x, z, r });
      // cardboard cluster (center / center-right)
      B(6, 2, 2.2, 1.8, 0.2, 1.6, '#b98a56'); B(8.6, 3.4, 1.6, 1.4, -0.3, 2.4, '#c9a06a');
      B(7.2, 0.4, 1.4, 1.2, 0.5, 3.0, '#a87f4f'); B(10.6, 1.2, 1.8, 1.5, 0.1, 1.2, '#b98a56');
      B(4.2, -3.8, 1.5, 1.5, -0.4, 2.0, '#c9a06a'); B(-2.5, 5.5, 1.9, 1.4, 0.7, 1.8, '#b98a56');
      B(-7.5, -6.5, 1.6, 1.3, 0.2, 2.6, '#a87f4f'); B(13.5, -6.0, 2.0, 1.6, -0.15, 1.5, '#c9a06a');
      B(16.5, 5.5, 1.4, 1.4, 0.4, 2.2, '#b98a56'); B(-12.0, 2.0, 1.7, 1.5, -0.5, 1.4, '#c9a06a');
      // colored cylinders
      C(-4.5, -1.5, 1.0, 3.4, '#35c163'); C(-2.2, -1.2, 1.0, 3.4, '#35c163');
      C(2.0, -8.0, 1.2, 3.0, '#3a6fd8'); C(14.5, -1.5, 0.9, 2.8, '#f2f2f2');
      C(18.5, -8.5, 1.1, 3.2, '#d64545'); C(-16.0, -6.0, 1.0, 3.0, '#f0c93f');
      C(9.0, 9.5, 1.0, 2.8, '#3a6fd8'); C(-9.0, 9.0, 1.1, 3.2, '#35c163');
      // gray blocks
      B(-1.0, -11.0, 2.4, 1.2, 0.0, 1.0, '#7d838c'); B(19.0, 2.5, 1.2, 2.6, 0.0, 1.8, '#6d737c');
      // shelf unit (static, left wall) — frame + blue storage boxes
      const shelf = { type: 'box', x: -19.5, z: 5.0, hw: 1.1, hd: 4.0, rot: 0, h: 3.4, color: '#4a4f57', static: true, shelf: true };
      O.push(shelf);
      // black floor pads (decals, like the source video)
      PAD(-6, 3.5, 1.3); PAD(0.5, 6.5, 1.1); PAD(11, -3.5, 1.4); PAD(-13, -2, 1.2); PAD(3, 11, 1.0);
    }

    addBox(x, z) {
      const r = this.rnd;
      const palette = ['#b98a56', '#c9a06a', '#a87f4f', '#7d838c'];
      this.obstacles.push({ type: 'box', x, z, hw: 1.0 + r() * 1.2, hd: 0.9 + r() * 1.0, rot: r() * Math.PI, h: 1.2 + r() * 2.0, color: palette[(r() * palette.length) | 0], static: false });
      this.log('obstacle spawned: box #' + this.obstacles.length);
    }
    addCylinder(x, z) {
      const r = this.rnd;
      const palette = ['#35c163', '#3a6fd8', '#f2f2f2', '#d64545', '#f0c93f'];
      this.obstacles.push({ type: 'cyl', x, z, r: 0.8 + r() * 0.5, h: 2.4 + r() * 1.2, color: palette[(r() * palette.length) | 0], static: false });
      this.log('obstacle spawned: cylinder #' + this.obstacles.length);
    }
    scatter(n) {
      const r = this.rnd;
      for (let i = 0; i < (n || 8); i++) {
        const x = (r() - 0.5) * (this.W - 6), z = (r() - 0.5) * (this.H - 6);
        const dx = x - this.robot.x, dz = z - this.robot.z;
        if (dx * dx + dz * dz < 16) continue;
        (r() < 0.55 ? this.addBox : this.addCylinder).call(this, x, z);
      }
    }
    clearObstacles() {
      this.obstacles = this.obstacles.filter(o => o.static);
      this.log('arena cleared (shelf kept)');
    }

    pointIn(o, px, pz) {
      if (o.type === 'box') {
        const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
        const lx = (px - o.x) * c - (pz - o.z) * s;
        const lz = (px - o.x) * s + (pz - o.z) * c;
        return Math.abs(lx) < o.hw && Math.abs(lz) < o.hd;
      }
      const dx = px - o.x, dz = pz - o.z;
      return dx * dx + dz * dz < o.r * o.r;
    }

    rayDist(x, z, ang, range) {
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const step = 0.08;
      const hw = this.W / 2 - 0.15, hh = this.H / 2 - 0.15;
      for (let t = step; t <= range; t += step) {
        const px = x + dx * t, pz = z + dz * t;
        if (px < -hw || px > hw || pz < -hh || pz > hh) return t;
        const O = this.obstacles;
        for (let i = 0; i < O.length; i++) if (this.pointIn(O[i], px, pz)) return t;
      }
      return range;
    }

    sense() {
      const r = this.robot;
      for (let k = 0; k < 8; k++) {
        const d = this.rayDist(r.x, r.z, r.h + SENSOR_ANGLES[k], this.sensorRange);
        this.rayDists[k] = d;
        let act = d >= this.sensorRange ? 0 : Math.pow(1 - d / this.sensorRange, 2);
        act += (this.rnd() - 0.5) * this.sensorNoise;
        this.sensors[k] = clamp(act, 0, 1);
      }
      return this.sensors;
    }

    /* One simulation tick. The ONLY controller is the network + innate priors. */
    step(dt) {
      const r = this.robot;
      const s = this.sense();
      this.net.setSensors(s);
      const sub = 3;
      for (let i = 0; i < sub; i++) this.net.step(dt / sub);
      const rd = this.net.readouts(); const A = rd[0], B = rd[1];

      // ---- innate priors (the part you are "born with") ----
      let plus = 0, minus = 0, front = 0, mid = 0;
      for (let k = 0; k < 8; k++) {
        const th = SENSOR_ANGLES[k], v = s[k];
        if (th > 0) plus += v * Math.sin(th); else minus += v * Math.sin(-th);
        if (Math.abs(th) < 0.5) front += v; else if (Math.abs(th) < 1.2) mid += v * 0.5;
      }
      front /= 2;
      let w = -this.K * (plus - minus) + this.netGain * 1.8 * (A - B);
      let speedFactor = Math.max(0, 1 - 1.5 * front - 0.4 * mid);
      let v = this.speedMax * this.speedScale * (0.55 + 0.45 * speedFactor) * speedFactor;
      if (front > 0.6) v -= this.Krev * (front - 0.6) * this.speedMax * 0.5;
      v += this.netGain * 0.1 * (A + B) * this.speedMax;
      v = clamp(v, -1.3, this.speedMax * this.speedScale);
      w = clamp(w, -this.turnMax, this.turnMax);

      // startle reflex: frontal saturation bursts the network state
      if (front > 0.85 && this._startleCd <= 0) {
        this.net.perturb(this.rnd, 2.2);
        this._startleCd = 2.5;
        this.log('startle: sensory saturation -> network burst');
      }
      this._startleCd -= dt;

      r.v = v; r.w = w;
      r.h += w * dt;
      r.x += Math.cos(r.h) * v * dt;
      r.z += Math.sin(r.h) * v * dt;
      this.collide();

      this.dist += Math.abs(v) * dt;
      this.time += dt;
      this._collCd -= dt;

      // motor readout for display, normalized [-1,1]
      this.motors[0] = clamp(v / this.speedMax - (w / this.turnMax) * 0.8, -1, 1); // left
      this.motors[1] = clamp(v / this.speedMax + (w / this.turnMax) * 0.8, -1, 1); // right

      // near-miss tracking
      let minD = this.sensorRange;
      for (let k = 0; k < 8; k++) minD = Math.min(minD, this.rayDists[k]);
      if (minD < 0.75 && this._nearArmed && Math.abs(v) > 0.3) {
        this.nearMisses++; this._nearArmed = false;
      } else if (minD > 1.4) this._nearArmed = true;

      // escape watchdog: if barely moved for 4s, burst the network
      this._watchT += dt;
      if (this._watchT > 4) {
        const dx = r.x - this._watchX, dz = r.z - this._watchZ;
        if (dx * dx + dz * dz < 0.36) {
          this.net.perturb(this.rnd, 2.8);
          this.log('escape maneuver: dynamics perturbed');
        }
        this._watchT = 0; this._watchX = r.x; this._watchZ = r.z;
      }
    }

    collide() {
      const r = this.robot, R = r.r;
      let hit = false;
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i];
        if (o.type === 'cyl') {
          const dx = r.x - o.x, dz = r.z - o.z;
          const d = Math.sqrt(dx * dx + dz * dz), min = o.r + R;
          if (d < min && d > 1e-6) {
            const push = (min - d);
            r.x += (dx / d) * push; r.z += (dz / d) * push; hit = true;
          }
        } else {
          const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
          let lx = (r.x - o.x) * c - (r.z - o.z) * s;
          let lz = (r.x - o.x) * s + (r.z - o.z) * c;
          const cx = clamp(lx, -o.hw, o.hw), cz = clamp(lz, -o.hd, o.hd);
          let dx = lx - cx, dz = lz - cz;
          let d = Math.sqrt(dx * dx + dz * dz);
          if (d < R) {
            let nx, nz, push;
            if (d > 1e-6) { nx = dx / d; nz = dz / d; push = R - d; }
            else { // center inside box: push along smallest exit
              const ex = o.hw - Math.abs(lx), ez = o.hd - Math.abs(lz);
              if (ex < ez) { nx = lx > 0 ? 1 : -1; nz = 0; push = ex + R; }
              else { nx = 0; nz = lz > 0 ? 1 : -1; push = ez + R; }
            }
            const wc = Math.cos(o.rot), ws = Math.sin(o.rot);
            const wx = nx * wc - nz * ws, wz = nx * ws + nz * wc;
            r.x += wx * push; r.z += wz * push; hit = true;
          }
        }
      }
      // walls
      const hw = this.W / 2 - R - 0.05, hh = this.H / 2 - R - 0.05;
      if (r.x < -hw) { r.x = -hw; hit = true; }
      if (r.x > hw) { r.x = hw; hit = true; }
      if (r.z < -hh) { r.z = -hh; hit = true; }
      if (r.z > hh) { r.z = hh; hit = true; }
      if (hit && this._collCd <= 0) {
        this.collisions++; this._collCd = 1.5;
        this.log('contact — dynamics absorbing impact');
      }
    }

    resetBrain(N, seed) {
      this.net = new CTRNN(N || this.net.N, seed != null ? seed : ((this.rnd() * 1e9) | 0));
      this.log('new reservoir initialized: ' + this.net.N + ' neurons, seed ' + this.net.seed);
    }
  }

  const api = { CTRNN, World, SENSOR_ANGLES, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PRIMITIVE = api;
})(typeof window !== 'undefined' ? window : globalThis);
