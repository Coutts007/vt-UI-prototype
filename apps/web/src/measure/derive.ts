// Turns a profile's numbers into nine measurements and flags (backend-spec 10.3, A14).
// A port of packages/py/vt_measure/derive.py, which it must match (make parity). Searches and
// tie-breaks are deliberate, and packages/parity-fixtures/README.md lists the rules. Pure functions.
export const SITES = ['stature', 'shoulder', 'chest', 'waist', 'hip', 'sleeve', 'outleg', 'inleg', 'neck'] as const;
export type Site = (typeof SITES)[number];
const REASONS = [
  'scale_disagree',
  'level_unchecked',
  'loose_clothing',
  'landmark_low',
  'mask_gap',
  'out_of_range',
  'crotch_not_found',
  'marker_weak',
  'waist_level_mismatch',
  'chest_level_mismatch',
  'view_failed',
  'free_arm_unknown',
] as const;
export type Reason = (typeof REASONS)[number];
export type Arm = 'left' | 'right';

const FRONT_SITES = new Set<Site>(['stature', 'shoulder', 'chest', 'waist', 'hip', 'sleeve', 'inleg', 'neck']);
const SIDE_SITES = new Set<Site>(['chest', 'waist', 'hip', 'outleg', 'neck']);
const LOOSE_SITES = new Set<Site>(['chest', 'waist', 'hip']);
const SCALE_BAND_SITES = new Set<Site>(['stature', 'chest', 'waist', 'hip', 'neck']);
const FREE_ARM_SITES: Site[] = ['sleeve', 'chest', 'waist'];
const ARMS: Record<Arm, readonly [number, number, number]> = { left: [11, 13, 15], right: [12, 14, 16] };

const MIN_HALF_MM = 15;
const SEARCH_STEP = 0.01;
const CHEST_ANTERIOR_BAND = [0.15, 0.35] as const;
const CHEST_ANTERIOR_TOL = 0.05;

export type Profile = readonly (number | null)[];
export interface Point {
  x: number;
  y: number;
  visibility: number;
}
export interface Marker {
  corners: number[][];
  image_w: number;
  image_h: number;
  confidence: number;
}
interface SilhouetteBase {
  mask_top_px: number;
  mask_bottom_px: number;
  image_w: number;
  image_h: number;
}
export interface FrontProfile extends SilhouetteBase {
  half_width_mm: Profile;
  crotch_y_px: number | null;
}
export interface SideProfile extends SilhouetteBase {
  half_depth_mm: Profile;
  anterior_mm: Profile;
}
export interface DeriveInput {
  covariates: { height_mm_entered: number; sex: 'female' | 'male' | 'unspecified'; clothing_fit: 'fitted' | 'loose' };
  session: { free_arm?: Arm | null; level_unchecked: boolean };
  landmarks_front: readonly Point[] | null;
  landmarks_side: readonly Point[] | null;
  marker_front: Marker | null;
  marker_side: Marker | null;
  silhouette_front: FrontProfile | null;
  silhouette_side: SideProfile | null;
}
export interface Rules {
  rules_version: string;
  marker: { side_mm: number; max_corner_aspect: number };
  scale: {
    stature_disagree_check_pct: number;
    stature_disagree_retake_pct: number;
    depth_correction_mm: { front: number; side: number };
    nominal_distance_mm: number;
  };
  levels: {
    chest: Record<'female' | 'male' | 'unspecified', number>;
    waist: number;
    waist_check_band: number[];
    waist_check_tol: number;
    hip_band_knee_fraction: number;
    neck_above_shoulder_frac: number;
  };
  offsets_mm: { acromion: number; shoulder: number; sleeve: number; outleg: number; inleg: number };
  girth_model: { type: string; correction_factors: Record<'chest' | 'waist' | 'hip' | 'neck', number> };
  plausible_mm: Record<Site, number[]>;
  flags: { visibility_fail: number; visibility_check: number; marker_conf_check: number; free_arm_min_distance_ratio: number };
}
export interface SiteResult {
  site_code: Site;
  value_mm: number | null;
  raw_mm: number | null;
  flag: 'pass' | 'check' | 'fail';
  reasons: Reason[];
  level_fraction: number | null;
  a_mm: number | null;
  b_mm: number | null;
  perimeter_mm: number | null;
  correction_factor: number | null;
}
export interface Derivation {
  sites: Record<Site, SiteResult>;
  scale_front: number | null;
  scale_side: number | null;
  scale_stature: number | null;
  disagreement_pct: number | null;
}

const add = (values: readonly number[]): number => {
  let total = 0;
  for (const value of values) total = total + value;
  return total;
};
const distance = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy);

export const roundForLimit = (value: number): number => Math.floor(value * 1e6 + 0.5) / 1e6;

