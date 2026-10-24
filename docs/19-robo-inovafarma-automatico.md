# Robô InovaFarma V3 — após configurar, basta exportar o CSV

## Objetivo do estabelecimento

O operador exporta a **Posição de Estoque** do InovaFarma no Windows para
`C:\InovaExportacoes`; o robô detecta o CSV completo, verifica sua
estabilidade, lê código interno, EAN, descrição, estoque e preço de venda,
e o envia automaticamente ao site. Não encaminha o CSV ao ChatGPT,
não depende de GitHub no computador e não solicita confirmar importações
todos os dias. A transmissão funciona somente enquanto o computador
e o robô estão ligados.

## Pareamento uma única vez

1. Criar um backup real em **Superadmin → Sistema e backups**.
2. Acessar **Superadmin → Robô InovaFarma**:
   `https://site.farmaciapaguepouco.app/admin/robo-inovafarma`.
3. Confirmar o backup, clicar em **Gerar chave para o robô** e
   copiar a chave exibida **uma única vez**. Ela não é enviada por email
   nem gravada em texto puro no site; só seu hash fica no banco.
4. Instalar **Node.js LTS** no Windows e extrair o pacote ZIP fornecido
   ao proprietário em uma pasta privada.
5. Fechar o monitor antigo com Ctrl+C e executar `INICIAR-ROBO.cmd`
   na pasta do pacote. Na primeira execução, colar a chave uma única vez.
   Ela será protegida pelo DPAPI da conta Windows. Não copiar
   `segredo.dpapi` para outra máquina nem para o GitHub.
6. Opcionalmente, executar `ATIVAR-INICIO-WINDOWS.cmd` uma vez, para
   iniciar o robô quando este usuário entrar no Windows.
7. Confirmar o estado do último relatório em
   `/admin/robo-inovafarma`.

## Operação diária

Exportar **Posição de Estoque em CSV** do InovaFarma para a pasta
`C:\InovaExportacoes`. O nome original contém a data, como
`Análise de produtos-24-10-2026 193856.csv`.
O robô lê cabeçalho após capa, aspas multilinha e cp1252.
Não modificar o arquivo com Excel; códigos devem ser preservados como texto.

Todos os blocos do arquivo chegam ao Worker antes da primeira alteração;
o processamento posterior é idempotente por arquivo e bloco. Falhas
ficam registradas; o robô tenta novamente sem aplicar o mesmo bloco duas vezes.

## Regras automáticas

- Normaliza estoque negativo para zero no arquivo enviado, sem adulterar o
  original exportado pelo ERP.
- EAN ausente, curto/longíssimo ou inválido por formato é enviado vazio;
  **não cria código de barras fictício**. Para cadastro já existente,
  código interno único do ERP é a chave principal.
- EAN pertencente a outro código, produto arquivado, códigos repetidos,
  saldo abaixo da soma de reservas/quarentena, **venda online paga ainda
  não confirmada no ERP**, ou qualquer ambiguidade: não modifica o SKU
  afetado e mostra motivo no painel. Os outros produtos continuam.
- Atualiza somente saldo absoluto e preço base de venda; não altera promoções
  vigentes, fotos, categorias, títulos, aprovações sanitárias, pedidos,
  pagamentos ou documentos do cliente.
- SKU novo é incluído **inativo** (exige revisão sanitária/comercial).
- Arquivo não inclui todos os produtos? O robô **não exclui, não zera e
  não arquiva** os ausentes. Relatórios incompatíveis ou parciais falham
  antes de qualquer atualização.
- Saldos positivos não autorizam venda quando um pedido pago ainda não
  foi conciliado com o InovaFarma. A integração da saída de vendas no ERP
  continua dependente do fornecedor.

## Escopo exato

Não existe acesso automático à base de dados da Precisão Sistemas,
nem atualização automática da venda no ERP. Também não é possível
derivar descontos das campanhas pelo CSV de Posição de Estoque; novas
promoções exigem o arquivo específico de promoções até que haja um
conector oficial homologado. A chave pode ser revogada a qualquer
momento no painel.

Arquivos de produção, credenciais e backups devem permanecer privados.
