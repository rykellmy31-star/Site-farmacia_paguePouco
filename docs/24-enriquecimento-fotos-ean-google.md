# Enriquecimento automático do cadastro pelo EAN

Ao clicar **Ativar** na lista, o sistema tenta preencher somente os dados ausentes:
- Foto principal: selecionada somente em catálogos Open Facts por EAN exato; nunca substitui foto já existente.
- Peso e dimensões: bases estruturadas já integradas. Quando disponível, Google Custom Search fornece dimensões de embalagem **explícitas** em trechos que também citem o mesmo EAN; o operador deve conferir antes de usar para frete.
- Nas telas de cadastro/edição: ao informar EAN ou clicar em **Buscar foto, peso e dimensões**, a foto será anexada ao formulário e salva junto com o produto. Os dados inseridos manualmente permanecem preservados.

## Acesso opcional ao Google

**Aviso importante:** a Custom Search JSON API do Google está fechada para novos clientes e será descontinuada em **1º de janeiro de 2027**. O código permite a conexão somente para contas que já possuírem acesso válido, **não** usa raspagem do Google Imagens.

Para titular elegível, em Cloudflare Worker → Configurações → Variáveis e segredos:
- `GOOGLE_CSE_API_KEY` (segredo, não compartilhar): chave de API já ativa.
- `GOOGLE_CSE_CX` (variável/segredo): ID do mecanismo de pesquisa existente.

Mesmo com a busca do Google, imagens de outros sites comerciais **não são copiadas automaticamente**, por restrições de licença e risco de associar embalagem de produto diferente. Apenas imagens de repositórios Open Facts por EAN exato e licença conhecida entram no catálogo.

## Licença, origem e segurança

Imagens do projeto Open Facts são geralmente **CC BY-SA 3.0**. A legenda registra fonte, atribuição e licença. O cadastro preserva foto/manual e dados já preenchidos. Fotos utilizam o URL público da origem e podem ficar indisponíveis se a origem mudar; não são baixadas do Google nem armazenadas como arquivos da farmácia. EAN inválido não dá foto.

Dimensões da imagem (pixels), peso líquido e quantidade (comprimidos, ml) não equivalem ao peso bruto/dimensões da embalagem de transporte. Não inventar medidas logísticas. Preços, estoque, classificação sanitária e bloqueios de venda não são alterados.

Documentação Google: https://developers.google.com/custom-search/v1/overview
Licença Open Food Facts: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/
