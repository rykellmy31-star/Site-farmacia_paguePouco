# 02 — Arquitetura técnica

## Decisão central: Node.js puro, **zero dependências npm**

A loja foi construída com **Node.js 20 + ES Modules e nenhuma dependência externa**.
Essa não foi uma escolha estética — foi a que atendeu, ao mesmo tempo, a todos os
requisitos do projeto dentro das restrições deste ambiente:

| Requisito | Como foi atendido |
|---|---|
| Funcionar de verdade (não maquete) | Servidor HTTP real, rotas reais, pedidos e pagamentos processados de fato |
| Persistência durável (nada só no navegador) | Banco em arquivo com **WAL + snapshot** em `data/db/` |
| Sem custo e sem contratar serviços | Nenhuma biblioteca paga, nenhum SaaS obrigatório, nenhuma API de terceiros necessária |
| Estabilidade | Sem risco de quebra por versão de pacote, sem build, sem `node_modules` |
| Instalação simples pelo lojista | `node src/server.js` — pronto |

### O que foi rejeitado e por quê

- **`node:sqlite`** — não existe no Node 20 deste ambiente (`ERR_NO_BUILTIN_MODULE`).
- **`better-sqlite3` / drivers nativos** — exigem compilação nativa; além disso, pacotes
  instalados não sobrevivem à entrega do workspace, o que deixaria a loja quebrada para o cliente.
- **Playwright/Chromium** — não instalado e sem instalação autorizada (custo/tempo).
- **Correios (API de frete)** — o frete é **fixo por estado**, configurado no painel,
  e funciona **sem nenhuma chamada externa** (ver `docs/04`).

## Camadas

```
navegador ──► HTTP ──► src/server.js            (boot, middlewares, erros, shutdown)
                          │
                          ├─► src/routes/*.js   (rotas: pública, conta, checkout, API, admin, webhooks)
                          │        └─► src/views/**  (funções puras que devolvem HTML)
                          │
                          └─► src/lib/*.js      (regras de negócio, sem HTML)
                                   store · security · catalog · cart · orders
                                   freight · cep · uploads · payments · audit · mailer

dados ──► src/lib/store.js ──► data/db/*.json   (WAL + snapshot)
mídia ──► src/lib/uploads.js ─► data/uploads/aaaa/mm/<id>.<ext>
fila de e-mails ──► src/lib/mailer.js ──► data/mail/*.eml
```

### Regra de ouro da camada de visão
Toda view é uma **função pura que recebe dados e devolve uma string HTML**.
Nenhuma view lê o banco diretamente para decidir o que exibir (ela recebe `ctx`),
o que mantém o HTML testável e previsível.

## Persistência (WAL + snapshot)

`src/lib/store.js` implementa um banco documental em arquivo:

- Cada operação de escrita (`insert`, `update`, `remove`) é registrada primeiro em um
  **WAL** (write-ahead log) e aplicada na memória.
- Em intervalos e no encerramento do processo, o estado é **compactado em snapshot**.
- Ao subir, o WAL pendente é replicado sobre o snapshot — por isso um desligamento
  abrupto não perde pedidos (isso é testado: ver `docs/05`).
- API: `all`, `count`, `find`, `findOne`, `get`, `insert`, `update`, `updateMany`,
  `remove`, `removeMany`, `query({ where, sort, order, limit, offset })`, `clear`, `backup()`.

**Coleções:** `admins`, `customers`, `sessions`, `passwordTokens`, `carts`, `products`,
`categories`, `orders`, `payments`, `webhookEvents`, `coupons`, `pages`, `banners`,
`showcases`, `midia`, `stockMovements`, `settings`, `counters`, `auditLogs`, `systemLogs`,
`mailOutbox`.

### Migração para PostgreSQL (ou MySQL) — caminho preparado
`database/schema.postgres.sql` contém o esquema equivalente em SQL.
A troca é feita **somente** reimplementando `src/lib/store.js` com a mesma API
(ou trocando por um adaptador) — nenhuma rota ou view muda, porque todas falam
apenas com a interface do `store`.

## Dinheiro

**Todo valor monetário é manipulado em centavos inteiros** (`precoCentavos`,
`totalCentavos`, `valor` do frete etc.). Isso elimina erros de arredondamento de
ponto flutuante. A conversão de/para o que o usuário digita passa sempre por
`toCents()` / `fromCents()` em `src/lib/format.js`, que aceitam `31.90` e `1.234,56`.

