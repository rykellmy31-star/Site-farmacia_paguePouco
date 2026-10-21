# Homologação Cloudflare — rodada segura de 21/10/2026

## Identidade de produção preservada

- Worker: `site-farmacia-paguepouco`
- URL: `https://site.farmaciapaguepouco.app`
- Durable Object binding: `LOJA`
- Classe: `LojaDurableObject`
- Instância persistente: `loja-principal-v1`
- Commit validado: `b6c910c266c84670b49a8bdb3918a952f429bc87`
- Workers Builds: *success* (verificável no GitHub Checks)
- `wrangler.jsonc` ainda define `farmacia-pague-pouco`, nome
  DIFERENTE do Worker de produção. **Não fazer deploy manual** com esse
  arquivo até alinhar conscientemente o destino e confirmar migrações.

## Evidências obtidas sem acesso a pedidos/segredos

1. GET `/__health` respondeu com
   `{"ok":true,"runtime":"cloudflare-workers","storage":"durable-object-sqlite"}`.
2. GET `/data/db/admins.json` não expôs dados (HTTP 404).
3. Página inicial pública foi acessível por HTTPS e exibiu catálogo.
4. Auditoria de API Cloudflare anteriormente executada no CI:
   Worker e bindings `LOJA`/`ASSETS` existentes, deployment presente,
   `nodejs_compat` e data de compatibilidade configurados.
5. Na auditoria de 21/10/2026, o token de leitura forneceu HTTP 200
   ao listar scripts, settings, schedules e deployments.
6. `PUBLIC_BASE_URL` não aparece explicitamente nos bindings na
   auditoria. O fallback de hostname já foi corrigido no código, mas
   recomendamos configurar a variável pública no **Worker correto**.
7. Serviço externo de e-mails e backup automático externo ainda não
   foram comprovados. Sem evidência de restauração real isolada.

## Automações de verificação incluídas nesta rodada

`scripts/smoke-cloudflare-readonly.mjs` faz SOMENTE cinco GETs anônimos:

- `/__health`: valida ambiente Workers + DO SQLite
- `/`: exige página HTML com status 200
- `/admin/inovafarma`: exige redirecionamento/negação sem sessão
- `/data/db/admins.json`: exige que o arquivo não seja público
- `/img/fundo-banner-vermelho.svg`: confirma acesso à mídia publicada

Imprime somente HTTP e indicadores booleanos, jamais HTML protegido,
credenciais ou dados de clientes. Falhas impedem CI de receber sinal
verde. Os testes offline `tests/cloudflare-public-smoke.test.js`
comprovam que não há POST, cookies, pagamentos ou origem arbitrária.

A auditoria com token `scripts/audit-cloudflare-readonly.mjs` continua
limitada a GET e acrescenta apenas indicadores de presença da chave
Inova e de integração desligada. **Não imprime os segredos.**

Após integração, o workflow manual **Homologacao Cloudflare - somente leitura**
poderá ser acionado em *GitHub → Actions → Run workflow* na `main`,
sem realizar deploy nem pagar Pix.

## Itens ainda pendentes antes de anunciar 100% comercial

1. **Configuração Worker:** cadastrar e verificar
   `PUBLIC_BASE_URL=https://site.farmaciapaguepouco.app` em *Variables*
   (plaintext). Nunca publicar Access Tokens em plaintext.
2. **Pagamentos reais:** validar credenciais Mercado Pago pelo painel,
   webhooks, reconciliação de Pix aprovado e estorno real já autorizado.
   Os testes CI usam mocks e NÃO comprovam repasse bancário.
3. **Backups:** implantar cópia externa versionada e criptografada de
   dados, mídias e manifesto; testar restauração de cópia da loja REAL
   em ambiente isolado. Os testes do CI trabalham com bases fictícias
   e não substituem essa recuperação real.
4. **Monitoramento:** validar Workers Observability/Logs e DO Alarms
   com erros reais sanitizados, sem logs com CPF ou tokens.
5. **Notificações:** provedora de e-mail transacional compatível com
   Workers ainda não foi conectada.
6. **Segurança:** verificar rotatividade de chaves, bootstrap
   `ADMIN_PASSWORD` após criação da conta, limites e permissões.
7. **InovaFarma:** documentação e conector oficial; não ativar
   `INOVA_STOCK_ENABLED` antes de homologação e autorização.
8. **Cloudflare Account:** o token de auditoria é intencionalmente
   **somente leitura**. Configurações e restaurações devem ser feitas
   por fluxo de autorização separado e auditável.

## Regra de segurança

Não criar Worker alternativo, não alterar binding/ID do DO, não apagar
dados, não restaurar produção, não solicitar compra real, não usar token
Cloudflare de escrita no CI. O smoke remoto não testa dados de clientes.
