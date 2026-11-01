// A profile from the fake flow must be a valid POST /profiles body, with no image in it.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { combineBurst } from '../../src/capture/burst';
import { evaluateChecks, toViewChecks } from '../../src/capture/checks';
import { buildProfile, disagreeingView } from '../../src/capture/compute';
import { CaptureSession } from '../../src/capture/session';
import { assertNoImages } from '../../src/db/storage';
import { DEFAULT_FAKE, FakeVisionWorker, Scenario } from '../../src/vision/fakeVision';

const contract = parse(readFileSync('../../packages/contracts/openapi.yaml', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract, 'contract');

const draft = {
  client_code: 'AB1008',
  height_mm: 1700,
  sex: 'female' as const,
  clothing_fit: 'fitted' as const,
  consent: {
    consent_version: '1.0',
    language: 'en' as const,
    scope: ['measure', 'measurements_only', 'retention'] as (
      'measure' | 'measurements_only' | 'retention'
    )[],
    given_at: '2026-10-31T10:00:00Z',
  },
};

async function capture(scenario: Scenario = 'good', height = 1700) {
  const session = new CaptureSession();
  session.begin('self');
  const worker = new FakeVisionWorker({ ...DEFAULT_FAKE, scenario });
  const grab = (view: 'front' | 'side') =>
    new Promise<void>((resolve) => {
      worker.onmessage = ({ data }) => {
        if (!data.ok) throw new Error(data.error);
        if (!data.frames) return;
        const combined = combineBurst({ frames: data.frames! })!;
        const { mask: _mask, ...numbers } = combined;
        session.views[view] = {
          ...numbers,
          checks: toViewChecks(evaluateChecks({ view, sample: worker.live('good', view) }), false),
          free_arm: view === 'front' ? 'left' : null,
        };
        resolve();
      };
      worker.postMessage({ id: 1, cmd: 'burst', view });
    });
  worker.postMessage({ id: 0, cmd: 'init', heightMm: height });
  await grab('front');
  await grab('side');
  return session;
}

const toBody = (profile: ReturnType<typeof buildProfile>) => {
  const { sync_status: _s, needs_help: _h, ...body } = profile;
  return body;
};

describe('buildProfile', () => {
  it('matches the contract and holds no images', async () => {
    const profile = buildProfile(await capture(), draft, 1234);
    const validate = ajv.getSchema('contract#/components/schemas/MeasurementProfilePayload')!;
    const valid = validate(toBody(profile));
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    assertNoImages(profile);
  });

  it.each([1450, 1700, 2150])('all nine sites pass at height %i', async (height) => {
    const profile = buildProfile(await capture('good', height), { ...draft, height_mm: height }, 1);
    const bad = profile.measurements.filter((m) => m.confidence_flag !== 'pass');
    expect(bad.map((m) => [m.site_code, m.value_mm, m.flag_reasons])).toEqual([]);
    expect(profile.measurements).toHaveLength(9);
    expect(profile.session.scale_disagreement_pct).toBeLessThan(2);
  });

  it('records A3 and A14 session fields', async () => {
    const { session } = buildProfile(await capture(), draft, 1);
    expect(session.guidance_mode).toBe('voice');
    expect(session.camera_facing).toBe('environment');
    expect(session.free_arm).toBe('left');
    expect(session.config_hash).toMatch(/^capture-2-/);
  });

  it('a helper means visual guidance', async () => {
    const captured = await capture();
    captured.machine = {
      ...captured.machine,
      context: { ...captured.machine.context, mode: 'assisted' },
    };
    expect(buildProfile(captured, draft, 1).session.guidance_mode).toBe('visual');
  });

  it('no gap between the legs fails the inside leg with a null value (C4)', async () => {
    const profile = buildProfile(await capture('no_crotch'), draft, 1);
    const inleg = profile.measurements.find((m) => m.site_code === 'inleg')!;
    expect(inleg).toMatchObject({
      value_mm: null,
      confidence_flag: 'fail',
      flag_reasons: ['crotch_not_found'],
    });
  });

  it('loose clothes flag the sites', async () => {
    const profile = buildProfile(await capture(), { ...draft, clothing_fit: 'loose' }, 1);
    const waist = profile.measurements.find((m) => m.site_code === 'waist')!;
    expect(waist.flag_reasons).toContain('loose_clothing');
  });

  it('refuses to build without consent', async () => {
    expect(() => buildProfile(new CaptureSession(), draft, 1)).toThrow('capture_incomplete');
  });
});

describe('scale disagreement', () => {
  it('above 4% picks the view with the weaker marker', async () => {
    const session = await capture('scale_disagree');
    const { session: record } = buildProfile(session, draft, 1);
    expect(record.scale_disagreement_pct).toBeGreaterThan(4);
    expect(disagreeingView(session, record.scale_disagreement_pct)).toBe('front');
    expect(disagreeingView(session, 3.9)).toBeNull();
  });
});
