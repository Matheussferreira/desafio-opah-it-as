#!/usr/bin/env bash
# Roda o ciclo completo de testes de integração:
#   1. Sobe infra isolada (postgres:5433, rabbitmq:5673, redis:6380)
#   2. Executa os testes
#   3. Destrói a infra independentemente do resultado
#
# Uso: bash test-integration.sh
# Requer: Docker com Compose v2 (docker compose --version >= 2.20)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.integration.yml"
SERVICE_DIR="$ROOT_DIR/services/consolidado"

cleanup() {
  echo ""
  echo "→ Derrubando infra de integração..."
  # Sem --remove-orphans: não toca no stack principal (docker-compose.yml)
  docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Teste de Integração — DLQ e Retry ==="
echo ""
echo "→ Subindo infra isolada (postgres:5433, rabbitmq:5673, redis:6380)..."
docker compose -f "$COMPOSE_FILE" up -d --wait

echo ""
echo "→ Infra pronta. Iniciando testes..."
echo ""

export RABBITMQ_URL="amqp://rabbit:rabbit@localhost:5673"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/consolidado_db"
export REDIS_URL="redis://localhost:6380"

cd "$SERVICE_DIR"
npm run test:integration

echo ""
echo "=== Testes de integração concluídos ==="
