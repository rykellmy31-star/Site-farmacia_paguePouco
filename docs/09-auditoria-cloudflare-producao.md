# Auditoria Cloudflare de produção — 21/10/2026

**Ambiente**: Worker existente `site-farmacia-paguepouco`, domínio
`site.farmaciapaguepouco.app`, Durable Object `LOJA`, classe
`LojaDurableObject`, identificação persistente `loja-principal-v1`.
Não recriar esses recursos nem restaurar automaticamente dados de produção.

## Evidências reais (GitHub Actions, PR #28)

O roteiro `scripts/audit-cloudflare-readonly.mjs` executou somente requisições
GET na API Cloudflare, com token restrito. Os resultados foram:

| Recurso | Verificação |
| --- | --- |
| Acesso ao script e às settings | HTTP 200, autenticado |
| Script com nome de produção | Encontrado |
| Deploy ativo | Encontrado |
| Binding `LOJA` e classe `LojaDurableObject` | Confirmados |
| Binding `ASSETS` | Confirmado |
| Secret `MP_CREDENTIALS_KEY` | Presente |
| Secret bootstrap `ADMIN_PASSWORD` | Presente |
| Secrets de ambiente alternativos `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` | Não encontrados nos bindings; **podem estar cifrados no cofre do painel** |
| `PUBLIC_BASE_URL` | Não definida explicitamente |
| Cron Triggers | Zero; não são necessários ao modelo atual de Durable Object Alarms |
| Data de compatibilidade e `nodejs_compat` | Presentes |
| `SESSION_SECRET` | Não presente como secret; o Worker gera um segredo persistido internamente |
| Serviço de e-mail externo | Ainda não implementado no Worker |

**Segurança**: o relatório não imprime os valores de chaves,
dados de clientes, histórico de pedidos nem outros Workers.

## Correção realizada

O método `alarm()` antes recebia `https://localhost.invalid` se
`PUBLIC_BASE_URL` estivesse ausente. O fallback agora usa
`https://site.farmaciapaguepouco.app`. Em chamadas normais, o Worker
já usa o origin real da requisição. Na Cloudflare recomenda-se também
cadastrar a variável de texto simples `PUBLIC_BASE_URL` com esse
endereço oficial para manter a configuração explícita.

## Pendências antes da homologação

1. **Mercado Pago**: confirmar no cofre do Super Administrador se Access
   Token e assinatura do webhook foram cadastrados para o MESMO ambiente.
   Um HTTP 401 observado anteriormente indica autenticação recusada;
   a presença de `MP_CREDENTIALS_KEY` não valida o Access Token.
   Não criar Pix real automaticamente para testes.
2. **Backups externos**: atualmente o painel exporta JSON dos documentos
   e manifesto/arquivos das mídias, mas não há comprovação de rotina
   externa automática nem teste de restauração da loja real.
   Cloudflare Durable Objects com SQLite contam com PITR de até 30 dias,
   o que **não substitui** cópias externas independentes de longo prazo.
   Qualquer ensaio de restauração deve ser feito em ambiente isolado;
   não usar operação de restore no Worker de produção.
3. **E-mails**: o envio externo permanece desativado na integração Worker.
   É necessário um provedor e testes dos fluxos sem destinatários reais.
4. **Monitoramento**: verificar observabilidade, alertas e falhas
   de reconciliação em ambiente homologado; a API read-only de scripts
   não atesta a execução específica de cada alarme.
5. **Wrangler**: `wrangler.jsonc` tem o nome `farmacia-pague-pouco`,
   diferente do Worker de produção `site-farmacia-paguepouco`.
   **Não executar `wrangler deploy` manual nem mudar bindings/migrações**
   até alinhar a configuração e confirmar o destino, para não criar
   Worker paralelo/banco isolado.

## Próximos passos de configuração na Cloudflare

- Adicionar `PUBLIC_BASE_URL=https://site.farmaciapaguepouco.app` como
  variável **Plaintext**, no Worker certo.
- Preparar cópias externas automáticas versionadas e criptografadas,
  com verificação periódica de restauração **fora de produção**.
- Monitorar erros em Workers Logs/Observability, sem registrar
  corpo de webhook, tokens ou CPF.
- Não conceder Workers Scripts Edit ao token
  `CLOUDFLARE_AUDIT_TOKEN`: ele deve permanecer somente leitura.

Relatório de presença de bindings não garante valores corretos
nem autoriza uma cobrança de verdade.
