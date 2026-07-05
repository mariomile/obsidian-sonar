import { Notice } from 'obsidian';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { SearchService } from './search-service.ts';

interface HttpModule {
  createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

export type HttpStatus =
  | { state: 'stopped' }
  | { state: 'listening'; port: number }
  | { state: 'error'; message: string };

/**
 * Omnisearch-compatible HTTP search API (desktop only). Serves the same
 * `GET /search?q=` contract Omnisearch exposes, so `recall.sh` and other
 * consumers keep working when Sonar replaces it. Bound to localhost only.
 * Only instantiate behind `Platform.isDesktopApp`.
 */
export class HttpServer {
  private server: Server | null = null;
  private readonly sockets = new Set<{ destroy(): void }>();
  private statusValue: HttpStatus = { state: 'stopped' };
  private onStatus?: (status: HttpStatus) => void;

  constructor(
    private readonly service: SearchService,
    private readonly port: number,
  ) {}

  get status(): HttpStatus {
    return this.statusValue;
  }

  setStatusListener(cb: (status: HttpStatus) => void): void {
    this.onStatus = cb;
  }

  private setStatus(status: HttpStatus): void {
    this.statusValue = status;
    this.onStatus?.(status);
  }

  start(): void {
    if (this.server) return;
    // Lazy require so this module never loads node:http on mobile. (This class
    // is only instantiated behind Platform.isDesktopApp.)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('node:http') as HttpModule;
    const server = http.createServer((req, res) => void this.handle(req, res));

    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const message = `Port ${this.port} is already in use — Omnisearch's HTTP server is probably still enabled. Disable it or change Sonar's port.`;
        new Notice(`Sonar: ${message}`);
        this.setStatus({ state: 'error', message });
      } else {
        this.setStatus({ state: 'error', message: err.message });
      }
      this.server = null;
    });

    server.listen(this.port, '127.0.0.1', () => {
      this.setStatus({ state: 'listening', port: this.port });
    });
    this.server = server;
  }

  stop(): void {
    if (!this.server) return;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server.close();
    this.server = null;
    this.setStatus({ state: 'stopped' });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);

    if (url.pathname === '/health') {
      const status = this.service.getStatus();
      return this.json(res, 200, {
        status: 'ok',
        ready: status.ready,
        docs: this.service.index.docCount,
      });
    }

    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') ?? '';
      if (!q.trim()) return this.json(res, 200, []);
      try {
        const hits = await this.service.query(q, { limit: 50, now: Date.now() });
        return this.json(
          res,
          200,
          hits.map((h) => ({
            score: h.score,
            path: h.path,
            basename: h.basename,
            excerpt: h.excerpt?.text ?? '',
            foundWords: h.matched,
            matches: (h.excerpt?.ranges ?? []).map(([start, end]) => ({
              match: h.excerpt!.text.slice(start, end),
              offset: start,
            })),
          })),
        );
      } catch (e) {
        return this.json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    return this.json(res, 404, { error: 'not found' });
  }

  private json(res: ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
}