export const ellipsePerimeter = (a: number, b: number): number =>
  Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest < 0.5) return floor;
  if (rest > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function sampleProfile(profile: Profile, u: number): number | null {
  const index = u * 100;
  if (index < 0 || index > 100) return null;
  const low = Math.floor(index);
  const lowValue = profile[low];
  const highValue = profile[Math.ceil(index)];
  if (lowValue === null || highValue === null) return null;
  return lowValue + (highValue - lowValue) * (index - low);
}

export function bandFractions(low: number, high: number): number[] {
  const count = Math.floor((high - low) / SEARCH_STEP + 0.5);
  if (count <= 0) return [low];
  return Array.from({ length: count + 1 }, (_, i) => low + ((high - low) * i) / count);
}

/** Millimetres per mask pixel, or null if the marker cannot be trusted. */
export function markerScale(marker: Marker | null, maskImageW: number, rules: Rules): number | null {
  if (!marker || marker.corners.length !== 4) return null;
  const { corners } = marker;
  const sides = [0, 1, 2, 3].map((i) => {
    const next = corners[(i + 1) % 4];
    return distance(next[0] - corners[i][0], next[1] - corners[i][1]);
  });
  const shortest = Math.min(...sides);
  if (shortest <= 0) return null;
  if (roundForLimit(Math.max(...sides) / shortest) > rules.marker.max_corner_aspect) return null;
  const meanSide = add(sides) / 4;
  return (rules.marker.side_mm / meanSide) * (marker.image_w / maskImageW);
}

/** Which arm to measure when the free arm is unknown. */
export function clearerArm(landmarks: readonly Point[]): Arm {
  const mean = (a: Arm) => add(ARMS[a].map((i) => landmarks[i].visibility)) / 3;
  return mean('left') > mean('right') ? 'left' : 'right';
}

/** The depth-corrected scale for a view, used for the profiles and for the derivation. */
export function correctedScale(marker: Marker | null, imageW: number, view: 'front' | 'side', rules: Rules): number | null {
  const scale = markerScale(marker, imageW, rules);
  if (scale === null) return null;
  return scale * (1 + rules.scale.depth_correction_mm[view] / rules.scale.nominal_distance_mm);
}

class ViewData<S extends SilhouetteBase> {
  shoulder: readonly number[] = [];
  hip: readonly number[] = [];
  knee: readonly number[] = [];
  constructor(
    readonly silhouette: S | null,
    readonly landmarks: readonly Point[] | null,
    public scale: number | null,
  ) {}
  get ok(): boolean {
    return this.scale !== null;
  }
  y(indices: readonly number[]): number {
    const h = this.silhouette!.image_h;
    return add(indices.map((i) => this.landmarks![i].y * h)) / indices.length;
  }
  get span(): number {
    return this.y(this.hip) - this.y(this.shoulder);
  }
  levelY(fraction: number): number {
    return this.y(this.shoulder) + fraction * this.span;
  }
  hipBandY(fraction: number): number {
    return this.y(this.hip) + fraction * (this.y(this.knee) - this.y(this.hip));
  }
  u(yPx: number): number {
    const { mask_top_px: top, mask_bottom_px: bottom } = this.silhouette!;
    return (yPx - top) / (bottom - top);
  }
  pixels(first: number, second: number): number {
    const { image_w: w, image_h: h } = this.silhouette!;
    const p = this.landmarks![first];
    const q = this.landmarks![second];
    return distance((p.x - q.x) * w, (p.y - q.y) * h);
  }
}

function viewScale(
  silhouette: SilhouetteBase | null,
  landmarks: readonly Point[] | null,
  marker: Marker | null,
  view: 'front' | 'side',
  rules: Rules,
): number | null {
  if (!silhouette || !landmarks) return null;
  if (silhouette.mask_bottom_px <= silhouette.mask_top_px) return null;
  return correctedScale(marker, silhouette.image_w, view, rules);
}

class Notes {
  reasons = new Map<Site, Set<Reason>>(SITES.map((site) => [site, new Set<Reason>()]));
  failed = new Set<Site>();
  warn(site: Site, reason: Reason): void {
    this.reasons.get(site)!.add(reason);
  }
  fail(site: Site, reason: Reason): void {
    this.warn(site, reason);
    this.failed.add(site);
  }
}

const blank = (site: Site, raw: number | null = null, fraction: number | null = null): SiteResult => ({
  site_code: site,
  value_mm: null,
  raw_mm: raw,
  flag: 'pass',
  reasons: [],
  level_fraction: fraction,
  a_mm: null,
  b_mm: null,
  perimeter_mm: null,
  correction_factor: null,
});

function girth(site: 'chest' | 'waist' | 'hip' | 'neck', a: number | null, b: number | null, fraction: number, rules: Rules, notes: Notes): SiteResult {
  if (a === null || b === null || a < MIN_HALF_MM || b < MIN_HALF_MM) {
    notes.fail(site, 'mask_gap');
    return { ...blank(site, null, fraction), a_mm: a, b_mm: b };
  }
  const perimeter = ellipsePerimeter(a, b);
  const factor = rules.girth_model.correction_factors[site];
  return { ...blank(site, perimeter * factor, fraction), a_mm: a, b_mm: b, perimeter_mm: perimeter, correction_factor: factor };
}

export function derive(data: DeriveInput, rules: Rules): Derivation {
  if (rules.girth_model.type !== 'ellipse_cf') throw new Error('girth_model_not_supported');

  const front = new ViewData(data.silhouette_front, data.landmarks_front, viewScale(data.silhouette_front, data.landmarks_front, data.marker_front, 'front', rules));
  front.shoulder = [11, 12];
  front.hip = [23, 24];
  front.knee = [25, 26];
  const side = new ViewData(data.silhouette_side, data.landmarks_side, viewScale(data.silhouette_side, data.landmarks_side, data.marker_side, 'side', rules));
  if (data.landmarks_side) {
    const lm = data.landmarks_side;
    const useRight = lm[12].visibility + lm[24].visibility >= lm[11].visibility + lm[23].visibility;
    side.shoulder = useRight ? [12] : [11];
    side.hip = useRight ? [24] : [23];
    side.knee = useRight ? [26] : [25];
  }
  // A hip at or above the shoulder means the pose data cannot be used.
  for (const view of [front, side]) {
    if (view.ok && view.span <= 0) view.scale = null;
  }

  const frontHalf = (y: number) => sampleProfile(front.silhouette!.half_width_mm, front.u(y));
  const sideHalf = (y: number) => sampleProfile(side.silhouette!.half_depth_mm, side.u(y));
  const notes = new Notes();
  const { levels, offsets_mm: offsets, flags } = rules;
  const { session, covariates } = data;

  let statureScale: number | null = null;
  let disagreement: number | null = null;
  if (front.ok) {
    const { mask_bottom_px: bottom, mask_top_px: top } = front.silhouette!;
    statureScale = covariates.height_mm_entered / (bottom - top);
    disagreement = roundForLimit((Math.abs(front.scale! - statureScale) / front.scale!) * 100);
  }

  let arm: Arm = session.free_arm ?? 'right';
  if (!session.free_arm) {
    if (data.landmarks_front) arm = clearerArm(data.landmarks_front);
    for (const site of FREE_ARM_SITES) notes.warn(site, 'free_arm_unknown');
  }

  const chest = (): SiteResult => {
    const fraction = levels.chest[covariates.sex];
    if (covariates.sex === 'female') {
      let best: number | null = null;
      let bestValue = -Infinity;
      for (const candidate of bandFractions(CHEST_ANTERIOR_BAND[0], CHEST_ANTERIOR_BAND[1])) {
        const value = sampleProfile(side.silhouette!.anterior_mm, side.u(side.levelY(candidate)));
        if (value !== null && value > bestValue) {
          best = candidate;
          bestValue = value;
        }
      }
      if (best !== null && roundForLimit(Math.abs(best - fraction)) > CHEST_ANTERIOR_TOL) {
        notes.warn('chest', 'chest_level_mismatch');
      }
    }
    return girth('chest', frontHalf(front.levelY(fraction)), sideHalf(side.levelY(fraction)), fraction, rules, notes);
  };

  const waist = (): SiteResult => {
    const fraction = levels.waist;
    let best: number | null = null;
    let bestValue = Infinity;
    for (const candidate of bandFractions(levels.waist_check_band[0], levels.waist_check_band[1])) {
      const value = frontHalf(front.levelY(candidate));
      if (value !== null && value < bestValue) {
        best = candidate;
        bestValue = value;
      }
    }
    if (best !== null && roundForLimit(Math.abs(best - fraction)) > levels.waist_check_tol) {
      notes.warn('waist', 'waist_level_mismatch');
    }
    return girth('waist', frontHalf(front.levelY(fraction)), sideHalf(side.levelY(fraction)), fraction, rules, notes);
  };

  const hip = (): SiteResult => {
    if (front.y(front.knee) <= front.y(front.hip) || side.y(side.knee) <= side.y(side.hip)) {
      notes.fail('hip', 'mask_gap');
      return blank('hip');
    }
    let best: number | null = null;
    let bestValue = -Infinity;
    for (const candidate of bandFractions(0, levels.hip_band_knee_fraction)) {
      const value = sideHalf(side.hipBandY(candidate));
      if (value !== null && value > bestValue) {
        best = candidate;
        bestValue = value;
      }
    }
    if (best === null) {
      notes.fail('hip', 'mask_gap');
      return blank('hip');
    }
    return girth('hip', frontHalf(front.hipBandY(best)), bestValue, best, rules, notes);
  };

  const neck = (): SiteResult => {
    const fraction = levels.neck_above_shoulder_frac;
    return girth('neck', frontHalf(front.levelY(-fraction)), sideHalf(side.levelY(-fraction)), fraction, rules, notes);
  };

  const compute = (site: Site): SiteResult => {
    switch (site) {
      case 'chest':
        return chest();
      case 'waist':
        return waist();
      case 'hip':
        return hip();
      case 'neck':
        return neck();
      case 'stature': {
        const { mask_bottom_px: bottom, mask_top_px: top } = front.silhouette!;
        return blank(site, (bottom - top) * front.scale!);
      }
      case 'shoulder':
        return blank(site, front.pixels(11, 12) * front.scale! + 2 * offsets.acromion + offsets.shoulder);
      case 'sleeve': {
        const [shoulder, elbow, wrist] = ARMS[arm];
        return blank(site, (front.pixels(shoulder, elbow) + front.pixels(elbow, wrist)) * front.scale! + offsets.sleeve);
      }
      case 'outleg':
        return blank(site, (side.silhouette!.mask_bottom_px - side.levelY(levels.waist)) * side.scale! + offsets.outleg);
      case 'inleg': {
        const crotch = front.silhouette!.crotch_y_px;
        if (crotch === null) {
          notes.fail('inleg', 'crotch_not_found');
          return blank('inleg');
        }
        return blank(site, (front.silhouette!.mask_bottom_px - crotch) * front.scale! + offsets.inleg);
      }
    }
  };

  const required = (site: Site): [readonly Point[], number][] => {
    const pick = (lm: readonly Point[] | null, ...groups: (readonly number[])[]) =>
      groups.flatMap((group) => group.map((i): [readonly Point[], number] => [lm!, i]));
    const f = data.landmarks_front;
    const s = data.landmarks_side;
    const torso = () => [...pick(f, front.shoulder, front.hip), ...pick(s, side.shoulder, side.hip)];
    switch (site) {
      case 'shoulder':
        return pick(f, front.shoulder);
      case 'sleeve':
        return pick(f, ARMS[arm]);
      case 'outleg':
        return pick(s, side.shoulder, side.hip);
      case 'inleg':
        return pick(f, [27, 28]);
      case 'hip':
        return [...torso(), ...pick(f, front.knee), ...pick(s, side.knee)];
      case 'chest':
      case 'waist':
      case 'neck':
        return torso();
      case 'stature':
        return [];
    }
  };

  const results = {} as Record<Site, SiteResult>;
  for (const site of SITES) {
    if ((FRONT_SITES.has(site) && !front.ok) || (SIDE_SITES.has(site) && !side.ok)) {
      notes.reasons.get(site)!.clear();
      notes.fail(site, 'view_failed');
      results[site] = blank(site);
      continue;
    }
    for (const [lm, index] of required(site)) {
      const { visibility } = lm[index];
      if (visibility < flags.visibility_fail) notes.fail(site, 'landmark_low');
      else if (visibility < flags.visibility_check) notes.warn(site, 'landmark_low');
    }
    if (FRONT_SITES.has(site) && data.marker_front!.confidence < flags.marker_conf_check) notes.warn(site, 'marker_weak');
    if (SIDE_SITES.has(site) && data.marker_side!.confidence < flags.marker_conf_check) notes.warn(site, 'marker_weak');
    if (disagreement !== null) {
      const overRetake = disagreement > rules.scale.stature_disagree_retake_pct;
      const overCheck = disagreement > rules.scale.stature_disagree_check_pct;
      if (overRetake || (overCheck && SCALE_BAND_SITES.has(site))) notes.warn(site, 'scale_disagree');
    }
    if (session.level_unchecked) notes.warn(site, 'level_unchecked');
    if (covariates.clothing_fit === 'loose' && LOOSE_SITES.has(site)) notes.warn(site, 'loose_clothing');

    const result = compute(site);
    if (result.raw_mm !== null && !notes.failed.has(site)) {
      const [low, high] = rules.plausible_mm[site];
      if (!(low <= result.raw_mm && result.raw_mm <= high)) notes.fail(site, 'out_of_range');
    }
    results[site] = result;
  }

  for (const site of SITES) {
    const result = results[site];
    const seen = notes.reasons.get(site)!;
    result.reasons = REASONS.filter((reason) => seen.has(reason));
    if (notes.failed.has(site)) {
      result.flag = 'fail';
      result.value_mm = null;
    } else {
      result.flag = result.reasons.length ? 'check' : 'pass';
      result.value_mm = roundHalfEven(result.raw_mm!);
    }
  }
  return {
    sites: results,
    scale_front: front.scale,
    scale_side: side.scale,
    scale_stature: statureScale,
    disagreement_pct: disagreement,
  };
}
