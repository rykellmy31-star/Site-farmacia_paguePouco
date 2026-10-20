# Testes e resultados — Farmácia Pague Pouco

**Execução:** 20/10/2026, 17:17:07  
**Resultado:** 69/69 testes aprovados — todos aprovados

> Estes testes sobem o servidor real em uma pasta de dados temporária (`.tmp-teste`),
> semeiam os dados de desenvolvimento e executam requisições HTTP reais.
> Não são testes simulados: cada item abaixo foi executado de fato.

| # | Área | Teste | Resultado | Detalhes |
|---|------|-------|-----------|----------|
| 1 | Site público | Home carrega com identidade da farmácia | ✅ Aprovado | HTTP 200 |
| 2 | Site público | Menu de departamentos exibe as categorias | ✅ Aprovado | 16 departamentos |
| 3 | Site público | Página de categoria lista produtos | ✅ Aprovado | ok |
| 4 | Site público | Página de produto exibe dados e aviso sanitário obrigatório | ✅ Aprovado | id mvgy47ts… |
| 5 | Site público | Medicamento controlado é exibido, mas BLOQUEADO para venda | ✅ Aprovado | bloqueado conforme RDC 44/2009 |
| 6 | Site público | Medicamento sem aprovação do farmacêutico fica bloqueado | ✅ Aprovado | aguardando responsável técnico |
| 7 | Site público | Busca encontra produtos por termo | ✅ Aprovado | ok |
| 8 | Site público | Página de ofertas responde | ✅ Aprovado | ok |
| 9 | Site público | Páginas institucionais estão publicadas (14 páginas) | ✅ Aprovado | 14/14 publicadas |
| 10 | Site público | Sitemap XML e robots.txt são gerados | ✅ Aprovado | ok |
| 11 | Site público | Página inexistente retorna 404 | ✅ Aprovado | HTTP 404 |
| 12 | Site público | Botão flutuante do WhatsApp usa o link oficial wa.me | ✅ Aprovado | wa.me/5573000000000 |
| 13 | Site público | CSS principal e JS do site são servidos | ✅ Aprovado | ok |
| 14 | Cadastro, login e recuperação de senha | Cadastro de novo cliente cria sessão | ✅ Aprovado | conta criada |
| 15 | Cadastro, login e recuperação de senha | Área do cliente exige autenticação (redireciona) | ✅ Aprovado | protegido |
| 16 | Cadastro, login e recuperação de senha | Login com senha incorreta é recusado | ✅ Aprovado | recusado |
| 17 | Cadastro, login e recuperação de senha | Login com senha correta autentica | ✅ Aprovado | autenticado |
| 18 | Cadastro, login e recuperação de senha | Cadastro com e-mail duplicado é bloqueado | ✅ Aprovado | bloqueado |
| 19 | Cadastro, login e recuperação de senha | Recuperação de senha gera link válido e permite redefinir | ✅ Aprovado | senha redefinida e sessões anteriores encerradas |
| 20 | Cadastro, login e recuperação de senha | Cliente cadastra endereço de entrega | ✅ Aprovado | endereço salvo |
| 21 | CEP, frete por estado e carrinho | Autenticação do Super Administrador no painel | ✅ Aprovado | sessão ativa |
| 22 | CEP, frete por estado e carrinho | Identificação de UF por CEP (4 estados diferentes) | ✅ Aprovado | 45830000→BA, 01001000→SP, 90010000→RS, 70040000→DF |
| 23 | CEP, frete por estado e carrinho | Adicionar produto ao carrinho | ✅ Aprovado | 2 unidades na cesta |
| 24 | CEP, frete por estado e carrinho | Bloqueio de venda de medicamento controlado na API | ✅ Aprovado | venda bloqueada (RDC 44/2009) |
| 25 | CEP, frete por estado e carrinho | Produto com cadastro sanitário INCOMPLETO é bloqueado (sem registro MS) | ✅ Aprovado | bloqueado: exige registro na Anvisa |
| 26 | CEP, frete por estado e carrinho | Medicamento com registro MS, mas SEM aprovação do farmacêutico, é bloqueado | ✅ Aprovado | bloqueado até o responsável técnico aprovar |
| 27 | CEP, frete por estado e carrinho | Cupom inválido é recusado e cupom válido aplica desconto | ✅ Aprovado | cupom válido exige valor mínimo (regra aplicada) |
| 28 | CEP, frete por estado e carrinho | Cálculo de frete identifica o estado e aplica a tabela | ✅ Aprovado | SP = R$ 29.90, prazo 3 a 8 dias úteis |
| 29 | CEP, frete por estado e carrinho | Frete não é inventado para estado sem configuração | ✅ Aprovado | bloqueia e informa o motivo |
| 30 | CEP, frete por estado e carrinho | Frete grátis é aplicado acima do valor configurado | ✅ Aprovado | frete grátis aplicado |
| 31 | Checkout, pedido e pagamento | Checkout exige login e mostra etapas | ✅ Aprovado | fluxo protegido |
| 32 | Checkout, pedido e pagamento | Seleção de frete no checkout redireciona para o pagamento | ✅ Aprovado | frete BA selecionado |
| 33 | Checkout, pedido e pagamento | Tela de pagamento exibe Pix, cartão e parcelamento | ✅ Aprovado | ok |
| 34 | Checkout, pedido e pagamento | Finalização cria o pedido, reserva estoque e gera cobrança Pix | ✅ Aprovado | pedido PP2026000001 |
| 35 | Checkout, pedido e pagamento | Pedido aparece em "Meus pedidos" do cliente | ✅ Aprovado | PP2026000001 |
| 36 | Checkout, pedido e pagamento | Estoque é RESERVADO após o pedido (sem baixa definitiva) | ✅ Aprovado | reserva registrada |
| 37 | Checkout, pedido e pagamento | Pagamento NÃO é aprovado sem confirmação do provedor | ✅ Aprovado | aguardando confirmação |
| 38 | Checkout, pedido e pagamento | Aprovação (simulada em testes) baixa o estoque e atualiza status | ✅ Aprovado | aprovado, estoque baixado e pedido em separação |
| 39 | Checkout, pedido e pagamento | Webhook valida assinatura (HMAC) — sem assinatura é recusado | ✅ Aprovado | recusado sem assinatura |
| 40 | Checkout, pedido e pagamento | Webhook com assinatura correta processa e ignora duplicatas | ✅ Aprovado | processado 1x, duplicata ignorada |
| 41 | Checkout, pedido e pagamento | Cancelamento de pedido devolve o estoque | ✅ Aprovado | cancelado e estoque liberado/devolvido |
| 42 | Painel Super Administrador | Login do Super Administrador e dashboard | ✅ Aprovado | ok |
| 43 | Painel Super Administrador | Lista de produtos, filtros e ações | ✅ Aprovado | listagem, busca e filtros ok |
| 44 | Painel Super Administrador | Criação de produto pelo painel | ✅ Aprovado | id mvgy48q9… |
| 45 | Painel Super Administrador | Upload de IMAGEM grava arquivo em disco e registra no banco | ✅ Aprovado | /uploads/2026/10/jYSdG_ZKzLZm.svg (222 bytes) |
| 46 | Painel Super Administrador | Upload de VÍDEO é aceito (validação por tipo real) | ✅ Aprovado | MP4 aceito |
| 47 | Painel Super Administrador | Upload de arquivo NÃO permitido é recusado | ✅ Aprovado | recusado: Tipo de arquivo não permitido. Envie imagens (JPG, PNG, WEBP |
| 48 | Painel Super Administrador | Biblioteca de mídia lista os arquivos enviados | ✅ Aprovado | ok |
| 49 | Painel Super Administrador | Criação de categoria reflete no site | ✅ Aprovado | ok |
| 50 | Painel Super Administrador | Configuração de fretes por estado é salva e aplicada | ✅ Aprovado | MA = R$ 31,90 (5 a 12 dias úteis) |
| 51 | Painel Super Administrador | Exceção de frete por faixa de CEP é aplicada | ✅ Aprovado | exceção aplicada (R$ 5,50) |
| 52 | Painel Super Administrador | Configuração do WhatsApp altera o botão do site | ✅ Aprovado | número e mensagem atualizados |
| 53 | Painel Super Administrador | Edição de página institucional aparece no site e sanitiza HTML perigoso | ✅ Aprovado | publicada e sanitizada (XSS bloqueado) |
| 54 | Painel Super Administrador | Criação de cupom e aplicação no carrinho | ✅ Aprovado | TESTE26288 aplicou R$ 7,49 |
| 55 | Painel Super Administrador | Criação de banner aparece na home | ✅ Aprovado | ok |
| 56 | Painel Super Administrador | Movimentação de estoque é registrada no histórico | ✅ Aprovado | entrada registrada |
| 57 | Painel Super Administrador | Relatórios e exportação CSV funcionam | ✅ Aprovado | ok |
| 58 | Painel Super Administrador | Editor visual: seções e vitrines | ✅ Aprovado | ok |
| 59 | Segurança, permissões e LGPD | Requisição POST sem token CSRF é recusada (403) | ✅ Aprovado | HTTP 403 |
| 60 | Segurança, permissões e LGPD | Painel exige autenticação (redireciona para login) | ✅ Aprovado | protegido |
| 61 | Segurança, permissões e LGPD | Perfil ATENDENTE não acessa usuários nem cria produtos (permissão no servidor) | ✅ Aprovado | 403 em usuários e criação de produto |
| 62 | Segurança, permissões e LGPD | Perfil FARMACÊUTICO aprova o cadastro sanitário e libera a venda | ✅ Aprovado | aprovado pelo farmacêutico e liberado para venda |
| 63 | Segurança, permissões e LGPD | Auditoria registra as ações administrativas | ✅ Aprovado | logs com IP e usuário |
| 64 | Segurança, permissões e LGPD | Rate limiting bloqueia excesso de tentativas de login | ✅ Aprovado | HTTP 429 após excesso de tentativas |
| 65 | Segurança, permissões e LGPD | Senhas são armazenadas com hash (não em texto puro) | ✅ Aprovado | scrypt (hash com salt) |
| 66 | Segurança, permissões e LGPD | Cabeçalhos de segurança são enviados | ✅ Aprovado | nosniff, SAMEORIGIN, referrer-policy |
| 67 | Segurança, permissões e LGPD | Injeção de SQL/JS no campo de busca não quebra nem executa | ✅ Aprovado | neutralizado e escapado |
| 68 | Segurança, permissões e LGPD | Tentativa de manipular preço pelo navegador é ignorada | ✅ Aprovado | preço recalculado no servidor (R$ 7,49) |
| 69 | Persistência dos dados | Reiniciar o servidor mantém clientes, pedidos, produtos e mídia | ✅ Aprovado | dados íntegros após reinício |

## Como reproduzir

```bash
npm test           # roda toda a suíte (sobe o servidor sozinho)
node scripts/test.js
```

## O que NÃO foi testado (e por quê)

| Item | Situação | Motivo |
|------|----------|--------|
| Cobrança real no Mercado Pago | Não testado | Não há credenciais no ambiente; o prompt proíbe criar contas/custos sem autorização. O módulo foi implementado, mas a operação real depende de `MP_ACCESS_TOKEN` (documentado em `docs/06`). |
| Envio real de e-mail (SMTP) | Não testado | Nenhuma credencial SMTP disponível. O sistema grava as mensagens na fila de saída (`data/mail/*.eml`), que foi usada para validar a recuperação de senha. |
| QR Code do Pix | Não gerado localmente | Sem credenciais do provedor. Com o Mercado Pago configurado, o QR é exibido a partir do retorno da API. No provedor interno de testes o código é explicitamente marcado como SIMULADO. |
| Consulta de endereço no ViaCEP | Não testado | Desligada por padrão (`VIACEP_ENABLED=false`). A identificação da UF é feita offline pela faixa de CEP e foi testada. |
| Dispositivos móveis reais | Não testado em hardware | O layout é responsivo (CSS mobile-first) e foi verificado por inspeção de marcação; recomenda-se teste manual em Android/iOS antes da publicação. |
