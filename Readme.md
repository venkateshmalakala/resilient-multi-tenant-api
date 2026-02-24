
# Multi-Tenant Resilient API (Bulkhead Pattern)

This project implements a highly resilient, multi-tenant REST API built with Node.js, Express, and PostgreSQL. The core objective is to demonstrate the **Bulkhead Pattern**, ensuring that resource exhaustion or service failures in one tenant tier do not impact the performance or availability of others.

---

## 🏗️ Architecture & Design Choices

### 1. Resource Isolation (The Bulkheads)
The application partitions resources into three distinct "compartments" based on the `X-Tenant-Tier` header.

| Tier | DB Connections (Max) | Rate Limit | Thread Pool Size |
| :--- | :--- | :--- | :--- |
| **free** | 5 | 100 req/min | 10 threads |
| **pro** | 20 | 1,000 req/min | 30 threads |
| **enterprise** | 50 | Unlimited | 60 threads |

- **Database Bulkheads:** Three independent `pg.Pool` instances ensure a connection leak in one tier cannot prevent other tiers from connecting.
- **Logic Bulkheads:** Requests are processed through isolated worker thread pools (using `piscina`) to ensure heavy computation in one tier does not block another.
- **Circuit Breakers:** Powered by `opossum`. They monitor failure rates and "fail fast" when a specific tier becomes unstable.

---

## 🚀 Getting Started

### Prerequisites
- Docker and Docker Compose
- Git Bash (Windows) or Terminal (Linux/macOS)

### Running the Application
1. Clone the repository.
2. Start the stack:
   ```bash
   docker-compose up --build

```

---

## 🧐 What to expect after startup

Once the containers are running, you should see the following sequence in your logs:

1. **Database Ready**: The `db` container initializes the schema and seed data.
2. **API Live**: The API service boots up and reports:
`Resilient API running on port 8080`.
3. **Health Check**: Verify the status at `http://localhost:8080/health`. It should return `{"status": "healthy"}`.

---

## 🧪 Testing & Verification

### 1. Manual Metric Check

View the real-time state of all bulkheads, thread pools, and circuit breakers:

```bash
curl http://localhost:8080/metrics/bulkheads

```

### 2. Automated Load Test (Bulkhead Proof)

This script floods the `free` tier to trigger rate limits while verifying that the `enterprise` tier remains unaffected.

```bash
docker compose exec api bash ./load-test.sh

```

### 3. Circuit Breaker Trigger

To manually trip the circuit breaker for the `free` tier without affecting other tiers, send 10 consecutive requests with the failure flag:

```bash
for i in {1..10}; do curl -H "X-Tenant-Tier: free" "http://localhost:8080/api/data?force_error=true"; done

```

Check metrics again. You will see `free.circuitBreaker.state: "OPEN"`, while other tiers remain `"CLOSED"`.

---

## 📁 Project Structure

* `server.js`: Main application logic containing bulkhead and circuit breaker implementation.
* `worker.js`: Logic executed within isolated thread pools.
* `init-db.sql`: Schema and seed data for the PostgreSQL container.
* `load-test.sh`: Script for performance and isolation verification.

```

```