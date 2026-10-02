import type { EngineParams } from '../params';
import type { RuleContext, Violation } from '../types';
import type { RuleCode, RuleScope, Severity } from './codes';
import { RULE_META } from './meta';

export interface Rule {
  code: RuleCode;
  severity: Severity;
  scope: RuleScope;
  /** A rule that is switched off by a param is skipped; absent means always on. */
  enabled?: (params: EngineParams) => boolean;
  /** Pure. A clean result is []. */
  check(ctx: RuleContext): Violation[];
}

type ViolationFields = Omit<Violation, 'rule' | 'severity' | 'scope'>;

export function violation(code: RuleCode, fields: ViolationFields): Violation {
  const { severity, scope } = RULE_META[code];
  return { rule: code, severity, scope, ...fields };
}

export function defineRule(
  code: RuleCode,
  impl: { enabled?: (params: EngineParams) => boolean; check: (ctx: RuleContext) => Violation[] },
): Rule {
  const { severity, scope } = RULE_META[code];
  return { code, severity, scope, ...impl };
}
