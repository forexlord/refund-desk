import { Controller, Get, Inject, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PerClientThrottlerGuard } from './common/throttler.guard';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AiService } from './ai/ai.service';
import { AccountsRepository } from './auth/accounts.repository';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { Mailer } from './auth/mailer';
import { OtpStore } from './auth/otp.store';
import { AgentAuthGuard } from './common/agent-auth.guard';
import { CustomerAuthGuard } from './common/customer-auth.guard';
import { SessionMiddleware } from './common/session';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { CrmController } from './crm/crm.controller';
import { CrmRepository } from './crm/crm.repository';
import { Database, DatabaseModule } from './database/database.module';
import { PolicyController } from './policy/policy.controller';
import { RefundsController } from './refunds/refunds.controller';
import { RefundsRepository } from './refunds/refunds.repository';
import { RefundsService } from './refunds/refunds.service';

@Controller('health')
class HealthController {
  constructor(
    private readonly db: Database,
    private readonly ai: AiService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async health() {
    await this.db.query('SELECT 1');
    const ai = this.ai.status;
    return { status: 'ok', database: 'up', aiMode: ai.mode, aiError: ai.error, model: ai.mode === 'fallback' ? null : this.config.anthropicModel };
  }
}

@Module({
  imports: [DatabaseModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, AuthController, CrmController, RefundsController, AdminController, PolicyController],
  providers: [
    CrmRepository,
    RefundsRepository,
    RefundsService,
    AiService,
    AdminService,
    CustomerAuthGuard,
    AgentAuthGuard,
    AccountsRepository,
    AuthService,
    OtpStore,
    Mailer,
    { provide: APP_GUARD, useClass: PerClientThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SessionMiddleware).forRoutes('{*splat}');
  }
}
