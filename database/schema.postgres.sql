-- ==========================================================================
-- FARMÁCIA PAGUE POUCO — Esquema PostgreSQL (caminho de migração)
-- --------------------------------------------------------------------------
-- O sistema roda, por padrão, com o banco em arquivo implementado em
-- src/lib/store.js (WAL + snapshot em data/db). Este arquivo documenta o
-- esquema relacional equivalente, para quem preferir PostgreSQL em produção.
--
-- Para migrar: reimplemente src/lib/store.js mantendo a MESMA interface
-- (all, count, find, findOne, get, insert, update, updateMany, remove,
--  removeMany, query, clear, backup). Nenhuma rota ou view precisa mudar,
-- porque todas falam apenas com essa interface.
--
-- Convenção importante: TODO VALOR MONETÁRIO É INTEGER EM CENTAVOS.
-- Ex.: R$ 29,90  =>  2990.
-- ==========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ------------------------------------------------------------------ admins
CREATE TABLE admins (
  id                TEXT PRIMARY KEY,
  nome              TEXT NOT NULL,
  email             CITEXT NOT NULL UNIQUE,
  senha_hash        TEXT NOT NULL,              -- scrypt
  role              TEXT NOT NULL,              -- super_admin|admin|gerente|atendente|operador_pedidos|farmaceutico
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_acesso_em  TIMESTAMPTZ,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admins_role ON admins (role);

-- --------------------------------------------------------------- customers
CREATE TABLE customers (
  id                TEXT PRIMARY KEY,
  nome              TEXT NOT NULL,
  email             CITEXT NOT NULL UNIQUE,
  cpf               TEXT,
  telefone          TEXT,
  data_nascimento   DATE,
  senha_hash        TEXT NOT NULL,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  email_verificado  BOOLEAN NOT NULL DEFAULT FALSE,
  marketing         BOOLEAN NOT NULL DEFAULT FALSE,      -- consentimento LGPD
  marketing_em      TIMESTAMPTZ,
  ultimo_acesso_em  TIMESTAMPTZ,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_ativo ON customers (ativo);

-- --------------------------------------------------------------- addresses
CREATE TABLE addresses (
  id           TEXT PRIMARY KEY,
  cliente_id   TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  apelido      TEXT,
  nome         TEXT NOT NULL,
  cep          TEXT NOT NULL,
  logradouro   TEXT NOT NULL,
  numero       TEXT,
  complemento  TEXT,
  bairro       TEXT,
  cidade       TEXT NOT NULL,
  uf           CHAR(2) NOT NULL,
  padrao       BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_cliente ON addresses (cliente_id);

-- --------------------------------------------------------------- sessions
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  tipo         TEXT NOT NULL,                   -- customer | admin
  usuario_id   TEXT NOT NULL,
  csrf         TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  expira_em    TIMESTAMPTZ NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_expira ON sessions (expira_em);

CREATE TABLE password_tokens (
  token       TEXT PRIMARY KEY,
  cliente_id  TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  usado       BOOLEAN NOT NULL DEFAULT FALSE,
  expira_em   TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- categories
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  pai_id      TEXT REFERENCES categories (id) ON DELETE SET NULL,
  icone       TEXT,
  descricao   TEXT,
  ordem       INTEGER NOT NULL DEFAULT 99,
  ativa       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_categories_pai ON categories (pai_id);

-- --------------------------------------------------------------- products
CREATE TABLE products (
  id                        TEXT PRIMARY KEY,
  nome                      TEXT NOT NULL,
  slug                      TEXT NOT NULL UNIQUE,
  codigo_interno            TEXT,
  sku                       TEXT,
  ean                       TEXT,
  marca                     TEXT,
  fabricante                TEXT,
  categoria_id              TEXT REFERENCES categories (id) ON DELETE SET NULL,
  subcategoria_id           TEXT REFERENCES categories (id) ON DELETE SET NULL,
  descricao                 TEXT,                        -- HTML sanitizado
  caracteristicas           JSONB NOT NULL DEFAULT '{}',
  preco_centavos            INTEGER NOT NULL DEFAULT 0,
  preco_promocional_centavos INTEGER NOT NULL DEFAULT 0,
  peso                      NUMERIC(10,3) NOT NULL DEFAULT 0,   -- kg
  largura                   NUMERIC(10,2) NOT NULL DEFAULT 0,   -- cm
  altura                    NUMERIC(10,2) NOT NULL DEFAULT 0,
  comprimento               NUMERIC(10,2) NOT NULL DEFAULT 0,
  ativo                     BOOLEAN NOT NULL DEFAULT TRUE,
  destaque                  BOOLEAN NOT NULL DEFAULT FALSE,
  vendas                    INTEGER NOT NULL DEFAULT 0,
  -- dados sanitários (MIP / Anvisa)
  classificacao             TEXT NOT NULL DEFAULT 'nao_aplicavel',
  requer_receita            BOOLEAN NOT NULL DEFAULT FALSE,
  controlado                BOOLEAN NOT NULL DEFAULT FALSE,
  registro_ms               TEXT,
  apresentacao              TEXT,
  concentracao              TEXT,
  principio_ativo           TEXT,
  bula_url                  TEXT,
  restricao_transporte      BOOLEAN NOT NULL DEFAULT FALSE,
  restricao_advertencia     TEXT,
  aprovado_farmaceutico     BOOLEAN NOT NULL DEFAULT FALSE,
  aprovado_por              TEXT,
  aprovado_em               TIMESTAMPTZ,
  criado_em                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_categoria ON products (categoria_id);
CREATE INDEX idx_products_marca ON products (marca);
CREATE INDEX idx_products_ativo ON products (ativo);
CREATE INDEX idx_products_nome_trgm ON products USING gin (nome gin_trgm_ops);

-- ------------------------------------------------------------ imagens/vídeos
CREATE TABLE product_media (
  id           TEXT PRIMARY KEY,
  produto_id   TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,                   -- image | video
  url          TEXT NOT NULL,
  legenda      TEXT,
  ordem        INTEGER NOT NULL DEFAULT 1,
  principal    BOOLEAN NOT NULL DEFAULT FALSE,
  tamanho      INTEGER,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_produto ON product_media (produto_id);
CREATE UNIQUE INDEX uq_media_principal ON product_media (produto_id) WHERE principal;

-- ---------------------------------------------------------------- estoque
CREATE TABLE stock (
  produto_id   TEXT PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
  quantidade   INTEGER NOT NULL DEFAULT 0,
  reservado    INTEGER NOT NULL DEFAULT 0,
  minimo       INTEGER NOT NULL DEFAULT 5,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_estoque_nao_negativo CHECK (quantidade >= 0 AND reservado >= 0)
);

CREATE TABLE stock_movements (
  id           TEXT PRIMARY KEY,
  produto_id   TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,      -- entrada | saida | reserva | liberacao | baixa | devolucao | ajuste
  quantidade   INTEGER NOT NULL,
  saldo_apos   INTEGER,
  origem       TEXT,               -- pedido | cadastro_inicial | edicao_produto | manual
  pedido_id    TEXT,
  usuario_id   TEXT,
  observacao   TEXT,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mov_produto ON stock_movements (produto_id, criado_em DESC);

-- ------------------------------------------------------------------ carts
CREATE TABLE carts (
  id           TEXT PRIMARY KEY,
  cliente_id   TEXT REFERENCES customers (id) ON DELETE SET NULL,
  itens        JSONB NOT NULL DEFAULT '[]',
  cupom        JSONB,
  frete        JSONB,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_carts_atualizado ON carts (atualizado_em);

-- ----------------------------------------------------------------- orders
CREATE TABLE orders (
  id                  TEXT PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE,        -- PP2026000001
  carrinho_id         TEXT,
  cliente_id          TEXT REFERENCES customers (id) ON DELETE SET NULL,
  cliente_nome        TEXT,
  cliente_email       TEXT,
  status_financeiro   TEXT NOT NULL DEFAULT 'pendente',
  status_operacional  TEXT NOT NULL DEFAULT 'aguardando_pagamento',
  metodo_pagamento    TEXT NOT NULL,
  parcelas            INTEGER NOT NULL DEFAULT 1,
  subtotal_centavos   INTEGER NOT NULL DEFAULT 0,
  desconto_centavos   INTEGER NOT NULL DEFAULT 0,
  frete_centavos      INTEGER NOT NULL DEFAULT 0,
  total_centavos      INTEGER NOT NULL DEFAULT 0,
  cupom_codigo        TEXT,
  frete_opcao_id      TEXT,
  frete_prazo         TEXT,
  endereco_entrega    JSONB NOT NULL,
  pagamento_id        TEXT,
  rastreio_codigo     TEXT,
  rastreio_url        TEXT,
  historico           JSONB NOT NULL DEFAULT '[]',
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_cliente ON orders (cliente_id);
CREATE INDEX idx_orders_status_fin ON orders (status_financeiro);
CREATE INDEX idx_orders_status_op ON orders (status_operacional);
CREATE INDEX idx_orders_criado ON orders (criado_em DESC);
-- proteção contra pedido duplicado (mesmo cliente/carrinho em 60s)
CREATE INDEX idx_orders_dup ON orders (cliente_id, carrinho_id, criado_em);

CREATE TABLE order_items (
  id                    TEXT PRIMARY KEY,
  pedido_id             TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  produto_id            TEXT REFERENCES products (id) ON DELETE SET NULL,
  produto_nome          TEXT NOT NULL,
  produto_slug          TEXT,
  produto_imagem        TEXT,
  sku                   TEXT,
  quantidade            INTEGER NOT NULL,
  preco_unitario_centavos INTEGER NOT NULL,
  preco_total_centavos  INTEGER NOT NULL,
  peso                  NUMERIC(10,3) NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_pedido ON order_items (pedido_id);

-- --------------------------------------------------------------- payments
CREATE TABLE payments (
  id                  TEXT PRIMARY KEY,
  pedido_id           TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,              -- internal | mercadopago
  provider_payment_id TEXT,
  metodo              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pendente',
  valor_centavos      INTEGER NOT NULL,
  parcelas            INTEGER NOT NULL DEFAULT 1,
  pix_codigo          TEXT,
  pix_qr_base64       TEXT,
  pix_expira_em       TIMESTAMPTZ,
  simulado            BOOLEAN NOT NULL DEFAULT FALSE,
  raw                 JSONB,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_provider ON payments (provider, provider_payment_id);

CREATE TABLE webhook_events (
  chave       TEXT PRIMARY KEY,     -- <provider>:<paymentId|chave>:<status>
  provider    TEXT NOT NULL,
  payload     JSONB,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- coupons
CREATE TABLE coupons (
  id             TEXT PRIMARY KEY,
  codigo         TEXT NOT NULL UNIQUE,
  tipo           TEXT NOT NULL,          -- percentual | fixo | frete_gratis
  valor          INTEGER NOT NULL,       -- % ou centavos
  valor_minimo   INTEGER NOT NULL DEFAULT 0,
  valido_de      TIMESTAMPTZ,
  valido_ate     TIMESTAMPTZ,
  limite_usos    INTEGER,
  usos           INTEGER NOT NULL DEFAULT 0,
  categorias     JSONB NOT NULL DEFAULT '[]',
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- banners
CREATE TABLE banners (
  id         TEXT PRIMARY KEY,
  titulo     TEXT NOT NULL,
  imagem     TEXT NOT NULL,
  link       TEXT,
  posicao    TEXT NOT NULL DEFAULT 'principal',
  ordem      INTEGER NOT NULL DEFAULT 1,
  ativo      BOOLEAN NOT NULL DEFAULT TRUE,
  inicio_em  TIMESTAMPTZ,
  fim_em     TIMESTAMPTZ,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- showcases
CREATE TABLE showcases (
  id        TEXT PRIMARY KEY,
  titulo    TEXT NOT NULL,
  tipo      TEXT NOT NULL,          -- categoria | marca | ofertas | novidades | mais_vendidos | manual
  categoria_slug TEXT,
  marca     TEXT,
  produtos  JSONB NOT NULL DEFAULT '[]',
  link      TEXT,
  limite    INTEGER NOT NULL DEFAULT 12,
  ordem     INTEGER NOT NULL DEFAULT 10,
  ativo     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------------ pages
CREATE TABLE pages (
  id           TEXT PRIMARY KEY,
  titulo       TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  resumo       TEXT,
  conteudo     TEXT NOT NULL,                 -- HTML sanitizado
  publicada    BOOLEAN NOT NULL DEFAULT TRUE,
  revisada     BOOLEAN NOT NULL DEFAULT FALSE,
  ordem        INTEGER NOT NULL DEFAULT 10,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- settings
CREATE TABLE settings (
  chave       TEXT PRIMARY KEY,     -- empresa | loja | tema | seo | rodape | pagamentos | whatsapp | frete | aparencia
  valor       JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------- midia
CREATE TABLE midia (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  caminho    TEXT NOT NULL,
  url        TEXT NOT NULL,
  tipo       TEXT NOT NULL,          -- image | video
  mime       TEXT NOT NULL,
  tamanho    INTEGER NOT NULL,
  largura    INTEGER,
  altura     INTEGER,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- auditoria
CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT,
  usuario_nome TEXT,
  acao        TEXT NOT NULL,        -- criou_produto, alterou_fretes, aprovou_produto...
  entidade    TEXT,
  entidade_id TEXT,
  detalhes    JSONB,
  ip          TEXT,
  user_agent  TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_criado ON audit_logs (criado_em DESC);

CREATE TABLE system_logs (
  id        TEXT PRIMARY KEY,
  nivel     TEXT NOT NULL,          -- info | warn | error | security
  mensagem  TEXT NOT NULL,
  detalhes  JSONB,
  ip        TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_syslog_criado ON system_logs (criado_em DESC);

-- ------------------------------------------------------- fila de e-mails
CREATE TABLE mail_outbox (
  id        TEXT PRIMARY KEY,
  para      TEXT NOT NULL,
  assunto   TEXT NOT NULL,
  corpo     TEXT NOT NULL,
  arquivo   TEXT,                   -- caminho do .eml quando em disco
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- contador
CREATE TABLE counters (
  id         TEXT PRIMARY KEY,      -- 'pedido'
  ano        INTEGER NOT NULL,
  sequencia  INTEGER NOT NULL
);

-- =========================================================================
-- Consultas úteis
-- =========================================================================
-- Pedidos aguardando pagamento há mais de 30 minutos (cobrança/lembrete):
--   SELECT codigo, cliente_email, total_centavos FROM orders
--    WHERE status_financeiro = 'pendente' AND criado_em < now() - interval '30 minutes';
--
-- Produtos com estoque abaixo do mínimo:
--   SELECT p.nome, s.quantidade, s.reservado, s.minimo
--     FROM products p JOIN stock s ON s.produto_id = p.id
--    WHERE s.quantidade - s.reservado <= s.minimo AND p.ativo;
--
-- Produtos bloqueados por pendência sanitária:
--   SELECT nome, classificacao, registro_ms, aprovado_farmaceutico FROM products
--    WHERE ativo AND (controlado OR requer_receita
--          OR (classificacao IN ('isento_prescricao','generico','fitoterapico') AND NOT aprovado_farmaceutico));
-- =========================================================================
