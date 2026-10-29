import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Redis } from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import type { AppKind } from '../auth/auth-user.js';
import { AccessGuard } from '../auth/access.guard.js';
import { RedisService } from '../infra/redis.service.js';

export const REALTIME_PATH = '/v1/realtime';
const CHANNEL = 'ineed:realtime';
const AUTH_TIMEOUT_MS = 10_000;
const PING_MS = 30_000;

/** Codes de fermeture (plage applicative 4000-4999). */
export const CLOSE_UNAUTHENTICATED = 4401;

export interface RealtimeEvent {
  type: string;
  [k: string]: unknown;
}

interface Envelope {
  userId: string;
  app: AppKind;
  event: RealtimeEvent;
}

interface Client {
  ws: WebSocket;
  userId: string;
  app: AppKind;
  alive: boolean;
}

/**
 * Canal temps réel (WebSocket, `/v1/realtime`) : nouveaux messages et accusés de lecture, poussés aux
 * applications ouvertes. Protocole : le client envoie `{"type":"auth","token":"<jeton d'accès>"}` dans les
 * 10 s (le jeton ne passe pas dans l'URL, qui peut être journalisée), reçoit `{"type":"ready"}`, puis les
 * événements. La diffusion passe par Redis : un message envoyé sur une instance de l'API atteint les
 * applications connectées à une autre. Ce canal n'est qu'une accélération : tout reste disponible en REST.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Temps réel');
  private wss?: WebSocketServer;
  private sub?: Redis;
  private readonly clients = new Set<Client>();
  private ping?: NodeJS.Timeout;

  constructor(
    private readonly redis: RedisService,
    private readonly access: AccessGuard,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  async onModuleInit(): Promise<void> {
    const server = this.adapterHost.httpAdapter?.getHttpServer() as Server | undefined;
    if (!server) return;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== REALTIME_PATH) return;
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
    // Connexion dédiée à l'abonnement, avec file d'attente hors ligne : elle se réabonne seule après une coupure.
    this.sub = this.redis.client.duplicate({ lazyConnect: true, enableOfflineQueue: true, maxRetriesPerRequest: null });
    this.sub.on('error', () => undefined);
    this.sub.on('message', (_channel: string, raw: string) => this.dispatchLocal(raw));
    await this.sub
      .connect()
      .then(() => this.sub!.subscribe(CHANNEL))
      .catch((err: unknown) => this.logger.warn(`Abonnement Redis impossible pour le moment : ${String(err)}`));
    this.ping = setInterval(() => this.heartbeat(), PING_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.ping);
    for (const ws of this.wss?.clients ?? []) ws.terminate();
    this.clients.clear();
    this.wss?.close();
    this.sub?.disconnect();
  }

  private accept(ws: WebSocket): void {
    let client: Client | null = null;
    const timer = setTimeout(() => ws.close(CLOSE_UNAUTHENTICATED, 'Authentification attendue'), AUTH_TIMEOUT_MS);
    ws.on('message', (data: Buffer) => {
      if (client) return; // le canal ne reçoit rien d'autre que l'authentification
      let msg: { type?: unknown; token?: unknown };
      try {
        msg = JSON.parse(data.toString('utf8')) as { type?: unknown; token?: unknown };
      } catch {
        ws.close(CLOSE_UNAUTHENTICATED, 'Message illisible');
        return;
      }
      if (msg.type !== 'auth' || typeof msg.token !== 'string') {
        ws.close(CLOSE_UNAUTHENTICATED, 'Authentification attendue');
        return;
      }
      this.access.authenticate(msg.token).then(
        (user) => {
          clearTimeout(timer);
          if (ws.readyState !== WebSocket.OPEN) return;
          client = { ws, userId: user.userId, app: user.app, alive: true };
          this.clients.add(client);
          ws.send(JSON.stringify({ type: 'ready' }));
        },
        () => ws.close(CLOSE_UNAUTHENTICATED, 'Session expirée'),
      );
    });
    ws.on('pong', () => {
      if (client) client.alive = true;
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (client) this.clients.delete(client);
    });
    ws.on('error', () => undefined);
  }

  private heartbeat(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        this.clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }

  private dispatchLocal(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    const text = JSON.stringify(env.event);
    for (const c of this.clients) {
      if (c.userId === env.userId && c.app === env.app && c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
    }
  }

  /** Publie un événement à un utilisateur, pour une application (client ou pro). Sans effet si Redis est indisponible. */
  async publish(userId: string, app: AppKind, event: RealtimeEvent): Promise<void> {
    await this.redis.ensureConnected().catch(() => undefined);
    await this.redis.client.publish(CHANNEL, JSON.stringify({ userId, app, event } satisfies Envelope)).catch(() => undefined);
  }

  /** Nombre de connexions authentifiées sur cette instance (santé, tests). */
  get connections(): number {
    return this.clients.size;
  }
}
