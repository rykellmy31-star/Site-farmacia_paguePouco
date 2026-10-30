# Evolution API v2 — WhatsApp de pedidos (Farmácia Pague Pouco)

## Fluxo
- **Responsável pela separação**: aviso somente quando o pedido passa para **aprovado** em cobrança real Mercado Pago. A mensagem contém código do pedido, não produtos/endereço.
- **Cliente**: recebe `pedido recebido` quando a cobrança é criada com sucesso e, depois, `pagamento confirmado` somente na transição de pendente para aprovado pelo Mercado Pago. As mensagens exigem autorização explícita, sem caixa pré-marcada: no primeiro checkout o cliente escolhe o botão `Finalizar e receber avisos no WhatsApp` (ou `Finalizar sem avisos no WhatsApp`), com texto claro de aceitação para pedidos atuais e futuros. A escolha é salva no cadastro por telefone, registrada para auditoria e pode ser revogada a qualquer momento em `Minha conta → Meus dados → Avisos de pedidos pelo WhatsApp`. Nas próximas compras o opt-in válido é reutilizado sem nova pergunta; ao mudar o telefone exige novo aceite.
- **Sem n8n**, sem alterar InovaFarma V3/V4, sem alterar credenciais Mercado Pago, sem enviar dados de medicamentos no WhatsApp.
- Só a Evolution API da instância `instancia` envia mensagens, com número de saída conectado pelo próprio operador à instância.
- Uma fila por evento e pedido evita mensagens repetidas. Como um timeout de rede pode indicar uma mensagem entregue, não há reenvio automático de resultado incerto; o painel exibe `verificar`.
- Nenhum disparo retroativo de pedidos anteriores à ativação.

## Para concluir a configuração (Cloudflare produção)
1. No painel da Evolution API v2 já hospedada, crie uma **instância exclusiva** para a farmácia e conecte o número da farmácia via WhatsApp.
2. Em Cloudflare, abra o Worker existente `site-farmacia-paguepouco` → **Configurações** → **Variáveis e segredos**. Crie um **segredo** chamado `EVOLUTION_API_KEY` com a chave autorizada na Evolution API. Não compartilhe a chave pelo chat nem armazene no repositório ou no campo de URL.
3. Na loja, faça login como Superadmin e abra **/admin/evolution-whatsapp** ou acesse o botão a partir de **/admin/whatsapp**.
4. Informe **URL HTTPS pública da Evolution** (sem `/manager`), **nome exato da instância**, **número que envia** (deve ser o mesmo conectado na Evolution) e **número que recebe** (separador de pedidos). Marque avisos internos e/ou ao cliente.
5. Marque **Ativar notificações automáticas** e salve. Faça um pedido real **de teste controlado**, autorize o opt-in, pague e confira os três avisos no painel/histórico: cliente no recebimento, cliente no pagamento e responsável no pagamento. Não realizar pagamento de teste no ambiente de produção apenas para verificar configuração sem autorização.
6. O frontend não grava nem exibe o segredo. Uma instância separada do TIGU impede que os números e as mensagens se misturem.

## Regras técnicas
- Envios via `POST {baseUrl}/message/sendText/{instancia}`, `apikey` no cabeçalho e corpo `{number,text}`.
- O Worker persiste o evento e marca a tentativa antes de chamar a rede; respostas do provedor não são gravadas integralmente nem expostas ao cliente.
- O processamento do WhatsApp nunca deve abortar a confirmação do pedido ou os webhooks de pagamento.
- **Segurança:** URL configurável restrita a HTTPS com host público; não são aceitas URLs localhost/IP literal. Em produção, a resolução DNS do endpoint deve apontar para infraestrutura de confiança.
- Se a API não estiver instalada, desconectada ou chave ausente, os avisos automáticos não funcionarão; o pedido/checkout permanecem normais.
- Utilizar somente mensagens operacionais, com opção voluntária do cliente. Revisar política de privacidade e finalidade de tratamento antes de ativar.
- Endpoint da Evolution v2: https://github.com/evolution-foundation/evolution-docs/blob/main/docs/05-Endpoints/00-send-plain-text.md

## Testes
`node --test tests/evolution-whatsapp.test.js`

## Proteção do aceite
- A opção de WhatsApp não é obrigatória para comprar. O botão `Finalizar sem avisos no WhatsApp` finaliza o mesmo checkout normalmente.
- Somente clique explícito em `Finalizar e receber avisos no WhatsApp` ou autorização voluntária em `Meus dados` ativa a preferência. Não basta fornecer telefone, aceitar Termos ou ter marcado marketing.
- Aceite salvo no cliente com telefone normalizado e data de aceite; quando o número muda, o consentimento anterior não é reutilizado.
- O cliente pode revogar em `Meus dados`; pagamentos, pedidos, histórico e outras funcionalidades permanecem.
- Mensagens anteriores não são geradas retroativamente ao ativar ou desativar a preferência.
