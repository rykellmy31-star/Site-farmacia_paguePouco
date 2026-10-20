# Implantação no Cloudflare Workers

Esta adaptação usa Workers com assets e um Durable Object com SQLite. Não é um projeto Cloudflare Pages nem um site apenas estático.

## Configuração no painel

1. Workers e Pages → Criar aplicativo → conectar este repositório.
2. Branch: `main`. Diretório raiz: `/` (raiz do repositório).
3. Nome do Worker: `farmacia-pague-pouco`, correspondente ao `name` de `wrangler.jsonc`.
   Se já criou um Worker com outro nome, use o mesmo nome no arquivo de configuração antes de implantar.
4. Comando de build: `npm run build`.
5. Comando de implantação: `npx wrangler deploy`.
6. Não configure `public` como saída de um site estático: ela não contém o servidor nem o painel.

O Wrangler também executa o build pela seção `build.command`. Assim, o comando de implantação anterior continua válido mesmo se o campo de build estiver vazio. A execução duplicada do preparo é segura, mas desnecessária.

O binding `LOJA`, a classe `LojaDurableObject` e a migração SQLite estão declarados no repositório. Não precisa copiar um ID de banco D1 ou cadastrar um bucket R2.

## Primeiro administrador

Em Configurações → Variáveis e segredos do Worker, adicione:

| Nome | Tipo | Valor |
| --- | --- | --- |
| `ADMIN_EMAIL` | Texto ou segredo | Seu e-mail de acesso ao painel |
| `ADMIN_PASSWORD` | Segredo | Uma senha exclusiva com pelo menos 12 caracteres |
| `PUBLIC_BASE_URL` | Texto, opcional | URL HTTPS definitiva do aplicativo, sem barra final |

Salve e implante a nova versão. Acesse `/admin`. O primeiro administrador é criado somente se ainda não houver nenhum. Não são importados os administradores ou o cliente de teste do ZIP.

Após o primeiro acesso, você pode remover `ADMIN_PASSWORD` das variáveis e implantar novamente: o usuário e o hash da senha permanecem no SQLite. Alterações futuras na variável não redefinem a senha de um usuário existente.

`SESSION_SECRET` é opcional. Sem ele, o sistema gera e guarda um segredo privado no banco persistente. Não há segredo fixo de demonstração no Worker.

Sem ADMIN_EMAIL/ADMIN_PASSWORD válidos na primeira configuração, o site público funciona e o painel mostra orientações com status HTTP 503. Isso é uma pendência de configuração, não um erro de build.

## Dados e uploads

- Pedidos, clientes, estoque, sessões, configurações, fila de e-mails e limites de acesso são persistidos no SQLite do Durable Object.
- As requisições da loja são serializadas também durante consultas externas para evitar concorrência nos contadores e nas reservas de estoque.
- Imagens e vídeos enviados pelo painel são gravados no mesmo armazenamento em fragmentos de 256 KiB. Não dependem de `/tmp` nem exigem R2.
- Limites padrão no Worker: imagem até 8 MiB, vídeo até 16 MiB; requisição completa até 20 MiB. Para vários arquivos, o limite vale para o conjunto.
- Vídeos enviados suportam requisições Range e HEAD.
- O catálogo ilustrativo do ZIP é usado apenas na primeira inicialização. Uma nova implantação não sobrescreve as alterações do painel.
- O build publica somente `public/` e SVGs selecionados de demonstração. Contas, clientes, pedidos, sessões, backups, .env e ZIP não são assets públicos.

Não altere a chave `loja-principal-v1`, a classe persistente ou o binding sem planejar a migração. Trocar essa identidade aponta para outro banco. Excluir o Worker/namespace pode apagar os dados; o GitHub guarda o código, não os dados gerados em produção.

## Pagamentos e e-mails

A implantação inicial mantém o provedor interno de testes; não movimenta dinheiro real.

Para Mercado Pago, configure os segredos `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`, a variável `MP_PUBLIC_KEY` e `MP_SANDBOX` conforme o ambiente. Configure o provedor e os meios de pagamento no painel. A integração externa precisa de homologação com suas credenciais antes de vender.

No Worker, os e-mails ficam na fila privada persistente do painel. O transporte SMTP do servidor Node não é executado nesse runtime. Portanto, a recuperação de senha e as notificações não entregam e-mails externos automaticamente nesta adaptação.

## Backup

No painel, Sistema → Baixar backup JSON exporta cadastros, pedidos e configurações para o navegador. Exige permissão administrativa e não é cacheado. O arquivo pode conter dados pessoais e hashes de senhas; guarde-o em local privado.

A exportação JSON não inclui binários de mídia nem o segredo interno de sessão. Ela serve como cópia de dados; não foi implementada uma restauração automática pelo painel.

## Plano e implantação

SQLite-backed Durable Objects estão disponíveis no Workers Free, sujeitos às cotas de uso e armazenamento da Cloudflare. Este projeto não exige habilitar R2, Containers ou um servidor pago. Nenhum plano ou orçamento é modificado pelo código.

A configuração funciona com implantação manual. Não há GitHub Actions novo. Se o projeto estiver conectado ao Workers Builds com publicação automática na main, a própria integração da Cloudflare pode iniciar um build ao receber um commit.

Documentação oficial:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/workers/static-assets/

## Verificação local, sem recursos remotos

Requer Node 22+ ou 24 e instalação das dependências de desenvolvimento:

```sh
npm install
npm run build
npm run check:cloudflare
npm run test:cloudflare
npm test
```

`check:cloudflare` usa `wrangler deploy --dry-run`: prepara o bundle sem publicá-lo.
`test:cloudflare` inicia `wrangler dev --local` com SQLite em uma pasta temporária e testa site, cookies, CSRF, login, upload, exportação e recuperação após reiniciar o processo. Não cria recursos na conta Cloudflare e não faz cobranças de pagamento.
`npm test` continua executando os testes do servidor Node original.

Após implantar:
1. `/__health` deve devolver `ok: true` e `durable-object-sqlite`.
2. Confira a página inicial, CSS e imagens.
3. Entre em `/admin`, altere uma configuração e envie uma imagem.
4. Reimplante e confira se a configuração, sessão e imagem continuam disponíveis.
5. `/data/db/admins.json` deve devolver 404.

### Verificação desta entrega

Foram executadas verificações de sintaxe JavaScript e verificações de componentes isolados no motor JavaScript disponível no chat (registradas em `docs/08-validacao-cloudflare.md`). O ambiente não disponibilizou terminal Node.js. Portanto, o build Wrangler, o workerd local, a suíte Node original e a implantação remota NÃO foram executados nesta entrega. O teste de implantação na sua conta é necessário para confirmar a compatibilidade completa.
