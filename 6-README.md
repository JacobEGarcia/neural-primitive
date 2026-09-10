# PRIMITIVE

A small "primitive" of an artificial brain, running in your browser.

~300 neurons. **No learned policy. No reinforcement learning. No training loop.**
Just a sparse continuous-time recurrent neural network (CTRNN) reacting to a
changing environment in real time through its own neural dynamics, plus innate
sensor-to-motor priors — the part you are "born with."

An e-puck style differential-drive robot roams an arena full of boxes and
cylinders and avoids them, driven only by this little brain. Watch the live
neural raster, the 8 proximity sensors, and the motor readouts as it moves.

Inspired by the untrained-neuron e-puck demo in @alexanderawolf's post
(https://x.com/alexanderawolf/status/2097720062937346451), quoted by
@chris_j_paxton (https://x.com/chris_j_paxton/status/2097822422565061097).
This is an original implementation, not affiliated with the authors.

## Run

Serve statically and open `index.html`:

    python3 -m http.server 8000
    # → http://localhost:8000

## How it works

- `brain.js` — the brain and the world (no rendering deps; runs in Node):
  - CTRNN: `tau_i * dx_i/dt = -x_i + Σ_j W_ij tanh(x_j) + I_i(t)`, sparse
    random `W` scaled to a spectral radius ~1.05 (edge of chaos).
  - 8 e-puck-style IR proximity sensors inject current into sensory neurons.
  - Innate priors: contralateral sensor→turn coupling, frontal slow-down /
    reverse, a startle reflex that bursts the network on sensory saturation.
  - Two random readout populations modulate turn rate and speed, so the
    motion is organic, never scripted.
- `app.js` — three.js rendering, HUD (neural raster, sensors, motors,
  console), obstacle dragging, controls.
- `test.js` — headless functional test: `node test.js` runs the sim for
  minutes of sim time and reports distance, contacts, near misses.

## Controls

- Drag obstacles with the mouse to rearrange the arena while it runs.
- NEW BRAIN: reseed the reservoir (a fresh random brain, instantly competent —
  that is the point of priors).
- PERTURB: kick the network state.
- + BOX / + CYLINDER / SCATTER / CLEAR: edit the arena.
- Neuron count, speed, net gain, tau scale: live sliders.
