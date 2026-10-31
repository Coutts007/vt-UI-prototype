// A3 item 3: at most one correction per 3 s, repeated every 6 s, "Good" with a tone on green.
import { describe, expect, it } from 'vitest';
import { CHECK_ORDER, CheckResults } from '../../src/capture/checks';
import { CheckFilter, GuidancePacer, InstructionHold } from '../../src/capture/guidance';

const all = (ok = true, ...wrong: (typeof CHECK_ORDER)[number][]): CheckResults =>
  Object.fromEntries(CHECK_ORDER.map((id) => [id, wrong.includes(id) ? !ok : ok])) as CheckResults;
const spoken = (actions: ReturnType<GuidancePacer['update']>) =>
  actions.flatMap((a) => ('speak' in a ? [a.speak] : []));

describe('GuidancePacer', () => {
  it('says a correction at once, and not again before 6 s', () => {
    const pacer = new GuidancePacer();
    const bad = all(true, 'level');
    expect(spoken(pacer.update(0, bad, 'tilt'))).toEqual(['tilt']);
    expect(spoken(pacer.update(5999, bad, 'tilt'))).toEqual([]);
    expect(spoken(pacer.update(6000, bad, 'tilt'))).toEqual(['tilt']);
    expect(spoken(pacer.update(12000, bad, 'tilt'))).toEqual(['tilt']);
  });

  it('holds a new correction until 3 s after the last', () => {
    const pacer = new GuidancePacer();
    const bad = all(true, 'level');
    pacer.update(0, bad, 'a');
    expect(spoken(pacer.update(2999, bad, 'b'))).toEqual([]);
    expect(spoken(pacer.update(3000, bad, 'b'))).toEqual(['b']);
  });

  it('never says more than one correction in any 3 s', () => {
    const pacer = new GuidancePacer();
    const bad = all(true, 'level');
    const times: number[] = [];
    for (let now = 0; now < 30000; now += 160) {
      const key = Math.floor(now / 500) % 2 ? 'a' : 'b';
      if (spoken(pacer.update(now, bad, key)).length) times.push(now);
    }
    expect(times.length).toBeGreaterThan(3);
    times.slice(1).forEach((time, i) => expect(time - times[i]).toBeGreaterThanOrEqual(3000));
  });

  it('says Good with a tone when a check turns green', () => {
    const pacer = new GuidancePacer();
    pacer.update(0, all(true, 'level'), 'tilt');
    const actions = pacer.update(1000, all(), null);
    expect(actions).toEqual([{ tone: 'pass' }, { speak: 'good' }]);
  });

  it('says nothing for what was already green at the start', () => {
    expect(new GuidancePacer().update(0, all(), null)).toEqual([]);
  });

  it('several checks turning green together give one Good', () => {
    const pacer = new GuidancePacer();
    pacer.update(0, all(true, 'level', 'arms'), 'tilt');
    expect(spoken(pacer.update(1000, all(), null))).toEqual(['good']);
  });

  it('after a check clears, the same correction can be said again at the 3 s gap', () => {
    const pacer = new GuidancePacer();
    pacer.update(0, all(true, 'level'), 'tilt');
    pacer.update(1000, all(), null);
    expect(spoken(pacer.update(2000, all(true, 'level'), 'tilt'))).toEqual([]);
    expect(spoken(pacer.update(3000, all(true, 'level'), 'tilt'))).toEqual(['tilt']);
  });
});

describe('CheckFilter', () => {
  it('a new state must hold for 300 ms', () => {
    const filter = new CheckFilter();
    filter.update(0, all());
    const bad = all(true, 'arms');
    expect(filter.update(100, bad).arms).toBe(true);
    expect(filter.update(399, bad).arms).toBe(true);
    expect(filter.update(400, bad).arms).toBe(false);
  });
  it('a flicker never reaches the screen', () => {
    const filter = new CheckFilter();
    filter.update(0, all());
    filter.update(100, all(true, 'arms'));
    filter.update(200, all());
    expect(filter.update(500, all(true, 'arms')).arms).toBe(true);
  });
  it('reset starts over', () => {
    const filter = new CheckFilter();
    filter.update(0, all());
    filter.reset();
    expect(filter.update(1, all(true, 'arms')).arms).toBe(false);
  });
});

describe('InstructionHold', () => {
  it('keeps a message 1.5 s unless the problem is fixed', () => {
    const hold = new InstructionHold<string>();
    expect(hold.update(0, 'a')).toBe('a');
    expect(hold.update(1000, 'b')).toBe('a');
    expect(hold.update(1500, 'b')).toBe('b');
    expect(hold.update(1600, null)).toBeNull();
    expect(hold.update(1700, 'c')).toBe('c');
  });
});
