# Firawynix Monitor

Aplicativo Windows para acompanhar serviços Linux quando o usuário configura uma conexão SSH. Na primeira execução a configuração de servidores é vazia, sem conexões automáticas.

## Desenvolvimento

Use Python 3.13. Instale `requirements-dev.txt`, execute `python -m pytest` e rode `python main.py --demo` para observar dados simulados. O modo demo não usa SSH.

## Segurança

O arquivo `servers.example.json` não contém servidores. `servers.json`, `.env`, chaves e dados de execução ficam fora do repositório. Senhas podem ser pedidas ao conectar ou guardadas no Gerenciador de Credenciais do Windows.
