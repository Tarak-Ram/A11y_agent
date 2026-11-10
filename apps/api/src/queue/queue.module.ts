import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';

export interface JobPayload {
  runId: string;
  personaRunId: string;
  persona: string;
  url: string;
  goal: string;
  locale?: string;
  maxSteps: number;
}

/** One interface; BullMQ locally, Pub/Sub in production (QUEUE_DRIVER=pubsub). */
export abstract class QueueDriver {
  abstract enqueue(job: JobPayload): Promise<void>;
  async close(): Promise<void> {}
}

export const QUEUE_NAME = 'persona-jobs';

class BullmqDriver extends QueueDriver {
  private queue: import('bullmq').Queue;
  constructor(redisUrl: string) {
    super();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Queue } = require('bullmq');
    const u = new URL(redisUrl);
    this.queue = new Queue(QUEUE_NAME, {
      connection: { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined },
    });
  }
  async enqueue(job: JobPayload) {
    await this.queue.add(job.persona, job, { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
  }
  async close() {
    await this.queue.close();
  }
}

class PubsubDriver extends QueueDriver {
  private topic: import('@google-cloud/pubsub').Topic;
  constructor(topicName: string) {
    super();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PubSub } = require('@google-cloud/pubsub');
    this.topic = new PubSub().topic(topicName);
  }
  async enqueue(job: JobPayload) {
    await this.topic.publishMessage({ json: job });
  }
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private driver: QueueDriver;
  private log = new Logger(QueueService.name);
  constructor() {
    const kind = process.env.QUEUE_DRIVER ?? 'bullmq';
    this.driver = kind === 'pubsub' ? new PubsubDriver(process.env.PUBSUB_TOPIC ?? 'a11y-jobs') : new BullmqDriver(process.env.REDIS_URL ?? 'redis://localhost:6379');
    this.log.log(`queue driver: ${kind}`);
  }
  enqueue(job: JobPayload) {
    return this.driver.enqueue(job);
  }
  onModuleDestroy() {
    return this.driver.close();
  }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
