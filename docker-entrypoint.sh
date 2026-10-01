#!/bin/sh
set -e

echo "=========================================="
echo " Starting TRENDS Shopify App (Production) "
echo "=========================================="

# 1. Run database migrations with retry loop for container orchestration
echo "[Docker Entrypoint] Verifying database connectivity and applying Prisma migrations..."
MAX_RETRIES=15
RETRY_COUNT=0

until npx prisma migrate deploy || [ $RETRY_COUNT -ge $MAX_RETRIES ]; do
  RETRY_COUNT=$((RETRY_COUNT+1))
  echo "[Docker Entrypoint] Database not ready yet. Retrying in 3 seconds ($RETRY_COUNT/$MAX_RETRIES)..."
  sleep 3
done

if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
  echo "[Docker Entrypoint] ERROR: Migration failed after $MAX_RETRIES attempts. Exiting."
  exit 1
fi

echo "[Docker Entrypoint] Prisma migrations successfully applied."

# 2. Launch production HTTP server
echo "[Docker Entrypoint] Starting production web server on port ${PORT:-3000}..."
exec npm run start
