const { Pool } = require('pg');

/**
 * Piscina passes the data sent via threadPool.run(data) 
 * directly as the first argument to the exported function.
 */
module.exports = async ({ tier, forceError, config }) => {
  // Simulate a failure if requested, to test circuit breakers
  if (forceError === 'true') {
    throw new Error("Database Failure Simulated");
  }

  // Initialize the pool with the tier-specific config
  const pool = new Pool(config);
  const client = await pool.connect();
  
  try {
    const res = await client.query('SELECT * FROM tenant_data WHERE tier = $1', [tier]);
    return res.rows;
  } finally {
    client.release();
    // Ensure the pool is closed within the worker to prevent resource leaks
    await pool.end(); 
  }
};