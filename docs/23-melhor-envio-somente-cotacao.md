# Melhor Envio — integração exclusiva de COTAÇÃO

Objetivo: exibir preços/prazos reais dos transportadores para CEPs diferentes do CEP da farmácia.
**Nenhuma etiqueta é criada, nenhum frete é comprado e nenhum saldo da conta Melhor Envio é utilizado.**

## Segurança e ativação

1. Criar aplicativo no Melhor Envio, em **Integrações → Área Dev.**, e solicitar apenas o escopo `shipping-calculate` (cotação). A autenticação OAuth2 deve fornecer um token válido. Os tokens expiram: renove-os pelo fluxo oficial; a troca deve ser feita em segredo, nunca em conversa ou código.
2. Configurar em Cloudflare Workers → Worker oficial → **Configurações → Variáveis e segredos**:
   - `MELHOR_ENVIO_TOKEN`: segredo (Bearer token real, **nunca** colar no GitHub ou em mensagens).
   - `MELHOR_ENVIO_CONTATO_EMAIL`: email técnico real da farmácia/projeto, exigido no User-Agent.
   - `MELHOR_ENVIO_SANDBOX`: opcional, `true` apenas para teste; produção usa `false`.
3. Cadastrar CEP da sede em Configurações → Empresa e, para cada produto vendido, **peso (kg), altura, largura e comprimento (cm)** medidos corretamente.
4. Em **Painel → Fretes**, use primeiro **Testar cotação** (CEP diferente do da farmácia). O teste utiliza 1 pacote ilustrativo de 500 g, 20 × 15 × 10 cm, sem comprar etiqueta. Com retorno válido, marque **Ativar somente consulta Melhor Envio** e salve. A cotação permanecerá desligada até essa ativação.
5. Validar cenários de mesmo CEP (retirada + entrega local), CEP diferente (transportadoras reais), indisponibilidade, item sem peso/dimensões e mudança de preço entre as telas.

## Comportamento

- CEP igual ao da sede: funciona como antes (entrega local ou retirada); sem chamada ao Melhor Envio.
- CEP diferente e recurso desligado: frete fixo atual da loja, sem mudanças.
- CEP diferente e recurso ligado: **POST exclusivamente para `/api/v2/me/shipment/calculate`**, com origem/destino e produtos; retorna `custom_price` e `custom_delivery_time` quando disponíveis. O valor selecionado é recalculado na confirmação do endereço, na tela de pagamento e antes de criar o pedido. Em caso de alteração, exige nova cotação; não muda silenciosamente o valor cobrado.
- Se faltar medida real, token ou a API falhar, o sistema **não inventa tarifa** e bloqueia a finalização até regularização.
- Bloqueios já existentes para itens/categorias com restrição de transporte continuam aplicados. Retorno do provedor não substitui avaliação sanitária.
- Política de frete grátis/cupom permanece aplicada ao preço cobrado ao cliente.

## Limites da integração

Nenhum endpoint de cart, checkout, etiquetas, compra, rastreio ou agendamento no Melhor Envio está implementado. A **cotação não garante contratação da transportadora**: a farmácia continuará responsável por viabilizar a entrega real por procedimento próprio.

Documentação: https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos

## Observações operacionais

- Tokens OAuth2 de acesso têm validade de cerca de 30 dias, e o refresh token de 45 dias (consulte o painel e a documentação vigente do provedor). A versão com segredo manual exige atualizar `MELHOR_ENVIO_TOKEN` quando vencer. A renovação OAuth automática **não está implementada**.
- O botão **Testar cotação** não habilita a integração nem cria despesa; a conta real precisa ter serviços autorizados no Melhor Envio. Nenhuma credencial é enviada ao navegador.
- Cotação não implica que a transportadora aceite o medicamento. Verifique restrições, autorizações sanitárias e embalagem apropriada antes da postagem.
- Após ativação, o checkout distingue claramente a cotação dinâmica da tabela fixa; se a API falhar, a compra não recebe um frete de valor inventado.

## Autorização OAuth2 no domínio oficial (novembro de 2026)

O retorno do cadastro do aplicativo no Melhor Envio é
`https://site.farmaciapaguepouco.app/admin/melhor-envio/callback`.
Use essa URL **exatamente** na URL de redirecionamento (callback). O próprio
Melhor Envio informa que o campo URL do ambiente para testes pode receber
a mesma URL de callback. Cadastre o app na produção para esta loja.

Configurar no Worker via **Secrets**, jamais no git, em logs ou em conversas:
- `MELHOR_ENVIO_CLIENT_ID` — ID do aplicativo fornecido na Área Dev.
- `MELHOR_ENVIO_CLIENT_SECRET` — segredo do aplicativo fornecido na Área Dev.
- `MELHOR_ENVIO_CREDENTIALS_KEY` — chave aleatória de 32+ caracteres, exclusiva.
- `MELHOR_ENVIO_CONTATO_EMAIL` — e-mail técnico do aplicativo.

Depois disso, a equipe acessa **Painel → Fretes → Conectar conta Melhor Envio**,
autoriza somente `shipping-calculate`, recebe retorno no callback e testa a
cotação. Os tokens ficam cifrados no banco e renovam automaticamente sob
demanda. A cotação para clientes ainda deve ser ativada manualmente. Um
botão no painel permite desconectar; isso remove os tokens e desativa a cotação.

Se `MELHOR_ENVIO_CREDENTIALS_KEY` for perdida, os dados cifrados não poderão
ser recuperados e será necessária nova autorização. Não ative os serviços de
etiquetas/checkout, que não estão implementados.
