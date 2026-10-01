import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { POLICY_LIMITS, POLICY_VERSION } from './policy.engine';

const POLICY_PATH = join(__dirname, '..', '..', 'policy', 'refund-policy.md');

@Controller('policy')
export class PolicyController {
  private readonly markdown = readFileSync(POLICY_PATH, 'utf8');

  @Get()
  get() {
    return { version: POLICY_VERSION, limits: POLICY_LIMITS, markdown: this.markdown };
  }
}
