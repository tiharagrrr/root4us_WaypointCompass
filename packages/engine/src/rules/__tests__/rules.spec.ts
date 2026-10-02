import { describe, expect, it } from 'vitest';
import { validate } from '../../validate';
import { RULE_CODES, type RuleCode } from '../codes';
import { RULES } from '../index';
import { RULE_META } from '../meta';
import { buildInput, listFixtureFiles, readFixture } from './fixture';

const files = listFixtureFiles();

describe('rule registry', () => {
  it('rules: every rule code is registered once, in code order, with its severity and scope', () => {
    expect(RULES.map((r) => r.code)).toEqual([...RULE_CODES]);
    for (const rule of RULES) {
      expect(rule.severity).toBe(RULE_META[rule.code].severity);
      expect(rule.scope).toBe(RULE_META[rule.code].scope);
    }
  });

  it('rules: there are 15 hard and 3 soft rules', () => {
    expect(RULES.filter((r) => r.severity === 'HARD')).toHaveLength(15);
    expect(RULES.filter((r) => r.severity === 'SOFT')).toHaveLength(3);
  });

  it('rules: every rule has a pass and a fail fixture', () => {
    for (const code of RULE_CODES) {
      expect(files, `${code}.pass.json`).toContain(`${code}.pass.json`);
      expect(files, `${code}.fail.json`).toContain(`${code}.fail.json`);
    }
    expect(files).toHaveLength(RULE_CODES.length * 2);
  });
});

describe.each(files)('fixture %s', (file) => {
  const fixture = readFixture(file);
  const rule = fixture.rule as RuleCode;
  const isPass = file.endsWith('.pass.json');

  it(`${rule} ${isPass ? 'pass' : 'fail'}: ${fixture.description}`, () => {
    const violations = validate(buildInput(fixture.input, fixture.params), fixture.plan);
    const own = violations.filter((v) => v.rule === rule);
    const otherHard = violations.filter((v) => v.rule !== rule && v.severity === 'HARD');

    expect(own).toHaveLength(fixture.expect.length);
    fixture.expect.forEach((e, i) => expect(own[i]).toMatchObject(e));
    if (isPass) expect(own).toEqual([]);
    else expect(own.length).toBeGreaterThan(0);
    expect(otherHard, 'a fixture fails for one reason only').toEqual([]);
  });
});

describe('rule switches', () => {
  const run = (name: string, params: Record<string, unknown>) => {
    const f = readFixture(name);
    return validate(buildInput(f.input, { ...f.params, ...params }), f.plan);
  };

  it('rules: TEMP_REEFER with reeferCarriesAmbient off rejects an ambient order on a reefer', () => {
    const f = readFixture('TEMP_REEFER.pass.json');
    const input = buildInput(f.input, { reeferCarriesAmbient: false });
    const order = input.orders[0];
    if (!order) throw new Error('fixture has no orders');
    const ambient = { ...input, orders: [{ ...order, tempClass: 'AMBIENT' as const }, ...input.orders.slice(1)] };
    const v = validate(ambient, f.plan).filter((x) => x.rule === 'TEMP_REEFER');
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('carries chilled orders only');
  });

  it('rules: TEMP_REEFER allows an ambient order on a reefer by default', () => {
    const f = readFixture('TEMP_REEFER.pass.json');
    const input = buildInput(f.input, f.params);
    const order = input.orders[0];
    if (!order) throw new Error('fixture has no orders');
    const ambient = { ...input, orders: [{ ...order, tempClass: 'AMBIENT' as const }, ...input.orders.slice(1)] };
    expect(validate(ambient, f.plan).filter((x) => x.rule === 'TEMP_REEFER')).toEqual([]);
  });

  it('rules: WINDOW_OUTLET, WINDOW_MALL and LATE_RISK are off when enforceWindows is off', () => {
    const v = run('WINDOW_OUTLET.fail.json', { enforceWindows: false });
    expect(v.filter((x) => ['WINDOW_OUTLET', 'WINDOW_MALL', 'LATE_RISK'].includes(x.rule))).toEqual([]);
  });

  it('rules: FUEL_WEEKLY is off when enforceFuel is off', () => {
    expect(run('FUEL_WEEKLY.fail.json', { enforceFuel: false }).filter((x) => x.rule === 'FUEL_WEEKLY')).toEqual([]);
  });

  it('rules: TECH_VALUE_LIMIT is dormant while the limit is null', () => {
    expect(run('TECH_VALUE_LIMIT.fail.json', { techValueLimitLkr: null })).toEqual([]);
  });

  it('rules: TECH_VALUE_LIMIT passes at exactly the limit', () => {
    expect(run('TECH_VALUE_LIMIT.fail.json', { techValueLimitLkr: 300000 })).toEqual([]);
  });

  it('rules: LATE_RISK passes with exactly the slack limit', () => {
    expect(run('LATE_RISK.fail.json', { lateRiskSlackMin: 10 })).toEqual([]);
  });

  it('rules: OPERATING_DAY flags a plan on a non-operating day', () => {
    const f = readFixture('OPERATING_DAY.pass.json');
    const input = { ...buildInput(f.input, f.params), isOperatingDay: false };
    const v = validate(input, f.plan).filter((x) => x.rule === 'OPERATING_DAY');
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('2026-10-02 is not an operating day');
  });
});
