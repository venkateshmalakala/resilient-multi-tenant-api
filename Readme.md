# Multi-Tenant Resilient API (Bulkhead Pattern)

This project implements a highly resilient, multi-tenant REST API built with Node.js, Express, and PostgreSQL. The core objective is to demonstrate the **Bulkhead Pattern**, ensuring that resource exhaustion or service failures in one tenant tier do not impact the performance or availability of others.

---

## 🏗️ Architecture & Resilience Strategy

The application's architecture is built on multiple layers of resilience to guarantee service quality and isolate tenants from one another. Resources are partitioned into three "compartments" based on the `X-Tenant-Tier` header (`free`, `pro`, `enterprise`).

| Tier         | DB Connections (Max) | Rate Limit      | Thread Pool Size |
| :----------- | :------------------- | :-------------- | :--------------- |
| **free**     | 5                    | 100 req/min     | 10 threads       |
| **pro**      | 20                   | 1,000 req/min   | 30 threads       |
| **enterprise** | 50                   | Unlimited       | 60 threads       |

### Layer 1: Rate Limiting (Traffic Shaping)
- **Technology**: `rate-limiter-flexible`
- **Purpose**: As the first line of defense, rate limiting prevents any single tenant from overwhelming the API with an excessive number of requests, ensuring fair resource allocation.

### Layer 2: Logic Bulkheads (CPU/Event Loop Isolation)
- **Technology**: `piscina` (Worker Thread Pools)
- **Purpose**: Each tenant tier is assigned its own dedicated pool of worker threads. This is the core of the bulkhead pattern. If the `free` tier is executing slow or CPU-intensive queries, it will only saturate its own thread pool, leaving the `pro` and `enterprise` pools unaffected and responsive.

### Layer 3: Database Bulkheads (Connection Isolation)
- **Technology**: `pg.Pool`
- **Purpose**: Each tier communicates with the database via a separate connection pool. This prevents a connection leak or a high number of pending queries in one tier from exhausting the database connections available to others.

### Layer 4: Fault Tolerance (Cascading Failure Prevention)
- **Technology**: `opossum` (Circuit Breakers)
- **Purpose**: Each logic bulkhead (thread pool) is wrapped in an independent circuit breaker. If requests for a specific tier begin to fail repeatedly (e.g., due to a database timeout), its circuit breaker will "trip" and fail-fast, immediately rejecting new requests for that tier without even attempting to run them. This prevents a failing downstream service from causing a cascading failure across the entire API.

---

## 🚀 Getting Started

### Prerequisites
- Docker and Docker Compose
- A shell environment like Git Bash (on Windows) or a standard Terminal (Linux/macOS).

### Running the Application
1.  Clone the repository.
2.  Start the full application stack:
    ```bash
    docker-compose up --build
    ```
3.  **Verify Health**: Once the containers are running, check the health endpoint. It is ready when `http://localhost:8080/health` returns `{"status": "healthy"}`.

---

## 🧪 Testing & Verification

### 1. Real-Time Observability
View the live state of all bulkheads, thread pools, and circuit breakers via the metrics endpoint. This is the primary tool for proving the implementation works.
```bash
curl http://localhost:8080/metrics/bulkheads
```

### 2. Automated Load Test (Proof of Isolation)
The included script floods the `free` tier to trigger its resilience mechanisms while simultaneously sending requests to the `enterprise` tier to prove it remains fast and available.
```bash
# This command runs the script inside the running 'api' container
docker compose exec api bash ./load-test.sh
```

### 3. Manual Circuit Breaker Trigger
You can manually force a tier's circuit breaker to open without affecting others.
1.  Send 10 consecutive requests to the `free` tier with a special failure flag:
    ```bash
    # Run this loop 10 times
    for i in {1..10}; do curl -H "X-Tenant-Tier: free" "http://localhost:8080/api/data?force_error=true"; done
    ```
2.  Check the metrics endpoint again. You will see `free.circuitBreaker.state: "OPEN"`, while the `pro` and `enterprise` breakers remain `"CLOSED"`.

---

## ⚙️ Configuration

Environment variables are managed in `.env`. Copy `.env.example` to `.env` to run locally.

-   `DATABASE_URL`: Connection string for PostgreSQL.
-   `API_PORT`: Port the service listens on (default: 8080).

---

## 📁 Project Structure

-   `server.js`: The main application entrypoint. Initializes all pools, breakers, and API endpoints.
-   `worker.js`: The database query logic that is executed inside the isolated `piscina` thread pools.
-   `init-db.sql`: Schema and seed data for the PostgreSQL database.
-   `docker-compose.yml`: Orchestrates the API and database services.
-   `load-test.sh`: Bash script for performance and isolation verification.
-   `Dockerfile`: Defines the container image for the API service.
-   `.env.example`: Template for required environment variables.