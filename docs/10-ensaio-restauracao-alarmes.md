# Ensaio de restauração de backup — Farmácia Pague Pouco

Este procedimento é **offline e não destrutivo**. Ele verifica se um backup exportado da Cloudflare permite reconstruir os documentos e mídias num armazenamento novo, **temporário** e **isolado**, e depois elimina esse armazenamento. Não acessa Cloudflare nem restaura dados da loja publicada.

## Requisitos para ensaiar

1. Um backup JSON do painel **Administração → Sistema → Baixar backup JSON** (formato `pague-pouco-sqlite-export-v1`).
2. O manifesto em **Sistema → Baixar manifesto de mídias** (formato `pague-pouco-midia-manifest-v1`).
3. **Todos** os arquivos listados no manifesto. Os nomes locais precisam espelhar `caminho`, por exemplo `midias/2026/10/id.webp`. Faça o download somente por sessão autorizada e guarde-os num local privado; o painel fornece downloads individuais e ainda não cria um pacote automático de todas as mídias.

Num computador com Node.js e o repositório clonado:

```sh
node scripts/testar-restauracao.js dados.json midias-manifest.json ./midias
```

Para um manifesto com zero arquivos, o terceiro argumento pode ser omitido.

A verificação rejeita arquivos incompletos, hashes SHA-256 divergentes, chaves inválidas, caminhos inseguros, coleções e IDs duplicados. Reabre um banco Node descartável e confirma a igualdade dos documentos originais e dos arquivos. As sessões e tokens temporários são excluídos deliberadamente da cópia de ensaio; a identidade interna `__meta` (segredo da sessão do Worker) não é exportada nem aceita para importação.

## Limites e pendências de homologação

- **Não existe botão de restaurar a produção**, nem restauração remota do Durable Object. A cópia temporária serve somente para testar recuperabilidade. Nunca substitua manualmente a instância `loja-principal-v1`.
- Não há agendamento de backup externo, pacote automatizado completo de mídias, ensaio real de perda de Worker, procedimento de corte/retorno ou restauração atômica homologada no SQLite do Durable Object.
- Os backups contêm dados pessoais, históricos de pedidos e hashes de senha. Não suba arquivos JSON ou mídias privadas ao GitHub público; use armazenamento seguro com acesso controlado.
- Para declarar a recuperação de desastres em produção **homologada**, ainda serão necessários um destino seguro, controle de versão/retensão, exportação integral automatizada, procedimento ensaiado de restauração atômica e aprovação explícita antes de aplicar qualquer restauração real.
- Esta rotina **não exige ativar R2** apenas para validar o banco e os arquivos existentes.

## Alarme Pix/estornos

A rotina de alarmes no Worker precisa reagendar `programarAlarmeFinanceiro()` **também dentro de `alarm()`**. O teste `tests/restore-rehearsal.test.js` impede a regressão para o nome antigo, e a suíte de conciliação cobre expiração de Pix, pagamentos e estornos simulados.
