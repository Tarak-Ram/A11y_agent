import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'path';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: (process.env.WEB_URL ?? 'http://localhost:3000').split(','), credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'authorization', 'x-api-key', 'x-csrf'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  // Dev-mode artifact files (videos, screenshots). In production they live in GCS.
  if ((process.env.STORAGE_DRIVER ?? 'local') === 'local') {
    app.use('/files', express.static(resolve(process.env.STORAGE_LOCAL_DIR ?? 'storage'), { fallthrough: false, index: false, dotfiles: 'deny' }));
  }
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}
bootstrap();
