/** views/admin/vendas.js — Pedidos, clientes, pagamentos e relatórios. */
import { escapeHtml as e } from '../../lib/security.js';
import {
  paginaAdmin, painel, tabelaAdmin, cartaoMetrica, campoAdmin, barraFerramentas,
  etiquetaStatus, graficoBarras, paginacaoAdmin, money,
} from './layout.js';
import { formatDateTime, formatDate, formatCep, formatDoc, formatPhone } from '../../lib/format.js';
import { STATUS_FINANCEIRO, STATUS_OPERACIONAL, pedidoPrecisaConferencia, statusOperacionalExibido } from '../../lib/orders.js';
import { mapStatus } from '../../lib/payments/internal.js';

/* =============================== PEDIDOS =============================== */
export function telaPedidos(ctx, { pedidos, total, pagina, porPagina, filtros, vendedores = [] }) {
  return paginaAdmin(ctx, {
    titulo: 'Pedidos',
    ativo: 'pedidos',
    conteudo: `
    <h1 class="mt-0">Pedidos <span class="texto-suave texto-pequeno">(${total})</span></h1>
    ${painel({
      corpo: `<form class="barra-ferramentas" method="get" action="/admin/pedidos" style="margin:0">
        <input type="text" name="q" placeholder="Código, nome, e-mail ou CPF" value="${e(filtros.q || '')}">
        <select name="vendedor" aria-label="Filtrar por vendedor">
          <option value="">Todos os vendedores</option>
          ${vendedores.map(v => `<option value="${e(v.id)}" ${filtros.vendedor === v.id ? 'selected' : ''}>${e(v.nome)} — ${e(v.codigoInova)}</option>`).join('')}
        </select>
        <select name="financeiro">
          <option value="">Pagamento: todos</option>
          ${Object.values(STATUS_FINANCEIRO).map((s) => `<option value="${e(s.id)}" ${filtros.financeiro === s.id ? 'selected' : ''}>${e(s.nome)}</option>`).join('')}
        </select>
        <select name="operacional">
          <option value="">Entrega: todos</option>
          ${Object.values(STATUS_OPERACIONAL).map((s) => `<option value="${e(s.id)}" ${filtros.operacional === s.id ? 'selected' : ''}>${e(s.nome)}</option>`).join('')}
        </select>
        <select name="periodo">
          <option value="">Qualquer período</option>
          <option value="hoje" ${filtros.periodo === 'hoje' ? 'selected' : ''}>Hoje</option>
          <option value="7" ${filtros.periodo === '7' ? 'selected' : ''}>Últimos 7 dias</option>
          <option value="30" ${filtros.periodo === '30' ? 'selected' : ''}>Últimos 30 dias</option>
        </select>
        <label class="texto-pequeno" style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" name="pendencia" value="1" ${filtros.pendencia === '1' ? 'checked' : ''}>
          Somente pagamentos a conferir
        </label>
        <button class="botao secundario" type="submit">Filtrar</button>
        <a class="botao secundario" href="/admin/api/pedidos/exportar.csv" download>Exportar CSV</a>
      </form>`,
    })}
    ${painel({
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Pedido', 'Cliente', 'Vendedor', 'Itens', 'Total', 'Pagamento', 'Entrega', 'Data', ''],
        linhas: pedidos.map((p) => `<tr>
          <td><strong>${e(p.codigo)}</strong></td>
          <td>${e(p.cliente?.nome || '—')}<br><span class="texto-pequeno texto-suave">${e(p.cliente?.email || '')}</span></td>
          <td>${e(p.vendedor?.nome || 'Atendimento geral')}</td>
          <td>${(p.itens || []).reduce((a, i) => a + i.quantidade, 0)}</td>
          <td>${money(p.totalCentavos)}</td>
          <td>${etiquetaStatus(p.statusFinanceiro)}
            ${pedidoPrecisaConferencia(p)
              ? '<div class="texto-pequeno"><strong>Conferir cobrança</strong></div>' : ''}
          </td>
          <td>${etiquetaStatus(statusOperacionalExibido(p))}</td>
          <td>${formatDateTime(p.criadoEm)}</td>
          <td><a class="botao pequeno secundario" href="/admin/pedidos/${e(p.id)}">Abrir</a></td>
        </tr>`),
        vazio: 'Nenhum pedido encontrado.',
      }),
    })}
    ${paginacaoAdmin({ pagina, total, porPagina, base: '/admin/pedidos', query: filtros })}`,
  });
}

