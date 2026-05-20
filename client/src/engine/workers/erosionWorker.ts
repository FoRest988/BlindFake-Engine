/**
 * Hydraulic erosion worker — droplet-based simulation.
 *
 * Message in:
 *   { heightData: ArrayBuffer (Float32Array), resolution: number, droplets: number, maxHeight?: number }
 *
 * Message out:
 *   { heightData: ArrayBuffer (Float32Array) }
 *
 * Algorithm: Simulates water droplets flowing downhill, eroding sediment
 * and depositing it where the gradient flattens (as in the Benes / Sebastian
 * Lague formulation).  Runs entirely in the worker thread.
 */

// ── Tunable parameters ────────────────────────────────────
const INERTIA           = 0.05;   // how much the droplet keeps its old direction
const CAPACITY_FACTOR   = 4;      // max sediment capacity relative to speed×slope
const ERODE_SPEED       = 0.3;
const DEPOSIT_SPEED     = 0.3;
const EVAPORATE_SPEED   = 0.01;
const GRAVITY           = 4;
const MAX_STEPS         = 64;
const BRUSH_RADIUS      = 3;      // erosion brush radius in cells

// Precompute a circular brush kernel with normalised weights
function buildBrush(radius: number): Array<{ dx: number; dz: number; w: number }> {
  const entries: Array<{ dx: number; dz: number; w: number }> = [];
  let total = 0;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < radius) {
        const w = 1 - d / radius;
        entries.push({ dx, dz, w });
        total += w;
      }
    }
  }
  for (const e of entries) e.w /= total;
  return entries;
}

// Bilinear height sample (x/z in [0, res-1])
function sampleHeight(h: Float32Array, res: number, x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const xi1 = Math.min(xi + 1, res - 1), zi1 = Math.min(zi + 1, res - 1);
  const xi0 = Math.max(xi, 0), zi0 = Math.max(zi, 0);
  return (h[zi0 * res + xi0] * (1 - fx) + h[zi0 * res + xi1] * fx) * (1 - fz)
       + (h[zi1 * res + xi0] * (1 - fx) + h[zi1 * res + xi1] * fx) * fz;
}

// Bilinear gradient of the height field at (x, z)
function sampleGradient(h: Float32Array, res: number, x: number, z: number): { gx: number; gz: number } {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const xi1 = Math.min(xi + 1, res - 1), zi1 = Math.min(zi + 1, res - 1);
  const xi0 = Math.max(xi, 0), zi0 = Math.max(zi, 0);
  const h00 = h[zi0 * res + xi0], h10 = h[zi0 * res + xi1];
  const h01 = h[zi1 * res + xi0], h11 = h[zi1 * res + xi1];
  const gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
  const gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
  return { gx, gz };
}

function runErosion(
  heightData: Float32Array,
  resolution: number,
  droplets: number,
): void {
  const brush = buildBrush(BRUSH_RADIUS);

  for (let d = 0; d < droplets; d++) {
    // Spawn at random position
    let x = Math.random() * (resolution - 1);
    let z = Math.random() * (resolution - 1);
    let vx = 0, vz = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const { gx, gz } = sampleGradient(heightData, resolution, x, z);

      // Update velocity (inertia + gravity×gradient)
      vx = vx * INERTIA - gx * (1 - INERTIA);
      vz = vz * INERTIA - gz * (1 - INERTIA);

      const vLen = Math.sqrt(vx * vx + vz * vz);
      if (vLen < 1e-6) break;

      // Normalize
      vx /= vLen; vz /= vLen;

      const nx = x + vx, nz = z + vz;
      if (nx < 0 || nx >= resolution - 1 || nz < 0 || nz >= resolution - 1) break;

      const oldH = sampleHeight(heightData, resolution, x, z);
      const newH = sampleHeight(heightData, resolution, nx, nz);
      const deltaH = newH - oldH;

      // Sediment capacity
      const capacity = Math.max(-deltaH * vLen * water * CAPACITY_FACTOR, 0.001);

      if (sediment > capacity || deltaH > 0) {
        // Deposit
        const amt = deltaH > 0
          ? Math.min(sediment, deltaH)
          : (sediment - capacity) * DEPOSIT_SPEED;
        sediment -= amt;
        // Distribute deposit around current cell (bilinear splat)
        const xi = Math.floor(x), zi = Math.floor(z);
        const fx = x - xi, fz = z - zi;
        if (xi >= 0 && xi < resolution - 1 && zi >= 0 && zi < resolution - 1) {
          heightData[zi * resolution + xi]         += amt * (1 - fx) * (1 - fz);
          heightData[zi * resolution + xi + 1]     += amt * fx       * (1 - fz);
          heightData[(zi+1) * resolution + xi]     += amt * (1 - fx) * fz;
          heightData[(zi+1) * resolution + xi + 1] += amt * fx       * fz;
        }
      } else {
        // Erode using brush
        const erodeAmt = Math.min((capacity - sediment) * ERODE_SPEED, -deltaH);
        for (const { dx, dz, w } of brush) {
          const ex = Math.round(x) + dx;
          const ez = Math.round(z) + dz;
          if (ex < 0 || ex >= resolution || ez < 0 || ez >= resolution) continue;
          const eroded = erodeAmt * w;
          heightData[ez * resolution + ex] -= eroded;
          sediment += eroded;
        }
      }

      // Move droplet
      speed = Math.sqrt(speed * speed + deltaH * GRAVITY);
      water *= (1 - EVAPORATE_SPEED);

      x = nx;
      z = nz;
      if (water < 0.01) break;
    }
  }
}

// ── Worker message handler ────────────────────────────────
self.addEventListener('message', (e: MessageEvent) => {
  const { heightData: inputBuffer, resolution, droplets } = e.data as {
    heightData: ArrayBuffer;
    resolution: number;
    droplets: number;
  };

  const heightData = new Float32Array(inputBuffer);
  runErosion(heightData, resolution, droplets);

  // Transfer buffer back to main thread
  (self as unknown as Worker).postMessage({ heightData: heightData.buffer }, [heightData.buffer]);
});
