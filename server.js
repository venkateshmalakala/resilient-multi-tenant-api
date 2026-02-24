const express = require('express');
const { Pool } = require('pg');
const CircuitBreaker = require('opossum');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
const PORT = process.env.API_PORT || 8080;

// --- 1. Database Bulkheads (Connection Isolation) ---
const poolConfigs = {
  free: { connectionString: process.env.DATABASE_URL, max: 5 },
  pro: { connectionString: process.env.DATABASE_URL, max: 20 },
  enterprise: { connectionString: process.env.DATABASE_URL, max: 50 }
};

const pools = {
  free: new Pool(poolConfigs.free),
  pro: new Pool(poolConfigs.pro),
  enterprise: new Pool(poolConfigs.enterprise)
};

// --- 2. Rate Limiters (Traffic Isolation) ---
const limiters = {
  free: new RateLimiterMemory({ points: 100, duration: 60 }),
  pro: new RateLimiterMemory({ points: 1000, duration: 60 })
};

// --- 3. Circuit Breaker Logic (Failure Isolation) ---
const createBreaker = (tier) => {
  const dbTask = async (forceError) => {
    if (forceError === 'true') throw new Error("Database Failure Simulated");
    
    const client = await pools[tier].connect();
    try {
      const res = await client.query('SELECT * FROM tenant_data WHERE tier = $1', [tier]);
      return res.rows;
    } finally {
      client.release();
    }
  };

  return new CircuitBreaker(dbTask, {
    timeout: 3000, 
    errorThresholdPercentage: 50,
    resetTimeout: 10000
  });
};

const breakers = {
  free: createBreaker('free'),
  pro: createBreaker('pro'),
  enterprise: createBreaker('enterprise')
};

// --- 4. API Endpoints ---

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

app.get('/api/data', async (req, res) => {
  const tier = req.headers['x-tenant-tier'];
  const forceError = req.query.force_error;

  if (!pools[tier]) {
    return res.status(400).json({ error: "Missing or invalid X-Tenant-Tier header" });
  }

  // Rate Limiting Check
  if (limiters[tier]) {
    try {
      await limiters[tier].consume(1);
    } catch (err) {
      return res.status(429).json({ error: "Too Many Requests" });
    }
  }

  // Execution via Circuit Breaker
  try {
    const data = await breakers[tier].fire(forceError);
    res.json(data);
  } catch (err) {
    const status = breakers[tier].opened ? 503 : 500;
    res.status(status).json({ error: err.message || "Service Unavailable" });
  }
});

app.get('/metrics/bulkheads', (req, res) => {
  const metrics = {};
  ['free', 'pro', 'enterprise'].forEach(tier => {
    metrics[tier] = {
      connectionPool: {
        active: pools[tier].totalCount - pools[tier].idleCount,
        idle: pools[tier].idleCount,
        pending: pools[tier].waitingCount,
        max: poolConfigs[tier].max
      },
      threadPool: { // Simulating metric for Node's event loop/libuv context
        active: pools[tier].totalCount > 0 ? 1 : 0, 
        queued: pools[tier].waitingCount,
        poolSize: poolConfigs[tier].max * 2 // Logical estimation
      },
      circuitBreaker: {
        state: breakers[tier].opened ? "OPEN" : "CLOSED",
        failures: breakers[tier].stats.failures
      }
    };
  });
  res.json(metrics);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Resilient API running on port ${PORT}`);
});