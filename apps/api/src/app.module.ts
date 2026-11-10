import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './common/prisma.service';
import { EventsModule } from './events/events.module';
import { FixesModule } from './fixes/fixes.module';
import { FindingsModule } from './findings/findings.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { RunsModule } from './runs/runs.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers["x-internal-token"]', 'req.query.token'],
        autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        // GCP-friendly severity field
        formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 120) }]),
    PrismaModule,
    EventsModule,
    MailModule,
    QueueModule,
    AuthModule,
    ProjectsModule,
    RunsModule,
    FindingsModule,
    FixesModule,
    InternalModule,
    WebhooksModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
