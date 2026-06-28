-- Executado pelo postgres na primeira inicialização (diretório de dados vazio)
SELECT 'CREATE DATABASE lancamentos_db'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'lancamentos_db')\gexec

SELECT 'CREATE DATABASE consolidado_db'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'consolidado_db')\gexec