## Frete: fixo por estado, sem API externa

`src/lib/freight.js` + uma tabela de faixas de CEP em `src/lib/cep.js`:
CEP → UF (offline) → configuração do estado → valor e prazo.

- Nunca é inventado valor/prazo: se o estado está desativado ou o pedido excede um
  limite, o motor **bloqueia e informa o motivo** (`{ disponivel: false, motivo }`).
- `custoPostagemEstimado` (custo real estimado de postagem) é mantido **separado** do
  valor cobrado do cliente.
- Suporta retirada na loja, entrega local, exceções por cidade/faixa de CEP,
  frete grátis por valor mínimo e limites de peso/cubagem.

## Pagamentos

`src/lib/payments/` expõe uma interface única: `createPayment`, `getPaymentStatus`,
`refundPayment`, `handleWebhook`, `enabledMethods`, `providerPublicInfo`.

- **Provedor `internal` (padrão, testes)** — gera código Pix **marcado como SIMULADO**
  e aceita simulação de aprovação pelo painel. Não processa dinheiro real.
- **Provedor `mercadopago`** — implementado (criação de Pix/cartão, consulta,
  estorno e webhook). Só é usado quando `PAYMENT_PROVIDER=mercadopago` e existirem
  credenciais. **Não foi executado com credenciais reais** (ver `docs/06`).

Regra de segurança: **nenhum pagamento é marcado como aprovado apenas pelo corpo da
requisição**. O webhook consulta o provedor e cada evento é idempotente
(chave `<provider>:<paymentId>:<status>` em `webhookEvents`).

## Segurança (implementada e testada)

| Controle | Onde |
|---|---|
| Senhas com **scrypt** + salt individual | `lib/security.js` |
| Sessões com cookie `httpOnly`, rotação de token | `lib/security.js` + `server.js` |
| **CSRF** por dupla submissão (sessão + cookie; injeção automática em todo `<form method="post">`) | `server.js` + `lib/security.js` |
| **Rate limiting** por IP/escopo (login, checkout, API) | `lib/security.js` |
| **XSS**: sanitizador com lista branca de tags/atributos no conteúdo do CMS; escape em todas as saídas | `lib/security.js` |
| **Uploads** validados por **magic bytes**, extensão e tamanho; nome de arquivo gerado pelo servidor | `lib/uploads.js` |
| **SQL/NoSQL injection**: não há SQL — o store usa funções de predicado; entradas são validadas/normalizadas | todo o projeto |
| Trilha de auditoria de ações administrativas (com IP) | `lib/audit.js` |
| Regras aplicadas **no servidor**: preço, desconto, cupom, frete e estoque são recalculados no backend | `lib/cart.js`, `lib/orders.js` |
| Bloqueio sanitário de venda (controlados, sem registro, sem aprovação) | `lib/catalog.js` |

## Painel administrativo

- Shell em `src/views/admin/layout.js` (menu de 20 itens filtrado por permissão).
- Telas em `src/views/admin/{catalogo,vendas,config}.js`.
- Rotas e API em `src/routes/admin.js`, com `guard()`/`guardApi()` que checam
  permissão **no servidor** (não confia no que o navegador esconde).
- 6 perfis: Super Administrador, Administrador, Gerente, Atendente,
  Operador de pedidos e **Responsável técnico** (farmacêutico) — este último é o único
  que aprova/libera o cadastro sanitário de medicamentos.

## Front-end

- HTML renderizado no servidor (rápido, indexável, funciona sem JS).
- `public/js/app.js` (site) e `public/js/admin.js` (painel) — **JavaScript puro**,
  sem frameworks: cesta lateral, carrosséis, CEP, galeria, upload, editor de texto.
- `public/styles.css` — design system com variáveis CSS; as cores vêm das
  configurações de aparência do painel. **Nenhuma fonte ou CDN externa**, para que a
  loja funcione offline e carregue rápido.

## Limites conhecidos da arquitetura

- O banco em arquivo atende com folga o porte de uma farmácia; para milhares de
  pedidos/dia simultâneos, recomenda-se a migração para PostgreSQL (esquema pronto).
- A busca é feita em memória sobre a coleção de produtos (rápida até dezenas de
  milhares de itens). Além disso, recomenda-se um índice externo (ex.: Postgres FTS).
- Um único processo Node atende tudo. Para alta escala, usar um proxy reverso
  (Nginx/Caddy) e `cluster`/PM2 — sem mudança de código.
