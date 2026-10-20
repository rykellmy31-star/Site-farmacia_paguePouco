# 04 — Configurações e publicação (checklist de produção)

## 1. Todas as variáveis de ambiente (arquivo `.env`)

Copie `.env.example` para `.env` e ajuste.

### Servidor

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `0.0.0.0` | Interface de escuta (use `127.0.0.1` atrás de proxy) |
| `DATA_DIR` | `./data` | Onde ficam banco, uploads, e-mails e backups |
| `PUBLIC_BASE_URL` | — | **Importante:** endereço público (ex.: `https://www.paguepouco.com.br`) usado em links de e-mail, retorno de pagamento e sitemap |
| `DEV_MODE` | `false` | `true` mostra avisos de ambiente de testes. **Deixe `false` em produção** |
| `SESSION_SECRET` | gerado | Chave das sessões. Se não definida, é gerada e salva em `data/.session-secret` |
| `SESSION_TTL_HOURS` | `72` | Duração da sessão do cliente |
| `TRUST_PROXY` | `false` | `true` quando há proxy reverso (para ler o IP real) |

### Pagamentos

| Variável | Padrão | Observação |
|---|---|---|
| `PAYMENT_PROVIDER` | `internal` | `internal` (testes) ou `mercadopago` |
| `MP_SANDBOX` | `true` | `true` = credenciais de teste. **Só mude para `false` quando o lojista autorizar e o homologar** |
| `MP_PUBLIC_KEY` / `MP_ACCESS_TOKEN` | — | Credenciais da **conta da empresa** no Mercado Pago |
| `MP_WEBHOOK_SECRET` | — | Segredo usado para validar as notificações |
| `MP_PIX_KEY` | — | Chave Pix da empresa (quando aplicável) |

### Outros

| Variável | Padrão | Observação |
|---|---|---|
| `VIACEP_ENABLED` | `false` | Consulta opcional de endereço. **O sistema funciona sem ela** (a UF vem da faixa de CEP) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | — | Sem SMTP, os e-mails ficam na fila `data/mail/` |
| `MAX_IMAGE_BYTES` | `5 MB` | Limite por imagem |
| `MAX_VIDEO_BYTES` | `50 MB` | Limite por vídeo |
| `IMAGE_OPTIMIZE` | `true` | Usa `sharp` **se** estiver instalado; sem ele, apenas redimensiona metadados |
| `RATE_LIMIT_LOGIN` | `8/min` | Tentativas de login por IP |
| `RATE_LIMIT_CHECKOUT` | `30/min` | Requisições de checkout por IP |

---

## 2. Checklist para publicar

### Obrigatório antes de abrir ao público

- [ ] `DEV_MODE=false` e `NODE_ENV=production`
- [ ] `PUBLIC_BASE_URL` com **HTTPS** e domínio correto
- [ ] `SESSION_SECRET` definido e guardado (nunca no repositório)
- [ ] **HTTPS** ativo (Let's Encrypt gratuito via Caddy ou Certbot)
- [ ] Proxy reverso (Nginx/Caddy) na frente, com `TRUST_PROXY=true`
- [ ] Executando como serviço (systemd/PM2) com `Restart=always`
- [ ] Backup automático diário de `data/` (banco + uploads) para fora do servidor
- [ ] Todas as senhas padrão trocadas (principalmente o Super Administrador)
- [ ] Dados da empresa completos em `Configurações → Empresa` (CNPJ, endereço, telefone, horário)
- [ ] Tabela de fretes revisada por estado (`Configurações → Fretes`)
- [ ] Textos jurídicos revisados: Termos de Uso, Privacidade, Trocas e Devoluções
- [ ] Página **Informações Sanitárias** revisada pelo farmacêutico responsável
- [ ] Cadastro sanitário dos medicamentos revisado e aprovado pelo responsável técnico
- [ ] Dados de demonstração (produtos/banners ilustrativos) substituídos ou removidos
- [ ] Provedor de pagamento configurado e **homologado em ambiente de teste**
- [ ] Teste real de ponta a ponta: comprar, pagar, receber o webhook, separar e enviar

### Recomendado

- [ ] Monitoramento de disponibilidade e de uso de disco
- [ ] Política de senhas fortes para a equipe e revisão periódica de usuários
- [ ] Log de auditoria revisado periodicamente (`Sistema → Auditoria`)
- [ ] `sitemap.xml` e `robots.txt` enviados ao Google Search Console
- [ ] Teste de compra em celular (Android e iOS) e em desktop

---

## 3. Exemplo de proxy reverso

### Caddy (HTTPS automático e gratuito)

```caddyfile
www.paguepouco.com.br {
    reverse_proxy 127.0.0.1:3000
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

### Nginx

```nginx
server {
    listen 80;
    server_name www.paguepouco.com.br;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name www.paguepouco.com.br;
    ssl_certificate     /etc/letsencrypt/live/www.paguepouco.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.paguepouco.com.br/privkey.pem;

    client_max_body_size 60m;   # importante para upload de vídeos

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

> Com Nginx/Caddy, use `HOST=127.0.0.1` e `TRUST_PROXY=true`.

---

## 4. Ativar o Mercado Pago (pagamentos reais)

1. Crie a conta da empresa em `mercadopago.com.br` (**pode haver custo por venda —
   ver `docs/06`**; a criação da conta em si é gratuita, mas a decisão é do lojista).
2. Em *Suas integrações → Credenciais*, copie a **Public Key** e o **Access Token**
   de **testes** primeiro.
3. Coloque no `.env`: `PAYMENT_PROVIDER=mercadopago`, `MP_SANDBOX=true`, as duas
   credenciais de teste e um `MP_WEBHOOK_SECRET` forte.
4. Cadastre a URL de notificação: `https://seudominio.com.br/webhooks/mercadopago`.
5. Faça uma compra real com cartão/Pix **de teste** e confirme que o pedido muda para
   *Pagamento aprovado* automaticamente pelo webhook.
6. Só então troque para as credenciais de **produção** e `MP_SANDBOX=false`.

**Nunca** coloque o Access Token em arquivos do front-end ou no repositório.

---

## 5. E-mails (opcional)

Sem SMTP, nada se perde: as mensagens ficam gravadas em `data/mail/`.
Para envio real, preencha `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e
`MAIL_FROM`. Recomenda-se um serviço transacional com plano gratuito.
**Este caminho não foi executado neste ambiente** (não havia credenciais) — ver `docs/06`.

---

## 6. Atualização e manutenção

- Atualizar = substituir os arquivos do sistema (mantendo `data/` e `.env`) e reiniciar.
- `npm run migrate` roda automaticamente no boot e normaliza a estrutura de dados.
- Monitore o espaço em disco: fotos e vídeos crescem com o catálogo.
