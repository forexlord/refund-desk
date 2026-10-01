import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigin });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  // Refund messages are small; reject oversized bodies early.
  app.useBodyParser('json', { limit: '16kb' });
  await app.listen(config.port, '0.0.0.0');
  const logger = new Logger('Bootstrap');
  if (!process.env.SESSION_SECRET?.trim()) logger.warn('SESSION_SECRET not set: using a random key, so sessions reset on restart.');
  logger.log(`Refund Desk API listening on :${config.port}`);
}

bootstrap();
