// Drawn masks with known answers (frontend-spec 11.4).
import { describe, expect, it } from 'vitest';
import { derive, ellipsePerimeter, Rules, sampleProfile } from '../../src/measure/derive';
import { frontProfile, Mask, maskRows, sideProfile } from '../../src/measure/silhouette';
import rulesFile from '../../../../packages/rules/rules-0.1-uncalibrated.json';

const W = 540;
const H = 960;
const SCALE = 1; // 1 mm per image pixel; the image is twice the mask's size.
const args = (mask: Mask, landmarks: ReturnType<typeof pose>) => ({
  mask,
  landmarks,
  scale: SCALE,
  imageW: W * 2,
  imageH: H * 2,
});
const point = (x: number, row: number, visibility = 0.95) => ({
  x: x / W,
  y: row / H,
  z: 0,
  visibility,
});

function paint() {
  const data = new Uint8Array(W * H);
  const fill = (row: number, from: number, to: number) => {
    for (let x = from; x < to; x++) data[row * W + x] = 1;
  };
  return { mask: { width: W, height: H, data }, fill };
}

/** Subject's left is on the right of the picture. Free arm is the left one. */
function pose() {
  const lm = Array.from({ length: 33 }, () => point(270, 480));
  lm[0] = point(270, 110);
  lm[11] = point(330, 200);
  lm[12] = point(210, 200);
  lm[13] = point(400, 320);
  lm[14] = point(200, 300);
  lm[15] = point(430, 440);
  lm[16] = point(270, 260);
  lm[23] = point(310, 460);
  lm[24] = point(230, 460);
  lm[25] = point(320, 640);
  lm[26] = point(220, 640);
  lm[27] = point(330, 840);
  lm[28] = point(210, 840);
  return lm;
}

function frontBody() {
  const { mask, fill } = paint();
  for (let row = 100; row < 860; row++) {
    if (row < 170)
      fill(row, 240, 300); // Head.
    else if (row < 195)
      fill(row, 250, 290); // Neck, half-width 20 cells.
    else if (row < 500)
      fill(row, 190, 350); // Torso, half-width 80 cells.
    else if (row < 860) {
      fill(row, 190, 260); // Legs with a gap at the centre.
      fill(row, 280, 350);
    }
    if (row >= 200 && row < 440) {
      const x = 330 + ((row - 200) * 100) / 240; // The free arm.
      fill(row, Math.round(x) + 40, Math.round(x) + 70);
    }
  }
  return mask;
}

