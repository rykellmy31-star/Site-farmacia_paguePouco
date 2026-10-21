# Vendedores — Farmácia Pague Pouco 2

## Operação imediata

No painel administrativo, abra **Vendedores**. O Super Administrador e
o papel Administrador podem cadastrar, editar, ativar/desativar e consultar.
Gerente apenas visualiza; operador, atendente e usuários públicos não
administram cadastros. Todas as rotas possuem checagem server-side, CSRF
e auditoria de criação/edição/alteração de situação.

Campos obrigatórios: nome e código textual interno InovaFarma. Por
exemplo, `00125` permanece `00125`, sem conversão numérica. Códigos
duplicados são rejeitados (inclusive variação entre maiúsculas/minúsculas).
Não existe operação de exclusão permanente; desative o registro.

Somente vendedores ativos aparecem no checkout. Se houver pelo menos um,
a escolha é obrigatória, verificada novamente no servidor antes de reservar
estoque ou criar cobrança. Se não houver nenhum ativo, a loja utiliza
**atendimento geral**, sem enviar ou inventar código InovaFarma.
O formulário só transmite o ID interno e não pode definir livremente
nome ou código. O pedido salva snapshot de `id`, `nome`, `codigoInova`;
edições futuras não alteram vendas históricas.

O cliente vê apenas o nome profissional na confirmação e no pedido. A
administração pode consultar o código interno e filtrar pedidos pelo vendedor.
Métricas de pedidos/total por vendedor incluem somente
`statusFinanceiro=aprovado` e excluem pedidos cancelados, estornados ou
com estorno solicitado. Não há cálculo de comissão.

## Preparação da integração futura

A fila interna `vendasPendentesInova` só é criada pelo fluxo existente
quando a integração autorizada estiver ligada. O envelope de preparação
pode conter `chaveIdempotencia`, `codigo`, `criadoEm`,
`vendedor.codigoInova` como **string**, valores em centavos, e produtos com
EAN/quantidade/preço/subtotal. Trata-se de modelo **interno** — não é
payload confirmado pela Precisão Sistemas e não implica que o ERP aceite
esses campos. Descontos globais não são rateados nos itens até que
a documentação oficial defina o método correto.

**NÃO ATIVAR `INOVA_STOCK_ENABLED`.** A InovaFarma continua sem
comunicação real: nenhum endpoint novo, baixa remota, alteração no ERP,
token compartilhado ou chamada externa foi implementado.

Integração real, estoque mestre, devoluções e idempotência externa
permanecem dependentes da documentação oficial, ambiente de homologação e
autorização explícita **INICIAR INTEGRAÇÃO INOVA**.

## Dados de produção

A coleção `sellers` começa vazia na loja real. Não há vendedor de exemplo
criado por seed ou migração e não são alterados Durable Objects, arquivos
de configuração Cloudflare, APIs Pix ou preços.
