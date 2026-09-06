/**
 * tickBus.ts — Pub/Sub abstraction for market ticks
 *
 * SCALING DESIGN:
 * Two implementations behind one interface:
 *   InMemoryTickBus : single process, zero config, works locally
 *   RedisTickBus    : multi-process, horizontal scaling
 *                     any number of backend instances share one Redis channel
 *                     a tick published by instance A reaches clients on instance B
 *
 * Switch with REDIS_URL env var:
 *   not set   → InMemoryTickBus
 *   redis://...  → RedisTickBus
 */

import { EventEmitter } from 'node:events';
import type { Tick } from './types.js';

export interface TickBus {
  publish(tick: Tick): void;
  subscribe(handler: (tick: Tick) => void): () => void;
}

// ─── In-memory (single process) ───────────────────────────────────────────────
class InMemoryTickBus extends EventEmitter implements TickBus {
  publish(tick: Tick) { this.emit('tick', tick); }
  subscribe(handler: (tick: Tick) => void) {
    this.on('tick', handler);
    return () => this.off('tick', handler);
  }
}

// ─── Redis (multi-process) ────────────────────────────────────────────────────
// Uses two separate connections: one for publishing, one for subscribing.
// This is the correct Redis pattern — a subscribed client can't publish.
class RedisTickBus implements TickBus {
  private pub: import('ioredis').default;
  private sub: import('ioredis').default;
  private emitter = new EventEmitter();
  private CHANNEL = 'deltawatch:ticks';

  constructor(pub: import('ioredis').default, sub: import('ioredis').default) {
    this.pub = pub;
    this.sub = sub;
    this.sub.subscribe(this.CHANNEL);
    this.sub.on('message', (_ch: string, msg: string) => {
      try {
        const tick: Tick = JSON.parse(msg);
        this.emitter.emit('tick', tick);
      } catch { /* malformed message — ignore */ }
    });
  }

  publish(tick: Tick) {
    this.pub.publish(this.CHANNEL, JSON.stringify(tick));
  }

  subscribe(handler: (tick: Tick) => void) {
    this.emitter.on('tick', handler);
    return () => this.emitter.off('tick', handler);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
let _bus: TickBus | null = null;

export async function getTickBus(): Promise<TickBus> {
  if (_bus) return _bus;
  const redisUrl = process.env.REDIS_URL ?? '';
  if (redisUrl) {
    const { default: Redis } = await import('ioredis');
    const pub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
    const sub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
    await Promise.all([pub.connect(), sub.connect()]);
    console.log('[tickbus] Using Redis pub/sub — multi-instance scaling enabled');
    _bus = new RedisTickBus(pub, sub);
  } else {
    console.log('[tickbus] Using in-memory bus (set REDIS_URL=redis://... for multi-instance scaling)');
    _bus = new InMemoryTickBus();
  }
  return _bus;
}
