# Bloqueio automático de controlados — InovaFarma V3/V4

## Escopo
- **V4** continua exportando o CSV do ERP, sem modificações.
- **V3** continua recebendo e enviando o relatório com mesmo token e mesma estrutura.
- O **servidor** verifica a lista de exclusão **antes** de inserir produto novo ou de atualizar um existente. Produtos identificados não entram no catálogo via robô; cadastros pré-existentes correspondentes são inativados, sem exclusão de pedidos/estoques/histórico.
- O servidor bloqueia reativação de qualquer cadastro sinalizado em `bloqueioControladoInova.ativo` e o checkout continua sujeito à mesma validação.
- O painel **/admin/robo-inovafarma** permite importar arquivo CSV somente pelo **Superadmin** e aplicar o bloqueio ao catálogo existente.
- A lista é **aditiva**, não remove bloqueios prévios silenciosamente. Códigos internos e EANs são preferidos e os nomes são comparados exatamente após normalização. Além disso, alguns nomes de princípios ativos são identificados como medida preliminar.
- O último relatório informa a quantidade barrada e a triagem permite conferir os itens.

## Como importar seu CSV de psicotrópicos
1. Exporte **somente** a relação de medicamentos psicotrópicos/controlados do InovaFarma.
2. Acesse **Painel → Robô de Estoque InovaFarma → Bloqueio automático de medicamentos controlados**.
3. Envie CSV de até 4 MB contendo colunas **Código**, **Cod. Barra/EAN**, e/ou **Produto**. É suficiente pelo menos um identificador por linha.
4. Os cadastros existentes que corresponderem à lista serão inativados imediatamente; nos relatórios posteriores o robô não cadastrará tais produtos. Não se altera o banco do ERP.
5. Para rodar novamente a checagem do catálogo, use **Aplicar bloqueios ao catálogo atual**.

## Cuidados essenciais
- Enviar **só** o CSV de psicotrópicos/controlados. Um CSV de estoque comum nesta seção bloquearia produtos que não deveriam ser bloqueados.
- A identificação **não é completa** enquanto não houver lista atualizada, inclusive nomes comerciais. Um produto ausente da lista **não** é certificado como livre de restrições.
- Psicotrópicos são apenas parte dos produtos sujeitos a controle especial. A referência legal vigente é a Portaria 344/1998 e as atualizações publicadas pela Anvisa: https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/lista-substancias
- Bloquear preventivamente **não** exige aprovação manual individual; qualquer reclassificação ou desbloqueio deve ser avaliado pelo farmacêutico responsável. O bloqueio não substitui obrigações sanitárias ou controle de receita.
- Não enviar dados de pacientes, prescrições, CPF ou tokens nesse CSV.
- A lista inicial foi criada com exemplos de princípios ativos e **não equivale** a uma cópia completa das listas oficiais.

## Testes
`node --test tests/triagem-controlados.test.js tests/bloqueio-controlados-inova.test.js tests/inovafarma-robo-auto.test.js`
