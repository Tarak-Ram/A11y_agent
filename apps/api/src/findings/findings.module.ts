import { Controller, Get, Module, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { explain } from '../common/wcag';

@Controller('findings')
@UseGuards(AuthGuard)
export class FindingsController {
  constructor(private prisma: PrismaService) {}

  /** POST /findings/:id/fix lives in FixesModule. */
  @Get(':id')
  async get(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    const f = await this.prisma.finding.findFirst({
      where: { id, personaRun: { run: { project: { userId: u.id } } } },
      include: { fixes: true, personaRun: { select: { personaType: true, videoUrl: true, runId: true } } },
    });
    if (!f) throw new NotFoundException('Finding not found');
    return { ...f, explanation: explain(f.wcagRule, f.axeRuleId), evidence: f.confirmedByAxe ? 'confirmed-by-axe' : 'agent-only' };
  }
}

@Module({ controllers: [FindingsController] })
export class FindingsModule {}
