/** views/admin/vendas.js — Pedidos, clientes, pagamentos e relatórios. */
import { escapeHtml as e } from '../../lib/security.js';
import {
  paginaAdmin, painel, tabelaAdmin, cartaoMetrica, campoAdmin, barraFerramentas,
  etiquetaStatus, graficoBarras, paginacaoAdmin, money,
} from './layout.js';
import { formatDateTime, formatDate, formatCep, formatDoc, formatPhone } from '../../lib/format.js';
import { STATUS_FINANCEIRO, STATUS_OPERACIONAL } from '../../lib/orders.js';
import { mapStatus } from '../../lib/payments/internal.js';

/* =============================== PEDIDOS =============================== */
export function telaPedidos(ctx, { pedidos, total, pagina, porPagina, filtros }) {
  return paginaAdmin(ctx, {
    titulo: 'Pedidos',
    ativo: 'pedidos',
    conteudo: `
    <h1 class="mt-0">Pedidos <span class="texto-suave texto-pequeno">(${total})</span></h1>
    ${painel({
      corpo: `<form class="barra-ferramentas" method="get" action="/admin/pedidos" style="margin:0">
        <input type="text" name="q" placeholder="Código, nome, e-mail ou CPF" value="${e(filtros.q || '')}">
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
        <button class="botao secundario" type="submit">Filtrar</button>
        <a class="botao secundario" href="/admin/api/pedidos/exportar.csv" download>Exportar CSV</a>
      </form>`,
    })}
    ${painel({
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Pedido', 'Cliente', 'Itens', 'Total', 'Pagamento', 'Entrega', 'Data', ''],
        linhas: pedidos.map((p) => `<tr>
          <td><strong>${e(p.codigo)}</strong></td>
          <td>${e(p.cliente?.nome || '—')}<br><span class="texto-pequeno texto-suave">${e(p.cliente?.email || '')}</span></td>
          <td>${(p.itens || []).reduce((a, i) => a + i.quantidade, 0)}</td>
          <td>${money(p.totalCentavos)}</td>
          <td>${etiquetaStatus(p.statusFinanceiro)}</td>
          <td>${etiquetaStatus(p.statusOperacional)}</td>
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

    <div class="cartoes">
      ${cartaoMetrica('Total', money(pedido.totalCentavos), `${(pedido.itens || []).reduce((a, i) => a + i.quantidade, 0)} itens`)}
      ${cartaoMetrica('Pagamento', STATUS_FINANCEIRO[pedido.statusFinanceiro]?.nome || pedido.statusFinanceiro)}
      ${cartaoMetrica('Entrega', STATUS_OPERACIONAL[pedido.statusOperacional]?.nome || pedido.statusOperacional)}
      ${cartaoMetrica('Frete', pedido.freteCentavos ? money(pedido.freteCentavos) : 'Grátis', e(pedido.freteOpcao?.prazo || ''))}
    </div>

    <div class="grade-form duas-colunas">
      <div>
        ${painel({
          titulo: 'Atualizar status operacional',
          corpo: `<form method="post" action="/admin/api/pedidos/${e(pedido.id)}/status">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            ${campoAdmin({ nome: 'status', rotulo: 'Novo status', valor: pedido.statusOperacional,
              opcoes: Object.values(STATUS_OPERACIONAL).map((s) => ({ valor: s.id, texto: s.nome })) })}
            ${campoAdmin({ nome: 'obs', rotulo: 'Observação interna' })}
            <button class="botao" type="submit">Atualizar status</button>
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

    ${!['cancelado', 'entregue'].includes(pedido.statusOperacional) ? `
    <div class="linha" style="gap:8px">
      <form method="post" action="/admin/api/pedidos/${e(pedido.id)}/cancelar" onsubmit="return confirm('Confirma o cancelamento deste pedido?')">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <button class="botao perigo" type="submit">Cancelar pedido</button>
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
          <td>${etiquetaStatus(p.statusOperacional)}</td>
          <td><a class="botao pequeno secundario" href="/admin/pedidos/${e(p.id)}">Abrir</a></td>
        </tr>`),
        vazio: 'Nenhum pedido deste cliente.',
      }),
    })}`,
  });
}

/* ============================== PAGAMENTOS ============================== */
export function telaPagamentosAdmin(ctx, { pagamentos, metricas, provedor, configPag }) {
  return paginaAdmin(ctx, {
    titulo: 'Pagamentos',
    ativo: 'pagamentos',
    conteudo: `
    <h1 class="mt-0">Pagamentos e integração</h1>

    ${painel({
      titulo: 'Situação da integração',
      corpo: `<div class="cartoes">
          ${cartaoMetrica('Provedor configurado', provedor.nome, provedor.real ? 'Operação real' : 'Ambiente de testes')}
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

    ${painel({
      titulo: 'Meios de pagamento e parcelamento',
      corpo: `<form method="post" action="/admin/api/config/pagamentos">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <div class="campo-linha">
          ${campoAdmin({ nome: 'provedor', rotulo: 'Provedor', valor: configPag.provedor || 'internal',
            opcoes: [{ valor: 'internal', texto: 'Provedor interno de testes (padrão)' }, { valor: 'mercadopago', texto: 'Mercado Pago' }],
            dica: 'Para usar o Mercado Pago é necessário também configurar MP_ACCESS_TOKEN no servidor.' })}
          ${campoAdmin({ nome: 'ambienteTestes', rotulo: 'Ambiente de testes', tipo: 'checkbox', valor: configPag.ambienteTestes !== false })}
        </div>
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
