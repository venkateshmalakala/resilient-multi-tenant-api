#!/bin/bash

echo "Starting Load Test: Flooding FREE tier while checking ENTERPRISE tier..."

# 1. Flood Free Tier to trigger Rate Limiting (100 req/min)
for i in {1..105}; do
  curl -s -o /dev/null -H "X-Tenant-Tier: free" http://localhost:8080/api/data &
done

# 2. Check Enterprise Tier (Should be 200 OK)
echo "Validating Enterprise Tier availability..."
for i in {1..5}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Tier: enterprise" http://localhost:8080/api/data)
  echo "Enterprise Request $i: Status $STATUS"
done

# 3. Trip the Free Tier Circuit Breaker
echo "Tripping Free Tier Circuit Breaker..."
for i in {1..10}; do
  curl -s -o /dev/null -H "X-Tenant-Tier: free" "http://localhost:8080/api/data?force_error=true"
done

echo "Check metrics at http://localhost:8080/metrics/bulkheads"
wait