describe('front profile', () => {
  it('reads the mask limits in image pixels', () => {
    const mask = frontBody();
    expect(maskRows(mask)).toEqual({ top: 100, bottom: 860 });
    const out = frontProfile(args(mask, pose()), 'left');
    expect(out.mask_top_px).toBe(200);
    expect(out.mask_bottom_px).toBe(1720);
    expect(out.samples).toBe(101);
    expect(out.half_width_mm).toHaveLength(101);
  });

  it('gives the torso half-width with a free arm that stands clear', () => {
    const out = frontProfile(args(frontBody(), pose()), 'left');
    // Centre 270, torso edge 350, so 80 cells at 2 mm each.
    expect(sampleProfile(out.half_width_mm, u(300))).toBeCloseTo(160, 0);
    expect(sampleProfile(out.half_width_mm, u(180))).toBeCloseTo(40, 0);
  });

  const u = (row: number) => (row * 2 - 200) / (1720 - 200);

  it('leaves a row null where an arm has merged, whatever the torso width, so it fails visibly', () => {
    const lm = pose();
    lm[13] = point(362, 320);
    lm[15] = point(362, 440);
    const mask = frontBody();
    for (let row = 200; row < 440; row++) {
      for (let x = 350; x < 374; x++) mask.data[row * W + x] = 1;
      for (let x = 374; x < W; x++) mask.data[row * W + x] = 0;
    }
    expect(frontProfile(args(mask, lm), 'left').half_width_mm[30]).toBeNull();
  });

  it('a clear arm does not disturb the width', () => {
    const out = frontProfile(args(frontBody(), pose()), 'left');
    expect(out.half_width_mm.slice(25, 40).every((v) => v === 160)).toBe(true);
  });

  it('a hand resting on the hip fails those rows', () => {
    const lm = pose();
    lm[15] = point(360, 450);
    lm[13] = point(380, 320);
    const mask = frontBody();
    for (let row = 200; row < 520; row++) {
      for (let x = 350; x < W; x++) mask.data[row * W + x] = 0;
      if (row >= 450) for (let x = 350; x < 374; x++) mask.data[row * W + x] = 1;
    }
    const out = frontProfile(args(mask, lm), 'left');
    expect(sampleProfile(out.half_width_mm, u(480))).toBeNull();
  });

  it('a one-pixel hole in the mask does not cut the width', () => {
    const mask = frontBody();
    for (let row = 230; row < 400; row++) mask.data[row * W + 322] = 0;
    expect(
      sampleProfile(frontProfile(args(mask, pose()), 'left').half_width_mm, u(300)),
    ).toBeCloseTo(160, 0);
  });

  it('a stray pixel away from the body does not set the height', () => {
    const mask = frontBody();
    for (const row of [40, 900]) for (let x = 100; x < 104; x++) mask.data[row * W + x] = 1;
    expect(maskRows(mask)).toEqual({ top: 100, bottom: 860 });
  });

  it('a speck in the leg gap is not the crotch', () => {
    const mask = frontBody();
    for (let row = 580; row < 584; row++)
      for (let x = 266; x < 274; x++) mask.data[row * W + x] = 1;
    expect(frontProfile(args(mask, pose()), 'left').crotch_y_px).toBe(1000);
  });

  it('measures on the free-arm side, ignoring the holding arm', () => {
    const mask = frontBody();
    // The holding arm merges on the picture's left.
    for (let row = 200; row < 440; row++)
      for (let x = 120; x < 190; x++) mask.data[row * W + x] = 1;
    const out = frontProfile(args(mask, pose()), 'left');
    expect(sampleProfile(out.half_width_mm, u(300))).toBeCloseTo(160, 0);
  });

  it('finds the crotch where the leg gap closes, in image pixels', () => {
    expect(frontProfile(args(frontBody(), pose()), 'left').crotch_y_px).toBe(1000);
  });

  it('has no crotch when the legs never show a gap', () => {
    const { mask, fill } = paint();
    for (let row = 100; row < 860; row++) fill(row, 190, 350);
    expect(frontProfile(args(mask, pose()), 'left').crotch_y_px).toBeNull();
  });

  it('a gap above the hips is not a crotch', () => {
    const mask = frontBody();
    for (let row = 500; row < 860; row++)
      for (let x = 190; x < 350; x++) mask.data[row * W + x] = 0;
    for (let row = 300; row < 500; row++)
      for (let x = 260; x < 280; x++) mask.data[row * W + x] = 0;
    expect(frontProfile(args(mask, pose()), 'left').crotch_y_px).toBeNull();
  });

  it('thigh rows run from the centre to the outside of the leg', () => {
    const out = frontProfile(args(frontBody(), pose()), 'left');
    expect(sampleProfile(out.half_width_mm, u(560))).toBeCloseTo(160, 0);
  });

  it('is null below the knee and for an empty mask', () => {
    const out = frontProfile(args(frontBody(), pose()), 'left');
    expect(out.half_width_mm[100]).toBeNull();
    const { mask } = paint();
    const none = frontProfile(args(mask, pose()), 'left');
    expect(none.half_width_mm.every((v) => v === null)).toBe(true);
    expect(none.crotch_y_px).toBeNull();
  });

  it('a one-pixel change in width changes the value by one pixel of scale', () => {
    const narrow = frontBody();
    for (let row = 195; row < 500; row++) narrow.data[row * W + 349] = 0;
    const a = frontProfile(args(frontBody(), pose()), 'left').half_width_mm[30] as number;
    const b = frontProfile(args(narrow, pose()), 'left').half_width_mm[30] as number;
    expect(a - b).toBeCloseTo(2, 5);
  });

  it('holds numbers only, so no mask data can travel in a profile', () => {
    const out = frontProfile(args(frontBody(), pose()), 'left');
    expect(JSON.stringify(out).length).toBeLessThan(2000);
  });
});

