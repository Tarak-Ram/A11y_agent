import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  /** Liveness: process is up. */
  @Get() live() {
    return { status: 'ok' };
  }

  /** Readiness: database reachable. Cloud Run / compose use this. */
  @Get('ready') async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
