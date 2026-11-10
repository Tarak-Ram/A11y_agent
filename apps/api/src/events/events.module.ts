import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { Observable } from 'rxjs';

export interface RunEvent {
  type: string; // status | step | screenshot | persona_done | run_done
  [k: string]: unknown;
}

/** Run events travel over Redis pub/sub: workers publish steps, API publishes lifecycle, SSE subscribes. */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private pub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: false, maxRetriesPerRequest: 2 });
  private subs = new Set<Redis>();

  channel(runId: string) {
    return `run:${runId}`;
  }

  async publish(runId: string, event: RunEvent) {
    await this.pub.publish(this.channel(runId), JSON.stringify(event));
  }

  stream(runId: string): Observable<RunEvent> {
    return new Observable<RunEvent>((subscriber) => {
      const sub = this.pub.duplicate();
      this.subs.add(sub);
      sub.subscribe(this.channel(runId)).catch((e) => subscriber.error(e));
      sub.on('message', (_c, msg) => {
        try {
          const ev = JSON.parse(msg) as RunEvent;
          subscriber.next(ev);
          if (ev.type === 'run_done') subscriber.complete();
        } catch {
          /* ignore malformed */
        }
      });
      return () => {
        this.subs.delete(sub);
        sub.quit().catch(() => undefined);
      };
    });
  }

  async onModuleDestroy() {
    await Promise.all([this.pub.quit(), ...[...this.subs].map((s) => s.quit())]).catch(() => undefined);
  }
}

@Global()
@Module({ providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
