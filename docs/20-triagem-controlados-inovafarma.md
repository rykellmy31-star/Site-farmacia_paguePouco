# Triagem preliminar de controlados — InovaFarma V3/V4

## Funcionamento
- **V4** continua clicando no InovaFarma e exportando o CSV sem alterações.
- **V3** continua autenticando, validando e enviando o CSV ao site sem alterações de formato, agendamento ou pareamento.
- No painel **Robô de Estoque InovaFarma** (Superadmin), após o último lote completo, uma seção nova apresenta os **possíveis** medicamentos controlados detectados pelo nome descrito no CSV. Mostra código, EAN, produto e termo encontrado, com paginação.
- Não modifica nenhum produto, estoque, preço, status de ativação, pedidos ou regras de checkout. A classificação sanitária atual do site mantém suas restrições.
- O exemplo **clonazepam** é reconhecido quando a palavra aparece no nome; a lista inicial contém também alguns outros princípios ativos. A triagem **não é um catálogo oficial ou exaustivo**.

## Limites e segurança
- Nomes comerciais sem princípio ativo explícito no CSV podem não ser identificados. O resultado zero **não significa** ausência de controlados.
- Identificação por nome é apenas um alerta, **não prova** a tarja, enquadramento regulatório, tipo de receita ou registro do produto. Mesmo coincidências devem ser revisadas pelo farmacêutico.
- Fonte oficial para conferência: [Anvisa — Listas de substâncias sujeitas a controle especial](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/lista-substancias). O Anexo I da Portaria 344/1998 sofre atualizações.
- A integração completa deve posteriormente cruzar **registro Anvisa/princípio ativo/apresentação** e, quando houver fonte confiável e licenciamento adequado, códigos EAN/GTIN, com exceções por apresentação.
- A revisão do responsável técnico deve determinar o enquadramento e atualizar o cadastro sanitário antes de qualquer ativação. A triagem não substitui o farmacêutico nem valida receitas.
- **Não usar** este resultado isoladamente para liberar venda, dispensação remota ou alterar estoque.
- Não copiar dados de clientes, CPF, prescrições, senhas ou tokens para a triagem.

## Teste
`node --test tests/triagem-controlados.test.js`
