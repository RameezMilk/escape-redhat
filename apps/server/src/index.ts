// Escape from Red Hat server: Fastify HTTP + WebSocket. The browser only talks to this process;
// model credentials stay here.
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { ClientMessageSchema, type CreateEngine, type ServerMessage } from '@escape/contracts';
import { describePlanner, readServerConfig } from './config.js';
import { caseSummaries, loadCases, loadMapFile, RUNS_DIR, WEB_DIST } from './data.js';
import { createProviderFromEnv } from './headless.js';
import { listRuns } from './runlog.js';
import { Session } from './session.js';

/** Minimal view of a ws socket (avoids depending on @types/ws). */
interface Sock {
  readyState: number;
  send(data: string): void;
  on(ev: 'message', cb: (data: Buffer) => void): void;
  on(ev: 'close', cb: () => void): void;
}

async function main() {
  const config = readServerConfig();
  const { createEngine } = (await import('@escape/engine')) as { createEngine: CreateEngine };
  const map = loadMapFile();
  const cases = loadCases();
  const provider = createProviderFromEnv();

  const clients = new Set<Sock>();
  const broadcast = (msg: ServerMessage) => {
    const text = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === 1) ws.send(text);
  };

  const session = new Session({
    map,
    cases,
    provider,
    planner: config.planner,
    createEngine,
    broadcast,
    runsDir: RUNS_DIR,
    defaultCase: config.demoCase,
    log: (m) => console.log(m),
  });

  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  app.get('/health', async () => ({ ok: true, episodeId: session.episodeId, provider: provider.info() }));
  app.get('/api/provider', async () => provider.info());
  app.get('/api/cases', async () => caseSummaries(cases));
  app.get('/api/runs', async () => listRuns(RUNS_DIR));

  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket: Sock) => {
      clients.add(socket);
      socket.send(JSON.stringify(session.welcome()));
      socket.on('message', (data: Buffer) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          socket.send(JSON.stringify({ type: 'error', episodeId: session.episodeId, message: 'invalid JSON' } satisfies ServerMessage));
          return;
        }
        const msg = ClientMessageSchema.safeParse(parsed);
        if (!msg.success) {
          socket.send(JSON.stringify({ type: 'error', episodeId: session.episodeId, message: `invalid message: ${msg.error.issues[0]?.message ?? ''}` } satisfies ServerMessage));
          return;
        }
        try {
          const reply = session.handle(msg.data);
          if (reply) socket.send(JSON.stringify(reply));
        } catch (e) {
          console.error('[ws] handler error', e);
          socket.send(JSON.stringify({ type: 'error', episodeId: session.episodeId, message: (e as Error).message } satisfies ServerMessage));
        }
      });
      socket.on('close', () => clients.delete(socket));
    });
  });

  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  session.start(config.demoCase);
  await app.listen({ port: config.port, host: '0.0.0.0' });

  const h = await provider.health();
  broadcast({ type: 'provider', episodeId: session.episodeId, provider: provider.info() });
  console.log(
    `[escape] http://localhost:${config.port}  planner: ${describePlanner(config.planner)}  health: ${h.ok ? 'OK' : 'FAIL'} (${h.detail})  harness ${config.planner.harness}  cases ${cases.size}${existsSync(WEB_DIST) ? '  serving web/dist' : ''}`,
  );

  const shutdown = () => {
    session.stop();
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
