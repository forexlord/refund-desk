import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Order, RefundAssessment, SecurityFlag } from '../common/domain';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ASSESSMENT_TOOL_NAME, assessmentToolSchema, assessmentZod } from './assessment.schema';
import { fallbackClassify } from './fallback-classifier';
import {
  buildClassifierUserContent,
  buildReplyUserContent,
  CLASSIFIER_SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT,
  ReplyFacts,
} from './prompts';
import { checkReply, templateReply } from './reply-guard';

export interface AssessmentOutcome {
  assessment: RefundAssessment;
  mode: 'llm' | 'fallback';
  model: string | null;
  flags: SecurityFlag[];
  error?: string;
}

export interface ReplyOutcome {
  reply: string;
  source: 'llm' | 'template';
  problems: string[];
  error?: string;
}

/**
 * AI integration layer. There are two narrowly scoped model calls:
 *  1. classify(): turns an untrusted free-text message into a validated, structured assessment
 *     through a forced tool call.
 *  2. writeReply(): turns a decision that has already been made into a customer-friendly message.
 *     The model never sees the customer's text here.
 * Both calls degrade gracefully. If the key is missing, the call times out, or the output is
 * invalid, the service falls back to the keyword classifier or the reply template.
 */
@Injectable()
export class AiService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;
  /** Error from the most recent model call (or the startup probe); null once a call succeeds. */
  private lastError: string | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey, timeout: config.aiTimeoutMs, maxRetries: 1 })
      : null;
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY not set: running with the keyword fallback classifier and reply templates.');
    }
  }

  /** Check the key and model once at startup, without blocking boot, so a bad config shows up before the first request. */
  onApplicationBootstrap() {
    if (!this.client) return;
    this.client.models
      .retrieve(this.config.anthropicModel)
      .then(() => this.logger.log(`Model ${this.config.anthropicModel} is available.`))
      .catch((err) => this.recordFailure('Startup model check failed', err));
  }

  /** 'degraded' = a key is set but the last model call failed, so requests are using the fallback. */
  get status(): { mode: 'llm' | 'degraded' | 'fallback'; error: string | null } {
    if (!this.client) return { mode: 'fallback', error: null };
    return { mode: this.lastError ? 'degraded' : 'llm', error: this.lastError };
  }

  private recordFailure(context: string, err: unknown): string {
    const error = err instanceof Error ? err.message : String(err);
    this.lastError = error;
    this.logger.error(`${context}: ${error}`);
    return error;
  }

  get model(): string {
    return this.config.anthropicModel;
  }

  async classify(order: Order, message: string, now: Date): Promise<AssessmentOutcome> {
    if (!this.client) {
      return { assessment: fallbackClassify(order, message), mode: 'fallback', model: null, flags: [] };
    }
    try {
      const response = await this.client.messages.create({
        model: this.config.anthropicModel,
        max_tokens: 1024,
        system: CLASSIFIER_SYSTEM_PROMPT,
        tools: [
          {
            name: ASSESSMENT_TOOL_NAME,
            description: 'Record the structured assessment of the customer refund message.',
            input_schema: assessmentToolSchema,
          },
        ],
        tool_choice: { type: 'tool', name: ASSESSMENT_TOOL_NAME },
        messages: [{ role: 'user', content: buildClassifierUserContent(order, message, now) }],
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error(`Model did not call ${ASSESSMENT_TOOL_NAME} (stop_reason=${response.stop_reason})`);
      }
      const parsed = assessmentZod.parse(toolUse.input);
      this.lastError = null;

      // Never trust IDs from the model: keep only IDs that exist in this order.
      const orderItemIds = new Set(order.items.map((i) => i.id));
      const claimed = parsed.claimed_item_ids.filter((id) => orderItemIds.has(id));
      const hallucinated = parsed.claimed_item_ids.filter((id) => !orderItemIds.has(id));

      const flags: SecurityFlag[] = [];
      if (parsed.manipulation_attempt) {
        flags.push({
          source: 'ai_classifier',
          code: 'llm_detected_manipulation',
          detail: parsed.manipulation_evidence ?? 'Model flagged a manipulation attempt.',
        });
      }

      return {
        assessment: {
          reasonCategory: parsed.reason_category,
          claimedItemIds: claimed,
          mentionsItemsNotInOrder: parsed.mentions_items_not_in_order || hallucinated.length > 0,
          customerRequestedAmount: parsed.customer_requested_amount,
          summary: parsed.summary,
          confidence: parsed.confidence,
          manipulationAttempt: parsed.manipulation_attempt,
          manipulationEvidence: parsed.manipulation_evidence,
          inconsistencies: parsed.inconsistencies,
        },
        mode: 'llm',
        model: this.config.anthropicModel,
        flags,
      };
    } catch (err) {
      const error = this.recordFailure('Classifier failed, using fallback', err);
      return { assessment: fallbackClassify(order, message), mode: 'fallback', model: null, flags: [], error };
    }
  }

  async writeReply(facts: ReplyFacts): Promise<ReplyOutcome> {
    const template = templateReply(facts);
    if (!this.client) {
      return { reply: template, source: 'template', problems: [] };
    }
    try {
      const response = await this.client.messages.create({
        model: this.config.anthropicModel,
        max_tokens: 400,
        system: REPLY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildReplyUserContent(facts) }],
      });
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
      this.lastError = null;

      const check = checkReply(text, facts);
      if (!check.ok) {
        this.logger.warn(`LLM reply rejected by output guard: ${check.problems.join('; ')}`);
        return { reply: template, source: 'template', problems: check.problems };
      }
      return { reply: text, source: 'llm', problems: [] };
    } catch (err) {
      const error = this.recordFailure('Reply generation failed, using template', err);
      return { reply: template, source: 'template', problems: [], error };
    }
  }
}
