import { Response } from 'express';
import { logger } from '../utils/logger';

export interface SSEEvent {
  type: 'CONNECTED' | 'INVOICE_UPDATED' | 'INVOICE_CREATED' | 'INVOICE_DELETED' | 'INVOICE_STATUS_CHANGED' | 'BATCH_UPDATED' | 'VENDOR_UPDATED';
  invoiceId?: string;
  data?: any;
  timestamp: number;
}

type Client = {
  id: string;
  res: Response;
  roles: string[];
  userId: string;
};

class EventBroadcaster {
  private clients: Map<string, Client> = new Map();
  private clientCounter = 0;

  addClient(res: Response, roles: string[], userId: string): string {
    const id = `client-${++this.clientCounter}`;
    this.clients.set(id, { id, res, roles, userId });

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection confirmation
    this.send(id, { type: 'CONNECTED', timestamp: Date.now() });

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        this.removeClient(id);
        clearInterval(heartbeat);
      }
    }, 30000);

    res.on('close', () => {
      clearInterval(heartbeat);
      this.removeClient(id);
    });

    logger.info(`[SSE] Client connected: ${id} (user: ${userId}, roles: ${roles.join(',')})`);
    return id;
  }

  removeClient(id: string) {
    const client = this.clients.get(id);
    if (client) {
      this.clients.delete(id);
      logger.info(`[SSE] Client disconnected: ${id}`);
    }
  }

  private send(clientId: string, event: SSEEvent) {
    const client = this.clients.get(clientId);
    if (!client) return;
    try {
      client.res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      this.removeClient(clientId);
    }
  }

  broadcast(event: SSEEvent) {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const [id, client] of this.clients) {
      try {
        client.res.write(msg);
      } catch {
        this.removeClient(id);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const eventBroadcaster = new EventBroadcaster();
