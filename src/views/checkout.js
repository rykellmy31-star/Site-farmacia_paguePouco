/** views/checkout.js — Carrinho completo, endereço/frete, pagamento e confirmação. */
import { escapeHtml as e } from '../lib/security.js';
import { paginaPublica, money, ICONES } from './layout.js';
import { campoForm, listaErros, alertaHtml, migalhas } from './partials.js';
import { htmlItensCarrinho, htmlResumoCarrinho } from './cart.js';
import { formatCep, formatDateTime } from '../lib/format.js';
import { productUrl } from '../lib/catalog.js';

const PASSOS = [
  { id: 'cesta', label: '1. Cesta' },
  { id: 'endereco', label: '2. Entrega' },
  { id: 'pagamento', label: '3. Pagamento' },
  { id: 'confirmacao', label: '4. Confirmação' },
];

function passosHtml(atual) {
  const ordem = PASSOS.map((p) => p.id);
  const indice = ordem.indexOf(atual);
  return `<ol class="passos">
    ${PASSOS.map((p, i) => `<li class="${i === indice ? 'ativo' : (i < indice ? 'concluido' : '')}">${e(p.label)}</li>`).join('')}
  </ol>`;
}

export function telaCarrinho(ctx, { totais, avisos = [], erro = '' }) {
  const cart = ctx.cart;
  return paginaPublica(ctx, {
    titulo: 'Minha cesta',
    semIndex: true,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Minha cesta' }])}
      ${passosHtml('cesta')}
      ${erro ? alertaHtml(erro, 'erro') : ''}
      ${avisos.length ? alertaHtml(`<ul>${avisos.map((a) => `<li>${e(a)}</li>`).join('')}</ul>`, 'aviso') : ''}
      <div class="checkout-grade">
        <div>
          <div class="cartao">
            <h3>${ICONES.carrinho} Produtos na cesta</h3>
            <div id="itensCarrinhoPagina">
              ${htmlItensCarrinho(cart)}
            </div>
          </div>
          <p class="mb-0"><a class="botao secundario pequeno" href="/">Continuar comprando</a></p>
        </div>
        <aside>
          <div class="resumo-pedido">
            <h3 class="mt-0">Resumo do pedido</h3>
            <form class="mb-2" method="post" action="/carrinho/cupom">
              <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
              <div class="linha" style="gap:6px">
                <input class="entrada" type="text" name="codigo" placeholder="Cupom de desconto" value="${e(cart.cupom?.codigo || '')}">
                <button class="botao pequeno secundario" type="submit">Aplicar</button>
              </div>
              ${cart.cupom ? `<p class="texto-pequeno mb-0">Cupom <strong>${e(cart.cupom.codigo)}</strong> aplicado.
                <button class="botao pequeno secundario" formaction="/carrinho/cupom/remover" type="submit">Remover</button></p>` : ''}
            </form>
            <div id="resumoCarrinho">${htmlResumoCarrinho(cart, totais, { mostrarFrete: false })}</div>
            <a class="botao destaque bloquinho mt-2" href="/checkout">Finalizar compra</a>
            <p class="texto-pequeno texto-suave mb-0 mt-1">O frete é calculado no próximo passo, a partir do seu CEP.</p>
          </div>
        </aside>
      </div>
    </div>`,
  });
}

export function telaEndereco(ctx, { totais, enderecos = [], erros = {}, calculo = null, freteSelecionado = '', erroFrete = '' }) {
  const padrao = enderecos.find((en) => en.padrao) || enderecos[0] || {};
  const ufOpcoes = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  return paginaPublica(ctx, {
    titulo: 'Entrega',
    semIndex: true,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Cesta', url: '/carrinho' }, { texto: 'Entrega' }])}
      ${passosHtml('endereco')}
      ${listaErros(erros)}
      <div class="checkout-grade">
        <div>
          ${enderecos.length ? `<div class="cartao">
            <h3>Usar um endereço salvo</h3>
            <div class="lista-ordenavel">
              ${enderecos.map((en) => `<label class="opcao-frete" style="align-items:flex-start">
                <input type="radio" name="enderecoSalvo" value="${e(en.id)}" form="formEndereco" ${en.padrao ? 'checked' : ''}>
                <span><strong>${e(en.apelido || 'Endereço')}</strong>${en.padrao ? ' <span class="etiqueta verde">Principal</span>' : ''}<br>
                ${e(en.logradouro)}, ${e(en.numero)} — ${e(en.bairro)}<br>${e(en.cidade)}/${e(en.uf)} — ${formatCep(en.cep)}</span>
              </label>`).join('')}
            </div>
          </div>` : ''}

          <form method="post" action="/checkout/endereco" id="formEndereco" class="cartao">
            <h3>${ICONES.caminhao} Dados de entrega</h3>
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <input type="hidden" name="usarEnderecoSalvo" id="usarEnderecoSalvo" value="${enderecos.length ? '1' : ''}">
            <div id="camposEndereco">
              <div class="campo-linha">
                ${campoForm({ nome: 'nome', rotulo: 'Nome do destinatário', valor: padrao.nome || ctx.usuario?.nome || '', obrigatorio: true })}
                ${campoForm({ nome: 'telefone', rotulo: 'Telefone de contato', valor: ctx.usuario?.telefone || '', obrigatorio: true })}
              </div>
              <div class="campo-linha">
                ${campoForm({ nome: 'cep', rotulo: 'CEP', valor: padrao.cep || ctx.cepSessao || '', obrigatorio: true, atributos: 'inputmode="numeric" id="cepEntrega" data-mascara-cep' })}
                ${campoForm({ nome: 'uf', rotulo: 'UF', valor: padrao.uf || '', obrigatorio: true, opcoes: ufOpcoes, atributos: 'id="ufEntrega"' })}
                ${campoForm({ nome: 'cidade', rotulo: 'Cidade', valor: padrao.cidade || '', obrigatorio: true, atributos: 'id="cidadeEntrega"' })}
              </div>
              <div class="campo-linha">
                ${campoForm({ nome: 'logradouro', rotulo: 'Endereço (rua/avenida)', valor: padrao.logradouro || '', obrigatorio: true })}
                ${campoForm({ nome: 'numero', rotulo: 'Número', valor: padrao.numero || '', obrigatorio: true })}
              </div>
              <div class="campo-linha">
                ${campoForm({ nome: 'complemento', rotulo: 'Complemento', valor: padrao.complemento || '' })}
                ${campoForm({ nome: 'bairro', rotulo: 'Bairro', valor: padrao.bairro || '', obrigatorio: true })}
              </div>
              <button class="botao secundario" type="button" id="botaoCalcularFrete">Calcular frete</button>
            </div>

            <div id="opcoesFrete" class="mt-2">
              ${erroFrete ? alertaHtml(erroFrete, 'erro') : ''}
              ${calculo ? `
                <h3>Formas de entrega</h3>
                ${calculo.opcoes.map((o, i) => `<label class="opcao-frete ${(freteSelecionado || calculo.opcoes[0].id) === o.id ? 'selecionada' : ''}">
                  <input type="radio" name="freteOpcao" value="${e(o.id)}" ${(freteSelecionado || calculo.opcoes[0].id) === o.id ? 'checked' : ''}>
                  <span>
                    <strong>${e(o.label)}</strong><br>
                    <span class="texto-pequeno texto-suave">${e(o.prazo || '')} ${o.detalhe ? `— ${e(o.detalhe)}` : ''}</span>
                  </span>
                  <span class="valor">${o.valor === 0 ? '<span style="color:var(--sucesso)">Grátis</span>' : money(o.valor)}</span>
                </label>`).join('')}
                <p class="texto-pequeno texto-suave">Estado identificado: <strong>${e(calculo.ufNome || '')} (${e(calculo.uf || '')})</strong>.
                Valor conforme a tabela de fretes fixos configurada pela farmácia.</p>` : ''}
            </div>

            <button class="botao destaque bloquinho mt-2" type="submit" ${calculo ? '' : 'data-sem-frete="1"'}>Ir para o pagamento</button>
            ${!calculo ? '<p class="texto-pequeno texto-suave mb-0">Informe o CEP e clique em "Calcular frete" para ver as opções.</p>' : ''}
          </form>
        </div>
        <aside>
          <div class="resumo-pedido">
            <h3 class="mt-0">Resumo do pedido</h3>
            ${(ctx.cart.itens || []).map((i) => `<div class="resumo-linha"><span>${i.quantidade}× ${e(i.nome)}</span><strong>${money(i.precoUnitarioCentavos * i.quantidade)}</strong></div>`).join('')}
            <div id="resumoCarrinho">${htmlResumoCarrinho(ctx.cart, totais, { mostrarFrete: false })}</div>
            <p class="texto-pequeno texto-suave mb-0 mt-2">Dúvidas sobre o pedido? Use o botão do WhatsApp para falar com a farmácia. Compras e pagamentos são concluídos aqui no site.</p>
          </div>
        </aside>
      </div>
    </div>`,
  });
}

