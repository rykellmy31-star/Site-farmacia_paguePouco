# Exportação ANTIMICROBIANO e indicadores da Visão Geral

## Origem e classificação
- Arquivo enviado: posição de estoque InovaFarma de **29/10/2026**, classe terapêutica **ANTIMICROBIANO**.
- **163 produtos** (121 com estoque positivo, 42 zerados, 0 negativos), total de 247 unidades. Isso é uma fotografia do arquivo, **não** a quantidade no site.
- Triagem preliminar: **149** antibióticos ou associações com antibióticos; **12** antimicrobianos/antiprotozoários; **1** antimicrobiano não antibiótico (Oto-Betnovate / clorfenesina); **1** medicamento de outra classe (Akineton / biperideno, sujeito a controle especial). Uma classificação administrativa não substitui a conferência farmacêutica e o registro na Anvisa.
- Mantém-se a exclusão conservadora dos **163 identificadores** desse relatório, pois esta loja optou por não vender online os produtos sujeitos à política de restrição. Não se confunde exclusão comercial da loja com proibição legal geral de venda remota.

## Como funciona a exclusão
1. Os scripts Windows **V3 e V4** não foram modificados. Exportação e envio do CSV geral continuam normalmente.
2. O servidor, antes de cadastrar/alterar cada produto do relatório do robô, compara código interno e EAN a fingerprints da lista fixa de 163 produtos. Correspondências são ignoradas: **produtos novos não são cadastrados**, produtos já existentes são inativados no próximo relatório. Não se apaga estoque/histórico de pedidos.
3. Mesmo antes da próxima passagem do robô, produtos previamente cadastrados correspondentes são excluídos das buscas, vitrines e páginas públicas; links diretos retornam 404. No checkout são rejeitados.
4. Lista inicial de psicotrópicos (280) continua protegida; não altera nenhum identificador/intervalo/token do robô.
5. Os identificadores da lista fixa são fingerprints determinísticos. Não é sigilo criptográfico, mas evita incluir os nomes e dados do CSV privado no repositório.
6. Para atualizações da lista, deve-se usar um novo CSV exclusivamente de antimicrobianos revisado, e não o CSV completo do estoque.

## Mudança exclusiva do painel **Visão Geral**
- Cartão **Produtos com estoque** conta apenas produtos com `ativo === true`, estoque `quantidade > 0`, não arquivados e não sujeitos a barreiras de ativação/controle sanitário ou exclusão por arquivo.
- Cartão **Estoque baixo**, lista de baixo estoque e ranking visível consideram os produtos ativos elegíveis acima de zero, sem medicamentos excluídos.
- A aba administrativa **Produtos** preserva o cadastro completo para manutenção/auditoria, inclusive inativos e zerados; indicadores históricos de relatórios comerciais não são reescritos.

## Regulamentação e limites
- A **RDC 471/2021, art. 12**, não impõe proibição absoluta de comercialização por meio remoto; a loja faz o bloqueio por opção administrativa e por não implementar conferência de receitas.
- A IN 360/2025 e eventuais atualizações estabelecem substâncias sujeitas a prescrição e retenção; a conferência dos nomes comerciais/registro cabe ao farmacêutico.
- Não enviar dados pessoais ou receitas nas exportações usadas para alimentar essa lista.

## Testes
`node --test tests/visao-geral-antimicrobianos-estoque.test.js tests/bloqueio-controlados-inova.test.js`
