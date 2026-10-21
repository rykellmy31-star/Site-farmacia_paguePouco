# Auditoria financeira, conciliação e preparação para homologação

Este documento acompanha o Pull Request #1. **Não faz autorização de deploy, merge ou movimentação financeira.**

## Correções implementadas nesta branch

- O painel utiliza `settings.pagamentos` como chave canônica. A leitura de `settings.payments` continua como compatibilidade e `ensureSettings` faz migração não destrutiva se a chave nova estiver ausente.
- A seleção Mercado Pago sem credenciais **não** cai silenciosamente no provedor fictício. Pagamentos reais em cartão continuam **indisponíveis** até a integração de tokenização oficial no navegador ser implementada e homologada.
- O fechamento recalcula frete, subtotal, cupons, mínimo, desconto Pix e parcelas no servidor. Falha definitiva ao criar cobrança libera a reserva; timeout com resultado indeterminado preserva pedido e reserva para conciliação.
- Cancelamento não implica estorno. Pedidos pagos requerem estorno aprovado no provedor antes do cancelamento; confirmação pendente usa status `estorno_solicitado`. Não existe entrada física automática no estoque.
- Movimentações de saída/liberação usam o vínculo pedido–produto e verificam disponibilidade e idempotência. Webhooks atrasados não reativam pedidos já cancelados.
- Webhook Mercado Pago exige assinatura HMAC quando configurada, obtém a cobrança pela API autenticada e confere valor em centavos, moeda BRL, ID do pagamento, referência externa e pedido; conteúdo recebido do navegador nunca é confirmação.
- Consulta de status Pix por API autenticada valida os mesmos vínculos. Conciliação recorrente verifica cobranças pendentes, aprova ou expira somente conforme status confirmado do provedor, liberando a reserva uma única vez.
- Em Cloudflare, `LojaDurableObject` agenda alarmes a cada cinco minutos enquanto houver Pix pendente. A fila serial existente protege contra execução concorrente. Falha de rede não expira nem libera uma cobrança real arbitrariamente. Confirmar uso de franquia e eventuais custos de alarms **antes** de qualquer deploy.
- O servidor Node não tenta encerrar novamente uma resposta que já está sendo servida por stream estático.

## Validação

Pipeline de PR sem acesso a segredos: `node --test tests/payment-safety.test.js tests/pix-reconciliation.test.js`, `npm test`, `npm run test:cloudflare`, `npm run build` e `npm run check:cloudflare` (dry-run, **sem** publicação).

Os testes e os mocks validam a lógica, mas não autorizam anunciar vendas reais. Não houve cobrança, estorno, entrega de e-mail nem acesso à operação da farmácia.

## Pendências bloqueantes de uso comercial

1. **Cartões:** implementar componente oficial Mercado Pago no navegador e tokenização, sem armazenar dados sensíveis, e validar Pix, cartão, parcelamento, juros, estornos e idempotência com credenciais da farmácia e homologação externa.
2. **E-mail:** Worker ainda não envia mensagens externas; a fila interna não é entrega real. Conectar serviço transacional compatível com Workers somente depois de validar plano/franquia, autorização e credenciais. Recuperação por e-mail fica bloqueada até isso.
3. **Pedidos em conciliação:** falhas de rede que deixem status desconhecido exigem ação operacional e mecanismo de resolução segura com o provedor; não liberar estoque nem simular aprovação.
4. **Backup/restauração:** falta solução verificável de backup completo com mídias e recuperação transacional pelo painel; nunca restaurar dados reais automaticamente.
5. **Comercial e sanitário:** validar dados cadastrais, políticas, estoque real, medicamentos, permissões do responsável técnico, dados pessoais, identidade visual em celular/computador e entrega.
6. **GitHub público:** há cadastros ilustrativos versionados em `data/db/admins.json` e `data/db/customers.json`, incluindo hashes de senha e campos pessoais. Verificar se existem dados reais ou credenciais reutilizadas (inclusive no ZIP e no histórico) e revogar/rotacionar segredos eventualmente expostos. Excluir arquivo da versão atual NÃO remove versões do histórico.
7. **Cloudflare:** homologar durabilidade, alarmes e despesas/franquia no ambiente de implantação. Não mudar `LOJA`, `LojaDurableObject` ou `loja-principal-v1` sem migração planejada.

## Inova Farma — fontes oficiais/localizadas

- Central oficial de downloads: https://download.inovafarma.com.br/ informa utilitário `InovaFarmaService` e um pacote `API InovaFarma 4.0.13`.
- Precisão Sistemas: https://www.inovafarma.com.br/
- Há parceiros com integrações de comércio eletrônico, mas não foram confirmados contrato, documentação de endpoints, autorização, versão instalada ou mapeamento de produtos/vendas aplicável a **esta** farmácia.

**Não** escrever diretamente no banco local do Inova Farma, publicar o banco na internet ou inventar API. Antes de desenvolver o conector, obter do fornecedor a documentação e as condições oficiais (consulta de produtos/EAN, estoque, preços, venda, cancelamento, devolução, autenticação, idempotência e necessidade do serviço local). Implementar fila de saída e conciliação sem baixa dupla somente após confirmação.

## Liberação de produção

Pendente de autorização específica do responsável do projeto. Este PR deve permanecer em rascunho; não fazer merge na main nem deploy automaticamente.
