const express = require('express');
const { Pool } = require('pg');
const CircuitBreaker = require('opossum');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const Piscina = require('piscina');
const path = require('path');

const app = express();
const PORT = process.env.API_PORT || 8080;

// --- 1. Database Connection Pools (Data Bulkheads) ---
const poolConfigs = {
  free: { connectionString: process.env.DATABASE_URL, max: 5 },
  pro: { connectionString: process.env.DATABASE_URL, max: 20 },
  enterprise: { connectionString: process.env.DATABASE_URL, max: 50 }
};

// We create lightweight pg pools here mainly to inspect their state for metrics.
// The actual query execution will happen inside the worker threads.
const metricsPools = {
  free: new Pool(poolConfigs.free),
  pro: new Pool(poolConfigs.pro),
  enterprise: new Pool(poolConfigs.enterprise)
};

// --- 2. Worker Thread Pools (Logic Bulkheads) ---
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
const limiters = {
  free: new RateLimiterMemory({ points: 100, duration: 60 }),
  pro: new RateLimiterMemory({ points: 1000, duration: 60 })
};

// --- 4. Circuit Breakers ---
// This function will be wrapped by the circuit breaker.
// It runs the database query in the appropriate worker thread pool.
const runQueryInWorker = (tier, forceError) => {
  const workerData = {
    tier,
    forceError,
    config: poolConfigs[tier]
  };
  return threadPools[tier].run(workerData);
};

const createBreaker = (tier) => {
  return new CircuitBreaker(() => runQueryInWorker(tier, null), { // Pass a clean function
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

  if (!threadPools[tier]) {
    return res.status(400).json({ error: "Missing or invalid X-Tenant-Tier header" });
  }

  // 1. Apply Rate Limiting
  if (limiters[tier]) {
    try {
      await limiters[tier].consume(req.ip); // Use IP for rate limiting
    } catch (err) {
      return res.status(429).json({ error: "Too Many Requests" });
    }
  }

  // 2. Execute through Circuit Breaker and Worker Pool
  try {
    // The circuit breaker now calls a function that uses the correct worker pool.
    // We pass the forceError flag directly to the underlying function for testing.
    const data = await breakers[tier].fire(tier, forceError);
    res.json(data);
  } catch (err) {
    const status = breakers[tier].opened ? 503 : 500;
    res.status(status).json({ error: err.message || "Service Unavailable" });
  }
});

app.get('/metrics/bulkheads', (req, res) => {
  const metrics = {};
  ['free', 'pro', 'enterprise'].forEach(tier => {
    const pool = metricsPools[tier];
    const threadPool = threadPools[tier];
    const breaker = breakers[tier];

    metrics[tier] = {
      connectionPool: {
        // These stats from 'pg' reflect connections made from workers
        active: pool.totalCount - pool.idleCount,
        idle: pool.idleCount,
        pending: pool.waitingCount,
        max: poolConfigs[tier].max
      },
      threadPool: {
        // Real-time metrics from Piscina
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

module.exports = app; // For testing