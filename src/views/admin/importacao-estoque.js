/**
 * Importação CSV manual do estoque: substitui a página de integração API do ERP.
 * Nunca coleta credenciais do InovaFarma e não ativa sincronização automática.
 */
import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel } from './layout.js';

export function telaImportacaoEstoque(ctx) {
  return paginaAdmin(ctx, {
    titulo: 'Importação de estoque',
    ativo: 'importacao_estoque',
    conteudo: `
      <h1 class="mt-0">Importação de estoque</h1>
      <div class="alerta info">
        <strong>Quer zerar todos os produtos e não reaproveitar nenhum cadastro antigo?</strong>
        Utilize a função específica
        <a class="botao" href="/admin/produtos/substituir-catalogo">Substituir todo o catálogo pelo InovaFarma</a>.
        A importação de estoque abaixo apenas atualiza/cadastra produtos e NÃO remove os atuais.
      </div>
      <div class="alerta info">
        <strong>Importação inicial por relatório do InovaFarma.</strong>
        Exporte a Posição de Estoque no aplicativo Windows em formato CSV e envie aqui.
        Não é necessário informar senha, API ou permitir acesso ao seu computador.
      </div>
      ${painel({
        titulo: '1. Enviar relatório de estoque',
        corpo: `<p>O arquivo precisa ter pelo menos estas colunas:
          <strong>código de barras (EAN), descrição, quantidade em estoque e preço de venda</strong>.
          Também pode incluir código interno e marca. O preço pode estar em formato
          brasileiro (<strong>R$ 12,90</strong> ou <strong>12,90</strong>). Não utilize preço de custo.</p>
          <form method="post" action="/admin/api/produtos/inova-csv/preparar" enctype="multipart/form-data">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <div class="campo">
              <label for="arquivoInovaCsv">Selecione o relatório de estoque (CSV)</label>
              <input type="file" name="arquivo" id="arquivoInovaCsv"
                accept=".csv,text/csv" required>
            </div>
            <button class="botao" type="submit">Conferir relatório antes de importar</button>
          </form>`,
      })}
      ${painel({
        titulo: '2. Conferir estoque e preços antes de confirmar',
        corpo: `<p class="texto-pequeno">Antes da importação, o sistema mostrará quantos produtos
          serão cadastrados, atualizados, permanecerão iguais ou apresentam conflitos.
          Somente <strong>depois de confirmar</strong> haverá alteração.</p>
          <p class="texto-pequeno">Para produtos existentes, <strong>o saldo e o preço de venda serão atualizados</strong>
          se o relatório trouxer essa coluna. A prévia exibirá o valor anterior e o novo,
          com alerta para mudanças expressivas.
          Imagens, categorias, pedidos e cadastro sanitário são preservados.
          Produto com quantidade zero fica esgotado. Se houver reservas de pedidos
          incompatíveis, o arquivo é bloqueado para evitar inconsistências.</p>
          <p class="texto-pequeno">Produtos novos são cadastrados com <strong>nome, código de barras, saldo e preço de venda</strong>
          do relatório, mas ficam <strong>inativos</strong> até revisão comercial e sanitária.
          A imagem ainda deverá ser adicionada no painel.
          Produtos que não aparecem no relatório não são zerados automaticamente.
          Se faltar a coluna de preço no arquivo, os preços existentes não serão substituídos,
          e os produtos novos permanecerão inativos e sem preço.</p>`,
      })}
      ${painel({
        titulo: '3. Conferir descontos e promoções do InovaFarma',
        corpo: `<p>O <strong>Relatório de Promoções</strong> é diferente do relatório de estoque:
          ele mostra campanhas, preços promocionais, desconto percentual e período.
          Envie o CSV que você exportou no menu Relatório de Promoções do InovaFarma.</p>
          <div class="alerta info"><strong>Conferência antes de aplicar.</strong>
            Você pode apenas conferir ou preparar a aplicação dos descontos.
            <strong>Nada será alterado até você revisar a lista e confirmar.</strong>
            Promoções com vigência definida serão ativadas e encerradas automaticamente.
            Campanhas semanais sem data final exigem que você informe uma validade máxima.</div>
          <form method="post" action="/admin/estoque/promocoes/conferir"
                enctype="multipart/form-data">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <div class="campo">
              <label for="arquivoPromocoesInova">Selecione Relatório de Promoções (CSV)</label>
              <input type="file" name="arquivo" id="arquivoPromocoesInova"
                     accept=".csv,text/csv" required>
            </div>
            <div class="campo">
              <label for="validadePromoSemFim">Validade máxima das campanhas semanais sem data final (opcional)</label>
              <input id="validadePromoSemFim" type="date" name="fimSemData">
              <p class="texto-pequeno">Defina até quando aplicar promoções como
              Segunda Fitness, Terça do Suplemento ou Quinta do Esmalte.
              Máximo de 90 dias a partir de hoje. Sem data, essas campanhas serão ignoradas.</p>
            </div>
            <div class="campo">
              <label>
                <input type="checkbox" name="aceitaTodosOnline" value="1">
                Autorizo os preços promocionais deste relatório para Pix, crédito e débito
                no site, mesmo que o InovaFarma tenha restrições de forma de pagamento.
              </label>
              <p class="texto-pequeno">Se não autorizar, campanhas com restrições de pagamento
              não serão aplicadas ao site. Não há combinação de descontos.</p>
            </div>
            <div class="linha" style="gap:8px;flex-wrap:wrap">
              <button class="botao secundario" type="submit">Somente conferir promoções</button>
              <button class="botao" type="submit"
                formaction="/admin/estoque/promocoes/preparar">Conferir e preparar aplicação dos descontos</button>
            </div>
          </form>`,
      })}
      ${painel({
        titulo: '4. Limpeza por comparação (alternativa, sem zerar tudo)',
        corpo: `<p>Compare os produtos já cadastrados no site com o relatório atualizado
          da <strong>Posição de Estoque do InovaFarma</strong> (CSV). A comparação utiliza
          EAN e código interno, inclusive em produtos que já existiam antes da
          importação inicial.</p>
          <div class="alerta info"><strong>Somente prévia: não exclui nada.</strong>
          Produtos com pedidos, reservas, códigos ambíguos ou sem identificador
          exigem revisão. Use o relatório integral com 6.128 registros, não o arquivo filtrado com 6.062 itens. O CSV exportado pelo próprio site não substitui a posição de estoque do InovaFarma. Os produtos sem EAN que ficaram pendentes também
          precisam ser regularizados antes de uma limpeza definitiva.</div>
          <form method="post" action="/admin/estoque/limpeza/previa"
                enctype="multipart/form-data">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <div class="campo">
              <label for="arquivoConciliacaoInova">Relatório atual de estoque do InovaFarma (CSV)</label>
              <input type="file" name="arquivo" id="arquivoConciliacaoInova"
                     accept=".csv,text/csv" required>
            </div>
            <button class="botao" type="submit">Conferir produtos antigos sem excluir</button>
          </form>`,
      })}
      ${painel({
        titulo: '5. Robô de exportações InovaFarma — preparação local',
        corpo: `<p class="texto-pequeno"><strong>Fase 1 disponível para instalar no Windows.</strong>
          O robô monitora a pasta de relatórios exportados, valida CSVs de estoque e
          promoções, impede duplicatas e organiza cópias para revisão.</p>
          <p class="texto-pequeno"><strong>Ainda não está instalado nem enviando atualizações
          automaticamente.</strong> Por segurança, a importação no site continua
          exigindo envio e confirmação humana. Não modifica o ERP.</p>
          <p><a href="https://github.com/rykellmy31-star/Site-farmacia_paguePouco/blob/main/docs/18-robo-windows-inovafarma.md"
          target="_blank" rel="noopener noreferrer" class="botao secundario">Ver instalação do robô Windows</a></p>`,
      })}
    `,
  });
}
