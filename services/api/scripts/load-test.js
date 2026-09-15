'use strict';

const http = require('http');

const TARGET_URL = process.env.TARGET_URL || 'http://localhost';
const TOTAL_REQUESTS = parseInt(process.env.REQUESTS || '100', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);

console.log('====================================================');
console.log('🚀 CloudVault — Horizontal Scaling & Load Benchmark');
console.log('====================================================');
console.log(`Target:      ${TARGET_URL}`);
console.log(`Total Reqs:  ${TOTAL_REQUESTS}`);
console.log(`Concurrency: ${CONCURRENCY}`);
console.log('----------------------------------------------------');

const results = [];
let completed = 0;
let errors = 0;
const startTime = Date.now();

function makeRequest(urlPath) {
  return new Promise((resolve) => {
    const start = process.hrtime();
    const parsedUrl = new URL(urlPath, TARGET_URL);

    const req = http.get(parsedUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const diff = process.hrtime(start);
        const latencyMs = (diff[0] * 1000 + diff[1] / 1e6);
        results.push({ statusCode: res.statusCode, latencyMs });
        resolve();
      });
    });

    req.on('error', (err) => {
      errors++;
      results.push({ statusCode: 0, latencyMs: 0, error: err.message });
      resolve();
    });

    req.setTimeout(5000, () => {
      req.destroy();
      errors++;
      results.push({ statusCode: 408, latencyMs: 5000, error: 'timeout' });
      resolve();
    });
  });
}

async function worker(tasks) {
  for (const task of tasks) {
    await makeRequest(task);
    completed++;
    if (completed % 25 === 0 || completed === TOTAL_REQUESTS) {
      process.stdout.write(`Completed ${completed}/${TOTAL_REQUESTS} requests...\r`);
    }
  }
}

async function run() {
  const endpoints = ['/health', '/api/health'];
  const tasks = [];
  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    tasks.push(endpoints[i % endpoints.length]);
  }

  // Distribute tasks across workers
  const workerTasks = Array.from({ length: CONCURRENCY }, () => []);
  tasks.forEach((task, idx) => {
    workerTasks[idx % CONCURRENCY].push(task);
  });

  await Promise.all(workerTasks.map((t) => worker(t)));

  const totalDurationMs = Date.now() - startTime;
  const validLatencies = results.filter((r) => r.latencyMs > 0).map((r) => r.latencyMs).sort((a, b) => a - b);

  const p50 = validLatencies[Math.floor(validLatencies.length * 0.5)] || 0;
  const p90 = validLatencies[Math.floor(validLatencies.length * 0.9)] || 0;
  const p95 = validLatencies[Math.floor(validLatencies.length * 0.95)] || 0;
  const p99 = validLatencies[Math.floor(validLatencies.length * 0.99)] || 0;
  const avg = validLatencies.reduce((sum, v) => sum + v, 0) / (validLatencies.length || 1);
  const rps = (completed / (totalDurationMs / 1000)).toFixed(1);

  console.log('\n----------------------------------------------------');
  console.log('📊 Benchmark Results Summary:');
  console.log(`Total Time:     ${(totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`Throughput:     ${rps} req/sec`);
  console.log(`Successful:     ${results.filter((r) => r.statusCode === 200).length}`);
  console.log(`Errors/Retries: ${errors}`);
  console.log('----------------------------------------------------');
  console.log('⏱️  Latency Distribution:');
  console.log(`Average:        ${avg.toFixed(2)} ms`);
  console.log(`p50 (Median):   ${p50.toFixed(2)} ms`);
  console.log(`p90:            ${p90.toFixed(2)} ms`);
  console.log(`p95:            ${p95.toFixed(2)} ms`);
  console.log(`p99:            ${p99.toFixed(2)} ms`);
  console.log('====================================================');
}

run();
