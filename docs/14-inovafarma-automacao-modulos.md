# Automação condicional dos módulos 2 a 7 — InovaFarma

## O que já é automático (quando autorizado e operacional)

A integração de vendas online da Precisão Sistemas é uma integração autorizada
por API ou Views, com liberação contratual no Portal PS. Ela NÃO nasce apenas
do preenchimento de URL e token. A documentação pública descreve mix de
produtos, recebimento de vendas no caixa, aviso de vendas pendentes e relatórios,
mas não fornece um contrato universal de API para a instalação específica.

Uma vez instalado e homologado o **conector oficial**, e ativado explicitamente
`INOVA_STOCK_ENABLED`, o site está pronto para receber eventos autenticados:

1. **Módulo 2 — estoque**: ingestão automática dos saldos absolutos
   por EAN enviados pelo conector homologado. O site usa o saldo oficial menos
   reservas e vendas ainda não refletidas. Sem saldos recentes, impede novas
   vendas afetadas.
2. **Módulo 3 — vendas**: a aprovação financeira enfileira o pedido.
   O conector externo consulta a fila autenticada e registra a venda no ERP
   conforme contrato oficial. Apenas vendas aprovadas, sem cancelamento,
   entram na lista de transmissão. Estornos e cancelamentos permanecem
   pendentes de conferência em vez de serem enviados como receita.
3. **Módulo 4 — vendedores**: código e nome são preservados no pedido e
   incluídos na fila, mantendo `00125` como string.
4. **Módulo 5 — monitoramento**: uma resposta autenticada e aceita atualiza
   a última comunicação, os contadores e eventos. Alarmes do Durable Object
   verificam periodicamente a idade do estoque, EANs e exceções quando
   `INOVA_STOCK_ENABLED=true`.
5. **Módulo 6 — histórico/fila**: exibidos a partir dos dados persistidos,
   sem registrar nomes/CPFs de clientes na telemetria.
6. **Módulo 7 — diagnósticos**: históricos de eventos validados, com
   limite de 100 ocorrências, estados e alertas automáticos. Sem credenciais
   ou corpos de webhook nos registros.

A confirmação de venda é idempotente por pedido e referência ERP. A mesma
referência não pode ser atribuída a outro pedido. A confirmação de cadastro
ERP NÃO é confundida com a confirmação de baixa no estoque: esta última só
acontece após um snapshot oficial que contenha o pedido refletido.

## O que permanece dependente da Precisão Sistemas

**O site não conhece o endpoint nem o protocolo homologado do fornecedor.**
Logo, a URL cadastrada na seção 1 continua inerte: não executa requests
externos. Ainda é necessária a implementação e validação do adaptador
oficial que obtém os estoques, leva os pedidos ao ERP e encaminha as
confirmações ao site. Não existe função segura que adivinhe os métodos e
permissões do ERP.

A configuração do Secret `INOVA_CREDENTIALS_KEY` apenas permite armazenar
segredo criptografado. Não prova autenticação nem habilita integração.
`INOVA_STOCK_ENABLED=false` permanece o padrão e não é alterado
automaticamente pelo painel.

**Checklist para ativação futura, somente após 'INICIAR INTEGRAÇÃO INOVA':**
- Módulo de vendas online contratado/liberado no Portal PS;
- API/Views e documentação específica fornecidas pelo fornecedor;
- Identidade/autenticação/servidor autorizado confirmado;
- Ambiente homologado com estoque e produtos reais de teste sem efeitos
  na produção;
- Testes de criação, repetição idempotente, estorno, devolução e
  sincronização de estoque com ordem confirmada;
- Ativação deliberada pelo responsável da farmácia.

Referências oficiais:
- https://conhecimento.atlassian.net/wiki/spaces/BDC/pages/18907864
- https://conhecimento.atlassian.net/wiki/spaces/BDC/pages/48857108

Não muda Cloudflare bindings, pagamentos reais, Durable Objects, nem
restaura ou recria o banco de produção.