export function telaPedido(ctx, { pedido, pagamento, eventos }) {
  const cliente = pedido.clienteId ? ctx.db.collection('customers').get(pedido.clienteId) : null;
  const podeEstornar = !!ctx.permissoes?.podeEstornar;
  return paginaAdmin(ctx, {
    titulo: `Pedido ${pedido.codigo}`,
    ativo: 'pedidos',
    conteudo: `
    <div class="linha centro entre mb-2" style="flex-wrap:wrap;gap:8px">
      <h1 class="mt-0 mb-0">Pedido ${e(pedido.codigo)}</h1>
      <a class="botao secundario" href="/admin/pedidos">Voltar</a>
    </div>

    ${['criacao_em_andamento', 'conciliacao_necessaria'].includes(pedido.pendenciaPagamento) &&
      pedido.statusFinanceiro === 'pendente' ? `<div class="alerta" role="alert">
        <strong>Atenção: cobrança com resultado incerto.</strong> O pedido está reservado,
        mas a cobrança não está confirmada. Conferir no provedor pelo código
        ${e(pedido.codigo)} antes de qualquer cancelamento, liberação de estoque
        ou nova tentativa. Não aprovar manualmente uma cobrança real.
      </div>` : ''}

    ${pedido.falhaPagamento && ctx.adminUser?.role === 'super_admin' ? `<div class="alerta aviso" role="status">
      <strong>Diagnóstico da última falha no Mercado Pago:</strong>
      ${e(pedido.falhaPagamento.motivo || 'Falha não classificada')}.
      HTTP: ${e(String(pedido.falhaPagamento.httpStatus || 'não disponível'))} ·
      Código: ${e(pedido.falhaPagamento.codigo || 'não informado')}.
      Confira credenciais, dados do pagador e habilitação do Pix antes de uma nova tentativa.
    </div>` : ''}

    ${painel({ titulo: 'Vendedor responsável', corpo: pedido.vendedor
      ? `<p><strong>Nome:</strong> ${e(pedido.vendedor.nome)}</p>
         <p><strong>Código InovaFarma:</strong> <code>${e(pedido.vendedor.codigoInova)}</code></p>
         <p class="texto-pequeno texto-suave">Registro histórico da compra. Não será modificado por edições futuras no vendedor.</p>`
      : '<p>Atendimento geral — nenhum vendedor selecionado no pedido.</p>' })}

    <div class="cartoes">
      ${cartaoMetrica('Total', money(pedido.totalCentavos), `${(pedido.itens || []).reduce((a, i) => a + i.quantidade, 0)} itens`)}
      ${cartaoMetrica('Pagamento', STATUS_FINANCEIRO[pedido.statusFinanceiro]?.nome || pedido.statusFinanceiro)}
      ${cartaoMetrica('Entrega', STATUS_OPERACIONAL[statusOperacionalExibido(pedido)]?.nome || statusOperacionalExibido(pedido))}
      ${cartaoMetrica('Frete', pedido.freteCentavos ? money(pedido.freteCentavos) : 'Grátis', e(pedido.freteOpcao?.prazo || ''))}
    </div>

    <div class="grade-form duas-colunas">
      <div>
        ${painel({
          titulo: 'Atualizar status operacional',
          corpo: `<form method="post" action="/admin/api/pedidos/${e(pedido.id)}/status">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            ${campoAdmin({ nome: 'status', rotulo: 'Novo status', valor: pedido.statusOperacional,
              opcoes: Object.values(STATUS_OPERACIONAL).filter(s => !['cancelado','devolucao_em_analise'].includes(s.id)).map((s) => ({ valor: s.id, texto: s.nome })) })}
            ${campoAdmin({ nome: 'obs', rotulo: 'Observação interna' })}
            <button class="botao" type="submit">Atualizar status</button>
            ${pedido.statusFinanceiro === 'aprovado' &&
                ['enviado','saiu_para_entrega'].includes(pedido.statusOperacional)
              ? `<button class="botao pequeno secundario" type="button"
                  data-marcar-entregue="${e(pedido.id)}">✓ Marcar como entregue</button>` : ''}
          </form>`,
        })}

        ${painel({
          titulo: 'Rastreamento',
          corpo: `<form method="post" action="/admin/api/pedidos/${e(pedido.id)}/rastreio">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <div class="campo-linha">
              ${campoAdmin({ nome: 'codigo', rotulo: 'Código de rastreio', valor: pedido.rastreio?.codigo || '' })}
              ${campoAdmin({ nome: 'transportadora', rotulo: 'Transportadora', valor: pedido.rastreio?.transportadora || '' })}
            </div>
            ${campoAdmin({ nome: 'url', rotulo: 'Link de rastreamento', valor: pedido.rastreio?.url || '' })}
            <button class="botao" type="submit">Salvar rastreio</button>
          </form>`,
        })}

        ${painel({
          titulo: 'Pagamento',
          corpo: pagamento ? `
            <p><strong>Provedor:</strong> ${e(pagamento.provedor)} ${pagamento.simulado ? '<span class="etiqueta laranja">Simulado</span>' : ''}<br>
            <strong>Método:</strong> ${e(pagamento.metodo)}<br>
            <strong>Status:</strong> ${e(mapStatus(pagamento.status))} (${e(pagamento.status)})<br>
            <strong>Valor:</strong> ${money(pagamento.valorCentavos)}
            ${pagamento.parcelas > 1 ? `<br><strong>Parcelas:</strong> ${e(pagamento.parcelas)}x de ${money(pagamento.valorParcelaCentavos)}` : ''}
            ${pagamento.transacaoId ? `<br><strong>ID da transação:</strong> ${e(pagamento.transacaoId)}` : ''}</p>
            ${pagamento.pixCodigo && pagamento.status === 'pending' ? `<div class="pix-codigo">${e(pagamento.pixCodigo)}</div>
              ${pagamento.simulado ? '<p class="texto-pequeno texto-suave">Código simulado (ambiente de testes). Não é pagável.</p>' : ''}` : ''}

            ${pagamento.provedor === 'internal' && pagamento.status === 'pending' && ctx.permissoes?.podeSimularPagamento ? `
            <div class="alerta aviso">
              <strong>Ambiente de testes.</strong> Aprovar manualmente serve apenas para validar o fluxo interno
              (baixa de estoque, status e histórico). Pagamentos reais dependem do provedor configurado.
            </div>
            <div class="linha" style="gap:6px;flex-wrap:wrap">
              <button class="botao" type="button" data-simular-pagamento="${e(pagamento.id)}" data-status="approved">Simular aprovação</button>
              <button class="botao secundario" type="button" data-simular-pagamento="${e(pagamento.id)}" data-status="rejected">Simular recusa</button>
            </div>` : ''}

            ${podeEstornar && pagamento.status === 'approved' ? `
            <div class="mt-2">
              <button class="botao perigo" type="button" data-estornar-pagamento="${e(pagamento.id)}">Solicitar estorno</button>
              ${pagamento.provedor === 'internal' ? '<p class="texto-pequeno texto-suave mb-0">Estorno simulado (sem movimentação financeira).</p>' : ''}
            </div>` : ''}
          ` : '<p class="texto-suave mb-0">Nenhuma cobrança vinculada a este pedido.</p>',
        })}
      </div>

      <div>
        ${painel({
          titulo: 'Cliente',
          corpo: `<p><strong>${e(pedido.cliente?.nome || '—')}</strong><br>
            ${e(pedido.cliente?.email || '')}<br>
            ${formatPhone(pedido.cliente?.telefone || '')}<br>
            CPF: ${e(formatDoc(pedido.cliente?.cpf || ''))}</p>
            ${cliente ? `<a class="botao pequeno secundario" href="/admin/clientes/${e(cliente.id)}">Ver cadastro do cliente</a>` : ''}`,
        })}

        ${painel({
          titulo: 'Endereço de entrega',
          corpo: `<p><strong>${e(pedido.endereco?.nome || '')}</strong><br>
            ${e(pedido.endereco?.logradouro || '')}, ${e(pedido.endereco?.numero || 's/n')}${pedido.endereco?.complemento ? ` — ${e(pedido.endereco.complemento)}` : ''}<br>
            ${e(pedido.endereco?.bairro || '')} — ${e(pedido.endereco?.cidade || '')}/${e(pedido.endereco?.uf || '')}<br>
            CEP ${formatCep(pedido.endereco?.cep || '')}<br>
            <span class="texto-pequeno texto-suave">Frete: ${e(pedido.freteOpcao?.label || '')} · ${e(pedido.freteOpcao?.prazo || '')}</span></p>`,
        })}

        ${painel({
          titulo: 'Histórico',
          corpo: `<ul class="linha-tempo">
            ${(pedido.historico || []).slice().reverse().map((h) => `<li>
              <strong>${e(String(h.status).replace(/_/g, ' '))}</strong>
              <span class="quando">${formatDateTime(h.em)} — ${e(h.por || 'sistema')}</span>
              ${h.obs ? `<div class="texto-pequeno">${e(h.obs)}</div>` : ''}
            </li>`).join('')}
          </ul>`,
        })}
      </div>
    </div>

    ${painel({
      titulo: 'Itens do pedido',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Produto', 'SKU', 'Qtd.', 'Preço unit.', 'Subtotal'],
        linhas: (pedido.itens || []).map((i) => `<tr>
          <td>${e(i.nome)}${i.sanitario?.classificacao && i.sanitario.classificacao !== 'nao_aplicavel' ? `<br><span class="texto-pequeno texto-suave">${e(i.sanitario.classificacao)}</span>` : ''}</td>
          <td>${e(i.sku || '—')}</td>
          <td>${e(i.quantidade)}</td>
          <td>${money(i.precoUnitarioCentavos)}</td>
          <td>${money(i.subtotalCentavos)}</td>
        </tr>`),
      }),
    })}

    ${painel({
      titulo: 'Resumo financeiro',
      corpo: `<div class="resumo-linha"><span>Subtotal</span><strong>${money(pedido.subtotalCentavos)}</strong></div>
        ${pedido.descontoCentavos ? `<div class="resumo-linha"><span>Desconto ${pedido.cupom ? `(${e(pedido.cupom.codigo)})` : ''}</span><strong>− ${money(pedido.descontoCentavos)}</strong></div>` : ''}
        <div class="resumo-linha"><span>Frete</span><strong>${pedido.freteCentavos ? money(pedido.freteCentavos) : 'Grátis'}</strong></div>
        <div class="resumo-linha total"><span>Total</span><span>${money(pedido.totalCentavos)}</span></div>`,
    })}

    ${pedido.cancelamentoPendenteEstorno ? `<div class="alerta" role="status">
      Cancelamento solicitado. Aguardando confirmação do estorno pelo provedor antes de encerrar o pedido.
      O sistema verificará automaticamente; não solicite outro reembolso.
    </div>` : ''}
    ${ctx.permissoes?.podeEditarPedidos &&
       !['cancelado', 'entregue', 'enviado', 'saiu_para_entrega'].includes(pedido.statusOperacional) &&
       !pedido.cancelamentoPendenteEstorno &&
       !(pedido.statusFinanceiro === 'pendente' &&
         ['criacao_em_andamento', 'conciliacao_necessaria'].includes(pedido.pendenciaPagamento)) &&
       (!['aprovado', 'estorno_solicitado'].includes(pedido.statusFinanceiro) || ctx.permissoes?.podeEstornar) ? `
    <div class="linha" style="gap:8px">
      <form method="post" action="/admin/api/pedidos/${e(pedido.id)}/cancelar" onsubmit="return confirm('Confirma o cancelamento deste pedido?')">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <button class="botao perigo" type="submit">
          ${pedido.statusFinanceiro === 'estorno_solicitado' ? 'Cancelar após confirmação do estorno' : 'Cancelar pedido'}
        </button>
      </form>
    </div>` : ''}`,
  });
}

