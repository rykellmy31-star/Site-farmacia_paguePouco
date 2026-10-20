# 06 — Pendências, bloqueios externos e o que ainda NÃO está pronto

Este documento é **deliberadamente honesto**. O sistema entregue funciona de verdade,
foi testado de verdade e pode ser operado — mas **não deve ser anunciado como loja
em produção** antes de concluir os itens das seções 1 e 2.

---

## 1. Bloqueios externos (dependem de decisão/contratação — NÃO foram feitos)

> Nada aqui foi contratado, ativado ou pago. Nenhuma ação gerou custo.

| Item | Situação | O que depende | Possível custo futuro |
|---|---|---|---|
| **Pagamento real (Mercado Pago)** | Módulo implementado, **não executado com credenciais** | Criar conta da empresa, obter Public Key/Access Token, homologar em sandbox, depois produção | Taxa por transação (Pix e cartão) definida pelo provedor |
| **Pix com QR Code real** | Depende do provedor | Credenciais válidas | Incluído na taxa do provedor |
| **Envio de e-mail por SMTP** | Código SMTP implementado, **não executado** | Escolher um serviço transacional e configurar credenciais | Plano do provedor de e-mail (há franquias gratuitas) |
| **Domínio** | Não contratado | Registro em registrador brasileiro | Anuidade |
| **Hospedagem/servidor** | Não provisionada | Contratar VPS/cloud | Mensalidade |
| **Certificado HTTPS** | Não emitido | Let's Encrypt (gratuito) ou equivalente | Gratuito na maioria dos casos |
| **Consulta de endereço ViaCEP** | Desligada por padrão | Nada — é opcional | Gratuito, mas é dependência externa |
| **API oficial dos Correios / transportadoras** | **Não usada, de propósito** | Contrato com agência/postagem | Custo por frete |
| **Publicação em produção** | Não realizada | Decisão do lojista após os itens obrigatórios | — |

**Nenhuma dessas pendências impede o uso do sistema em ambiente de testes**: com o
provedor interno é possível cadastrar produtos, simular compras, simular aprovação de
pagamento, movimentar estoque, emitir relatórios e treinar a equipe.

---

## 2. Validações obrigatórias antes de vender ao público

- [ ] **Regularidade sanitária:** alvará sanitário, AFE/AE conforme a atividade,
      responsável técnico (farmacêutico) com registro ativo no CRF, e observância da
      **RDC 44/2009** e da **Lei 5.991/1973** para comércio de medicamentos.
- [ ] **Revisão do cadastro sanitário** de cada medicamento pelo farmacêutico
      responsável (classificação, registro MS, apresentação, concentração, princípio
      ativo, fabricante e link da bula oficial).
- [ ] **Conferência dos bloqueios:** confirmar que nenhum medicamento controlado ou
      sujeito a prescrição está liberado para venda online.
- [ ] **Publicidade sanitária:** revisar textos, banners e promoções quanto às
      restrições de propaganda de medicamentos (sem promessas terapêuticas, sem
      incentivo ao uso irracional, sem automedicação).
- [ ] **Textos jurídicos:** Termos de Uso, Política de Privacidade, Cookies e Trocas e
      Devoluções revisados por advogado (CDC + LGPD).
- [ ] **LGPD:** política de privacidade publicada, registro dos consentimentos de
      marketing, prazos de retenção e processo para atender pedidos de titular.
- [ ] **Pagamentos:** homologação em sandbox **e** teste real de uma compra de baixo
      valor antes de abrir o catálogo.
- [ ] **Frete e logística:** tabela de fretes compatível com o custo real de postagem
      e com os prazos prometidos.
- [ ] **Segurança:** HTTPS ativo, senhas fortes da equipe, backup diário testado
      (restauração verificada, não apenas o arquivo gerado).
- [ ] **Atendimento:** WhatsApp da empresa configurado e com horário de atendimento
      coerente com o prometido no site.

---

## 3. O que NÃO foi feito (e por quê)

| Item | Motivo |
|---|---|
| Transação financeira real | Exigiria conta e credenciais do lojista; o prompt proíbe criar contas/custos sem autorização. O provedor interno cobre os testes |
| QR Code de Pix gerado localmente | Sem credenciais do provedor. Com o Mercado Pago configurado, o QR é fornecido pela API. No provedor interno o código é explicitamente **SIMULADO** |
| Envio real de e-mail | Sem credenciais SMTP. A fila em disco permite validar e auditar as mensagens |
| Testes em dispositivos móveis reais | Não há dispositivos nem navegador headless neste ambiente. O layout é responsivo (CSS mobile-first) e foi verificado por marcação; recomendado teste manual em Android/iOS |
| Integração com ERP/farmácia popular | Fora do escopo solicitado |
| Migração automática para PostgreSQL | O esquema SQL está pronto em `database/schema.postgres.sql`; a troca exige reimplementar `src/lib/store.js` com a mesma interface |
| Otimização automática de imagens (WebP/AVIF) | Sem biblioteca nativa instalada. Com `sharp` instalado, a otimização é ativada automaticamente |

---

## 4. O que foi testado de verdade

Ver `docs/05-testes-e-resultados.md`. Em resumo: **69 testes de integração
executados contra o servidor real**, cobrindo navegação, cadastro, login,
recuperação de senha, carrinho, bloqueios sanitários, CEP/UF, frete por estado,
checkout, criação de pedido, reserva e baixa de estoque, pagamento, webhook com
assinatura e idempotência, cancelamento, painel administrativo completo, uploads,
permissões por perfil, auditoria, segurança (CSRF, XSS, rate limit, hash de senha)
e persistência após reinício.

---

## 5. Riscos e recomendações técnicas

1. **Backup:** o valor real está em `data/`. Sem backup, um incidente no servidor
   significa perder pedidos e cadastros. Automatize e **teste a restauração**.
2. **Espaço em disco:** fotos e vídeos crescem com o catálogo; defina um limite e
   monitore.
3. **Senhas da equipe:** use senhas fortes e perfis mínimos (quem só separa pedidos
   não precisa de Super Administrador).
4. **Aprovação sanitária é humana:** o sistema bloqueia por regra, mas a
   responsabilidade técnica é do farmacêutico. Mantenha o fluxo de aprovação ativo.
5. **Escala:** para milhares de pedidos simultâneos, migre para PostgreSQL e coloque
   um proxy reverso — o código está preparado para isso (ver `docs/02`).
