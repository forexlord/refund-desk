import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { APP_CONFIG, AppConfig, loadConfig } from '../config/app-config';

export const PG_POOL = Symbol('PG_POOL');

@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly logger = new Logger(Database.name);
  constructor(@Inject(PG_POOL) readonly pool: Pool) {}

  query<T extends Record<string, any> = any>(text: string, params: unknown[] = []) {
    return this.pool.query<T>(text, params);
  }

  /** Run fn inside a transaction; rolls back on any error. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown() {
    this.logger.log('Closing database pool');
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new Pool({ connectionString: config.databaseUrl, max: 10 }),
    },
    Database,
  ],
  exports: [APP_CONFIG, Database],
})
export class DatabaseModule {}
