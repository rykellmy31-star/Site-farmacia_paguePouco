# 01 — Instalação e execução

## 1. O que você precisa

- **Node.js 20 ou superior** (recomendada a versão LTS). Verifique com `node -v`.
- Nada mais. **Nenhum banco para instalar, nenhum `npm install`** — o projeto não tem
  dependências externas.

## 2. Instalação (3 passos)

```bash
# 1) copie a pasta do projeto para o servidor/máquina
# 2) crie o arquivo de configuração a partir do exemplo
cp .env.example .env

# 3) suba o sistema (o banco é criado e migrado automaticamente)
npm start
```

Abra `http://localhost:3000`.

> O `npm start` já executa as migrações (`scripts/migrate.js`) antes de subir.

## 3. Primeiro acesso ao painel

Endereço: `http://localhost:3000/admin`

Se você carregou os dados de demonstração (`npm run seed`), use:

| Perfil | E-mail | Senha |
|---|---|---|
| Super Administrador | `admin@paguepouco.local` | `Admin@123456` |
| Administrador | `adm@paguepouco.local` | `Adm@123456` |
| Gerente | `gerente@paguepouco.local` | `Gerente@123` |
| Atendente | `atendente@paguepouco.local` | `Atende@123` |
| Operador de pedidos | `pedidos@paguepouco.local` | `Pedidos@123` |
| Responsável técnico (farmacêutico) | `farmaceutico@paguepouco.local` | `Farma@123456` |

**Troque todas as senhas antes de publicar.** Os dados semeados são *ilustrativos*
(categorias, produtos, banners, cupons e páginas de exemplo) e devem ser substituídos
pelos dados reais da farmácia.

## 4. Comandos disponíveis

| Comando | O que faz |
|---|---|
| `npm start` | Sobe o servidor (roda as migrações antes) |
| `npm run dev` | Sobe em modo desenvolvimento |
| `npm run migrate` | Cria/atualiza a estrutura de dados (idempotente) |
| `npm run seed` | Carrega os dados de demonstração (categorias, produtos, páginas, usuários) |
| `npm run seed:force` | Recria os dados de demonstração do zero |
| `npm test` | Roda a suíte completa de testes (sobe um servidor temporário) |
| `npm run backup` | Gera um backup dos dados + uploads em `data/backups/` |
| `npm run reset` | Apaga banco e uploads (pede confirmação) |

## 5. Onde ficam os dados

```
data/
  db/            banco (JSON + WAL) — mantenha em backup
  uploads/       fotos e vídeos enviados pelo painel
  mail/          fila de e-mails (recuperação de senha, avisos de pedido)
  backups/       backups gerados por npm run backup
  .session-secret  chave de sessão (não compartilhar)
```

## 6. Recomeçar do zero

```bash
npm run reset -- --confirmar   # apaga banco e uploads
npm run seed                   # recarrega os dados de demonstração
npm start
```

## 7. Executar como serviço (servidor Linux)

Exemplo com `systemd` (arquivo `/etc/systemd/system/paguepouco.service`):

```ini
[Unit]
Description=Farmacia Pague Pouco
After=network.target

[Service]
WorkingDirectory=/caminho/para/farmacia-pague-pouco
ExecStart=/usr/bin/node src/server.js
Restart=always
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now paguepouco
```

Na publicação, coloque um proxy reverso (Nginx ou Caddy) com HTTPS na frente.
Veja `docs/04-configuracoes-e-producao.md`.

## 8. Solução de problemas

| Sintoma | Causa provável e solução |
|---|---|
| `EADDRINUSE` ao subir | A porta já está em uso; mude `PORT` no `.env` |
| Erro de permissão em `data/` | O usuário do processo precisa de leitura/escrita na pasta `data/` |
| Site sobe, mas imagens não aparecem | Confira permissão de leitura em `data/uploads/` |
| E-mails não chegam | Sem SMTP configurado, as mensagens ficam na fila `data/mail/` e podem ser vistas em **Sistema → E-mails (fila de saída)** |
| Esqueci a senha do admin | Use a recuperação de senha pelo navegador (gera link) ou apague `data/db/admins.json` e rode `npm run seed` novamente |
