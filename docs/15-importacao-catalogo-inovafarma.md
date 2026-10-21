# Importação assistida do catálogo InovaFarma

## Objetivo

Evitar que a farmácia cadastre manualmente um por um os produtos que já
existem no ERP. A nova área
**Painel → Produtos → Importar da InovaFarma** permite revisão de
lotes encaminhados por um conector autorizado e importação de vários
produtos em uma única ação. O **Super Administrador decide o que manter**.

## Como funciona após documentação, homologação e ativação autorizada

1. O conector oficial recebe ou consulta o catálogo da Precisão Sistemas
   pelos meios e permissões oficialmente documentados.
2. Ele mapeia os campos oficiais para **nosso contrato interno**, e envia
   lotes de até **250 produtos** ao endpoint privado de recebimento do site.
3. Os EANs são validados e usados como chave textual (sem perder zeros).
   Lotes repetidos são idempotentes, lotes com EAN repetido ou campos
   inconsistentes são rejeitados por inteiro.
4. Os produtos aparecem em **Importar da InovaFarma → Aguardando revisão**.
   Por padrão, a listagem mostra apenas os que o ERP informou com saldo
   maior que zero. Pode-se visualizar todos os saldos e filtrar pelo nome/EAN.
5. O Super Administrador marca os produtos desejados e clica
   **Importar selecionados (inativos)** ou **Ignorar selecionados**.
   Cada página permite até 50 por operação para limitar o risco.
6. Produtos inéditos entram em **Produtos**, mas **inativos e bloqueados
   para venda**, com nome, EAN, código interno, marca e preço recebido
   quando disponível. É obrigatório revisar enquadramento sanitário,
   apresentação, registro MS, categoria e dados comerciais antes de
   habilitar para venda. Receber um catálogo não autoriza automaticamente
   comercializar medicamentos.
7. Se o EAN já tiver **uma** correspondência no site, o registro existente
   é vinculado sem modificar título, estoque, preço, fotos ou publicação.
   Se houver **mais de uma correspondência**, a importação bloqueia até
   corrigir a duplicidade.
8. A quantidade recebida no catálogo é apenas **informativa**. A quantidade
   vendável permanece zero nos novos produtos até um **snapshot oficial
   posterior**, homologado pelo fluxo de estoque já existente, respeitando
   reservas e débitos não refletidos no ERP. Não realiza dupla baixa.

## Contrato INTERNO do site (não é contrato oficial da InovaFarma)

`POST /webhooks/inovafarma/catalogo`

Exige HTTPS, `Authorization: Bearer INOVA_STOCK_TOKEN`, integração
homologada com `INOVA_STOCK_ENABLED=true` e limite de corpo 256 KiB.
O endpoint permanece inacessível enquanto a integração estiver desligada.

Exemplo meramente sintético para desenvolvimento:

```json
{
  "loteId": "catalogo-20261021-0001",
  "geradoEm": "2026-10-21T17:00:00.000Z",
  "itens": [
    {
      "ean": "7891234567890",
      "nome": "Produto de exemplo",
      "codigoInterno": "00125",
      "marca": "Marca de exemplo",
      "precoCentavos": 1299,
      "quantidade": 20
    }
  ]
}
```

O campo `precoCentavos` é opcional e expresso em inteiros; saldo é
inteiro não negativo. Esse esquema foi criado para **a ponte interna do
site**. É necessário mapear o contrato real após recebê-lo da Precisão.
O ERP pode não fornecer todas as informações e pode exigir liberação
contratual específica para envio do mix de produtos.

## O que NÃO está ativado agora

- Não existe rotina que chama a API oficial da InovaFarma e puxa produtos:
  ainda faltam documentação do fornecedor e conector homologado.
- Nenhum produto foi criado na base de produção por esse recurso.
- A rota de recepção continua **desabilitada** com
  `INOVA_STOCK_ENABLED=false`.
- A revisão humana é obrigatória antes de inserir na aba Produtos e
  continua necessária para publicação.
- Nenhuma chave foi criada, nenhum preço ou estoque atual foi modificado,
  nenhuma mudança ocorreu na identidade do Durable Object LOJA.

Na etapa **INICIAR INTEGRAÇÃO INOVA**, implementar o adaptador oficial
que realiza a importação paginada do mix, com retries, autenticação,
limites de taxa e monitoramento da quantidade total do catálogo, sem
presumir rotas, campos ou formatos da API.
