/**
 * Motion primitives, modelled on Apple's "Designing Fluid Interfaces" (WWDC 2018):
 *
 *  - Springs are described by `dampingRatio` (1 = no overshoot, < 1 = bounce)
 *    and `response` (seconds, roughly how quickly it gets there), not by a
 *    duration + curve.
 *  - Every animation is interruptible: it can be stopped at any frame and its
 *    live value/velocity picked up by a finger or by a new animation.
 *  - When a finger lets go, its velocity is handed to the spring so there is
 *    no seam between dragging and animating, and the resting point is chosen
 *    by projecting that momentum forward.
 *  - Past a boundary, content follows the finger with increasing resistance
 *    (rubber-banding) instead of stopping dead.
 */

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export interface SpringOptions {
  from: number;
  to: number;
  /** Units per second, e.g. the finger's velocity on release. */
  velocity?: number;
  /** 1 = critically damped (no bounce). Lower = bouncier. */
  dampingRatio?: number;
  /** Seconds. Smaller = snappier. */
  response?: number;
  /** Settles when within this distance of `to`… */
  restDelta?: number;
  /** …and moving slower than this (units/second). */
  restSpeed?: number;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}

export interface SpringAnimation {
  stop(): void;
  readonly value: number;
  readonly velocity: number;
  readonly target: number;
  readonly running: boolean;
}

/** Runs a physical spring on requestAnimationFrame. Returns a handle that can be interrupted at any time. */
export function animateSpring(o: SpringOptions): SpringAnimation {
  const { from, to, dampingRatio = 1, response = 0.38, restDelta = 0.35, restSpeed = 4, onUpdate, onComplete } = o;
  let x = from;
  let v = o.velocity ?? 0;
  let running = true;
  let raf = 0;

  const finish = () => {
    running = false;
    x = to;
    v = 0;
    onUpdate(to);
    onComplete?.();
  };

  const handle: SpringAnimation = {
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    },
    get value() {
      return x;
    },
    get velocity() {
      return v;
    },
    get target() {
      return to;
    },
    get running() {
      return running;
    },
  };

  if (prefersReducedMotion() || from === to && Math.abs(v) < restSpeed) {
    // Defer so callers can store the handle before onComplete runs.
    raf = requestAnimationFrame(finish);
    return handle;
  }

  const k = (2 * Math.PI / response) ** 2;
  const c = (4 * Math.PI * dampingRatio) / response;
  let last = performance.now();

  const step = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.064, Math.max(0, (now - last) / 1000));
    last = now;
    // Fixed sub-steps keep the integration stable regardless of frame rate.
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -k * (x - to) - c * v;
      v += a * h;
      x += v * h;
    }
    if (Math.abs(x - to) < restDelta && Math.abs(v) < restSpeed) {
      finish();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return handle;
}

/**
 * Where content would come to rest if it kept gliding with the given velocity
 * (px/s) and UIScrollView's normal deceleration rate.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Apple-style rubber band: resistance grows the further you pull past a limit. */
export function rubberBand(offset: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  const sign = Math.sign(offset);
  const x = Math.abs(offset);
  return sign * (1 - 1 / ((x * constant) / dimension + 1)) * dimension;
}

/** Clamps `value` into [min, max], rubber-banding the overshoot. */
export function rubberClamp(value: number, min: number, max: number, dimension: number): number {
  if (value < min) return min + rubberBand(value - min, dimension);
  if (value > max) return max + rubberBand(value - max, dimension);
  return value;
}

/** Tracks recent pointer positions to measure release velocity (px/s). */
export class VelocityTracker {
  private samples: { t: number; x: number; y: number }[] = [];

  reset() {
    this.samples = [];
  }

  add(x: number, y: number, t = performance.now()) {
    this.samples.push({ t, x, y });
    const cutoff = t - 100;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** Velocity over the last ~100ms. Returns 0 if the finger paused before lifting. */
  velocity(now = performance.now()): { x: number; y: number } {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const last = s[s.length - 1];
    if (now - last.t > 80) return { x: 0, y: 0 };
    const first = s[0];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }
}

/**
 * CSS/WAAPI easing that matches a critically damped spring (dampingRatio 1,
 * response 0.38s), for things that don't need a live velocity hand-off.
 */
export const SPRING_EASING =
  'linear(0, 0.043, 0.141, 0.254, 0.375, 0.481, 0.58, 0.66, 0.728, 0.786, 0.831, 0.868, 0.897, 0.921, 0.938, 0.952, 0.963, 0.972, 0.979, 0.983, 0.988, 0.99, 0.993, 0.994, 0.996, 0.997, 0.998, 0.998, 1)';
export const SPRING_MS = 540;

export const supportsLinearEasing =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transition-timing-function', 'linear(0, 1)');

export const springEasing = supportsLinearEasing ? SPRING_EASING : 'cubic-bezier(0.22, 1, 0.36, 1)';
