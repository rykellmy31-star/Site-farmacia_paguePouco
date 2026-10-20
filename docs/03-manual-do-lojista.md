# 03 — Manual do lojista (sem precisar programar)

Este manual é para o dia a dia da farmácia. **Tudo o que está aqui é feito pelo
painel, sem editar código.** Endereço do painel: `https://seudominio.com.br/admin`.

## Sumário rápido

1. [Primeiros passos](#1-primeiros-passos)
2. [Cadastrar um produto](#2-cadastrar-um-produto)
3. [Fotos e vídeos do produto](#3-fotos-e-vídeos)
4. [Estoque](#4-estoque)
5. [Categorias (departamentos)](#5-categorias-departamentos)
6. [Regras sanitárias e medicamentos](#6-regras-sanitárias-e-medicamentos)
7. [Pedidos](#7-pedidos)
8. [Pagamentos e reembolsos](#8-pagamentos-e-reembolsos)
9. [Clientes](#9-clientes)
10. [Fretes](#10-fretes)
11. [Cupons e promoções](#11-cupons-e-promoções)
12. [Banners e vitrines da home](#12-banners-e-vitrines-da-home)
13. [Páginas institucionais](#13-páginas-institucionais)
14. [WhatsApp de atendimento](#14-whatsapp-de-atendimento)
15. [Aparência (cores e logo)](#15-aparência-cores-e-logo)
16. [Usuários e permissões](#16-usuários-e-permissões)
17. [Relatórios](#17-relatórios)
18. [Backup](#18-backup)

---

## 1. Primeiros passos

Acesse `Configurações → Empresa` e preencha: **nome da farmácia, CNPJ, endereço,
telefone, e-mail, horário de atendimento, redes sociais**. Depois, em
`Configurações → Aparência`, envie a **logo** e ajuste as cores.
Esses dados aparecem no cabeçalho, rodapé, notas e páginas institucionais.

> Dica: enquanto estiver configurando, mantenha o produto **inativo** e ative só
> quando estiver pronto para vender.

---

## 2. Cadastrar um produto

`Produtos → + Novo produto`.

| Campo | Observação |
|---|---|
| **Nome** | Nome que o cliente vê. O endereço (URL) é gerado sozinho. |
| **Código interno / SKU / EAN** | Controle interno e leitura de código de barras. |
| **Marca / Fabricante** | A marca vira um link de busca automática. |
| **Categoria / Subcategoria** | É o que coloca o produto no menu de departamentos. |
| **Preço** e **Preço promocional** | Em reais. A promoção só vale se for menor que o preço normal; o desconto em % é calculado sozinho. |
| **Estoque / Estoque mínimo** | Quantidade disponível e o nível que dispara o alerta de estoque baixo. |
| **Peso e dimensões** | Usados nos limites de frete. |
| **Descrição** | Texto com formatação (negrito, listas, links). |
| **Características** | Pares "nome: valor" (ex.: *Tipo de pele: Oleosa*). |
| **Ativo / Destaque** | Produto inativo não aparece no site. Destaque leva o produto para a vitrine da home. |

**Importação em massa:** `Produtos → Importar/exportar`. O modelo é um arquivo CSV.
Exporte primeiro para ver o formato, preencha e importe.

---

## 3. Fotos e vídeos

- Na tela do produto, use a área **"Arraste as fotos"** (ou clique para escolher).
  Várias fotos de uma vez; formatos aceitos: **JPG, PNG, WEBP, SVG** e vídeos **MP4/WEBM**.
- A **primeira foto é a principal** (a que aparece nas vitrines). Use o botão
  **"Definir como principal"** para trocar, ou **Remover** para apagar.
- **Sempre clique em "Salvar produto"** depois de mexer nas fotos — a troca só é
  confirmada com o salvamento.
- Todos os arquivos ficam em `Mídia`, onde podem ser reaproveitados e têm a URL
  copiável. Arquivos em uso não são apagados sem confirmação.

> Boas práticas: fotos quadradas, fundo claro, produto nítido. Isso melhora a venda
> e o posicionamento no Google.

---

## 4. Estoque

`Estoque` mostra a situação de cada produto (disponível, reservado, mínimo).

- **Entrada/Saída/Ajuste:** informe a quantidade e a observação (ex.: "Reposição NF 123").
- Toda movimentação fica registrada no **histórico**, com data e responsável.
- Quando o pedido é **confirmado** (pagamento aprovado), o sistema **baixa** o estoque.
  Enquanto o pagamento está pendente, a quantidade fica **reservada** — assim duas
  pessoas não compram a mesma última unidade.
- Se o pedido é **cancelado**, a reserva é liberada (ou o estoque devolvido, se já
  tiver sido baixado).
- Com estoque zerado, o produto aparece como **esgotado** e não pode ser comprado.

---

## 5. Categorias (departamentos)

`Categorias → + Nova categoria`. Dê um nome, escolha um ícone/emoji e a ordem de
exibição. **Não há limite de categorias** — as 16 iniciais são apenas o ponto de
partida e podem ser renomeadas, desativadas ou excluídas.

Para criar uma **subcategoria**, escolha a categoria "pai" no cadastro
(ex.: *Medicamentos isentos de prescrição › Dor e febre*).

---

## 6. Regras sanitárias e medicamentos

O sistema **bloqueia automaticamente a venda online** de:

- medicamentos **controlados** ou que exijam **receita** (RDC 44/2009);
- produtos com **cadastro sanitário incompleto** (falta registro na Anvisa, quando exigido);
- medicamentos **sem aprovação do farmacêutico responsável técnico**.

O produto bloqueado **continua visível no site** (para informação), mas sem botão de
compra e com aviso claro de indisponibilidade.

**Quem libera:** o perfil **Responsável técnico (farmacêutico)**, em
`Produtos → editar produto → Situação sanitária`. Registre:
classificação, registro MS, apresentação, concentração, princípio ativo, fabricante e
link da bula oficial. Depois clique em **Aprovar**.

> O sistema **não escreve texto de bula nem alegações terapêuticas**. Use sempre o
> link oficial da bula e textos aprovados pelo responsável técnico.

---

## 7. Pedidos

`Pedidos` lista todos os pedidos com **dois status independentes**:

- **Financeiro:** Aguardando pagamento · Pagamento aprovado · Recusado · Estornado · Expirado.
- **Operacional:** Aguardando pagamento · Em separação · Preparando envio ·
  Enviado · Saiu para entrega · Entregue · Cancelado.

Ao abrir um pedido você pode:

- **alterar o status** (cada alteração fica registrada no histórico);
- **informar o código de rastreio** (o cliente vê na área dele);
- **cancelar** (devolve o estoque);
- **simular aprovação** — **somente em ambiente de testes**, para validar o fluxo;
- **estornar** o pagamento (quando o provedor permite).

---

## 8. Pagamentos e reembolsos

`Pagamentos` (Configurações) define as formas aceitas (Pix, cartão de crédito,
débito), o número máximo de parcelas, parcela mínima e juros, além das credenciais
do provedor.

- Por padrão o sistema usa o **provedor interno de testes**, que gera um código Pix
  **SIMULADO** (não pagável) — serve para validar o fluxo sem movimentar dinheiro.
- Para receber de verdade, configure o **Mercado Pago** com as credenciais da
  **conta da empresa** (ver `docs/04`). As chaves ficam no servidor e nunca aparecem
  para o cliente.
- **Nenhum pagamento é marcado como aprovado sem a confirmação do provedor.**
- **Estorno:** abra o pedido e use *Estornar*.

---

## 9. Clientes

`Clientes` mostra o cadastro, os pedidos e os endereços de cada pessoa. É possível
ativar/desativar o acesso. Os dados são tratados conforme a LGPD: use-os apenas para
a operação da loja e mantenha o consentimento de marketing registrado.

---

## 10. Fretes

`Fretes` (Configurações) — **tabela fixa por estado**, sem depender dos Correios.

- Para cada um dos **26 estados + DF**: valor, prazo mínimo e máximo, e liga/desliga.
- **Frete grátis:** valor mínimo do pedido e para quais estados vale.
- **Retirada na loja:** endereço e horário.
- **Entrega local:** cidades atendidas pela própria farmácia.
- **Exceções:** valor/prazo diferente por cidade ou faixa de CEP.
- **Limites:** peso máximo, cubagem e valor por quilo excedente.
- **Mensagem de indisponibilidade:** texto exibido quando não atendemos a região.

Se um estado estiver desligado, o sistema **não inventa frete**: informa que ainda
não atende aquela localidade.

A tabela completa de estados/valores/prazos também aparece na página pública
`Entregas e Fretes`, que é atualizada sozinha.

---

## 11. Cupons e promoções

`Promoções → + Novo cupom`: código, tipo (**percentual** ou **valor fixo**), valor,
valor mínimo do pedido, validade, limite de usos e categorias permitidas.
Há também **cupom de frete grátis**.

Ofertas e vitrines de ofertas são montadas em `Promoções → Vitrines` e aparecem
automaticamente na home e na página **Ofertas**.

---

## 12. Banners e vitrines da home

- **Banners:** `Banners → + Novo banner` (imagem, título, link, posição, ordem,
  data de início/fim, ativo). O carrossel da home usa a posição *principal*.
- **Vitrines:** `Aparência → Vitrines` para criar seções como "Mais vendidos",
  "Novidades", "Ofertas do dia" ou uma vitrine por marca/categoria, definindo a ordem.
- **Seções:** `Aparência → Seções` liga/desliga e reordena os blocos da home
  (banners, categorias, ofertas, entrega, institucional...).

---

## 13. Páginas institucionais

`Páginas` edita as 14 páginas (Quem Somos, Nossas Lojas, Atendimento, Fale Conosco,
FAQ, Como Comprar, Formas de Pagamento, Entregas e Fretes, Trocas e Devoluções,
Privacidade, Cookies, Termos de Uso, Atendimento Farmacêutico e Informações
Sanitárias) **e permite criar novas**.

Use o editor de texto (negrito, títulos, listas, links). Textos jurídicos e sanitários
devem ser revisados pelo responsável antes de publicar — por isso há o campo de
revisão e o rascunho/publicação.

---

## 14. WhatsApp de atendimento

`WhatsApp de atendimento` (Configurações):

- número (com DDD e DDI, ex.: `55 73 99999-0000`);
- liga/desliga, texto do botão, mensagem inicial;
- **dias e horários de atendimento** e a mensagem exibida fora do horário;
- em quais páginas o botão aparece.

O botão flutuante fica no canto inferior direito e abre o link oficial `wa.me`.
**Ele é exclusivo para tirar dúvidas — nenhuma compra é feita pelo WhatsApp.**

---

## 15. Aparência (cores e logo)

`Configurações → Aparência`: envie a **logo** (e a logo do rodapé), escolha as cores
primária e de destaque, e configure títulos/descrições para o Google (SEO).

---

## 16. Usuários e permissões

`Usuários` cria logins para a equipe. Perfis:

| Perfil | Pode fazer |
|---|---|
| **Super Administrador** | Tudo, inclusive gerenciar usuários |
| **Administrador** | Opera toda a loja, menos usuários |
| **Gerente** | Produtos, estoque, pedidos, relatórios, promoções |
| **Atendente** | Pedidos, clientes e páginas institucionais |
| **Operador de pedidos** | Separação, expedição e status de pedidos |
| **Responsável técnico** | Cadastro sanitário e aprovação de medicamentos |

As permissões são verificadas **no servidor**: esconder o botão na tela não dá acesso
a quem não tem permissão.

---

## 17. Relatórios

`Relatórios`: vendas por período, produtos mais vendidos, ticket médio, pedidos por
status, clientes e estoque — com **exportação em CSV** para abrir no Excel.

---

## 18. Backup

`Sistema → Backup` gera um arquivo com todos os dados (banco + fotos/vídeos).
Também é possível rodar `npm run backup` no servidor.

**Recomendação:** faça backup diário e guarde uma cópia fora do servidor.
Em `Sistema → E-mails` você vê a fila de mensagens enviadas; em
`Sistema → Auditoria`, todas as ações da equipe.
