# Estimativa de Custos — AWS

## Premissas

- Região: `us-east-1` (preços de referência, jun/2026)
- Workload: 50 req/s pico no Consolidado, ~1 M req/dia; ~100 k lançamentos/dia
- Ambiente: produção com alta disponibilidade (Multi-AZ onde aplicável)
- Reserva: On-Demand (sem Reserved Instances — ajustar para redução real no dia a dia)
- Dois RDS separados: um para `lancamentos_db` (write-heavy), um para `consolidado_db` (read-heavy + consumer)

## Estimativa Mensal

| Serviço | Especificação | Custo/mês |
|---|---|---|
| **ECS Fargate** — Lancamentos | 2 tasks × 0.25 vCPU × 0.5 GB RAM × 730h | ~$10 |
| **ECS Fargate** — Consolidado | 2 tasks × 0.5 vCPU × 1 GB RAM × 730h | ~$25 |
| **RDS PostgreSQL** — lancamentos_db | db.t3.small, 20 GB SSD, Multi-AZ | ~$55 |
| **RDS PostgreSQL** — consolidado_db | db.t3.small, 20 GB SSD, Multi-AZ | ~$55 |
| **Amazon MQ** — RabbitMQ | mq.t3.micro, cluster 3 brokers (HA) | ~$90 |
| **ElastiCache Redis** | cache.t3.micro, Cluster Mode, 1 shard + 1 réplica | ~$30 |
| **ALB** | 1 load balancer + ~1 M LCUs | ~$25 |
| **CloudWatch Logs** | ~10 GB/mês de logs | ~$5 |
| **ECR** | 2 repositórios, ~500 MB | ~$1 |
| **Secrets Manager** | 4 secrets (2 por serviço) | ~$2 |
| **Data Transfer** | ~50 GB/mês (estimativa conservadora) | ~$5 |
| **TOTAL ESTIMADO** | | **~$303/mês** |

> **Variação com single-instance Amazon MQ:** Um `mq.t3.micro` single-instance (sem HA) custa ~$30/mês em vez de ~$90. Total seria ~$243/mês. Recomendado apenas para staging — single-node MQ é ponto único de falha.

## Notas

- **Todos os componentes são open-source:** PostgreSQL, RabbitMQ, Redis, Node.js — custo zero de licença de software.
- O maior custo do setup HA é o **Amazon MQ cluster**: 3 brokers × $30 = $90/mês. Para volumes menores ou sem requisito de HA estrita do broker, Amazon SQS + SNS elimina esse custo fixo (paga-se por mensagem: 100k msg/dia = ~$0.04/mês).
- IAM Roles, Security Groups, VPC e subnets: custo zero — são recursos lógicos sem cobrança.
- X-Ray (tracing distribuído — evolução futura): ~$5/mês adicional para 100k traces/mês.

## Otimizações de Custo para Produção Real

| Otimização | Economia estimada |
|---|---|
| Reserved Instances 1 ano no RDS (ambos) | $110 → ~$66/mês (40% de redução) |
| Compute Savings Plans no ECS Fargate (1 ano) | $35 → ~$21/mês (40%) |
| Fargate Spot para o Consolidado | $25 → ~$7/mês (70% — aceitável para consumer assíncrono tolerante a interrupção) |
| Amazon MQ → SQS+SNS (se sem requisito de RabbitMQ específico) | $90 → ~$0.04/mês |
| ElastiCache → Redis OSS no Fargate (para volumes muito baixos) | Elimina ~$30/mês; aceita maior risco de operação |

**Com todas as otimizações combinadas (exceto SQS):** ~$150/mês.  
**Com SQS em vez de Amazon MQ:** ~$60/mês.