/* =============================== CLIENTES =============================== */
export function telaClientes(ctx, { clientes, total, pagina, porPagina, busca }) {
  return paginaAdmin(ctx, {
    titulo: 'Clientes',
    ativo: 'clientes',
    conteudo: `
    <h1 class="mt-0">Clientes <span class="texto-suave texto-pequeno">(${total})</span></h1>
    <p class="texto-pequeno texto-suave">Dados pessoais tratados conforme a LGPD. Use apenas para atender o cliente e cumprir obrigações legais.</p>
    ${painel({
      corpo: `<form class="barra-ferramentas" method="get" action="/admin/clientes" style="margin:0">
        <input type="text" name="q" placeholder="Nome, e-mail, CPF ou telefone" value="${e(busca)}">
        <button class="botao secundario" type="submit">Buscar</button>
        ${busca ? '<a class="botao secundario" href="/admin/clientes">Limpar</a>' : ''}
      </form>`,
    })}
    ${painel({
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Nome', 'E-mail', 'Telefone', 'CPF', 'Pedidos', 'Cadastro', 'Ações'],
        linhas: clientes.map((c) => {
          const pedidos = ctx.db.collection('orders').count((o) => o.clienteId === c.id);
          return `<tr>
            <td><strong>${e(c.nome || '')}</strong> ${c.ativo === false ? '<span class="etiqueta vermelha">Inativo</span>' : ''}</td>
            <td>${e(c.email || '')}</td>
            <td>${formatPhone(c.telefone || '')}</td>
            <td>${e(formatDoc(c.cpf || ''))}</td>
            <td>${pedidos}</td>
            <td>${formatDate(c.criadoEm)}</td>
            <td class="acoes-linha">
              <a class="botao pequeno secundario" href="/admin/clientes/${e(c.id)}">Abrir</a>
              <button class="botao pequeno" data-alternar-cliente="${e(c.id)}">${c.ativo === false ? 'Reativar' : 'Desativar'}</button>
            </td>
          </tr>`;
        }),
        vazio: 'Nenhum cliente encontrado.',
      }),
    })}
    ${paginacaoAdmin({ pagina, total, porPagina, base: '/admin/clientes', query: { q: busca } })}`,
  });
}

