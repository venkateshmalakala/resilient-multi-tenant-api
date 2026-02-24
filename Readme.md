# Multi-Tenant Resilient API (Bulkhead Pattern)

This project implements a highly resilient, multi-tenant REST API built with Node.js, Express, and PostgreSQL. The core objective is to demonstrate the Bulkhead Pattern, ensuring that resource exhaustion or service failures in one tenant tier do not impact the performance or availability of others.

## Architecture & Design Choices

### 1. Resource Isolation (The Bulkheads)

Instead of a single shared pool, this application partitions resources into three distinct "compartments" based on the `X-Tenant-Tier` header:

- **Database Bulkheads:** Three independent `pg.Pool` instances are initialized.
  - **Free:** 5 max connections.
  - **Pro:** 20 max connections.
  - **Enterprise:** 50 max connections.

- **Logic Bulkheads:** Requests are processed through isolated circuit breakers. If the database slows down for the "Free" tier, only that tier's breaker trips.

### 2. Resilience Features

- **Rate Limiting:** Implemented via `rate-limiter-flexible`.
  - **Free:** 100 requests / minute.
  - **Pro:** 1,000 requests / minute.
  - **Enterprise:** Unlimited.

- **Circuit Breakers:** Powered by Opossum. They monitor failure rates and "fail fast" when a specific tier becomes unstable.

- **Health Monitoring:** A dedicated `/metrics/bulkheads` endpoint provides real-time visibility into the health of each resource pool.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Git Bash (if on Windows) or a Terminal (Linux/macOS)

### Running the Application

1.  Clone the repository.
2.  Start the stack:
    ```bash
    docker-compose up --build
    ```
3.  Verify Health:
    The API is healthy when `http://localhost:8080/health` returns `{"status": "healthy"}`.

## Testing & Verification

### 1. Manual Metric Check

View the current state of all bulkheads:

```bash
curl http://localhost:8080/metrics/bulkheads
```

### 2. Automated Load Test

The included `load-test.sh` demonstrates resource isolation. It floods the `free` tier to trigger rate limits and failures while verifying that the `enterprise` tier remains unaffected.

To run the test:

```bash
# Using Docker (Works on Windows/Linux/macOS)
docker compose exec api bash ./load-test.sh
```

### 3. Circuit Breaker Trigger

To manually trip the circuit breaker for the `free` tier without affecting `pro` or `enterprise`:

Send 10 consecutive requests with the failure flag:

```bash
# Run this 10 times
curl -H "X-Tenant-Tier: free" "http://localhost:8080/api/data?force_error=true"
```

Check metrics again. You will see `free.circuitBreaker.state: "OPEN"`, while other tiers remain `"CLOSED"`.

## Configuration

Environment variables are managed in `.env`. Refer to `.env.example` for the required keys:

- `DATABASE_URL`: Connection string for PostgreSQL.
- `API_PORT`: Port the service listens on (default: 8080).

## Project Structure

- `server.js`: Main application logic containing bulkhead and circuit breaker implementation.
- `init-db.sql`: Schema and seed data for the PostgreSQL container.
- `docker-compose.yml`: Orchestrates the API and DB services.
- `load-test.sh`: Bash script for performance and isolation verification.
