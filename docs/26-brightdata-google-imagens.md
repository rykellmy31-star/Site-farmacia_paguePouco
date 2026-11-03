# Pesquisa Google Imagens por EAN — Bright Data

## Configuração no Worker oficial
Cloudflare > Workers e Pages > site-farmacia-paguepouco > Configurações > Variáveis e segredos:
- `BRIGHTDATA_API_TOKEN`: **segredo** (token copiado em API Keys, não divulgar).
- `BRIGHTDATA_SERP_ZONE`: **variável** com nome EXATO da zona SERP. O padrão é `cr_farmacia_imagens`, mas é necessário conferir o nome no painel da Bright Data.

O código usa `POST https://api.brightdata.com/request` com `Authorization: Bearer`,
`zone` e URL Google com `tbm=isch&gl=br&hl=pt-BR&brd_json=1`.
Somente a rota autenticada `POST /admin/api/produtos/google-imagens` pode acionar
a pesquisa (permissão de edição de produtos).

## Uso
Abra o formulário de edição de produto e clique em **Pesquisar Google Imagens pelo EAN**.
O painel mostra até 12 resultados da pesquisa e link da fonte original para conferência.

**Este primeiro estágio é somente leitura:** não altera catálogo, pedidos,
estoque, preços, imagens manuais, regras sanitárias ou banco. Não realiza
consulta em massa nem faz upload automático de resultados do Google.
A SERP retorna links de terceiros; sua exibição não autoriza reproduzir a
imagem comercialmente. Verifique licença e equivalência exata da embalagem.
Após validar alguns EANs com foto correta e uso permitido, a automação de
lotes poderá ser implementada com cotas, progresso persistido e opção de
parar/retomar.

## Custo e consumo
O fornecedor anuncia até 5.000 pesquisas gratuitas mensais de SERP API,
mas a cota específica da zona deve ser confirmada no Billing da conta.
Cada clique em Pesquisar pode consumir uma pesquisa. Não presumir que
4.000 fotos podem ser baixadas ou utilizadas automaticamente.
