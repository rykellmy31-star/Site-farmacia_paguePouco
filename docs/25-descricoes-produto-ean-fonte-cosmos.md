# Consulta automática de descrições por EAN

O produto agora possui **três ferramentas separadas** na administração:

1. **Buscar descrição pelo EAN** — marca, nome, conteúdo e informações cadastrais da embalagem.
2. **Buscar imagem PNG pelo EAN** — foto frontal, conversão para PNG e verificação de qualidade.
3. **Buscar dimensões pelo EAN** — peso bruto e medidas de transporte quando disponível, com revisão.

A busca de descrição funciona automaticamente para campos **vazios** ao salvar/ativar um produto. Cadastros preenchidos são preservados. Nome comercial, preço, estoque, classificação sanitária, exigência de receita, registro na Anvisa e outros dados regulados não são modificados. A descrição não inventa alegações de saúde.

## Fontes

- **Bluesoft Cosmos**: catálogo brasileiro por GTIN que oferece descrição, marca, peso bruto/líquido e dimensões via API autenticada. A integração de descrições está pronta, porém **só consulta a API caso COSMOS_API_TOKEN já esteja configurado**; não há uso clandestino/sem licença.
- **Open Food Facts / Open Beauty Facts / Open Products Facts**: API pública por EAN, sem token, com nome, designação, marca, quantidade e embalagem, utilizada automaticamente sem configuração.
- As fotografias continuam restritas às fontes com licença apropriada e mesmo EAN; o módulo de descrição não reutiliza imagens comerciais do Cosmos.

**Opcional:** na Cloudflare Workers, `COSMOS_API_TOKEN` poderá ser configurado como segredo. Sem o token, as bases gratuitas funcionam normalmente. A fonte Cosmos não é obrigatória e não cria despesas automaticamente.

Fontes da documentação:
- https://api.cosmos.bluesoft.com.br/api
- https://api.cosmos.bluesoft.com.br/api-pricings
- https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/

A fonte gratuita é ODbL; o registro de descrição inclui atribuição de fonte e exige verificação no rótulo do fabricante. A cobertura depende do cadastro disponível para cada EAN.