export function telaCliente(ctx, { cliente, pedidos, enderecos }) {
  return paginaAdmin(ctx, {
    titulo: `Cliente: ${cliente.nome}`,
    ativo: 'clientes',
    conteudo: `
    <div class="linha centro entre mb-2" style="flex-wrap:wrap;gap:8px">
      <h1 class="mt-0 mb-0">${e(cliente.nome)}</h1>
      <a class="botao secundario" href="/admin/clientes">Voltar</a>
    </div>

    ${painel({
      titulo: 'Dados cadastrais',
      corpo: `<div class="grade-form duas-colunas">
        <div>
          <p><strong>E-mail:</strong> ${e(cliente.email || '')}<br>
          <strong>Telefone:</strong> ${formatPhone(cliente.telefone || '')}<br>
          <strong>CPF:</strong> ${e(formatDoc(cliente.cpf || ''))}<br>
          <strong>Nascimento:</strong> ${e(cliente.dataNascimento || '—')}<br>
          <strong>Cadastro:</strong> ${formatDateTime(cliente.criadoEm)}<br>
          <strong>Último acesso:</strong> ${cliente.ultimoAcesso ? formatDateTime(cliente.ultimoAcesso) : '—'}<br>
          <strong>Marketing:</strong> ${cliente.marketing ? 'Autorizado' : 'Não autorizado'}</p>
        </div>
        <div>
          <h4>Endereços</h4>
          ${(enderecos || []).length ? enderecos.map((en) => `<p class="texto-pequeno">
            <strong>${e(en.apelido || 'Endereço')}</strong> ${en.padrao ? '<span class="etiqueta verde">Principal</span>' : ''}<br>
            ${e(en.logradouro)}, ${e(en.numero)} — ${e(en.bairro)}<br>
            ${e(en.cidade)}/${e(en.uf)} — ${formatCep(en.cep)}</p>`).join('')
            : '<p class="texto-pequeno texto-suave">Nenhum endereço cadastrado.</p>'}
        </div>
      </div>`,
    })}

    ${painel({
      titulo: 'Pedidos do cliente',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Pedido', 'Data', 'Total', 'Pagamento', 'Entrega', ''],
        linhas: pedidos.map((p) => `<tr>
          <td>${e(p.codigo)}</td>
          <td>${formatDateTime(p.criadoEm)}</td>
          <td>${money(p.totalCentavos)}</td>
          <td>${etiquetaStatus(p.statusFinanceiro)}</td>
          <td>${etiquetaStatus(statusOperacionalExibido(p))}</td>
          <td><a class="botao pequeno secundario" href="/admin/pedidos/${e(p.id)}">Abrir</a></td>
        </tr>`),
        vazio: 'Nenhum pedido deste cliente.',
      }),
    })}`,
  });
}