export function telaPagamento(ctx, { totais, parcelas, formasPagamento, erros = {}, endereco, frete }) {
  const cfg = ctx.settings.pagamentos || {};
  const infoPag = ctx.infoPagamento || {};
  return paginaPublica(ctx, {
    titulo: 'Pagamento',
    semIndex: true,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Cesta', url: '/carrinho' }, { texto: 'Entrega', url: '/checkout/endereco' }, { texto: 'Pagamento' }])}
      ${passosHtml('pagamento')}
      ${listaErros(erros)}
      ${infoPag.motivo ? alertaHtml(`<strong>Ambiente de testes:</strong> ${e(infoPag.motivo)}`, 'aviso') : ''}
      <div class="checkout-grade">
        <form method="post" action="/checkout/finalizar" id="formPagamento">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <div class="cartao">
            <h3>${ICONES.cadeado} Como você quer pagar?</h3>

            ${formasPagamento.pix ? `<label class="opcao-pagamento selecionada">
              <input type="radio" name="metodoPagamento" value="pix" checked>
              <span>
                <strong>Pix</strong><br>
                <span class="texto-pequeno texto-suave">Aprovação rápida. Você receberá o código para pagar pelo seu banco.</span>
                ${formasPagamento.descontoPix > 0 ? `<br><span class="etiqueta verde">${formasPagamento.descontoPix}% de desconto</span>` : ''}
              </span>
            </label>` : ''}

            ${formasPagamento.credit_card ? `<label class="opcao-pagamento">
              <input type="radio" name="metodoPagamento" value="credit_card">
              <span>
                <strong>Cartão de crédito</strong><br>
                <span class="texto-pequeno texto-suave">Parcelamento conforme as opções abaixo.</span>
              </span>
            </label>
            <div class="forma-pagamento-detalhe" id="detalheCredito">
              ${campoForm({
                nome: 'parcelas', rotulo: 'Parcelas',
                opcoes: parcelas.map((p) => ({ valor: p.numero, texto: p.texto })),
              })}
              ${infoPag.real
                ? `<div id="containerCartaoMP" class="mt-2"></div>
                   <p class="texto-pequeno texto-suave">Os dados do cartão são processados pelo Mercado Pago. Não armazenamos o número do seu cartão.</p>`
                : `<div class="simulado-aviso"><strong>Ambiente de testes:</strong> o pagamento com cartão será registrado como
                   "Aguardando pagamento" e poderá ser confirmado pela equipe da farmácia (simulação) enquanto o Mercado Pago não é configurado.
                   <strong>Nenhuma cobrança real é gerada.</strong></div>`}
            </div>` : ''}

            ${formasPagamento.debit_card ? `<label class="opcao-pagamento">
              <input type="radio" name="metodoPagamento" value="debit_card">
              <span><strong>Cartão de débito</strong><br><span class="texto-pequeno texto-suave">Pagamento à vista.</span></span>
            </label>` : ''}
          </div>

          <div class="cartao">
            <h3>${ICONES.caminhao} Entrega</h3>
            <p class="mb-1"><strong>${e(endereco.nome || '')}</strong><br>
              ${e(endereco.logradouro)}, ${e(endereco.numero)}${endereco.complemento ? ` — ${e(endereco.complemento)}` : ''}<br>
              ${e(endereco.bairro)} — ${e(endereco.cidade)}/${e(endereco.uf)}<br>
              CEP ${formatCep(endereco.cep)}</p>
            <p class="mb-0"><strong>${e(frete?.label || 'Entrega')}</strong> — ${e(frete?.prazo || '')}
              <a class="texto-pequeno" href="/checkout/endereco">(alterar)</a></p>
          </div>

          <button class="botao destaque grande bloquinho" type="submit" id="botaoFinalizar">Finalizar pedido</button>
          <p class="texto-pequeno texto-suave mt-2 mb-0">
            Ao finalizar, você concorda com os <a href="/pagina/termos-de-uso" target="_blank">Termos de Uso</a> e a
            <a href="/pagina/politica-de-privacidade" target="_blank">Política de Privacidade</a>.
            ${ctx.settings.loja?.avisoMedicamento && ctx.settings.loja?.mostrarAvisoSanitario ? `<br>${e(ctx.settings.loja.avisoMedicamento)}` : ''}
          </p>
        </form>
        <aside>
          <div class="resumo-pedido">
            <h3 class="mt-0">Resumo do pedido</h3>
            ${(ctx.cart.itens || []).map((i) => `<div class="resumo-linha"><span>${i.quantidade}× ${e(i.nome)}</span><strong>${money(i.precoUnitarioCentavos * i.quantidade)}</strong></div>`).join('')}
            <div id="resumoCarrinho">${htmlResumoCarrinho(ctx.cart, totais, { mostrarFrete: true })}</div>
            <div class="resumo-linha"><span>Frete (${e(frete?.label || '')})</span><strong>${totais.freteCentavos && !totais.freteGratis ? money(totais.freteCentavos) : '<span style="color:var(--sucesso)">Grátis</span>'}</strong></div>
            <div class="resumo-linha total"><span>Total</span><span>${money(totais.totalCentavos)}</span></div>
          </div>
        </aside>
      </div>
    </div>`,
  });
}

export function telaConfirmacao(ctx, { pedido, pagamento }) {
  return paginaPublica(ctx, {
    titulo: `Pedido ${pedido.codigo} confirmado`,
    semIndex: true,
    conteudo: `<div class="container">
      ${passosHtml('confirmacao')}
      <div class="pagina-conteudo texto-centro">
        <h1>${ICONES.check} Pedido registrado!</h1>
        <p class="negrito">Pedido <strong>${e(pedido.codigo)}</strong></p>
        <p>Enviamos a confirmação para <strong>${e(pedido.cliente?.email || '')}</strong>.</p>
      </div>

      ${pagamento?.metodo === 'pix' && pedido.statusFinanceiro === 'pendente' ? `
      <div class="cartao mt-2">
        <h3>Pague com Pix</h3>
        ${pagamento.simulado ? `<div class="simulado-aviso">
          <strong>Atenção — ambiente de testes:</strong> este código Pix é <strong>SIMULADO</strong> e não pode ser pago em
          nenhum banco ou aplicativo. Ele existe apenas para validar o funcionamento do sistema.
          Quando o Mercado Pago estiver configurado, um QR Code real será exibido aqui.
        </div>` : ''}
        <div class="pix-caixa">
          <strong>Código Pix "copia e cola"</strong>
          <div class="pix-codigo" id="pixCodigo">${e(pagamento.pixCodigo || '')}</div>
          <button class="botao pequeno secundario mt-1" type="button" data-copiar="#pixCodigo">Copiar código</button>
          ${pagamento.pixQrBase64 ? `<div class="mt-2"><img src="data:image/png;base64,${pagamento.pixQrBase64}" alt="QR Code do Pix" width="220" height="220" style="margin:0 auto"></div>` : ''}
          ${pagamento.pixExpiraEm ? `<p class="texto-pequeno texto-suave mb-0 mt-1">Expira em ${formatDateTime(pagamento.pixExpiraEm)}.</p>` : ''}
        </div>
        <p class="texto-pequeno texto-suave">Após o pagamento, a confirmação é automática e o pedido entra em separação.</p>
      </div>` : `
      <div class="cartao mt-2">
        <h3>${pagamento?.metodo === 'pix' ? 'Pagamento Pix' : 'Pagamento com cartão'}</h3>
        <p>Status atual: <strong>${e(String(pedido.statusFinanceiro || ''))}</strong>.</p>
        <p class="texto-pequeno texto-suave mb-0">Você receberá a atualização por e-mail assim que o pagamento for confirmado.</p>
      </div>`}

      <div class="cartao">
        <h3>Itens do pedido</h3>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Produto</th><th>Qtd.</th><th>Subtotal</th></tr></thead>
            <tbody>${(pedido.itens || []).map((i) => `<tr>
              <td>${e(i.nome)}</td><td>${i.quantidade}</td><td>${money(i.subtotalCentavos)}</td></tr>`).join('')}</tbody>
            <tfoot>
              <tr><td colspan="2"><strong>Subtotal</strong></td><td>${money(pedido.subtotalCentavos)}</td></tr>
              ${pedido.descontoCentavos ? `<tr><td colspan="2">Desconto</td><td>− ${money(pedido.descontoCentavos)}</td></tr>` : ''}
              <tr><td colspan="2">Frete</td><td>${pedido.freteCentavos ? money(pedido.freteCentavos) : 'Grátis'}</td></tr>
              <tr><td colspan="2"><strong>Total</strong></td><td><strong>${money(pedido.totalCentavos)}</strong></td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p class="texto-centro mt-3">
        <a class="botao" href="/conta/pedidos/${e(pedido.codigo)}">Acompanhar meu pedido</a>
        <a class="botao secundario" href="/">Voltar às compras</a>
      </p>
      <p class="texto-pequeno texto-suave texto-centro mt-2">
        Dúvidas? Use o botão do WhatsApp no canto da tela — ele é exclusivo para atendimento.
      </p>
    </div>`,
  });
}

export function telaCheckoutVazio(ctx) {
  return paginaPublica(ctx, {
    titulo: 'Cesta vazia',
    semIndex: true,
    conteudo: `<div class="container">
      <div class="pagina-conteudo texto-centro">
        <h1>Sua cesta está vazia</h1>
        <p>Adicione produtos para continuar a compra.</p>
        <p><a class="botao" href="/ofertas">Ver ofertas</a></p>
      </div>
    </div>`,
  });
}
