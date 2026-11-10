import { describe, expect, it } from 'vitest';
import { createTiltSmoother, tiltFromAngles } from '../../src/capture/camera';

// D50: the level check reads lean and in-plane tilt from the up vector, smoothed.
describe('tiltFromAngles', () => {
  it('matches the event angles on an upright phone with a small lean and roll', () => {
    const tilt = tiltFromAngles(89, 0);
    expect(tilt.beta).toBeCloseTo(89, 5);
    expect(tilt.gamma).toBeCloseTo(0, 5);
  });

  it('reads flat on a table as beta 0', () => {
    expect(tiltFromAngles(0, 0).beta).toBeCloseTo(0, 5);
  });

  it('stays level at the gimbal lock, where the event gamma is meaningless', () => {
    // Exactly upright: the browser may report any gamma, but the phone is level.
    for (const gamma of [-60, -15, 0, 30, 80]) {
      const tilt = tiltFromAngles(90, gamma);
      expect(tilt.beta).toBeCloseTo(90, 5);
      expect(Math.abs(tilt.gamma)).toBeLessThan(1e-6);
    }
  });

  it('shows a real sideways tilt of an upright phone', () => {
    // A phone rotated 5 degrees in the screen plane, leaning back 0.1 degree, reports
    // beta about 85 and gamma about -89 in the event's angles.
    const tilt = tiltFromAngles(85.001, -88.85);
    expect(tilt.beta).toBeGreaterThan(89.5);
    expect(Math.abs(tilt.gamma)).toBeGreaterThan(4.5);
    expect(Math.abs(tilt.gamma)).toBeLessThan(5.5);
  });
});

describe('createTiltSmoother', () => {
  it('takes the first reading as is', () => {
    const smooth = createTiltSmoother(300);
    const tilt = smooth(89, 1, 0);
    expect(tilt.beta).toBeCloseTo(89, 2);
    // Near upright the event's gamma is a turn about the vertical axis, so 1 degree of it is
    // almost no sideways tilt (sin 1 x cos 89 = 0.017 degree).
    expect(tilt.gamma).toBeCloseTo(0.017, 3);
  });

  it('keeps a still phone with jittery readings inside the 2 degree band', () => {
    const smooth = createTiltSmoother(300);
    let worst = 0;
    // 60 Hz readings jumping between +-2.5 degrees around level.
    for (let i = 0; i < 120; i++) {
      const noise = i % 2 === 0 ? 2.5 : -2.5;
      const tilt = smooth(90 + noise * 0.4, noise, i * 16);
      if (i > 20) worst = Math.max(worst, Math.abs(tilt.gamma), Math.abs(tilt.beta - 90));
    }
    expect(worst).toBeLessThan(2);
  });

  it('follows a real change within about a second', () => {
    const smooth = createTiltSmoother(300);
    smooth(90, 0, 0);
    let tilt = smooth(80, 0, 16);
    for (let t = 32; t <= 1000; t += 16) tilt = smooth(80, 0, t);
    expect(tilt.beta).toBeCloseTo(80, 0);
  });
});
