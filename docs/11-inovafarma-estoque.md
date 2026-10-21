# Integração de estoque — INOVAFARMA (ponte para homologação)

## Objetivo e limites

O estoque **oficial** permanece na InovaFarma. O site apenas disponibiliza saldos
recebidos de um **conector autorizado**, reserva quantidades para checkout e gera
uma fila de vendas **com pagamento aprovado** para que o conector as registre na
Inova. Não integra preço, financeiro, cadastros de clientes, nota fiscal ou dados
clínicos.

**Esta branch não realiza conexão direta com a API da Inova.** Os endpoints
privados, autenticação e contrato de integração precisam ser fornecidos /
homologados pela Precisão Sistemas, responsável pela InovaFarma.
A documentação pública descreve APIs/Views com autorização prévia no Portal PS
e módulos possivelmente sujeitos a contratação. Não presuma que um executável
chamado "API INOVAFARMA" constitua uma API pública utilizável externamente.

Referências:
- https://conhecimento.atlassian.net/wiki/spaces/BDC/pages/18907864
- https://conhecimento.atlassian.net/wiki/spaces/BDC/pages/48857108
- https://conhecimento.atlassian.net/wiki/spaces/BDC/pages/449282077

## Fluxo previsto

1. A Inova é atualizada por reposições e vendas no balcão.
2. Um conector homologado consulta o ERP e envia **quantidades absolutas por EAN**
   ao endpoint autenticado do site. Se o EAN não for único, o lote é rejeitado.
3. No site, a disponibilidade é `saldoInova - reservasLocal - vendasPagasAindaNaoRefletidas`.
   Sem um snapshot recente, o site **não vende**, em vez de usar um estoque antigo.
4. Ao confirmar um pagamento no Mercado Pago, o site mantém a movimentação e
   marca a venda como pendente para a Inova. O conector consulta essa fila e
   registra a venda uma única vez no ERP, usando `pedidoId` como chave de idempotência.
5. O conector confirma a referência do registro no ERP. **Essa confirmação não
   libera a reserva provisória**; a liberação só ocorre ao enviar um snapshot
   atualizado contendo o pedido em `pedidosRefletidos`, após a baixa efetiva.
6. Recebida a confirmação do saldo, o site remove o débito provisório e passa a
   usar a quantidade oficial da Inova.

Não usar para produção até homologar também:
- A existência do módulo/API e a liberação contratual para esta farmácia;
- O método autorizado para registrar vendas, inclusive duplicidades e falhas;
- Reembolsos, cancelamentos pós-pagamento e **devoluções físicas** (o site não
  deve criar entrada na Inova automaticamente só porque houve um estorno);
- Coerência entre unidades, códigos de barras, lotes e relógios;
- O que fazer quando a integração ficar indisponível e o alerta ao operador.

## Credenciais e ativação

Variáveis/secrets na Cloudflare Workers: `INOVA_STOCK_ENABLED=false`,
`INOVA_STOCK_TOKEN` (segredo aleatório de ao menos 32 caracteres) e
`INOVA_STOCK_MAX_AGE_MINUTES=15`. A configuração padrão permanece **desativada**
para preservar o site já publicado e o banco de dados do Durable Object.

**Não habilitar** a variável até o conector autorizado estar implementado e
a homologação de compra/baixa/devolução concluída. Quando habilitada sem saldos,
o catálogo fica esgotado por segurança. Nunca publicar tokens no GitHub.

O conector transmite o segredo em `Authorization: Bearer <token>` sobre HTTPS;
respostas não incluem informações de clientes ou credenciais de pagamento.

## Contrato JSON do conector (não é contrato da API do fornecedor)

### 1) Enviar saldos oficiais (POST)

`/webhooks/inovafarma/estoque`

```json
{
  "loteId": "inova-20261021-0001",
  "geradoEm": "2026-10-21T17:10:00.000Z",
  "itens": [
    { "ean": "7891234567890", "quantidade": 12 },
    { "ean": "7891234567891", "quantidade": 0 }
  ],
  "pedidosRefletidos": []
}
```

- Máximo de 500 produtos por lote; EAN com 8 a 14 dígitos, único no site.
- `geradoEm` deve avançar entre lotes (até 60s de tolerância de futuro).
- `loteId` único permite reenvio seguro. Nunca reutilizar identificador para
  lotes diferentes.
- Não zera produtos omitidos: eles ficam indisponíveis quando o próprio snapshot
  envelhecer além do limite.
- Resposta 400/409 rejeita o lote antes de modificar saldos.

### 2) Consultar vendas pagas ainda não confirmadas no ERP (GET)

`/integracoes/inovafarma/vendas/pendentes`

Retorna `{ "ok":true, "vendas":[...] }`, com `pedidoId`, `codigo`,
`aprovadoEm` e `itens` contendo `produtoId`, `ean` e `quantidade`.
Uma venda com EAN ausente precisa de conciliação manual, **não** deve ser
registrada por aproximação do nome.

### 3) Confirmar registro da venda no ERP (POST)

`/webhooks/inovafarma/vendas/confirmar`

```json
{
  "vendas": [
    { "pedidoId": "pedido-1", "referenciaInova": "ID-DA-VENDA-NO-ERP" }
  ]
}
```

A confirmação é idempotente; reutilizar a mesma `referenciaInova` para o mesmo
pedido. Uma referência diferente para pedido confirmado retorna erro.

### 4) Confirmar que o saldo novo já inclui a venda

Envie outro snapshot em `/webhooks/inovafarma/estoque` contendo saldo já
atualizado do(s) produto(s) e:

```json
"pedidosRefletidos": ["pedido-1"]
```

Um pedido só pode ser refletido depois de confirmado e quando todos seus EANs
constarem no snapshot. Isso previne duplicidade de desconto no site.

## Segurança e preservação do projeto

- Não tocar no Worker `site-farmacia-paguepouco`, no binding `LOJA`, na classe
  `LojaDurableObject` ou na identidade `loja-principal-v1`.
- O endpoint nunca recebe ou utiliza credenciais do banco da Inova e não expõe
  banco de dados privado à internet.
- Com `INOVA_STOCK_ENABLED=false`, persistem integralmente os fluxos anteriores
  de estoque/reservas, checkout, Pix e painel.
- Com integração ativa, o formulário de movimentação manual desaparece e a API
  correspondente recusa mutações. A sincronização é a única autoridade para
  quantidades-base.
- Monitorar regularmente fila de vendas e a idade dos snapshots antes de
  habilitar vendas reais pelo novo modelo.

## Validação

```bash
node --test tests/inovafarma-stock.test.js
npm test
npm run test:cloudflare
npm run build
npm run check:cloudflare
```

Os testes locais simulam o conector; **não** constituem homologação no ERP real.
