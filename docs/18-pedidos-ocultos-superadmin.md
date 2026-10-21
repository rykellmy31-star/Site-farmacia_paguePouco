# Pedidos ocultos para o cliente (Super Administrador)

A ação de lixeira **não exclui o pedido do banco** nem o pagamento e as
movimentações. Ela só arquiva a exibição: a conta do cliente, a listagem
Meus pedidos, a URL de detalhe e a URL de confirmação do checkout
deixam de exibir aquele pedido.

## Onde usar

- **Painel → Pedidos**: lixeira 🗑️ ao lado de `Abrir` para pedidos elegíveis.
- **Pedidos → Filtro → Pedidos ocultos**: permite consultar os pedidos
  arquivados e clicar **Restaurar**. Disponível só para o Super Administrador.
- A ação exige POST com CSRF e confirmação visual.
- Todas as ocultações/restaurações são gravadas em `auditLogs`.

## Critérios de segurança

Só é possível ocultar pedidos cujo status financeiro seja **recusado**,
**expirado** ou **estornado** (estorno confirmado). Solicitação de estorno,
pendência de conciliação financeira, pagamento aprovado/pendente, entrega em
separação, expedição, entregue ou devolução pendente BLOQUEIAM ocultação.
Isso impede que um pedido pago em andamento desapareça do cliente.

O registro original permanece em `orders` com
`ocultoDoClienteEm` e `ocultoDoClientePor`. O sistema não chama API de
pagamentos e nunca apaga `payments`, produtos, históricos, reservas ou
movimentações. Os relatórios de faturamento e exportações contábeis
continuam contando os pedidos ocultos — trata-se de arquivamento visual.

Não ocorrerá ocultação automática nem migração destrutiva de pedidos
existentes. O histórico pode ser restaurado pelo Super Administrador.
