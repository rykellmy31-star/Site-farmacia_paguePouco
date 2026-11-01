/** views/account.js — Telas da área do cliente. */
import { escapeHtml as e } from '../lib/security.js';
import { paginaPublica, money, ICONES } from './layout.js';
import { campoForm, listaErros, alertaHtml, etiquetaStatus, migalhas } from './partials.js';
import { STATUS_OPERACIONAL, STATUS_FINANCEIRO, statusOperacionalExibido } from '../lib/orders.js';
import { formatDateTime, formatDate, formatCep } from '../lib/format.js';
import { productUrl, imagemPrincipal } from '../lib/catalog.js';
import { autorPublicoDoEventoPedido } from '../lib/order-history-public.js';
import { autorizouWhatsappPedidos, autorizouWhatsappProdutos } from '../lib/evolution-whatsapp.js';

function moldura(ctx, { titulo, conteudo, ativo = '' }) {
  return paginaPublica(ctx, {
    titulo,
    semIndex: true,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Minha conta', url: '/conta' }, ...(titulo !== 'Minha conta' ? [{ texto: titulo }] : [])])}
      <div class="conta-grade">
        <aside>
          <nav class="menu-conta" aria-label="Menu da conta">
            <a href="/conta" class="${ativo === 'inicio' ? 'ativo' : ''}">Painel</a>
            <a href="/conta/pedidos" class="${ativo === 'pedidos' ? 'ativo' : ''}">Meus pedidos</a>
            <a href="/conta/enderecos" class="${ativo === 'enderecos' ? 'ativo' : ''}">Meus endereços</a>
            <a href="/conta/favoritos" class="${ativo === 'favoritos' ? 'ativo' : ''}">Favoritos</a>
            <a href="/conta/dados" class="${ativo === 'dados' ? 'ativo' : ''}">Meus dados</a>
            <a href="/conta/sair">Sair</a>
          </nav>
        </aside>
        <div>${conteudo}</div>
      </div>
    </div>`,
  });
}

export function telaLogin(ctx, { erros = {}, valores = {}, aviso = '', proximo = '' }) {
  return paginaPublica(ctx, {
    titulo: 'Entrar',
    semIndex: true,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Entrar' }])}
      <div style="max-width:440px;margin:0 auto">
        <div class="pagina-conteudo">
          <h1>Entrar na minha conta</h1>
          ${alertaHtml(aviso, 'info')}
          ${listaErros(erros)}
          <form method="post" action="/conta/login">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <input type="hidden" name="proximo" value="${e(proximo)}">
            ${campoForm({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: valores.email || '', obrigatorio: true, atributos: 'autocomplete="email" autofocus' })}
            ${campoForm({ nome: 'senha', rotulo: 'Senha', tipo: 'password', obrigatorio: true, atributos: 'autocomplete="current-password"' })}
            <button class="botao bloquinho" type="submit">Entrar</button>
          </form>
          <p class="mt-2 mb-0"><a href="/conta/esqueci-senha">Esqueci minha senha</a></p>
          <hr style="border:0;border-top:1px solid var(--borda);margin:18px 0">
          <p class="mb-1">Ainda não tem conta?</p>
          <a class="botao secundario bloquinho" href="/conta/cadastro">Criar minha conta</a>
        </div>
      </div>
    </div>`,
  });
}

