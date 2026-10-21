# Integração InovaFarma — painel de preparação e horários da loja

## Entregue sem ativar o ERP

A aba **Integração InovaFarma** aparece para o Super Administrador.
Administradores com permissão `inovafarma.ver` podem apenas consultar o estado
e indicadores, sem receber URL privada, identificador de estabelecimento,
formulários de alteração ou estado detalhado do cofre.
Somente `super_admin` pode editar configurações ou credenciais, mediante sessão
autenticada, POST e CSRF. Ações são auditadas sem valores sensíveis.

**Conexão**: cadastro persistido de URL HTTPS pública do fornecedor (apenas
informativo), identificador de estabelecimento e intervalo planejado de
5/15/30/60 minutos. O método de autenticação fica
`aguardando_documentacao`. Nunca é executado `fetch` para URL digitada
no painel. Não são aceitas URLs locais, IPs, credenciais embutidas, outras
portas ou query strings. A validação não transforma qualquer URL em
endpoint de rede autorizado.

**Credencial**: só pode ser armazenada com Secret do Worker
`INOVA_CREDENTIALS_KEY` (texto aleatório com no mínimo 32 caracteres),
separado de `MP_CREDENTIALS_KEY`. O cofre aplica HKDF SHA-256 com salt
e contexto Inova próprio, seguido por AES-256-GCM com IV aleatório e AAD.
A credencial cifrada fica na coleção privada `inovaSecrets`, que é
excluída da exportação operacional do CloudStore. O token não é exibido
nem registrado em auditoria e não é consumido por um conector.
Não insira valor real sem orientação oficial da Precisão Sistemas.

**Sincronização**: status real com base nos metadados persistidos por
`inovaStockSync`/`inovaSyncMeta`, EAN, diferenças identificáveis entre
saldos existentes e dados defasados. Sem registros, o painel informa
que ainda não houve sincronização; NÃO mostra um teste simulado como
conexão bem-sucedida.

**Vendas**: mostra apenas itens já sinalizados pelo fluxo existente como
`inovaEnvioPendente`, além de histórico, confirmação e necessidade de EAN.
A interface jamais envia pedidos. Dados de vendedor histórico mantêm o
código com zeros à esquerda e o envio real deverá respeitar o contrato
oficial e a idempotência.

**Ações indisponíveis**: testar conexão, sincronizar agora e ativar integração
estão explicitamente desabilitadas, sem handlers falsos. Envio/reenvio
automático, baixa oficial, sincronização de saldos e verificação real de
conexão são bloqueados até documentação, homologação e autorização
explícita `INICIAR INTEGRAÇÃO INOVA`.

O parâmetro de produção **`INOVA_STOCK_ENABLED=false`** permanece
inalterado; o novo painel não tem rota para ativá-lo.

## Horário da loja

`formatDate` e `formatDateTime` passam a usar explicitamente
`America/Bahia` em todo HTML que compartilha a formatação.
Exemplo: `2026-10-21T17:21:00Z` aparece como `21/10/2026 14:21`,
inclusive em Cloudflare, independentemente do fuso UTC do servidor.
Os instantes ISO gravados no banco continuam em UTC para manter
auditoria, idempotência e ordenação corretas. Datas puras no formato
`YYYY-MM-DD` preservam a data sem aplicar deslocamento horário.

## Pendências obrigatórias

- Receber documentação técnica da Precisão Sistemas e endpoints homologados
- Definir e validar autenticação, empresa, eventos, limites e retries oficiais
- Aprovar contrato de integração e homologar recebimentos sem duplicação
- Validar compensação de estoque, cancelamentos e estornos em ambiente separado
- Conectar rotinas reais somente após autorização expressa e testes em staging
