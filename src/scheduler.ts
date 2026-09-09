import { IrisAIError } from './errors.js';
import type { AIQueueStats, AIRateLimit } from './types.js';

interface SchedulerOptions {
  maxConcurrent: number;
  maxQueueSize: number;
  rateLimit: AIRateLimit;
}

/** Injectable only internally, for deterministic scheduler tests. */
interface Clock {
  now(): number;
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

interface WaitingJob {
  start(): void;
}

interface RequestWaiter {
  admit(): void;
}

const aborted = (): IrisAIError => new IrisAIError('ABORTED', 'AI 审核已取消。');

/** Bounded FIFO review queue plus a sliding-window gate for every HTTP request. */
export class AIScheduler {
  private active = 0;
  private readonly pending = new Set<WaitingJob>();
  private readonly requestWaiters = new Set<RequestWaiter>();
  private starts: number[] = [];
  private startsHead = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: SchedulerOptions, private readonly clock: Clock = {
    now: () => performance.now(),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer),
  }) {}

  get stats(): AIQueueStats {
    return {
      active: this.active, queued: this.pending.size,
      maxConcurrent: this.options.maxConcurrent, maxQueueSize: this.options.maxQueueSize,
    };
  }

  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(aborted());
    if (this.active >= this.options.maxConcurrent && this.pending.size >= this.options.maxQueueSize) {
      return Promise.reject(new IrisAIError('QUEUE_FULL', 'AI 等待队列已满，本次审核已放弃。', null, true));
    }
    return new Promise<T>((resolve, reject) => {
      const cancel = (): void => {
        this.pending.delete(job);
        signal?.removeEventListener('abort', cancel);
        reject(aborted());
      };
      const job: WaitingJob = {
        start: () => {
          signal?.removeEventListener('abort', cancel);
          this.active++;
          const finish = (): void => {
            this.active--;
            this.drainJobs();
          };
          Promise.resolve().then(() => {
            if (signal?.aborted) throw aborted();
            return work();
          }).then(
            value => { finish(); resolve(value); },
            error => { finish(); reject(error); },
          );
        },
      };
      if (this.active < this.options.maxConcurrent) job.start();
      else {
        this.pending.add(job);
        signal?.addEventListener('abort', cancel, { once: true });
      }
    });
  }

  private drainJobs(): void {
    while (this.active < this.options.maxConcurrent && this.pending.size) {
      const job = this.pending.values().next().value!;
      this.pending.delete(job);
      job.start();
    }
  }

  /** Called immediately before the single source-text request for each review. */
  acquireRequest(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(aborted());
    return new Promise<void>((resolve, reject) => {
      const cancel = (): void => {
        this.requestWaiters.delete(waiter);
        signal?.removeEventListener('abort', cancel);
        this.drainRequests();
        reject(aborted());
      };
      const waiter: RequestWaiter = {
        admit: () => {
          signal?.removeEventListener('abort', cancel);
          resolve();
        },
      };
      this.requestWaiters.add(waiter);
      signal?.addEventListener('abort', cancel, { once: true });
      this.drainRequests();
    });
  }

  private drainRequests(): void {
    if (this.timer !== undefined) {
      this.clock.clearTimer(this.timer);
      this.timer = undefined;
    }
    const now = this.clock.now();
    const { maxRequests, intervalMs } = this.options.rateLimit;
    while (this.startsHead < this.starts.length && this.starts[this.startsHead]! <= now - intervalMs) this.startsHead++;
    // Amortized O(1) pruning, avoiding repeated Array.shift for large limits.
    if (this.startsHead > 1024 && this.startsHead * 2 > this.starts.length) {
      this.starts = this.starts.slice(this.startsHead);
      this.startsHead = 0;
    }
    while (this.requestWaiters.size && this.starts.length - this.startsHead < maxRequests) {
      const waiter = this.requestWaiters.values().next().value!;
      this.requestWaiters.delete(waiter);
      this.starts.push(now);
      waiter.admit();
    }
    if (this.requestWaiters.size) {
      const delay = Math.max(1, Math.ceil(this.starts[this.startsHead]! + intervalMs - now));
      this.timer = this.clock.setTimer(() => {
        this.timer = undefined;
        this.drainRequests();
      }, delay);
    }
  }
}
