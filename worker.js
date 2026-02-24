const { parentPort, workerData } = require('worker_threads');
const { Pool } = require('pg');

/**
 * This function is executed in a worker thread.
 * It simulates a database failure if forceError is true,
 * otherwise it connects to the database and fetches data for the given tier.
 */
async function handleRequest() {
  const { tier, forceError, config } = workerData;

  // Simulate a failure if requested, to test circuit breakers
  if (forceError === 'true') {
    throw new Error("Database Failure Simulated");
  }

  const pool = new Pool(config);
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM tenant_data WHERE tier = $1', [tier]);
    return res.rows;
  } finally {
    client.release();
    await pool.end(); // Ensure the pool is closed to prevent leaks in the worker
  }
}

handleRequest()
  .then(result => parentPort.postMessage(result))
  .catch(err => {
    // Re-throw the error so Piscina can catch it and handle it appropriately
    throw err;
  });
