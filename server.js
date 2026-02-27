const express = require('express');
const { Pool } = require('pg');
const CircuitBreaker = require('opossum');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const Piscina = require('piscina');
const path = require('path');

const app = express();
const PORT = process.env.API_PORT || 8080;

// --- 1. Database Connection Pools (Data Bulkheads) ---
// Independent configurations and pools for each tier to ensure resource isolation.
const poolConfigs = {
  free: { connectionString: process.env.DATABASE_URL, max: 5 },
  pro: { connectionString: process.env.DATABASE_URL, max: 20 },
  enterprise: { connectionString: process.env.DATABASE_URL, max: 50 }
};

// These pools are primarily used for health/metric inspection in this process.
const metricsPools = {
  free: new Pool(poolConfigs.free),
  pro: new Pool(poolConfigs.pro),
  enterprise: new Pool(poolConfigs.enterprise)
};

// --- 2. Worker Thread Pools (Logic Bulkheads) ---
// Using Piscina to isolate heavy logic and database execution into separate thread pools.
const workerPath = path.resolve(__dirname, 'worker.js');
const threadPools = {
  free: new Piscina({
    filename: workerPath,
    maxThreads: 10
  }),
  pro: new Piscina({
    filename: workerPath,
    maxThreads: 30
  }),
  enterprise: new Piscina({
    filename: workerPath,
    maxThreads: 60
  })
};

// --- 3. Rate Limiters (Traffic Isolation) ---
// Tiered rate limiting to prevent one tier from exhausting server resources.
const limiters = {
  free: new RateLimiterMemory({ points: 100, duration: 60 }),
  pro: new RateLimiterMemory({ points: 1000, duration: 60 })
};

// --- 4. Circuit Breakers ---
// Helper function to run queries within the isolated worker pools.
const runQueryInWorker = (tier, forceError) => {
  const workerData = {
    tier,
    forceError,
    config: poolConfigs[tier]
  };
  return threadPools[tier].run(workerData);
};

// Updated to correctly pass the forceError parameter to the worker via the breaker.
const createBreaker = (tier) => {
  return new CircuitBreaker((forceError) => runQueryInWorker(tier, forceError), { 
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
    name: `${tier}-breaker`
  });
};

const breakers = {
  free: createBreaker('free'),
  pro: createBreaker('pro'),
  enterprise: createBreaker('enterprise')
};

// --- 5. API Endpoints ---
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

app.get('/api/data', async (req, res) => {
  const tier = req.headers['x-tenant-tier'];
  const forceError = req.query.force_error;

  // Validate that a valid tier header is provided.
  if (!threadPools[tier]) {
    return res.status(400).json({ error: "Missing or invalid X-Tenant-Tier header" });
  }

  // 1. Apply Rate Limiting.
  if (limiters[tier]) {
    try {
      await limiters[tier].consume(req.ip);
    } catch (err) {
      return res.status(429).json({ error: "Too Many Requests" });
    }
  }

  // 2. Execute through Circuit Breaker and Worker Pool.
  try {
    // Pass forceError into fire() so the breaker can pass it to the worker.
    const data = await breakers[tier].fire(forceError);
    res.json(data);
  } catch (err) {
    // Return 503 if the breaker is open, otherwise a standard 500.
    const status = breakers[tier].opened ? 503 : 500;
    res.status(status).json({ error: err.message || "Service Unavailable" });
  }
});

// Metrics endpoint to monitor the health of all bulkheads and breakers.
app.get('/metrics/bulkheads', (req, res) => {
  const metrics = {};
  ['free', 'pro', 'enterprise'].forEach(tier => {
    const pool = metricsPools[tier];
    const threadPool = threadPools[tier];
    const breaker = breakers[tier];

    metrics[tier] = {
      connectionPool: {
        active: pool.totalCount - pool.idleCount,
        idle: pool.idleCount,
        pending: pool.waitingCount,
        max: poolConfigs[tier].max
      },
      threadPool: {
        active: threadPool.threads.length,
        queued: threadPool.queueSize,
        poolSize: threadPool.options.maxThreads
      },
      circuitBreaker: {
        state: breaker.opened ? "OPEN" : (breaker.halfOpen ? "HALF_OPEN" : "CLOSED"),
        failures: breaker.stats.failures
      }
    };
  });
  res.json(metrics);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Resilient API running on port ${PORT}`);
});

module.exports = app;