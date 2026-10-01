import { SecurityFlag } from '../common/domain';

/**
 * Deterministic input guard. Runs BEFORE any LLM call.
 *
 * It does not block the request. The text is still classified so that the customer gets a
 * response and an agent sees what was attempted. It records flags, and any flag forces the
 * request to human review (policy rule P-11). Pattern matching is only one layer. The main
 * defence is architectural: the LLM cannot decide outcomes (see policy.engine.ts).
 */

export const MAX_MESSAGE_LENGTH = 2000;

// Zero-width and bidi control characters are commonly used to hide instructions from human reviewers.
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤﻿]/g;

interface Pattern {
  code: string;
  re: RegExp;
  detail: string;
}

const PATTERNS: Pattern[] = [
  {
    code: 'instruction_override',
    re: /\b(ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|the|any|system)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|polic(y|ies)|guidelines?|directives?)\b/i,
    detail: 'Attempts to override system instructions or policy.',
  },
  {
    code: 'role_manipulation',
    re: /\b(you are now|from now on,? you|act as|pretend (to be|you are)|roleplay as|switch to|enter)\b[^.\n]{0,40}\b(mode|assistant|agent|admin|developer|dan|unrestricted|jailbreak)/i,
    detail: 'Attempts to change the assistant role or mode.',
  },
  {
    code: 'prompt_probe',
    re: /\b(system prompt|developer (mode|message)|hidden instructions?|jailbreak|reveal (your|the) (prompt|instructions))\b/i,
    detail: 'References to system prompts or jailbreak techniques.',
  },
  {
    code: 'forced_outcome',
    re: /\b(approve|authori[sz]e|process|issue|grant)\b[^.\n]{0,30}\brefund\b[^.\n]{0,40}\b(immediately|regardless|without (review|checking|question)|no matter what|automatically|override)\b/i,
    detail: 'Demands a specific outcome regardless of policy.',
  },
  {
    code: 'forced_outcome',
    re: /\b(set|change|mark|output|return|respond with)\b[^.\n]{0,25}\b(decision|status|result|outcome)\b[^.\n]{0,15}\b(approved|accepted|granted)\b/i,
    detail: 'Attempts to set the decision field directly.',
  },
  {
    code: 'authority_claim',
    re: /\b(i am|i'm|this is)\s+(an?\s+|the\s+)?((support|store|customer service|refunds?|senior|head)\s+)?(admin|administrator|manager|supervisor|staff( member)?|employee|developer|engineer|ceo|support agent)\b/i,
    detail: 'Claims staff or elevated authority.',
  },
  {
    code: 'markup_injection',
    re: /<\/?\s*(system|assistant|user|customer_message|order_record|policy|instructions?|tool_(use|result))\b[^>]*>/i,
    detail: 'Contains prompt-structure tags.',
  },
  {
    code: 'structured_payload',
    re: /["']?\b(decision|refund_amount|reason_category|manipulation_attempt)\b["']?\s*[:=]/i,
    detail: 'Contains structured fields mimicking system output.',
  },
];

export interface GuardResult {
  sanitized: string;
  flags: SecurityFlag[];
}

export function sanitizeMessage(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

export function inspectMessage(raw: string): GuardResult {
  const flags: SecurityFlag[] = [];
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/.test(raw)) {
    flags.push({ source: 'input_guard', code: 'hidden_characters', detail: 'Message contained invisible or bidirectional control characters.' });
  }

  const sanitized = sanitizeMessage(raw);
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    if (p.re.test(sanitized) && !seen.has(p.code)) {
      seen.add(p.code);
      flags.push({ source: 'input_guard', code: p.code, detail: p.detail });
    }
  }
  return { sanitized, flags };
}

/** Neutralise anything that could close or open our prompt delimiters. */
export function escapeForPrompt(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›');
}
