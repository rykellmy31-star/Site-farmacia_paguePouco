# Robô InovaFarma — fase 1: monitor local de exportações CSV (Windows)

## Estado e limites

Esta primeira etapa do **robô do InovaFarma** está implementada no repositório
existente da Farmácia Pague Pouco. Não depende de API não documentada do ERP.
O robô **não está instalado no computador da farmácia**, nem sincroniza a loja
automaticamente ainda. O cadastro do site, pagamentos, pedidos e estoque **não
são modificados** pelo robô. Não existe conexão externa, chave nem webhook.

Fluxo:

1. O operador exporta os relatórios CSV pelo próprio InovaFarma (Windows).
2. O robô observa a pasta selecionada a cada 15 segundos. Espera 10 segundos
   sem modificações para evitar capturar exportação ainda em andamento.
3. Valida os relatórios com **os leitores oficiais do próprio site**:
   - Posição de Estoque: EAN, descrição, estoque e preço; duplicidades e
     valores inválidos são rejeitados.
   - Relatório de Promoções: campanhas, datas e preços reconhecidos.
   - Catálogo integral padronizado: apenas arquivo completo com ao menos
     6.128 produtos, conforme regra de substituição existente.
4. Copia sem alterar os arquivos válidos para uma pasta local e grava
   SHA-256, tipo, contagem e horário; ignora cópias idênticas mesmo após
   reiniciar. Rejeita arquivo desconhecido em vez de inventar saldos.
5. O Superadmin envia **manualmente** o CSV validado do diretório de fila
   ao menu **Painel → Importação de estoque** e revisa antes de aplicar.
   O catálogo integral só pode ser substituído na tela específica, com
   conferência, backup e confirmação explícita.
6. O robô nunca executa compra, baixa de estoque, exclusão de produtos,
   envio de CPF ou envio de vendas ao ERP. Não guarda senhas nem tokens.

## Instalação no computador com acesso aos relatórios do InovaFarma

1. No computador Windows, instale **Node.js 22 LTS** (se ainda não tiver).
2. Baixe o ZIP **do repositório existente** no GitHub (Code → Download ZIP),
   extraia-o em uma pasta local privada. Não execute um ZIP de outro projeto.
3. Crie uma pasta para as exportações (por exemplo, `C:\\InovaExportacoes`)
   e faça a exportação de **Posição de Estoque** ou **Relatório de Promoções**
   do InovaFarma para essa pasta.
4. No diretório do repositório extraído, abra
   `scripts/INICIAR-ROBO-INOVAFARMA.cmd`, cole a pasta de exportações e
   mantenha a janela aberta enquanto desejar monitorar.
5. Quando um relatório íntegro for identificado, ele aparecerá na subpasta
   `.robo-inovafarma` da pasta de origem, com nome contendo parte da
   assinatura SHA-256. O arquivo `estado.json` é o histórico. **Não edite
   ou exclua esses arquivos enquanto o robô funcionar**.
6. Para interromper, feche a janela do terminal ou pressione Ctrl+C. Para
   retomar, execute novamente o mesmo inicializador.
7. Se receber "CSV não reconhecido", não altere estoque no site; confira
   a exportação. Se o arquivo original tiver EAN ausente ou layout diferente,
   a próxima etapa será homologar um conversor específico para esse layout.

Rodar uma vez com PowerShell ou Prompt de Comando (na pasta do projeto):

```powershell
node scripts/inovafarma-robo-windows.mjs --pasta "C:\InovaExportacoes" --uma-vez
```

Monitoramento contínuo enquanto o processo estiver aberto:

```powershell
node scripts/inovafarma-robo-windows.mjs --pasta "C:\InovaExportacoes" --assistir
```

O robô procura **apenas arquivos .csv na pasta escolhida**, sem vasculhar
o Windows, sem executar scripts dos relatórios e sem apagar os originais.
Os arquivos na fila permanecem locais. Não coloque essa pasta em repositório
público, não compartilhe o backup nem o histórico de exportações.

## Próximas fases — dependências reais

- **Fase 2: envio seguro da fila ao site.** Exigirá autenticação própria,
  revisão dos relatórios, fila criptografada e recebimento somente leitura
  no Worker. Não reutilizar `INOVA_STOCK_TOKEN` nem ativar a API oficial para
  o fluxo de arquivos sem homologação. Precisamos identificar a pasta
  exportada e a disponibilidade do computador Windows.
- **Fase 3: conciliação assistida de estoque/preço/descontos.**
  Aprovar explicitamente as mudanças no site; proteger reservas,
  quarentena, pedidos pagos, produtos com EAN ausente e vigências.
  Um CSV incompleto não autoriza apagar catálogo ou zerar produtos omitidos.
- **Fase 4: integração nativa ao ERP (se disponível).** Somente depois que
  a Precisão Sistemas autorizar e documentar protocolo e permissões de
  acesso ao InovaFarma. Não tentar conectar à base interna sem contrato.

## Segurança / validação

`node --test tests/inovafarma-robo-windows.test.js` roda os testes sem
ERP, sem Cloudflare e sem dados reais. Nenhum dado é alterado em produção
por instalar ou executar esta primeira fase.
