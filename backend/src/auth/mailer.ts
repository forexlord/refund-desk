import { Injectable, Logger } from '@nestjs/common';

/**
 * Outbound email. The repository has no email provider configured, so this development implementation
 * writes messages to the backend log. A production deployment replaces this class with a provider client
 * (SES, Postmark, …); callers don't change.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mailer');

  async send(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(`[dev mailer] To: ${to} | ${subject}\n${body}`);
  }
}
