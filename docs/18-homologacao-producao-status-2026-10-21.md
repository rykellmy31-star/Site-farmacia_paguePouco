# Homologação de produção — estado observado em 21/10/2026 (BRT)

Este registro substitui **somente** as afirmações antigas sobre disponibilidade da Cloudflare nas notas de pendências; não certifica 100% e não altera os demais documentos. Sem dados de clientes, credenciais ou pagamentos reais.

## Evidências verificadas

- Código `main`: `e3ccdd700d97627edfbc62ece2b6bc1d62c68761` (PR #54).
- Cloudflare Workers Builds para esse commit: **success** (GitHub check).
- CI da alteração (run 39708759134): **success**, incluindo testes de fluxo de checkout/Pix simulados, integração, navegador responsivo, componentes Worker e `wrangler dry run`.
- Smoke da execução: `/__health` HTTP 200, página inicial HTTP 200, painel não autenticado HTTP 303, caminho privado HTTP 404, asset de banner HTTP 200. Não houve escrita em produção.
- Auditoria API Cloudflare somente leitura nessa execução: Worker `site-farmacia-paguepouco` encontrado, `LOJA` e `ASSETS` presentes, deployment existente e HTTPS funcional.
- Consulta GET adicional ao site confirmou `{"ok":true,"runtime":"cloudflare-workers","storage":"durable-object-sqlite"}` e a página inicial navegável.

## Pendências necessárias para 100% — NÃO marcar como aprovadas

| Teste | Estado | Critério para aprovação |
| --- | --- | --- |
| URL pública explicitamente configurada | **PENDENTE** | Configurar `PUBLIC_BASE_URL=https://site.farmaciapaguepouco.app` no Worker existente e auditar novamente |
| Backup/restauração com dados reais | **PENDENTE** | Exportar snapshot e mídias privadamente, verificar hashes, fazer restauração isolada e documentar sucesso; definir retenção e backup externo protegido |
| Pix e estorno Mercado Pago reais | **PENDENTE** | Compra autorizada de baixo valor; confirmar crédito, recebimento/assinatura do webhook, reconciliação de pedido e estorno com nova conciliação, sem divulgação de dados |
| E-mail transacional | **PENDENTE** | Serviço/remetente configurado; envio e recebimento reais de mensagens de teste |
| InovaFarma | **PENDENTE** | Contrato/API disponível, autorização do proprietário e testes autenticados de importação, saldos, baixa/estorno e divergência de ERP |
| Homologação admin/comprador com conta de teste | **PENDENTE** | Navegação, banners, carrinho, cupom, frete, pedidos, devolução, estoque e painel com conta autorizada e dados fictícios |
| Sanitário, jurídico e LGPD | **VALIDAÇÃO HUMANA NECESSÁRIA** | Farmacêutico e responsáveis legais revisam catálogo, publicidade, receitas, política de privacidade, condições de venda e operação |

## Limites de segurança

- Não criar Worker, D1 ou banco alternativo: preservar `LOJA` / `LojaDurableObject` / `loja-principal-v1`.
- Não cadastrar secret no GitHub público; não expor token, backup, CPF, pedidos ou logs privados.
- Não afirmar que um CI com mocks comprova recebimento real de dinheiro.
- Não ativar InovaFarma nem realizar pagamento, estorno, download de dados de clientes ou restore remoto sem validação apropriada.
- O arquivo antigo `docs/06-pendencias-bloqueios.md` contém itens históricos de infraestrutura pré-Cloudflare; ele **não** reflete sozinho a situação atual.

## Próxima ação desbloqueadora

Usar sessão Cloudflare autorizada para cadastrar `PUBLIC_BASE_URL` (Plaintext) no Worker existente e confirmar a variável. Para logs Workers Builds, o token de auditoria requer `Workers CI Read`; o acesso de leitura geral já está funcionando. Depois executar testes de backup isolado e transações de teste com autorização explícita.
