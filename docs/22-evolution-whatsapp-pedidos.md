# Evolution API v2 — WhatsApp de pedidos (Farmácia Pague Pouco)

## Fluxo
- **Responsável pela separação**: aviso somente quando o pedido passa para **aprovado** em cobrança real Mercado Pago. A mensagem contém o código do pedido e, em pedidos com autorização v2, nomes e quantidades dos produtos salvos no pedido. Não inclui endereço/CPF.
- **Cliente**: recebe `pedido recebido` quando a cobrança é criada com sucesso e, depois, `pagamento confirmado` somente na transição de pendente para aprovado pelo Mercado Pago. As mensagens exigem autorização explícita, sem caixa pré-marcada: no primeiro checkout o cliente escolhe o botão `Finalizar e receber avisos no WhatsApp` (ou `Finalizar sem avisos no WhatsApp`), com texto claro de aceitação para pedidos atuais e futuros. A escolha é salva no cadastro por telefone, registrada para auditoria e pode ser revogada a qualquer momento em `Minha conta → Meus dados → Avisos de pedidos pelo WhatsApp`. Nas próximas compras o opt-in válido é reutilizado sem nova pergunta; ao mudar o telefone exige novo aceite.
- **Sem n8n**, sem alterar InovaFarma V3/V4 ou credenciais Mercado Pago. Nomes de produtos, inclusive medicamentos, só são enviados com autorização v2; código e status seguem disponíveis nos avisos autorizados anteriores.
- Só a Evolution API da instância `instancia` envia mensagens, com número de saída conectado pelo próprio operador à instância.
- Uma fila por evento e pedido evita mensagens repetidas. Como um timeout de rede pode indicar uma mensagem entregue, não há reenvio automático de resultado incerto; o painel exibe `verificar`.
- Nenhum disparo retroativo de pedidos anteriores à ativação.

## Produtos nas mensagens
- Quando autorizados, os produtos do **snapshot do pedido** são incluídos logo após o código entre parênteses: `#PP2026000019 (2x Dipirona 500mg, Shampoo)`. A lista não é consultada em tempo real no catálogo e remove caracteres de controle/formatação.
- O evento `cliente_recebido` agora avisa: "Quando o pagamento for confirmado pelo site (até 10 minutos), seu pedido será enviado para separação!". Este prazo é o texto informativo da loja, não uma confirmação antecipada de pagamento.
- O evento `cliente_pago` mantém a confirmação somente após aprovação real; `responsavel_pago` recebe a mesma lista de itens quando autorizada.
- Consentimentos **versão 1** prometiam não divulgar nomes de medicamentos: continuam enviando código e status sem nomes. Após autorização explícita atualizada pelo checkout ou em `Meus dados`, salva-se `versao:2`, permitindo a lista em novos pedidos. O atendimento e o fluxo de pagamento continuam funcionando mesmo sem essa autorização.
- Não armazenar dados clínicos no log do provedor; a fila apaga o corpo após a tentativa de envio.

## Conexão simplificada na Farmácia Pague Pouco

O superadministrador acessa `/admin/evolution-whatsapp` e preenche **somente**
o nome da instância exclusiva da farmácia e o WhatsApp que recebe pedidos pagos.
Depois de **Salvar configurações**, clica em **Conectar WhatsApp / Gerar QR Code**
e lê o QR pelo WhatsApp da farmácia em **Aparelhos conectados**.
A tela mostra conectado, conectando ou desconectado.

O botão cria automaticamente a instância, caso ainda não exista, usando a integração
`WHATSAPP-BAILEYS`, ou reutiliza a instância existente sem apagá-la.
A instância conectada determina o número remetente, sem precisar digitá-lo.
Nunca compartilhar o mesmo nome de instância com TIGU, Odonto ou outros projetos.

### Configuração única na Cloudflare

No Worker existente `site-farmacia-paguepouco`, em **Configurações → Variáveis
e segredos**, configurar:

- `EVOLUTION_API_URL` — URL HTTPS da Evolution v2 instalada na VPS, sem
  `/manager`, sem barra final; preferir segredo/variável de servidor.
- `EVOLUTION_API_KEY` — segredo da chave autorizada na Evolution API.

Se já existir uma URL antiga salva no banco, ela é mantida como alternativa para
não interromper o envio; entretanto, a variável de servidor tem prioridade.
A chave sempre fica no Worker. **Não** colocar URL ou chave no formulário nem
em JavaScript ou repositório; cada Worker tem seus próprios bindings.

A geração de QR Code e a consulta de estado são restritas à sessão do superadmin,
a resposta não inclui chave nem credenciais e o POST do QR exige CSRF.

Para conferir, depois de conectar e ativar os avisos, fazer um pedido controlado
e verificar os eventos no Histórico seguro. Não deve haver envios retroativos
nem interferência em Mercado Pago, robô InovaFarma ou botão de atendimento.

## Regras técnicas
- Envios via `POST {EVOLUTION_API_URL}/message/sendText/{instancia}`, `apikey` no cabeçalho e corpo `{number,text}`. A URL antiga é fallback para preservar a conexão.
- O Worker persiste o evento e marca a tentativa antes de chamar a rede; respostas do provedor não são gravadas integralmente nem expostas ao cliente.
- O processamento do WhatsApp nunca deve abortar a confirmação do pedido ou os webhooks de pagamento.
- **Segurança:** URL configurável restrita a HTTPS com host público; não são aceitas URLs localhost/IP literal. Em produção, a resolução DNS do endpoint deve apontar para infraestrutura de confiança.
- Se a API não estiver instalada, desconectada ou chave ausente, os avisos automáticos não funcionarão; o pedido/checkout permanecem normais.
- Utilizar somente mensagens operacionais, com opção voluntária do cliente. Revisar política de privacidade e finalidade de tratamento antes de ativar.
- Endpoint da Evolution v2: https://github.com/evolution-foundation/evolution-docs/blob/main/docs/05-Endpoints/00-send-plain-text.md

## Testes
`node --test tests/evolution-whatsapp.test.js tests/evolution-connection.test.js`

## Proteção do aceite
- A opção de WhatsApp não é obrigatória para comprar. O botão `Finalizar sem avisos no WhatsApp` finaliza o mesmo checkout normalmente.
- Somente clique explícito em `Finalizar e receber avisos no WhatsApp` ou autorização voluntária em `Meus dados` ativa a preferência. Não basta fornecer telefone, aceitar Termos ou ter marcado marketing.
- Aceite salvo no cliente com telefone normalizado e data de aceite; quando o número muda, o consentimento anterior não é reutilizado.
- O cliente pode revogar em `Meus dados`; pagamentos, pedidos, histórico e outras funcionalidades permanecem.
- Mensagens anteriores não são geradas retroativamente ao ativar ou desativar a preferência.