function sidePose(facingRight = true) {
  const lm = Array.from({ length: 33 }, () => point(270, 480, 0.3));
  lm[0] = point(facingRight ? 310 : 230, 110);
  lm[12] = point(270, 200);
  lm[24] = point(270, 460);
  lm[26] = point(270, 640);
  return lm;
}
function sideBody() {
  const { mask, fill } = paint();
  for (let row = 100; row < 860; row++) {
    if (row < 195) fill(row, 245, 295);
    else if (row < 300)
      fill(row, 200, 350); // Chest: 200 to 350, centre 270.
    else if (row < 650) fill(row, 210, 330);
    else fill(row, 230, 310);
  }
  return mask;
}

describe('side profile', () => {
  const u = (row: number) => (row * 2 - 200) / (1720 - 200);
  it('half-depth is half of the run through the body', () => {
    const out = sideProfile(args(sideBody(), sidePose()));
    expect(sampleProfile(out.half_depth_mm, u(250))).toBeCloseTo(150, 0);
    expect(sampleProfile(out.half_depth_mm, u(400))).toBeCloseTo(120, 0);
  });
  it('anterior is measured toward the way the client faces', () => {
    const toRight = sideProfile(args(sideBody(), sidePose(true)));
    const toLeft = sideProfile(args(sideBody(), sidePose(false)));
    expect(sampleProfile(toRight.anterior_mm, u(250))).toBeCloseTo(160, 0);
    expect(sampleProfile(toLeft.anterior_mm, u(250))).toBeCloseTo(140, 0);
  });
  it('uses the near side with the higher visibility', () => {
    const lm = sidePose();
    lm[11] = point(250, 200, 0.99);
    lm[23] = point(250, 460, 0.99);
    lm[25] = point(250, 640, 0.99);
    lm[12] = point(270, 200, 0.2);
    lm[24] = point(270, 460, 0.2);
    const out = sideProfile(args(sideBody(), lm));
    expect(sampleProfile(out.anterior_mm, u(250))).toBeCloseTo(200, 0);
  });
  it('a forearm held forward over the hip does not add to the depth', () => {
    const lm = sidePose();
    lm[14] = point(360, 400);
    lm[16] = point(380, 490);
    const mask = sideBody();
    for (let row = 455; row < 491; row++)
      for (let x = 330; x < 400; x++) mask.data[row * W + x] = 1;
    const out = sideProfile(args(mask, lm));
    expect(sampleProfile(out.half_depth_mm, u(470))).toBeNull();
    expect(sampleProfile(out.half_depth_mm, u(600))).toBeCloseTo(120, 0);
  });
  it('a hole on the centre line still reads the row', () => {
    const mask = sideBody();
    for (let row = 200; row < 500; row++) mask.data[row * W + 270] = 0;
    expect(sampleProfile(sideProfile(args(mask, sidePose())).half_depth_mm, u(400))).toBeCloseTo(
      120,
      0,
    );
  });
  it('an empty mask gives nulls', () => {
    const none = sideProfile(args(paint().mask, sidePose()));
    expect(none.half_depth_mm.every((v) => v === null)).toBe(true);
  });
});

describe('mask to measurements', () => {
  it('a drawn body gives the expected girth, through the same derivation the server runs', () => {
    const rules = rulesFile as unknown as Rules;
    const marker = (side: number) => ({
      corners: [
        [100, 100],
        [100 + side, 100],
        [100 + side, 100 + side],
        [100, 100 + side],
      ],
      image_w: W * 2,
      image_h: H * 2,
      confidence: 0.95,
    });
    const front = frontProfile(args(frontBody(), pose()), 'left');
    const side = sideProfile(args(sideBody(), sidePose()));
    const out = derive(
      {
        covariates: { height_mm_entered: 1520, sex: 'male', clothing_fit: 'fitted' },
        session: { free_arm: 'left', level_unchecked: false },
        landmarks_front: pose(),
        landmarks_side: sidePose(),
        marker_front: marker(150),
        marker_side: marker(150),
        silhouette_front: front,
        silhouette_side: side,
      },
      rules,
    );
    expect(out.sites.stature.raw_mm).toBeCloseTo(1520, 0);
    expect(out.sites.inleg.raw_mm).toBeCloseTo(720, 0);
    const chest = out.sites.chest;
    expect(chest.a_mm).toBeCloseTo(160, 0);
    expect(chest.b_mm).toBeCloseTo(150, 0);
    expect(chest.raw_mm).toBeCloseTo(ellipsePerimeter(160, 150), 0);
  });
});