/* ============================== PAGAMENTOS ============================== */
export function telaPagamentosAdmin(ctx, { pagamentos, metricas, provedor, configPag, credenciais = null, urlWebhook = '', falhas = [] }) {
  return paginaAdmin(ctx, {
    titulo: 'Pagamentos',
    ativo: 'pagamentos',
    conteudo: `
    <h1 class="mt-0">Pagamentos e integração</h1>

    ${painel({
      titulo: 'Situação da integração',
      corpo: `<div class="cartoes">
          ${cartaoMetrica('Provedor configurado', provedor.nome,
            !provedor.configurado ? 'Integração incompleta' :
            provedor.provider === 'internal' ? 'Simulação interna' :
            provedor.sandbox ? 'Credenciais de teste (sem dinheiro real)' : 'Credenciais de produção')}
          ${cartaoMetrica('Cobranças registradas', metricas.total)}
          ${cartaoMetrica('Aprovadas', metricas.aprovadas)}
          ${cartaoMetrica('Pendentes', metricas.pendentes)}
          ${cartaoMetrica('Valor aprovado', money(metricas.valorAprovado))}
        </div>
        ${provedor.motivo ? `<div class="alerta aviso">${e(provedor.motivo)}</div>` : ''}
        <div class="alerta info mb-0">
          <strong>Regras de segurança aplicadas:</strong> as credenciais ficam apenas no servidor (variáveis de ambiente);
          nenhum dado de cartão é armazenado por nós; o pedido só é marcado como pago mediante confirmação do provedor
          (webhook validado ou consulta autenticada à API).
        </div>`,
    })}

    ${credenciais ? painel({
      titulo: 'Integração Mercado Pago — Access Token e Pix',
      corpo: `<p>Cadastre as credenciais da sua aplicação do Mercado Pago para o site gerar o Pix automaticamente e exibir o QR Code e o código Copia e Cola na confirmação do pedido.</p>
        <p><strong>Credencial atual:</strong> ${credenciais.tokenConfigurado ? 'Configurada' : 'Não configurada'} ·
          <strong>Origem:</strong> ${e(credenciais.origem)} ·
          <strong>Ambiente:</strong> ${e(credenciais.ambiente)} ·
          <strong>Assinatura dos webhooks:</strong> ${credenciais.webhookConfigurado ? 'Configurada' : 'Pendente'}.</p>
        ${!credenciais.legivel ? '<div class="alerta erro">Não foi possível abrir as credenciais guardadas. Confira a chave de cifragem; cobranças bloqueadas.</div>' : ''}
        ${!credenciais.cofrePreparado ? `<div class="alerta aviso">Antes de salvar pelo painel, configure uma única vez o secret <code>MP_CREDENTIALS_KEY</code> na Cloudflare, com pelo menos 32 caracteres aleatórios. O Access Token não deve ser colocado no GitHub.</div>` : ''}
        <form method="post" action="/admin/api/mercadopago/credenciais" autocomplete="off">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <div class="campo-linha">
            ${campoAdmin({ nome: 'ambiente', rotulo: 'Credenciais para', valor: credenciais.ambiente,
              opcoes: [{ valor: 'testes', texto: 'Teste — sem cobrar clientes' }, { valor: 'producao', texto: 'Produção — pagamentos reais' }] })}
          </div>
          <div class="campo-linha">
            <div class="campo"><label for="mpAccessToken">Access Token (privado) *</label>
              <input id="mpAccessToken" name="accessToken" type="password" autocomplete="new-password" minlength="20" maxlength="2048" required placeholder="Cole o Access Token do Mercado Pago">
              <span class="dica">Nunca será exibido novamente nesta página. Para atualizar, informe a credencial nova.</span></div>
            <div class="campo"><label for="mpPublicKey">Public Key (opcional para Pix)</label>
              <input id="mpPublicKey" name="publicKey" type="text" autocomplete="off" maxlength="512" placeholder="Cole a Public Key"></div>
          </div>
          <div class="campo"><label for="mpWebhookSecret">Assinatura secreta das notificações (necessária em produção)</label>
            <input id="mpWebhookSecret" name="webhookSecret" type="password" autocomplete="new-password" maxlength="512" placeholder="Cole o secret de assinatura do webhook"></div>
          <p class="texto-pequeno"><strong>URL para configurar nas notificações do Mercado Pago:</strong><br>
            <code>${e(urlWebhook)}</code></p>
          <button type="submit" class="botao">Salvar credenciais com segurança</button>
          <p class="texto-pequeno texto-suave">Salvar credenciais não ativa cobranças reais automaticamente. <strong>Confira na sua conta Mercado Pago se a chave copiada é de teste ou produção:</strong> ambas podem começar com APP_USR. A seleção do ambiente aqui não converte uma chave de produção em teste. Depois selecione Mercado Pago e confirme o ambiente correto abaixo.</p>
        </form>
        ${credenciais.origem === 'painel' ? `<form method="post" action="/admin/api/mercadopago/remover" class="mt-2">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <button type="submit" class="botao secundario">Remover credenciais guardadas no painel</button>
        </form>` : ''}
        <div class="alerta info mt-2 mb-0"><strong>Importante:</strong> o Pix real só é gerado após autenticação do Mercado Pago. Cartões reais continuam desativados até homologação da tokenização; o Pix não exige a Public Key no navegador.</div>`,
    }) : ''}

    ${painel({
      titulo: 'Meios de pagamento e parcelamento',
      corpo: `<form method="post" action="/admin/api/config/pagamentos">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <div class="campo-linha">
          ${campoAdmin({ nome: 'provedor', rotulo: 'Provedor', valor: configPag.provedor || 'internal',
            opcoes: [{ valor: 'internal', texto: 'Provedor interno de testes (padrão)' }, { valor: 'mercadopago', texto: 'Mercado Pago' }],
            dica: 'Configure o Access Token no formulário acima (Super Administrador) ou pelo secret MP_ACCESS_TOKEN na Cloudflare. Pix real só após ativação e homologação.' })}
          ${campoAdmin({ nome: 'ambienteTestes', rotulo: 'Ambiente de testes (sem cobrar clientes)', tipo: 'checkbox', valor: configPag.ambienteTestes !== false })}
        </div>
        <label class="check"><input type="checkbox" name="habilitarProducao" value="1"> Confirmo que verifiquei as credenciais de produção e autorizo cobranças reais quando o modo de testes estiver desmarcado.</label>
        <h4>Meios habilitados</h4>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'meios_pix', rotulo: 'Pix', tipo: 'checkbox', valor: configPag.meios?.pix !== false })}
          ${campoAdmin({ nome: 'meios_credit_card', rotulo: 'Cartão de crédito', tipo: 'checkbox', valor: configPag.meios?.credit_card !== false })}
          ${campoAdmin({ nome: 'meios_debit_card', rotulo: 'Cartão de débito', tipo: 'checkbox', valor: !!configPag.meios?.debit_card })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'parcelamentoMaximo', rotulo: 'Parcelamento máximo', tipo: 'number', min: '1', max: '12', valor: configPag.parcelamentoMaximo || 6 })}
          ${campoAdmin({ nome: 'parcelasSemJuros', rotulo: 'Parcelas sem juros', tipo: 'number', min: '1', max: '12', valor: configPag.parcelasSemJuros || 3 })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'taxaJurosMes', rotulo: 'Taxa de juros ao mês (%)', tipo: 'number', step: '0.01', min: '0', valor: configPag.taxaJurosMes || 0, dica: 'Somente se a farmácia repassar juros ao cliente.' })}
          ${campoAdmin({ nome: 'valorMinimoParcela', rotulo: 'Valor mínimo da parcela (R$)', tipo: 'number', step: '0.01', min: '0', valor: ((configPag.valorMinimoParcela || 500) / 100).toFixed(2) })}
        </div>
        ${campoAdmin({ nome: 'descontoPixPercentual', rotulo: 'Desconto no Pix (%)', tipo: 'number', step: '0.01', min: '0', valor: configPag.descontoPixPercentual || 0 })}
        ${campoAdmin({ nome: 'mensagemCheckout', rotulo: 'Mensagem no checkout', tipo: 'textarea', valor: configPag.mensagemCheckout || '' })}
        <button class="botao" type="submit">Salvar configurações de pagamento</button>
      </form>
      <div class="alerta aviso mt-2 mb-0">
        <strong>Taxas:</strong> as taxas cobradas pelo Mercado Pago (Pix, crédito, débito, parcelamento e antecipação) são definidas
        pelo provedor e não estão incluídas nos valores de frete. Consulte o painel do Mercado Pago para conhecer as taxas vigentes.
      </div>`,
    })}

    ${credenciais ? painel({
      titulo: 'Tentativas de cobrança que não foram concluídas',
      corpo: `<p class="texto-pequeno texto-suave">Aqui aparecem os pedidos cancelados por falha de cobrança, mesmo quando nenhuma transação foi criada. Para falhas anteriores a este diagnóstico, o motivo detalhado não pode ser recuperado sem os logs originais.</p>
        ${tabelaAdmin({
          colunas: ['Pedido', 'Resultado', 'Status HTTP', 'Código', ''],
          linhas: falhas.map(p => `<tr>
            <td>${e(p.codigo)}</td>
            <td>${e(p.falhaPagamento?.motivo || 'Falha antiga: motivo exato não registrado')}</td>
            <td>${e(String(p.falhaPagamento?.httpStatus || '—'))}</td>
            <td>${e(p.falhaPagamento?.codigo || '—')}</td>
            <td><a href="/admin/pedidos/${e(p.id)}">Ver pedido</a></td>
          </tr>`),
          vazio: 'Nenhuma falha de cobrança recente registrada.',
        })}`,
    }) : ''}

    ${painel({
      titulo: 'Transações',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Data', 'Pedido', 'Provedor', 'Método', 'Status', 'Valor', 'Ações'],
        linhas: pagamentos.map((p) => `<tr>
          <td>${formatDateTime(p.criadoEm)}</td>
          <td><a href="/admin/pedidos/${e(p.pedidoId)}">${e(p.pedidoCodigo || '')}</a></td>
          <td>${e(p.provedor)} ${p.simulado ? '<span class="etiqueta laranja">Simulado</span>' : ''}</td>
          <td>${e(p.metodo)}</td>
          <td>${etiquetaStatus(p.status === 'approved' ? 'aprovado' : p.status === 'pending' ? 'pendente' : p.status)}</td>
          <td>${money(p.valorCentavos)}</td>
          <td><a class="botao pequeno secundario" href="/admin/pedidos/${e(p.pedidoId)}">Ver pedido</a></td>
        </tr>`),
        vazio: 'Nenhuma transação registrada.',
      }),
    })}`,
  });
}

