// Demo timekeeping adapter: sends an HMAC-signed clock event to the running bridge.
// Usage: npm run demo:clock -- in <workerId>   |   npm run demo:clock -- out <workerId>
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { signWebhook } from '../src/app.js';

const [action, workerId] = process.argv.slice(2);
if (!['in', 'out'].includes(action ?? '') || !/^\d+$/.test(workerId ?? '')) {
  console.error('usage: npm run demo:clock -- <in|out> <workerId>');
  process.exit(2);
}
const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error('WEBHOOK_SECRET is not set');
const url = process.env.BRIDGE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;

const body = JSON.stringify({
  idempotencyKey: `demo-${randomUUID()}`,
  workerId,
  type: action === 'in' ? 'clock_in' : 'clock_out',
});
const res = await fetch(`${url}/webhooks/clock`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-metronome-signature': signWebhook(secret, body) },
  body,
});
console.log(res.status, await res.text());
