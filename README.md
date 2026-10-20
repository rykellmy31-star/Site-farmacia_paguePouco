# Farmácia Pague Pouco — Loja Virtual

Sistema completo de e-commerce farmacêutico: **site público, painel Super Admin,
cadastro de produtos com fotos e vídeos, cesta, checkout, frete fixo por estado,
pagamentos, área do cliente, gestão de pedidos, relatórios e segurança**.

Construído em **Node.js 20 com zero dependências externas** — não é necessário
`npm install`, banco de dados externo ou serviço de terceiros para rodar.

---

## Início rápido

```bash
cp .env.example .env     # opcional: ajuste PORT, PUBLIC_BASE_URL etc.
npm start                # cria o banco, aplica migrações e sobe o servidor
```

- **Loja:** http://localhost:3000
- **Painel:** http://localhost:3000/admin

Dados de demonstração (16 departamentos, ~39 produtos ilustrativos, 14 páginas
institucionais, cupons, banners e 6 perfis de usuário):

```bash
npm run seed
```

| Perfil | E-mail | Senha |
|---|---|---|
| Super Administrador | `admin@paguepouco.local` | `Admin@123456` |
| Administrador | `adm@paguepouco.local` | `Adm@123456` |
| Gerente | `gerente@paguepouco.local` | `Gerente@123` |
| Atendente | `atendente@paguepouco.local` | `Atende@123` |
| Operador de pedidos | `pedidos@paguepouco.local` | `Pedidos@123` |
| Responsável técnico | `farmaceutico@paguepouco.local` | `Farma@123456` |

> **Troque as senhas antes de publicar.**

## Comandos

| Comando | Descrição |
|---|---|
| `npm start` | Sobe o servidor (com migrações automáticas) |
| `npm run migrate` | Cria/atualiza a estrutura de dados |
| `npm run seed` | Carrega dados de demonstração |
| `npm test` | Roda os **69 testes de integração** (HTTP real) |
| `npm run backup` | Backup de dados + uploads |
| `npm run reset` | Apaga tudo (pede confirmação) |

## Documentação

| Documento | Conteúdo |
|---|---|
| `docs/01-instalacao-e-execucao.md` | Instalação, primeiros passos, serviço, solução de problemas |
| `docs/02-arquitetura.md` | Decisões técnicas, camadas, persistência, segurança |
| `docs/03-manual-do-lojista.md` | Manual completo do painel, sem programar |
| `docs/04-configuracoes-e-producao.md` | Variáveis de ambiente, checklist de produção, proxy reverso, Mercado Pago |
| `docs/05-testes-e-resultados.md` | Resultado dos testes executados |
| `docs/06-pendencias-bloqueios.md` | O que falta, o que depende de terceiros e o que pode gerar custo |
| `database/schema.postgres.sql` | Esquema relacional equivalente (caminho de migração) |

## Destaques do sistema

- **Frete fixo por estado** (26 estados + DF) configurado no painel — **não depende
  da API dos Correios**; funciona 100% offline e nunca inventa valor ou prazo.
- **Bloqueios sanitários automáticos** (RDC 44/2009): medicamentos controlados, com
  cadastro incompleto ou sem aprovação do farmacêutico não podem ser vendidos online.
- **Status financeiro separado do operacional**, com histórico de cada pedido.
- **Pagamentos**: provedor interno de testes por padrão; Mercado Pago preparado
  (Pix, cartão, parcelamento, webhook com validação de assinatura e idempotência).
- **WhatsApp de atendimento** configurável (dúvidas apenas — nunca para fechar compra).
- **Permissões por perfil verificadas no servidor**, auditoria de ações, senhas com
  scrypt, proteção CSRF/XSS, rate limiting e uploads validados.
- **HTML renderizado no servidor** com URLs amigáveis, sitemap, robots.txt e
  dados estruturados (SEO).

## Situação atual — leia antes de anunciar a loja

O sistema **funciona e foi testado de verdade** (69/69 testes de integração), mas
**não deve ser divulgado como loja em produção** antes de concluir os itens
obrigatórios de `docs/06-pendencias-bloqueios.md`: pagamentos reais (depende de
credenciais da empresa), hospedagem/domínio/HTTPS, segurança operacional,
adequação legal (CDC/LGPD) e, principalmente, a **regularidade sanitária e a
revisão do cadastro de medicamentos pelo farmacêutico responsável**.

Nenhum serviço pago foi contratado e nenhuma transação real foi realizada.
