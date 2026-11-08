import { describe, expect, it } from 'vitest';
import { project, rubberBand, rubberClamp, VelocityTracker } from '../motion';

describe('project', () => {
  it('projects momentum with UIScrollView-normal deceleration', () => {
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-1000)).toBeCloseTo(-499, 0);
    expect(project(0)).toBe(0);
  });
  it('travels less with a faster deceleration rate', () => {
    expect(Math.abs(project(1000, 0.99))).toBeLessThan(Math.abs(project(1000, 0.998)));
  });
});

describe('rubberBand', () => {
  it('resists more the further it is pulled, never exceeding the dimension', () => {
    const a = rubberBand(50, 300);
    const b = rubberBand(500, 300);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(50);
    expect(b).toBeLessThan(300);
    expect(b - a).toBeLessThan(450);
    expect(rubberBand(-50, 300)).toBeCloseTo(-a);
  });
  it('clamps inside the range and rubber-bands outside it', () => {
    expect(rubberClamp(40, 0, 100, 50)).toBe(40);
    expect(rubberClamp(120, 0, 100, 50)).toBeGreaterThan(100);
    expect(rubberClamp(120, 0, 100, 50)).toBeLessThan(120);
    expect(rubberClamp(-20, 0, 100, 50)).toBeLessThan(0);
  });
});

describe('VelocityTracker', () => {
  it('measures px/s over the recent samples', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(10, 0, 10);
    v.add(20, 0, 20);
    expect(v.velocity(20).x).toBeCloseTo(1000);
  });
  it('reports zero when the finger paused before lifting', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(30, 0, 16);
    expect(v.velocity(300).x).toBe(0);
  });
});
