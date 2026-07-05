#!/usr/bin/env node
/**
 * WebSocket Load Test — Real-Time Collaborative Code Editor
 *
 * Usage:
 *   node latency-bench.js [server-url] [num-clients] [num-pings]
 *
 * Examples:
 *   node latency-bench.js http://localhost:3001 50 200
 */

const { io } = require('socket.io-client');

const SERVER_URL    = process.argv[2] || 'http://localhost:3001';
const NUM_CLIENTS   = parseInt(process.argv[3]) || 50;
const NUM_PINGS     = parseInt(process.argv[4]) || 200;
const WARMUP_COUNT  = 20;
const PING_INTERVAL = 40;
const ROOM_ID       = `bench-${Date.now()}`;

const rtts   = [];
let clients  = [];
let connected = 0;

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function ms(n) { return `${parseFloat(n.toFixed(2))} ms`; }

function printReport() {
  if (rtts.length === 0) {
    console.error('\nno data — check that bench-ping is registered on the server');
    return;
  }

  const p50  = percentile(rtts, 50);
  const p75  = percentile(rtts, 75);
  const p90  = percentile(rtts, 90);
  const p95  = percentile(rtts, 95);
  const p99  = percentile(rtts, 99);
  const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length;

  const col = (label, val) =>
    console.log(`  ${label.padEnd(8)} ${val}`);

  console.log(`
${'─'.repeat(48)}
  collab-editor  WebSocket Load Test
${'─'.repeat(48)}
  target   ${SERVER_URL}
  room     ${ROOM_ID}
  clients  ${NUM_CLIENTS}
  samples  ${rtts.length}  (${WARMUP_COUNT} warmup discarded)

  round-trip latency
  ${'─'.repeat(26)}`);
  col('min',  ms(Math.min(...rtts)));
  col('p50',  ms(p50));
  col('p75',  ms(p75));
  col('p90',  ms(p90));
  col('p95',  ms(p95));
  col('p99',  ms(p99));
  col('max',  ms(Math.max(...rtts)));
  col('mean', ms(mean));

  console.log(`
  one-way propagation estimate  (RTT ÷ 2)
  ${'─'.repeat(26)}`);
  col('p50',  ms(p50 / 2));
  col('p95',  ms(p95 / 2));

  console.log(`${'─'.repeat(48)}`);
}

function connectClient(i) {
  return new Promise((resolve, reject) => {
    const s = io(SERVER_URL, { transports: ['websocket'], timeout: 10_000, reconnection: false });
    s.on('connect', () => {
      process.stdout.write(`\r  connecting  ${++connected}/${NUM_CLIENTS}`);
      resolve(s);
    });
    s.on('connect_error', (e) => reject(new Error(`client ${i}: ${e.message}`)));
  });
}

function joinRoom(socket) {
  return new Promise((resolve) => {
    socket.once('yjs-init', resolve);
    socket.emit('join-room', ROOM_ID);
  });
}

function runPings(sender) {
  return new Promise((resolve) => {
    const total = NUM_PINGS + WARMUP_COUNT;
    let sent = 0, recv = 0;

    sender.on('bench-pong', (p) => {
      const rtt = performance.now() - p.t;
      if (p.idx >= WARMUP_COUNT) rtts.push(rtt);
      if (++recv >= total) resolve();
    });

    const iv = setInterval(() => {
      if (sent >= total) { clearInterval(iv); return; }
      sender.emit('bench-ping', { t: performance.now(), idx: sent++ });
    }, PING_INTERVAL);
  });
}

async function run() {
  console.log(`\n  connecting ${NUM_CLIENTS} clients to ${SERVER_URL} ...`);

  try {
    clients = await Promise.all(
      Array.from({ length: NUM_CLIENTS }, (_, i) => connectClient(i))
    );
  } catch (e) {
    console.error(`\n  error: ${e.message}`);
    process.exit(1);
  }

  console.log(`\n  syncing yjs state for all clients ...`);
  await Promise.all(clients.map(joinRoom));
  console.log(`  done — all clients in room "${ROOM_ID}"\n`);

  await new Promise(r => setTimeout(r, 400));

  process.stdout.write(`  running  [warmup ${'░'.repeat(10)}]  `);
  await runPings(clients[0]);
  process.stdout.write('\r  running  [done   ' + '█'.repeat(10) + ']  \n');

  printReport();
  clients.forEach(c => c.disconnect());
  process.exit(0);
}

setTimeout(() => {
  console.error('\n  timeout — partial results:');
  printReport();
  clients.forEach(c => c.disconnect());
  process.exit(0);
}, 60_000);

run().catch(e => { console.error('\n  fatal:', e.message); process.exit(1); });