export function telaCadastro(ctx, { erros = {}, valores = {} }) {
  return paginaPublica(ctx, {
    titulo: 'Criar conta',
    semIndex: true,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Criar conta' }])}
      <div style="max-width:520px;margin:0 auto">
        <div class="pagina-conteudo">
          <h1>Criar minha conta</h1>
          <p class="texto-pequeno texto-suave">Seus dados são tratados conforme a nossa
            <a href="/pagina/politica-de-privacidade">Política de Privacidade</a>.</p>
          ${listaErros(erros)}
          <form method="post" action="/conta/cadastro">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            ${campoForm({ nome: 'nome', rotulo: 'Nome completo', valor: valores.nome || '', obrigatorio: true, atributos: 'autocomplete="name"' })}
            <div class="campo-linha">
              ${campoForm({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: valores.email || '', obrigatorio: true, atributos: 'autocomplete="email"' })}
              ${campoForm({ nome: 'telefone', rotulo: 'Telefone/WhatsApp', valor: valores.telefone || '', obrigatorio: true, atributos: 'autocomplete="tel"' })}
            </div>
            <div class="campo-linha">
              ${campoForm({ nome: 'cpf', rotulo: 'CPF', valor: valores.cpf || '', obrigatorio: true, dica: 'Necessário para emissão de nota fiscal.' })}
              ${campoForm({ nome: 'dataNascimento', rotulo: 'Data de nascimento', tipo: 'date', valor: valores.dataNascimento || '' })}
            </div>
            <div class="campo-linha">
              ${campoForm({ nome: 'senha', rotulo: 'Senha', tipo: 'password', obrigatorio: true, dica: 'Mínimo de 8 caracteres, com letras e números.' })}
              ${campoForm({ nome: 'senha2', rotulo: 'Confirmar senha', tipo: 'password', obrigatorio: true })}
            </div>
            <label class="check">
              <input type="checkbox" name="marketing" value="1" ${valores.marketing ? 'checked' : ''}>
              <span class="texto-pequeno">${e(ctx.settings.lgpd?.textoConsentimento || 'Autorizo o envio de ofertas e novidades.')}</span>
            </label>
            <button class="botao bloquinho" type="submit">Criar conta</button>
          </form>
          <p class="mt-2 mb-0">Já tem conta? <a href="/conta/login">Entrar</a></p>
        </div>
      </div>
    </div>`,
  });
}

export function telaEsqueciSenha(ctx, { mensagem = '', erro = '' }) {
  return paginaPublica(ctx, {
    titulo: 'Recuperar senha',
    semIndex: true,
    conteudo: `<div class="container">
      <div style="max-width:440px;margin:0 auto">
        <div class="pagina-conteudo">
          <h1>Recuperar senha</h1>
          <p class="texto-pequeno texto-suave">Informe seu e-mail cadastrado. Enviaremos um link para você definir uma nova senha.</p>
          ${erro ? alertaHtml(erro, 'erro') : ''}
          ${mensagem ? alertaHtml(mensagem, 'sucesso') : ''}
          <form method="post" action="/conta/esqueci-senha">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            ${campoForm({ nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true })}
            <button class="botao bloquinho" type="submit">Enviar link de recuperação</button>
          </form>
          <p class="mt-2 mb-0"><a href="/conta/login">Voltar ao login</a></p>
        </div>
      </div>
    </div>`,
  });
}

export function telaRedefinirSenha(ctx, { token, erro = '' }) {
  return paginaPublica(ctx, {
    titulo: 'Definir nova senha',
    semIndex: true,
    conteudo: `<div class="container">
      <div style="max-width:440px;margin:0 auto">
        <div class="pagina-conteudo">
          <h1>Definir nova senha</h1>
          ${erro ? alertaHtml(erro, 'erro') : ''}
          <form method="post" action="/conta/redefinir-senha">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <input type="hidden" name="token" value="${e(token)}">
            ${campoForm({ nome: 'senha', rotulo: 'Nova senha', tipo: 'password', obrigatorio: true, dica: 'Mínimo de 8 caracteres.' })}
            ${campoForm({ nome: 'senha2', rotulo: 'Confirmar nova senha', tipo: 'password', obrigatorio: true })}
            <button class="botao bloquinho" type="submit">Salvar nova senha</button>
          </form>
        </div>
      </div>
    </div>`,
  });
}

export function telaConta(ctx, { pedidos }) {
  const u = ctx.usuario;
  return moldura(ctx, {
    titulo: 'Minha conta',
    ativo: 'inicio',
    conteudo: `
      <div class="painel">
        <div class="corpo">
          <h2 class="mt-0">Olá, ${e(String(u.nome || '').split(' ')[0])}!</h2>
          <p class="texto-suave mb-0">Aqui você acompanha pedidos, endereços e suas preferências.</p>
        </div>
      </div>
      <div class="painel">
        <header><h3>Últimos pedidos</h3><a class="botao pequeno secundario" href="/conta/pedidos">Ver todos</a></header>
        <div class="corpo sem-padding">
          ${pedidos.length ? `<div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Pedido</th><th>Data</th><th>Total</th><th>Pagamento</th><th>Status</th><th></th></tr></thead>
            <tbody>${pedidos.slice(0, 5).map((p) => `<tr>
              <td><strong>${e(p.codigo)}</strong></td>
              <td>${formatDate(p.criadoEm)}</td>
              <td>${money(p.totalCentavos)}</td>
              <td>${etiquetaStatus(p.statusFinanceiro)}</td>
              <td>${etiquetaStatus(statusOperacionalExibido(p))}</td>
              <td><a class="botao pequeno secundario" href="/conta/pedidos/${e(p.codigo)}">Detalhes</a></td>
            </tr>`).join('')}</tbody></table></div>`
            : '<div class="estado-vazio">Você ainda não fez pedidos. <a href="/ofertas">Ver ofertas</a></div>'}
        </div>
      </div>`,
  });
}

export function telaPedidos(ctx, { pedidos }) {
  return moldura(ctx, {
    titulo: 'Meus pedidos',
    ativo: 'pedidos',
    conteudo: `<div class="painel">
      <header><h3>Meus pedidos</h3></header>
      <div class="corpo sem-padding">
        ${pedidos.length ? `<div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th>Total</th><th>Pagamento</th><th>Entrega</th><th></th></tr></thead>
          <tbody>${pedidos.map((p) => `<tr>
            <td><strong>${e(p.codigo)}</strong></td>
            <td>${formatDate(p.criadoEm)}</td>
            <td>${(p.itens || []).reduce((a, i) => a + i.quantidade, 0)}</td>
            <td>${money(p.totalCentavos)}</td>
            <td>${etiquetaStatus(p.statusFinanceiro)}</td>
            <td>${etiquetaStatus(statusOperacionalExibido(p))}</td>
            <td><a class="botao pequeno secundario" href="/conta/pedidos/${e(p.codigo)}">Abrir</a></td>
          </tr>`).join('')}</tbody></table></div>`
          : '<div class="estado-vazio">Nenhum pedido encontrado.</div>'}
      </div>
    </div>`,
  });
}

export function telaPedidoDetalhe(ctx, { pedido }) {
  const pagamento = db_findPayment(ctx.db, pedido.pagamentoId);
  return moldura(ctx, {
    titulo: `Pedido ${pedido.codigo}`,
    ativo: 'pedidos',
    conteudo: `
      ${alertaHtml(ctx.aviso || '', 'info')}
      ${['criacao_em_andamento', 'conciliacao_necessaria'].includes(pedido.pendenciaPagamento) &&
        pedido.statusFinanceiro === 'pendente' ? `<div class="alerta info" role="status">
        <strong>Pagamento em verificação.</strong> Seu pedido está registrado, mas a cobrança
        ainda não foi confirmada. Não realize outra tentativa nem solicite cancelamento
        até a conferência com o atendimento. Informe o código ${e(pedido.codigo)}.
      </div>` : ''}
      <div class="painel">
        <header>
          <h3>Pedido ${e(pedido.codigo)}</h3>
          <span class="texto-pequeno texto-suave">Realizado em ${formatDateTime(pedido.criadoEm)}</span>
        </header>
        <div class="corpo">
          <div class="linha" style="gap:10px;flex-wrap:wrap">
            <div><span class="rotulo">Pagamento</span>${etiquetaStatus(pedido.statusFinanceiro)}</div>
            <div><span class="rotulo">Entrega</span>${etiquetaStatus(statusOperacionalExibido(pedido))}</div>
            <div><span class="rotulo">Forma</span>${e(String(pedido.metodoPagamento || '').replace('credit_card', 'Cartão de crédito').replace('debit_card', 'Cartão de débito').replace('pix', 'Pix'))}</div>
            ${pedido.vendedor?.nome ? `<div><span class="rotulo">Vendedor</span><strong>${e(pedido.vendedor.nome)}</strong></div>` : ''}
          </div>
          ${pagamento?.provedor === 'mercadopago' && pedido.statusFinanceiro === 'pendente' ? `<p class="consulta-pix-info" role="status" data-pix-status-auto="true">
            Se você já pagou, <a class="botao pequeno secundario" href="/conta/pedidos/${e(pedido.codigo)}">Atualizar situação do Pix</a>
            <span class="texto-pequeno texto-suave">O banco é consultado de forma segura, no máximo uma vez por minuto. Não gera outra cobrança.</span>
          </p>` : ''}
          ${pagamento?.pixCodigo && pedido.statusFinanceiro === 'pendente' ? `
          <div class="pix-caixa mt-2">
            <strong>Pix para pagamento</strong>
            ${pagamento.simulado ? '<div class="simulado-aviso"><strong>Ambiente de testes:</strong> este código Pix é SIMULADO e não pode ser pago em nenhum banco. Ele serve apenas para validar o fluxo.</div>' : ''}
            <div class="pix-codigo" id="pixCodigo">${e(pagamento.pixCodigo)}</div>
            <button class="botao pequeno secundario mt-1" type="button" onclick="navigator.clipboard && navigator.clipboard.writeText(document.getElementById('pixCodigo').textContent.trim())">Copiar código</button>
            ${pagamento.pixExpiraEm ? `<p class="texto-pequeno texto-suave mb-0 mt-1">Expira em ${formatDateTime(pagamento.pixExpiraEm)}.</p>` : ''}
          </div>` : ''}
        </div>
      </div>

      <div class="painel">
        <header><h3>Itens do pedido</h3></header>
        <div class="corpo sem-padding">
          <div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Produto</th><th>Qtd.</th><th>Preço</th><th>Subtotal</th></tr></thead>
            <tbody>${(pedido.itens || []).map((i) => `<tr>
              <td>${e(i.nome)}</td>
              <td>${i.quantidade}</td>
              <td>${money(i.precoUnitarioCentavos)}</td>
              <td>${money(i.subtotalCentavos)}</td>
            </tr>`).join('')}</tbody>
            <tfoot>
              <tr><td colspan="3"><strong>Subtotal</strong></td><td>${money(pedido.subtotalCentavos)}</td></tr>
              ${pedido.descontoCentavos ? `<tr><td colspan="3">Desconto</td><td>− ${money(pedido.descontoCentavos)}</td></tr>` : ''}
              <tr><td colspan="3">Frete (${e(pedido.freteOpcao?.label || '')})</td><td>${pedido.freteCentavos ? money(pedido.freteCentavos) : 'Grátis'}</td></tr>
              <tr><td colspan="3"><strong>Total</strong></td><td><strong>${money(pedido.totalCentavos)}</strong></td></tr>
            </tfoot>
          </table></div>
        </div>
      </div>

      <div class="painel">
        <header><h3>Entrega</h3></header>
        <div class="corpo">
          <p><strong>${e(pedido.endereco?.nome || pedido.cliente?.nome || '')}</strong><br>
          ${e(pedido.endereco?.logradouro || '')}, ${e(pedido.endereco?.numero || 's/n')}${pedido.endereco?.complemento ? ` — ${e(pedido.endereco.complemento)}` : ''}<br>
          ${e(pedido.endereco?.bairro || '')} — ${e(pedido.endereco?.cidade || '')}/${e(pedido.endereco?.uf || '')}<br>
          CEP ${formatCep(pedido.endereco?.cep || '')}</p>
          ${pedido.freteOpcao?.prazo ? `<p class="mb-0">Prazo estimado: <strong>${e(pedido.freteOpcao.prazo)}</strong></p>` : ''}
          ${pedido.rastreio?.codigo ? `<div class="alerta info mt-2 mb-0">
            <strong>Código de rastreio:</strong> ${e(pedido.rastreio.codigo)}
            ${pedido.rastreio.transportadora ? ` — ${e(pedido.rastreio.transportadora)}` : ''}
            ${pedido.rastreio.url ? `<br><a href="${e(pedido.rastreio.url)}" target="_blank" rel="noopener">Rastrear objeto</a>` : ''}
          </div>` : '<p class="texto-pequeno texto-suave mb-0 mt-2">O código de rastreio aparecerá aqui assim que o pedido for enviado.</p>'}
        </div>
      </div>

      <div class="painel">
        <header><h3>Histórico do pedido</h3></header>
        <div class="corpo">
          <ul class="linha-tempo">
            ${(pedido.historico || []).slice().reverse().map((h) => `<li>
              <strong>${e(String(h.status || '').replace(/_/g, ' '))}</strong>
              <span class="quando">${formatDateTime(h.em)} — ${e(autorPublicoDoEventoPedido(h))}</span>
              ${h.obs ? `<div class="texto-pequeno">${e(h.obs)}</div>` : ''}
            </li>`).join('')}
          </ul>
        </div>
      </div>

      ${pedido.statusOperacional !== 'cancelado' && pedido.statusOperacional !== 'entregue' &&
        !(['criacao_em_andamento', 'conciliacao_necessaria'].includes(pedido.pendenciaPagamento) &&
          pedido.statusFinanceiro === 'pendente') ? `
      <div class="painel">
        <header><h3>Cancelar pedido</h3></header>
        <div class="corpo">
          <form method="post" action="/conta/pedidos/${e(pedido.codigo)}/cancelar" onsubmit="return confirm('Deseja realmente cancelar este pedido?')">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            ${campoForm({ nome: 'motivo', rotulo: 'Motivo (opcional)', tipo: 'textarea' })}
            <button class="botao perigo" type="submit">Cancelar pedido</button>
          </form>
        </div>
      </div>` : ''}`,
  });
}

function db_findPayment(db, id) {
  return id ? db.collection('payments').get(id) : null;
}

export function telaEnderecos(ctx, { enderecos, erros = {}, editando = null }) {
  const ufs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  return moldura(ctx, {
    titulo: 'Meus endereços',
    ativo: 'enderecos',
    conteudo: `
      <div class="painel">
        <header><h3>${editando ? 'Editar endereço' : 'Novo endereço'}</h3></header>
        <div class="corpo">
          ${listaErros(erros)}
          <form method="post" action="/conta/enderecos${editando ? `/${e(editando.id)}` : ''}">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            ${editando ? '<input type="hidden" name="acao" value="editar">' : ''}
            <div class="campo-linha">
              ${campoForm({ nome: 'nome', rotulo: 'Nome do destinatário', valor: editando?.nome || '', obrigatorio: true })}
              ${campoForm({ nome: 'apelido', rotulo: 'Apelido (ex.: Casa)', valor: editando?.apelido || '' })}
            </div>
            <div class="campo-linha">
              ${campoForm({ nome: 'cep', rotulo: 'CEP', valor: editando?.cep || '', obrigatorio: true, atributos: 'inputmode="numeric"' })}
              ${campoForm({ nome: 'logradouro', rotulo: 'Endereço', valor: editando?.logradouro || '', obrigatorio: true })}
            </div>
            <div class="campo-linha">
              ${campoForm({ nome: 'numero', rotulo: 'Número', valor: editando?.numero || '', obrigatorio: true })}
              ${campoForm({ nome: 'complemento', rotulo: 'Complemento', valor: editando?.complemento || '' })}
              ${campoForm({ nome: 'bairro', rotulo: 'Bairro', valor: editando?.bairro || '', obrigatorio: true })}
            </div>
            <div class="campo-linha">
              ${campoForm({ nome: 'cidade', rotulo: 'Cidade', valor: editando?.cidade || '', obrigatorio: true })}
              ${campoForm({ nome: 'uf', rotulo: 'UF', valor: editando?.uf || 'BA', obrigatorio: true, opcoes: ufs })}
            </div>
            <label class="check"><input type="checkbox" name="padrao" value="1" ${editando?.padrao ? 'checked' : ''}> <span>Usar como endereço principal</span></label>
            <button class="botao" type="submit">${editando ? 'Salvar alterações' : 'Cadastrar endereço'}</button>
            ${editando ? '<a class="botao secundario" href="/conta/enderecos">Cancelar</a>' : ''}
          </form>
        </div>
      </div>
      <div class="painel">
        <header><h3>Endereços cadastrados</h3></header>
        <div class="corpo sem-padding">
          ${enderecos.length ? `<div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Apelido</th><th>Endereço</th><th></th></tr></thead>
            <tbody>${enderecos.map((en) => `<tr>
              <td><strong>${e(en.apelido || 'Endereço')}</strong> ${en.padrao ? '<span class="etiqueta verde">Principal</span>' : ''}</td>
              <td>${e(en.logradouro)}, ${e(en.numero)} — ${e(en.bairro)}<br>${e(en.cidade)}/${e(en.uf)} — CEP ${formatCep(en.cep)}</td>
              <td class="acoes-linha">
                <a class="botao pequeno secundario" href="/conta/enderecos?editar=${e(en.id)}">Editar</a>
                <form method="post" action="/conta/enderecos/${e(en.id)}/excluir" onsubmit="return confirm('Excluir este endereço?')">
                  <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
                  <button class="botao pequeno perigo" type="submit">Excluir</button>
                </form>
              </td>
            </tr>`).join('')}</tbody></table></div>` : '<div class="estado-vazio">Nenhum endereço cadastrado.</div>'}
        </div>
      </div>`,
  });
}

export function telaDados(ctx, { erros = {} }) {
  const u = ctx.usuario;
  return moldura(ctx, {
    titulo: 'Meus dados',
    ativo: 'dados',
    conteudo: `
      <div class="painel">
        <header><h3>Dados pessoais</h3></header>
        <div class="corpo">
          ${listaErros(erros)}
          <form method="post" action="/conta/dados">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <div class="campo-linha">
              ${campoForm({ nome: 'nome', rotulo: 'Nome completo', valor: u.nome || '', obrigatorio: true })}
              ${campoForm({ nome: 'telefone', rotulo: 'Telefone/WhatsApp', valor: u.telefone || '', obrigatorio: true })}
            </div>
            <div class="campo-linha">
              ${campoForm({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: u.email || '', obrigatorio: true })}
              ${campoForm({ nome: 'cpf', rotulo: 'CPF', valor: u.cpf || '' })}
            </div>
            ${campoForm({ nome: 'dataNascimento', rotulo: 'Data de nascimento', tipo: 'date', valor: u.dataNascimento || '' })}
            <label class="check"><input type="checkbox" name="marketing" value="1" ${u.marketing ? 'checked' : ''}>
              <span class="texto-pequeno">${e(ctx.settings.lgpd?.textoConsentimento || 'Autorizo o envio de ofertas e novidades.')}</span></label>
            <button class="botao" type="submit">Salvar alterações</button>
          </form>
        </div>
      </div>
      <div class="painel" id="avisos-whatsapp">
        <header><h3>Avisos de pedidos pelo WhatsApp</h3></header>
        <div class="corpo">
          ${ctx.req?.query?.get('whatsapp')==='telefone-invalido'
            ? '<div class="alerta aviso">Atualize seu telefone com DDD antes de ativar os avisos.</div>' : ''}
          <p><strong>${autorizouWhatsappProdutos(u)
            ? 'Ativado ✅ — com os nomes dos produtos'
            : autorizouWhatsappPedidos(u)
              ? 'Ativado — somente número e status, sem nomes dos produtos'
              : 'Desativado'}</strong></p>
          <p class="texto-pequeno texto-suave">A Farmácia Pague Pouco pode enviar confirmações de recebimento e pagamento
          de pedidos atuais e futuros ao WhatsApp cadastrado, incluindo nomes dos produtos (inclusive medicamentos).
          Os nomes podem revelar informações de saúde. Sem ofertas. Você pode desativar a qualquer momento;
          mudar o número de telefone exige nova autorização. A escolha não altera ofertas ou marketing.</p>
          ${autorizouWhatsappPedidos(u) && !autorizouWhatsappProdutos(u)
            ? '<p class="texto-pequeno">Sua autorização anterior permanece ativa sem nomes dos produtos. Para incluir os nomes, atualize a autorização abaixo.</p>'
            : ''}
          <form method="post" action="/conta/dados/whatsapp-pedidos">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            ${autorizouWhatsappPedidos(u)
              ? `<button class="botao secundario" name="acao" value="desativar" type="submit">Desativar avisos no WhatsApp</button>
                  ${!autorizouWhatsappProdutos(u)
                    ? '<button class="botao mt-2" name="acao" value="atualizar" type="submit">Autorizar envio dos nomes dos produtos</button>'
                    : ''}` 
              : '<button class="botao" name="acao" value="ativar" type="submit">Autorizar avisos no WhatsApp</button>'}
          </form>
        </div>
      </div>
      <div class="painel">
        <header><h3>Alterar senha</h3></header>
        <div class="corpo">
          <form method="post" action="/conta/senha">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <div class="campo-linha">
              ${campoForm({ nome: 'senhaAtual', rotulo: 'Senha atual', tipo: 'password', obrigatorio: true })}
              ${campoForm({ nome: 'senhaNova', rotulo: 'Nova senha', tipo: 'password', obrigatorio: true, dica: 'Mínimo de 8 caracteres.' })}
            </div>
            <button class="botao secundario" type="submit">Alterar senha</button>
          </form>
        </div>
      </div>
      <div class="painel">
        <header><h3>Privacidade</h3></header>
        <div class="corpo">
          <p class="texto-pequeno">Para solicitar a correção, exportação ou exclusão dos seus dados pessoais (LGPD),
          entre em contato pelos canais de atendimento descritos na
          <a href="/pagina/politica-de-privacidade">Política de Privacidade</a>.</p>
        </div>
      </div>`,
  });
}

export function telaFavoritos(ctx, { produtos }) {
  return moldura(ctx, {
    titulo: 'Favoritos',
    ativo: 'favoritos',
    conteudo: `<div class="painel">
      <header><h3>Meus produtos favoritos</h3></header>
      <div class="corpo">
        ${produtos.length ? `<div class="vitrine">${produtos.map((p) => `
          <article class="produto">
            <a class="foto" href="${e(productUrl(p))}"><img src="${e(imagemPrincipal(p))}" alt="${e(p.nome)}" loading="lazy"></a>
            <h3 class="nome"><a href="${e(productUrl(p))}">${e(p.nome)}</a></h3>
            <span class="preco">${money(p.precoPromocionalCentavos || p.precoCentavos)}</span>
            <div class="acoes">
              <button class="botao bloquinho" data-adicionar-carrinho="${e(p.id)}">Adicionar à cesta</button>
              <form method="post" action="/conta/favoritos/remover" class="mt-1">
                <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
                <input type="hidden" name="produtoId" value="${e(p.id)}">
                <button class="botao pequeno secundario bloquinho" type="submit">Remover dos favoritos</button>
              </form>
            </div>
          </article>`).join('')}</div>`
          : '<div class="estado-vazio">Você ainda não salvou produtos favoritos.</div>'}
      </div>
    </div>`,
  });
}
