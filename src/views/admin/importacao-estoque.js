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
          <div class="alerta info"><strong>Prévia somente leitura.</strong>
            O site não aplicará nenhum desconto ao conferir o relatório.
            Campanhas por dia da semana, promoções futuras e condições de pagamento
            precisarão ser revisadas antes de permitir atualização automática.</div>
          <form method="post" action="/admin/estoque/promocoes/conferir"
                enctype="multipart/form-data">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <div class="campo">
              <label for="arquivoPromocoesInova">Selecione Relatório de Promoções (CSV)</label>
              <input type="file" name="arquivo" id="arquivoPromocoesInova"
                     accept=".csv,text/csv" required>
            </div>
            <button class="botao" type="submit">Conferir promoções sem alterar a loja</button>
          </form>`,
      })}
      ${painel({
        titulo: '4. Atualizações futuras',
        corpo: `<p class="texto-pequeno">Após importar seu primeiro relatório, poderemos usar
          um monitor separado no computador Windows para detectar novas exportações.
          Esse robô ainda não está instalado nem ativo. Atualmente, a importação
          só ocorre quando você envia e confirma um relatório.</p>`,
      })}
    `,
  });
}