/* ============================== RELATÓRIOS ============================== */
export function telaRelatorios(ctx, { metricas, grafico, topProdutos, porEstado, porCategoria, periodo }) {
  return paginaAdmin(ctx, {
    titulo: 'Relatórios',
    ativo: 'relatorios',
    conteudo: `
    <h1 class="mt-0">Relatórios</h1>
    ${painel({
      corpo: `<form class="barra-ferramentas" method="get" action="/admin/relatorios" style="margin:0">
        <label class="rotulo mb-0" for="de">De</label>
        <input type="date" id="de" name="de" value="${e(periodo.de)}">
        <label class="rotulo mb-0" for="ate">Até</label>
        <input type="date" id="ate" name="ate" value="${e(periodo.ate)}">
        <button class="botao secundario" type="submit">Aplicar</button>
        <a class="botao secundario" href="/admin/api/relatorios/vendas.csv?de=${encodeURIComponent(periodo.de)}&ate=${encodeURIComponent(periodo.ate)}">Exportar CSV</a>
      </form>`,
    })}

    <div class="cartoes">
      ${cartaoMetrica('Pedidos no período', metricas.pedidosTotal)}
      ${cartaoMetrica('Pedidos pagos', metricas.pedidosPagos)}
      ${cartaoMetrica('Receita', money(metricas.receitaCentavos))}
      ${cartaoMetrica('Ticket médio', money(metricas.ticketMedioCentavos))}
      ${cartaoMetrica('Cancelados', metricas.pedidosCancelados)}
      ${cartaoMetrica('Entregues', metricas.pedidosEntregues)}
    </div>

    ${painel({
      titulo: 'Receita por dia',
      corpo: graficoBarras(grafico.map((d) => ({ rotulo: formatDate(d.data), valor: d.receitaCentavos, texto: money(d.receitaCentavos) }))),
    })}

    <div class="grade-form duas-colunas">
      ${painel({
        titulo: 'Produtos mais vendidos',
        semPadding: true,
        corpo: tabelaAdmin({
          colunas: ['Produto', 'Qtd.', 'Receita'],
          linhas: topProdutos.map((p) => `<tr><td>${e(p.nome)}</td><td>${e(p.quantidade)}</td><td>${money(p.receitaCentavos)}</td></tr>`),
          vazio: 'Sem vendas no período.',
        }),
      })}
      ${painel({
        titulo: 'Vendas por estado (UF)',
        semPadding: true,
        corpo: tabelaAdmin({
          colunas: ['UF', 'Pedidos', 'Receita'],
          linhas: porEstado.map((p) => `<tr><td>${e(p.uf)}</td><td>${e(p.pedidos)}</td><td>${money(p.receitaCentavos)}</td></tr>`),
          vazio: 'Sem vendas no período.',
        }),
      })}
    </div>

    ${painel({
      titulo: 'Vendas por categoria',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Categoria', 'Itens vendidos', 'Receita'],
        linhas: porCategoria.map((c) => `<tr><td>${e(c.nome)}</td><td>${e(c.quantidade)}</td><td>${money(c.receitaCentavos)}</td></tr>`),
        vazio: 'Sem vendas no período.',
      }),
    })}`,
  });
}
