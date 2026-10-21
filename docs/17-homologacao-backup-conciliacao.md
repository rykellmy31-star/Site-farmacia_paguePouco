# Homologação: bloqueios de recuperação e conciliação

## Entregas desta etapa

1. **Ensaio de backup real isolado, ainda sem exportação efetiva**:
   - `scripts/validate-cloudflare-backup.mjs` recebe os dois arquivos JSON
     de exportação privada do painel e uma pasta opcional com as mídias
     baixadas do manifesto.
   - Confere formato, documentos, identificadores, caminhos, bytes e
     SHA-256 de cada imagem/vídeo, e reabre o banco em diretório
     temporário descartável. Não faz requisições à Cloudflare, não modifica
     banco de produção e não imprime documentos.
   - Sessões, tokens de senha, outbox e cofres Mercado Pago/InovaFarma
     não são reconstruídos no ensaio.
2. **Monitoramento financeiro persistente**:
   - O alarme periódico registra apenas contadores por ciclo e nome dos
     fluxos com falha, sem CPFs, IDs, valores, tokens ou respostas externas.
   - Em `Painel → Sistema` o Super Administrador visualiza o número atual
     de Pix pendentes, estornos pendentes, checkouts interrompidos e
     pedidos que precisam de conferência, além da última execução registrada.
   - Erros brutos do Worker não são publicados em logs.
3. **Regressão**: testes de rejeição de mídia alterada, exclusão de
   credenciais, tratamento de contadores e prova de privacidade.

## Como validar os dados REAIS, sem restaurar produção

No painel `/admin/sistema`, autenticado como Super Administrador:

- Clique em **Baixar backup JSON** e guarde o arquivo privadamente.
- Clique em **Baixar manifesto de mídias**.
- Baixe todos os arquivos originais listados no manifesto e organize-os
  numa pasta local que reproduza o campo `caminho` de cada item.

Em um computador seguro, com o código do projeto e Node.js 22 instalado:

```bash
node scripts/validate-cloudflare-backup.mjs \
  --snapshot "backup-real.json" \
  --manifest "manifesto-real.json" \
  --media-dir "./midias"
```

Se não houver imagens, o argumento `--media-dir` pode ser omitido.
Só `RESTAURACAO_ISOLADA: ok=true` comprova aquela cópia específica.
**Não faça upload do backup para um repositório público nem cole o
conteúdo em conversa.** Os arquivos contêm cadastros, dados de clientes,
pedidos e possivelmente hashes de senha.

## Bloqueios que exigem configuração/autorização fora do GitHub

- **Cloudflare PUBLIC_BASE_URL**: cadastrar variável Plaintext com
  valor `https://site.farmaciapaguepouco.app`, no Worker
  `site-farmacia-paguepouco` EXISTENTE. O código já usa fallback,
  mas a auditoria mostra que a variável explícita está ausente.
- **Cópias externas automáticas**: ainda requerem destino autorizado,
  estratégia de criptografia, retenção, custo e credenciais de backup.
  Este PR não acessa informações reais nem simula automação externa.
- **Mercado Pago**: homologação com pagamentos, retornos Pix e estornos
  reais autorizados. O CI usa mocks. A telemetria não confirma
  dinheiro creditado.
- **Entrega de e-mails**: escolher serviço transacional suportado,
  verificar custos, autenticação e domínio remetente. A fila interna
  não realiza entrega externa.
- **InovaFarma**: documentação homologada e autorização. A integração
  permanece desligada.

A base Cloudflare continua **Durable Object `LOJA` /
`LojaDurableObject` / `loja-principal-v1`**. Nenhum deploy manual,
restore remoto ou transação real faz parte deste PR.
