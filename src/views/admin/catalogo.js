/** views/admin/catalogo.js — Painel, produtos, categorias, estoque, mídia, banners e promoções. */
import { escapeHtml as e, sanitizeHtml } from '../../lib/security.js';
import { paginaAdmin, painel, tabelaAdmin, cartaoMetrica, campoAdmin, barraFerramentas, etiquetaStatus, graficoBarras, paginacaoAdmin, money } from './layout.js';
import { formatDateTime, formatDate, formatNumber } from '../../lib/format.js';
import { CLASSIFICACOES, descontoPercentual, temPromocao, estoqueDisponivel, podeVender } from '../../lib/catalog.js';
import { uploadStats } from '../../lib/uploads.js';
import { toCents } from '../../lib/format.js';
import { inovaAtiva } from '../../lib/inovafarma-stock.js';

/* ============================== PAINEL ============================== */
export function telaDashboard(ctx, { metricas, grafico, pedidosRecentes, estoqueBaixo, topProdutos, infoPagamento }) {
  return paginaAdmin(ctx, {
    titulo: 'Painel',
    ativo: 'dashboard',
    conteudo: `
    <div class="linha centro entre mb-2" style="flex-wrap:wrap;gap:8px">
      <h1 class="mt-0 mb-0">Painel da loja</h1>
      <span class="texto-pequeno texto-suave">Atualizado em ${formatDateTime(new Date().toISOString())}</span>
    </div>

    ${!infoPagamento.configurado && infoPagamento.efetivo === 'mercadopago' ? `<div class="alerta aviso">${e(infoPagamento.motivo)}</div>` : ''}
    ${infoPagamento.efetivo === 'internal' ? `<div class="alerta info">
      <strong>Pagamentos em ambiente de testes.</strong> O provedor interno não movimenta dinheiro real nem gera cobranças.
      Configure o Mercado Pago em <a href="/admin/pagamentos">Pagamentos</a> e nas variáveis de ambiente para operar de verdade.
    </div>` : ''}

    <div class="cartoes">
      ${cartaoMetrica('Pedidos', metricas.pedidosTotal, `${metricas.pedidosPagos} pagos`)}
      ${cartaoMetrica('Receita (pagos)', money(metricas.receitaCentavos), `Ticket médio ${money(metricas.ticketMedioCentavos)}`)}
      ${cartaoMetrica('Aguardando pagamento', metricas.pedidosPendentes)}
      ${cartaoMetrica('Enviados', metricas.pedidosEnviados, `${metricas.pedidosEntregues} entregues`)}
      ${cartaoMetrica('Cancelados', metricas.pedidosCancelados)}
      ${cartaoMetrica('Produtos', metricas.produtosTotal, `${metricas.produtosAtivos} ativos`)}
      ${cartaoMetrica('Estoque baixo', metricas.estoqueBaixo)}
      ${cartaoMetrica('Clientes', metricas.clientesTotal)}
    </div>

    ${painel({
      titulo: 'Vendas nos últimos 30 dias',
      corpo: `${graficoBarras(grafico.map((d) => ({ rotulo: formatDate(d.data), valor: d.receitaCentavos, texto: money(d.receitaCentavos) })))}
        <p class="texto-pequeno texto-suave mb-0">Passe o mouse sobre as barras para ver o valor diário (apenas pedidos com pagamento aprovado).</p>`,
    })}

    <div class="grade-form duas-colunas">
      ${painel({
        titulo: 'Pedidos recentes',
        acoes: '<a class="botao pequeno secundario" href="/admin/pedidos">Ver todos</a>',
        semPadding: true,
        corpo: tabelaAdmin({
          colunas: ['Pedido', 'Cliente', 'Total', 'Pagamento', 'Entrega', ''],
          linhas: pedidosRecentes.map((p) => `<tr>
            <td><strong>${e(p.codigo)}</strong><br><span class="texto-pequeno texto-suave">${formatDate(p.criadoEm)}</span></td>
            <td>${e(p.cliente?.nome || '—')}</td>
            <td>${money(p.totalCentavos)}</td>
            <td>${etiquetaStatus(p.statusFinanceiro)}</td>
            <td>${etiquetaStatus(p.statusOperacional)}</td>
            <td><a class="botao pequeno secundario" href="/admin/pedidos/${e(p.id)}">Abrir</a></td>
          </tr>`),
          vazio: 'Nenhum pedido ainda.',
        }),
      })}

      ${painel({
        titulo: 'Produtos com estoque baixo',
        acoes: '<a class="botao pequeno secundario" href="/admin/estoque">Ir para estoque</a>',
        semPadding: true,
        corpo: tabelaAdmin({
          colunas: ['Produto', 'Estoque', 'Mínimo', ''],
          linhas: estoqueBaixo.map((p) => `<tr>
            <td>${e(p.nome)}</td>
            <td><strong>${e(p.estoque?.quantidade ?? 0)}</strong> ${Number(p.estoque?.reservado) ? `<span class="texto-pequeno texto-suave">(${p.estoque.reservado} reservado)</span>` : ''}</td>
            <td>${e(p.estoque?.minimo ?? 0)}</td>
            <td><a class="botao pequeno secundario" href="/admin/produtos/${e(p.id)}">Ajustar</a></td>
          </tr>`),
          vazio: 'Nenhum produto abaixo do estoque mínimo.',
        }),
      })}
    </div>

    ${painel({
      titulo: 'Produtos mais vendidos',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Produto', 'Quantidade', 'Receita'],
        linhas: topProdutos.map((p) => `<tr><td>${e(p.nome)}</td><td>${p.quantidade}</td><td>${money(p.receitaCentavos)}</td></tr>`),
        vazio: 'Ainda não há vendas registradas.',
      }),
    })}`,
  });
}

/* ============================= PRODUTOS ============================= */
export function telaProdutos(ctx, { produtos, total, pagina, porPagina, busca, categorias, filtros }) {
  return paginaAdmin(ctx, {
    titulo: 'Produtos',
    ativo: 'produtos',
    conteudo: `
    <div class="linha centro entre mb-2" style="flex-wrap:wrap;gap:8px">
      <h1 class="mt-0 mb-0">Produtos <span class="texto-suave texto-pequeno">(${total})</span></h1>
      <div class="linha" style="gap:6px">
        <a class="botao" href="/admin/produtos/novo">+ Novo produto</a>
        <a class="botao secundario" href="/admin/produtos/importar">Importar/exportar</a>
      </div>
    </div>

    ${painel({
      corpo: `<form class="barra-ferramentas" method="get" action="/admin/produtos" style="margin:0">
        <input type="text" name="q" placeholder="Buscar por nome, SKU, EAN ou marca" value="${e(busca)}">
        <select name="categoria">
          <option value="">Todas as categorias</option>
          ${categorias.map((c) => `<option value="${e(c.id)}" ${filtros.categoria === c.id ? 'selected' : ''}>${e(c.nome)}</option>`).join('')}
        </select>
        <select name="status">
          <option value="">Todos os status</option>
          <option value="ativo" ${filtros.status === 'ativo' ? 'selected' : ''}>Ativos</option>
          <option value="inativo" ${filtros.status === 'inativo' ? 'selected' : ''}>Inativos</option>
          <option value="estoque_baixo" ${filtros.status === 'estoque_baixo' ? 'selected' : ''}>Estoque baixo</option>
          <option value="bloqueado" ${filtros.status === 'bloqueado' ? 'selected' : ''}>Bloqueados para venda</option>
        </select>
        <button class="botao secundario" type="submit">Filtrar</button>
        ${busca || filtros.categoria || filtros.status ? '<a class="botao secundario" href="/admin/produtos">Limpar</a>' : ''}
      </form>`,
    })}

    ${painel({
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Foto', 'Produto', 'Categoria', 'Preço', 'Estoque', 'Situação', 'Ações'],
        linhas: produtos.map((p) => {
          const venda = podeVender(p);
          const cat = ctx.db.collection('categories').get(p.categoriaId);
          return `<tr>
            <td><img class="mini" src="${e(p.imagens?.[0]?.url || '/img/produto-sem-foto.svg')}" alt=""></td>
            <td>
              <strong>${e(p.nome)}</strong><br>
              <span class="texto-pequeno texto-suave">SKU ${e(p.sku || '—')} · ${e(p.marca || '—')}</span>
              ${p.destaque ? ' <span class="etiqueta laranja">Destaque</span>' : ''}
            </td>
            <td>${e(cat?.nome || '—')}</td>
            <td>
              ${money(p.precoPromocionalCentavos || p.precoCentavos)}
              ${temPromocao(p) ? `<br><span class="texto-pequeno texto-suave"><s>${money(p.precoCentavos)}</s> −${descontoPercentual(p)}%</span>` : ''}
            </td>
            <td>
              <strong>${e(p.estoque?.quantidade ?? 0)}</strong>
              ${Number(p.estoque?.reservado) ? `<br><span class="texto-pequeno texto-suave">${p.estoque.reservado} reservado</span>` : ''}
              ${Number(p.estoque?.quantidade ?? 0) <= Number(p.estoque?.minimo ?? 0) ? ' <span class="etiqueta vermelha">Baixo</span>' : ''}
            </td>
            <td>
              ${!p.ativo ? etiquetaStatus('inativo') : ''}
              ${p.ativo && venda.ok ? etiquetaStatus('ativo') : ''}
              ${p.ativo && !venda.ok ? `<span class="etiqueta vermelha" title="${e(venda.motivo)}">${venda.bloqueioSanitario ? 'Bloqueio sanitário' : 'Indisponível'}</span>` : ''}
            </td>
            <td class="acoes-linha">
              <a class="botao pequeno secundario" href="/admin/produtos/${e(p.id)}">Editar</a>
              <a class="botao pequeno secundario" href="/produto/${e(p.slug)}" target="_blank">Ver</a>
              <button class="botao pequeno ${p.ativo ? '' : 'secundario'}" data-alternar-produto="${e(p.id)}">${p.ativo ? 'Desativar' : 'Ativar'}</button>
              <button class="botao pequeno perigo" data-excluir-produto="${e(p.id)}" data-nome="${e(p.nome)}">Excluir</button>
            </td>
          </tr>`;
        }),
        vazio: 'Nenhum produto encontrado com esses filtros.',
      }),
    })}
    ${paginacaoAdmin({ pagina, total, porPagina, base: '/admin/produtos', query: { q: busca, ...filtros } })}`,
  });
}

export function telaProdutoForm(ctx, { produto, categorias, marcas, todasMidia }) {
  const p = produto || {};
  const s = { classificacao: 'nao_aplicavel', requerReceita: false, registroMS: '', apresentacao: '', concentracao: '', principioAtivo: '', bulaUrl: '', aprovadoFarmaceutico: false, restricaoTransporte: false, restricaoAdvertencia: '', fabricante: '', controlado: false, ...(p.sanitario || {}) };
  const editando = !!produto;
  const imagens = p.imagens || [];
  const videos = p.videos || [];

  return paginaAdmin(ctx, {
    titulo: editando ? `Editar: ${p.nome}` : 'Novo produto',
    ativo: 'produtos',
    conteudo: `
    <div class="linha centro entre mb-2" style="flex-wrap:wrap;gap:8px">
      <h1 class="mt-0 mb-0">${editando ? 'Editar produto' : 'Novo produto'}</h1>
      <a class="botao secundario" href="/admin/produtos">Voltar para a lista</a>
    </div>

    ${editando && !podeVender(p).ok ? `<div class="alerta aviso">
      <strong>Este produto não pode ser vendido agora.</strong> Motivo: ${e(podeVender(p).motivo || '')}
    </div>` : ''}

    ${ctx.req?.query?.get('salvo') === '1' ? '<div class="alerta sucesso" role="status">Produto salvo com sucesso.</div>' : ''}
    <form id="formProduto" method="post" action="/admin/api/produtos${editando ? `/${e(p.id)}` : ''}">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">

      <div class="grade-form duas-colunas">
        <div>
          ${painel({
            titulo: 'Identificação',
            corpo: `
            ${campoAdmin({ nome: 'nome', rotulo: 'Nome do produto', valor: p.nome || '', obrigatorio: true, dica: 'Nome completo exibido na loja (ex.: Paracetamol 500mg 20 comprimidos).' })}
            <div class="campo-linha">
              ${campoAdmin({ nome: 'codigoInterno', rotulo: 'Código interno', valor: p.codigoInterno || '' })}
              ${campoAdmin({ nome: 'sku', rotulo: 'SKU', valor: p.sku || '' })}
            </div>
            <div class="campo-linha">
              ${campoAdmin({ nome: 'ean', rotulo: 'Código de barras (EAN)', valor: p.ean || '' })}
              ${campoAdmin({ nome: 'marca', rotulo: 'Marca', valor: p.marca || '', atributos: `list="listaMarcas"`, dica: 'Digite uma nova marca ou escolha uma existente.' })}
            </div>
            <datalist id="listaMarcas">${marcas.map((m) => `<option value="${e(m.nome)}">`).join('')}</datalist>
            ${campoAdmin({ nome: 'fabricante', rotulo: 'Fabricante', valor: p.fabricante || '' })}
            <div class="campo-linha">
              ${campoAdmin({ nome: 'categoriaId', rotulo: 'Categoria principal', valor: p.categoriaId || '',
                opcoes: [{ valor: '', texto: '— Selecione —' }, ...categorias.filter((c) => !c.paiId).map((c) => ({ valor: c.id, texto: c.nome }))] })}
              ${campoAdmin({ nome: 'subcategoriaId', rotulo: 'Subcategoria', valor: p.subcategoriaId || '',
                opcoes: [{ valor: '', texto: '— Nenhuma —' }, ...categorias.filter((c) => c.paiId).map((c) => ({ valor: c.id, texto: c.nome }))] })}
            </div>
            ${campoAdmin({ nome: 'ativo', rotulo: 'Produto ativo (visível na loja)', tipo: 'checkbox', valor: p.ativo !== false })}
            ${campoAdmin({ nome: 'destaque', rotulo: 'Destacar na home', tipo: 'checkbox', valor: !!p.destaque })}
            `,
          })}

          ${painel({
            titulo: 'Preços',
            corpo: `
            <div class="campo-linha">
              ${campoAdmin({ nome: 'preco', rotulo: 'Preço de venda (R$)', tipo: 'number', step: '0.01', min: '0', valor: p.precoCentavos != null ? (p.precoCentavos / 100).toFixed(2) : '', obrigatorio: true })}
              ${campoAdmin({ nome: 'precoPromocional', rotulo: 'Preço promocional (R$)', tipo: 'number', step: '0.01', min: '0', valor: p.precoPromocionalCentavos ? (p.precoPromocionalCentavos / 100).toFixed(2) : '', dica: 'Deixe em branco para não aplicar promoção.' })}
            </div>
            <p class="texto-pequeno texto-suave mb-0">Use ponto ou vírgula para os centavos. O desconto em % é calculado automaticamente.</p>
            `,
          })}

          ${painel({
            titulo: 'Estoque e logística',
            corpo: `
            <div class="campo-linha">
              ${campoAdmin({ nome: 'quantidade', rotulo: 'Quantidade em estoque', tipo: 'number', min: '0', valor: p.estoque?.quantidade ?? 0 })}
              ${campoAdmin({ nome: 'estoqueMinimo', rotulo: 'Estoque mínimo (alerta)', tipo: 'number', min: '0', valor: p.estoque?.minimo ?? 5 })}
            </div>
            <div class="campo-linha">
              ${campoAdmin({ nome: 'peso', rotulo: 'Peso (kg)', tipo: 'number', step: '0.001', min: '0', valor: p.peso ?? 0 })}
              ${campoAdmin({ nome: 'largura', rotulo: 'Largura (cm)', tipo: 'number', step: '0.1', min: '0', valor: p.dimensoes?.largura ?? 0 })}
            </div>
            <div class="campo-linha">
              ${campoAdmin({ nome: 'altura', rotulo: 'Altura (cm)', tipo: 'number', step: '0.1', min: '0', valor: p.dimensoes?.altura ?? 0 })}
              ${campoAdmin({ nome: 'comprimento', rotulo: 'Comprimento (cm)', tipo: 'number', step: '0.1', min: '0', valor: p.dimensoes?.comprimento ?? 0 })}
            </div>
            ${editando ? `<p class="texto-pequeno texto-suave mb-0">Ajustes de estoque ficam registrados no histórico de movimentações. Reservado: <strong>${e(p.estoque?.reservado ?? 0)}</strong> · Disponível para venda: <strong>${estoqueDisponivel(p)}</strong></p>` : ''}
            `,
          })}
        </div>

        <div>
          ${painel({
            titulo: 'Informações sanitárias',
            corpo: `
            ${campoAdmin({ nome: 'classificacao', rotulo: 'Classificação', valor: s.classificacao,
              opcoes: Object.values(CLASSIFICACOES).map((c) => ({ valor: c.id, texto: c.nome })) })}
            <div class="campo-linha">
              ${campoAdmin({ nome: 'principioAtivo', rotulo: 'Princípio ativo', valor: s.principioAtivo || '' })}
              ${campoAdmin({ nome: 'concentracao', rotulo: 'Concentração', valor: s.concentracao || '' })}
            </div>
            <div class="campo-linha">
              ${campoAdmin({ nome: 'apresentacao', rotulo: 'Apresentação', valor: s.apresentacao || '' })}
              ${campoAdmin({ nome: 'registroMS', rotulo: 'Registro na Anvisa (MS)', valor: s.registroMS || '', dica: 'Obrigatório para medicamentos e correlatos.' })}
            </div>
            ${campoAdmin({ nome: 'bulaUrl', rotulo: 'Link da bula oficial (PDF)', valor: s.bulaUrl || '', dica: 'Informe a URL da bula fornecida pelo fabricante.' })}
            ${campoAdmin({ nome: 'restricaoTransporte', rotulo: 'Produto com restrição de transporte', tipo: 'checkbox', valor: !!s.restricaoTransporte })}
            ${campoAdmin({ nome: 'restricaoAdvertencia', rotulo: 'Advertência adicional', valor: s.restricaoAdvertencia || '' })}
            <hr style="border:0;border-top:1px solid var(--borda);margin:14px 0">
            ${campoAdmin({ nome: 'requerReceita', rotulo: 'Exige receita médica (bloqueia a venda online)', tipo: 'checkbox', valor: !!s.requerReceita })}
            ${campoAdmin({ nome: 'controlado', rotulo: 'Medicamento controlado (bloqueia a venda online)', tipo: 'checkbox', valor: !!s.controlado })}
            <div class="alerta ${ctx.podeAprovar ? 'info' : 'aviso'} mb-0">
              <strong>Aprovação do farmacêutico responsável:</strong>
              ${s.aprovadoFarmaceutico
                ? `<span class="etiqueta verde">Aprovado</span> por ${e(s.aprovadoPor || '—')} em ${s.aprovadoEm ? formatDateTime(s.aprovadoEm) : '—'}`
                : '<span class="etiqueta laranja">Pendente</span>'}
              ${ctx.podeAprovar ? `
                <div class="mt-1">
                  <button class="botao pequeno ${s.aprovadoFarmaceutico ? 'secundario' : ''}" type="button"
                    data-aprovar-produto="${e(p.id || '')}" data-status="${s.aprovadoFarmaceutico ? '0' : '1'}">
                    ${s.aprovadoFarmaceutico ? 'Revogar aprovação' : 'Aprovar cadastro'}
                  </button>
                </div>` : '<div class="texto-pequeno mt-1">Seu perfil não tem permissão para aprovar. Peça ao farmacêutico responsável ou ao super administrador.</div>'}
            </div>
            `,
          })}

          ${painel({
            titulo: 'Fotos e vídeos',
            corpo: `
            <div class="zona-upload" id="zonaUpload" tabindex="0" role="button" aria-label="Enviar arquivos">
              <strong>Clique ou arraste arquivos aqui</strong>
              <p class="texto-pequeno texto-suave mb-0">Imagens (JPG, PNG, WEBP) até 8 MB · Vídeos (MP4, WEBM) até 64 MB.</p>
              <input type="file" id="inputUpload" multiple accept="image/*,video/*" style="display:none">
            </div>
            <div id="galeriaProduto" class="galeria-midia">
              ${imagens.map((img, i) => `
                <div class="item-midia" data-url="${e(img.url)}" data-tipo="image">
                  ${img.principal ? '<span class="principal-marca">Principal</span>' : ''}
                  <img src="${e(img.url)}" alt="${e(img.legenda || '')}">
                  <div class="acoes-item">
                    <button class="botao pequeno secundario" type="button" data-definir-principal="${i}">Principal</button>
                    <button class="botao pequeno secundario" type="button" data-remover-imagem="${i}">Remover</button>
                  </div>
                  <input type="hidden" name="imagens[]" value="${e(img.url)}">
                  <input type="hidden" name="imagemLegenda[]" value="${e(img.legenda || '')}">
                </div>`).join('')}
              ${videos.map((v, i) => `
                <div class="item-midia" data-url="${e(v.url)}" data-tipo="video">
                  <video src="${e(v.url)}" muted></video>
                  <div class="acoes-item">
                    <button class="botao pequeno secundario" type="button" data-remover-video="${i}">Remover</button>
                  </div>
                  <input type="hidden" name="videos[]" value="${e(v.url)}">
                </div>`).join('')}
            </div>
            ${!imagens.length && !videos.length ? '<p class="texto-pequeno texto-suave mb-0 mt-1">Nenhum arquivo enviado. O produto será exibido com imagem provisória.</p>' : ''}
            `,
          })}
        </div>
      </div>

      ${painel({
        titulo: 'Descrição',
        corpo: `<div class="editor-texto" data-editor>
          <div class="ferramentas">
            <button type="button" data-cmd="bold"><strong>N</strong></button>
            <button type="button" data-cmd="italic"><em>I</em></button>
            <button type="button" data-cmd="insertUnorderedList">• Lista</button>
            <button type="button" data-cmd="insertOrderedList">1. Lista</button>
            <button type="button" data-cmd="formatBlock:p">Parágrafo</button>
            <button type="button" data-cmd="formatBlock:h3">Título</button>
            <button type="button" data-cmd="removeFormat">Limpar</button>
          </div>
          <div class="area" contenteditable="true" id="editorDescricao">${sanitizeHtml(p.descricao || '')}</div>
        </div>
        <textarea name="descricao" id="campoDescricao" style="display:none">${e(p.descricao || '')}</textarea>`,
      })}

      ${painel({
        titulo: 'Características técnicas',
        corpo: `<div id="caracteristicas" data-caracteristicas='${e(JSON.stringify(p.caracteristicas || {}))}'></div>
          <p class="texto-pequeno texto-suave mb-0">Exibidas na aba "Características" do produto.</p>`,
      })}

      <div class="linha" style="gap:8px;flex-wrap:wrap">
        <button class="botao destaque grande" type="submit">${editando ? 'Salvar alterações' : 'Cadastrar produto'}</button>
        <a class="botao secundario grande" href="/admin/produtos">Cancelar</a>
        ${editando ? `<button class="botao perigo grande" type="button" data-excluir-produto="${e(p.id)}" data-nome="${e(p.nome)}">Excluir produto</button>` : ''}
      </div>
    </form>`,
  });
}

export function telaImportar(ctx) {
  return paginaAdmin(ctx, {
    titulo: 'Importar e exportar produtos',
    ativo: 'produtos',
    conteudo: `
    <h1 class="mt-0">Importar e exportar produtos</h1>
    ${painel({
      titulo: 'Exportar produtos (CSV)',
      corpo: `<p class="texto-pequeno">Gera um arquivo CSV com todos os produtos cadastrados.</p>
        <a class="botao" href="/admin/api/produtos/exportar.csv" download>Baixar CSV</a>`,
    })}
    ${painel({
      titulo: 'Importar produtos (CSV)',
      corpo: `<p class="texto-pequeno">Colunas aceitas: <code>nome,sku,ean,marca,fabricante,categoria,subcategoria,preco,precoPromocional,quantidade,estoqueMinimo,peso,descricao,ativo</code>.
        A primeira linha deve conter o cabeçalho. Produtos são criados; se o SKU já existir, o cadastro é atualizado.
        <strong>Use apenas fontes autorizadas</strong> (seu ERP, tabelas do fornecedor).</p>
        <form method="post" action="/admin/api/produtos/importar" enctype="multipart/form-data">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <div class="campo">
            <label for="arquivoCsv">Arquivo CSV</label>
            <input type="file" id="arquivoCsv" name="arquivo" accept=".csv,text/csv" required>
          </div>
          <button class="botao" type="submit">Importar</button>
        </form>`,
    })}
    ${painel({
      titulo: 'Importar catálogo de fornecedor',
      corpo: `<p class="texto-pequeno texto-suave mb-0">A integração automática com catálogos de distribuidores depende de credenciais e de autorização da empresa.
        Enquanto isso, utilize a importação por CSV. <strong>Nenhum serviço pago foi contratado.</strong></p>`,
    })}`,
  });
}

/* ============================ CATEGORIAS ============================ */
export function telaCategorias(ctx, { arvore }) {
  const linhas = [];
  for (const c of arvore) {
    linhas.push(`<tr>
      <td><strong>${e(c.nome)}</strong></td>
      <td>${e(c.icone || '')}</td>
      <td>${e(c.slug)}</td>
      <td>${e(String(c.ordem ?? 0))}</td>
      <td>${c.ativa !== false ? etiquetaStatus('ativo') : etiquetaStatus('inativo')}</td>
      <td class="acoes-linha">
        <button class="botao pequeno secundario" data-editar-categoria="${e(c.id)}">Editar</button>
        <button class="botao pequeno" data-alternar-categoria="${e(c.id)}">${c.ativa !== false ? 'Ocultar' : 'Exibir'}</button>
        <button class="botao pequeno perigo" data-excluir-categoria="${e(c.id)}" data-nome="${e(c.nome)}">Excluir</button>
      </td>
    </tr>`);
    for (const f of c.filhas || []) {
      linhas.push(`<tr>
        <td>↳ ${e(f.nome)}</td>
        <td>${e(f.icone || '')}</td>
        <td>${e(f.slug)}</td>
        <td>${e(String(f.ordem ?? 0))}</td>
        <td>${f.ativa !== false ? etiquetaStatus('ativo') : etiquetaStatus('inativo')}</td>
        <td class="acoes-linha">
          <button class="botao pequeno secundario" data-editar-categoria="${e(f.id)}">Editar</button>
          <button class="botao pequeno" data-alternar-categoria="${e(f.id)}">${f.ativa !== false ? 'Ocultar' : 'Exibir'}</button>
          <button class="botao pequeno perigo" data-excluir-categoria="${e(f.id)}" data-nome="${e(f.nome)}">Excluir</button>
        </td>
      </tr>`);
    }
  }

  return paginaAdmin(ctx, {
    titulo: 'Categorias',
    ativo: 'categorias',
    conteudo: `
    <h1 class="mt-0">Departamentos e categorias</h1>
    <div class="grade-form duas-colunas">
      ${painel({
        titulo: 'Nova categoria',
        corpo: `<form method="post" action="/admin/api/categorias">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          ${campoAdmin({ nome: 'nome', rotulo: 'Nome', obrigatorio: true })}
          <div class="campo-linha">
            ${campoAdmin({ nome: 'icone', rotulo: 'Ícone/emoji', valor: '💊' })}
            ${campoAdmin({ nome: 'ordem', rotulo: 'Ordem', tipo: 'number', valor: 99 })}
          </div>
          ${campoAdmin({ nome: 'paiId', rotulo: 'Categoria pai', opcoes: [{ valor: '', texto: '— Nenhuma (departamento) —' }, ...arvore.map((c) => ({ valor: c.id, texto: c.nome }))] })}
          ${campoAdmin({ nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea' })}
          ${campoAdmin({ nome: 'ativa', rotulo: 'Visível no site', tipo: 'checkbox', valor: true })}
          <button class="botao" type="submit">Criar categoria</button>
        </form>`,
      })}
      ${painel({
        titulo: 'Categorias cadastradas',
        semPadding: true,
        corpo: tabelaAdmin({
          colunas: ['Nome', 'Ícone', 'Slug', 'Ordem', 'Situação', 'Ações'],
          linhas,
          vazio: 'Nenhuma categoria cadastrada.',
        }),
      })}
    </div>
    <div class="alerta info mt-2">Categorias podem ser reorganizadas pela coluna "Ordem" (clique em Editar). O menu do site é gerado automaticamente a partir daqui.</div>`,
  });
}

/* ============================== ESTOQUE ============================== */
export function telaEstoque(ctx, { produtos, movimentacoes, alertas }) {
  return paginaAdmin(ctx, {
    titulo: 'Estoque',
    ativo: 'estoque',
    conteudo: `
    <h1 class="mt-0">Controle de estoque</h1>
    ${inovaAtiva() ? '<div class="alerta info"><strong>Estoque gerenciado pela InovaFarma.</strong> Altere os saldos apenas no ERP. O site bloqueia vendas quando o estoque estiver desatualizado.</div>' : ''}
    ${alertas.length ? `<div class="alerta aviso"><strong>${alertas.length} produto(s) abaixo do estoque mínimo.</strong></div>` : ''}

    ${!inovaAtiva() ? painel({
      titulo: 'Movimentação manual',
      corpo: `<form method="post" action="/admin/api/estoque/movimentar">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <div class="campo-linha">
          ${campoAdmin({ nome: 'produtoId', rotulo: 'Produto', opcoes: produtos.map((p) => ({ valor: p.id, texto: `${p.nome} (disp.: ${estoqueDisponivel(p)})` })) })}
          ${campoAdmin({ nome: 'tipo', rotulo: 'Tipo', opcoes: [
            { valor: 'entrada', texto: 'Entrada (reposição)' },
            { valor: 'saida', texto: 'Saída (perda/ajuste)' },
            { valor: 'ajuste', texto: 'Definir quantidade exata' },
          ] })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'quantidade', rotulo: 'Quantidade', tipo: 'number', min: '0', valor: 1, obrigatorio: true })}
          ${campoAdmin({ nome: 'lote', rotulo: 'Lote (opcional)' })}
          ${campoAdmin({ nome: 'validade', rotulo: 'Validade (opcional)', tipo: 'date' })}
        </div>
        ${campoAdmin({ nome: 'observacao', rotulo: 'Observação' })}
        <button class="botao" type="submit">Registrar movimentação</button>
      </form>`,
    }) : ''}

    ${painel({
      titulo: 'Situação atual',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Produto', 'Em estoque', 'Reservado', 'Disponível', 'Mínimo', 'Situação'],
        linhas: produtos.map((p) => {
          const disp = estoqueDisponivel(p);
          return `<tr>
            <td>${e(p.nome)}</td>
            <td>${e(p.estoque?.quantidade ?? 0)}</td>
            <td>${e(p.estoque?.reservado ?? 0)}</td>
            <td><strong>${disp}</strong></td>
            <td>${e(p.estoque?.minimo ?? 0)}</td>
            <td>${disp <= Number(p.estoque?.minimo ?? 0) ? '<span class="etiqueta vermelha">Baixo</span>' : (disp === 0 ? '<span class="etiqueta vermelha">Esgotado</span>' : '<span class="etiqueta verde">OK</span>')}</td>
          </tr>`;
        }),
        vazio: 'Nenhum produto cadastrado.',
      }),
    })}

    ${painel({
      titulo: 'Histórico de movimentações',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Data', 'Produto', 'Tipo', 'Qtd.', 'Saldo', 'Origem', 'Observação'],
        linhas: movimentacoes.map((m) => `<tr>
          <td>${formatDateTime(m.criadoEm)}</td>
          <td>${e(m.produtoNome)}</td>
          <td>${etiquetaStatus(m.tipo === 'entrada' ? 'ativo' : m.tipo === 'saida' ? 'inativo' : 'pendente')} ${e(m.tipo)}</td>
          <td>${e(m.quantidade)}</td>
          <td>${e(m.saldoDepois)}</td>
          <td>${e(m.origem || '')}</td>
          <td>${e(m.observacao || '')}</td>
        </tr>`),
        vazio: 'Nenhuma movimentação registrada.',
      }),
    })}`,
  });
}

/* =============================== MÍDIA =============================== */
export function telaMidia(ctx, { arquivos, stats, filtro }) {
  return paginaAdmin(ctx, {
    titulo: 'Fotos e vídeos',
    ativo: 'midia',
    conteudo: `
    <h1 class="mt-0">Biblioteca de fotos e vídeos</h1>
    <div class="cartoes">
      ${cartaoMetrica('Arquivos', stats.total)}
      ${cartaoMetrica('Imagens', stats.imagens)}
      ${cartaoMetrica('Vídeos', stats.videos)}
      ${cartaoMetrica('Espaço usado', `${(stats.bytes / 1024 / 1024).toFixed(2)} MB`)}
    </div>

    ${painel({
      titulo: 'Enviar novos arquivos',
      corpo: `<div class="zona-upload" id="zonaUploadMidia" tabindex="0" role="button">
          <strong>Clique ou arraste arquivos aqui</strong>
          <p class="texto-pequeno texto-suave mb-0">Imagens até 8 MB · Vídeos até 64 MB. Formatos aceitos: JPG, PNG, WEBP, SVG, MP4, WEBM, PDF.</p>
          <input type="file" id="inputUploadMidia" multiple accept="image/*,video/*,application/pdf" style="display:none">
        </div>`,
    })}

    ${painel({
      titulo: 'Arquivos',
      corpo: `
      <form class="barra-ferramentas" method="get" action="/admin/midia" style="margin-bottom:12px">
        <select name="tipo">
          <option value="">Todos</option>
          <option value="image" ${filtro === 'image' ? 'selected' : ''}>Imagens</option>
          <option value="video" ${filtro === 'video' ? 'selected' : ''}>Vídeos</option>
          <option value="doc" ${filtro === 'doc' ? 'selected' : ''}>Documentos</option>
        </select>
        <button class="botao secundario" type="submit">Filtrar</button>
      </form>
      ${arquivos.length ? `<div class="galeria-midia">${arquivos.map((m) => `
        <div class="item-midia">
          ${m.tipo === 'image' ? `<img src="${e(m.url)}" alt="${e(m.nome)}">`
            : m.tipo === 'video' ? `<video src="${e(m.url)}" muted></video>`
            : `<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:2rem">📄</div>`}
          <div class="acoes-item">
            <a class="botao pequeno secundario" href="${e(m.url)}" target="_blank">Abrir</a>
            <button class="botao pequeno secundario" data-copiar-url="${e(m.url)}">Copiar URL</button>
            <button class="botao pequeno perigo" data-excluir-midia="${e(m.id)}">Excluir</button>
          </div>
          <div class="acoes-item texto-pequeno texto-suave">${e(String(m.nome).slice(0, 30))} · ${(Number(m.tamanho || 0) / 1024).toFixed(0)} KB</div>
        </div>`).join('')}</div>` : '<div class="estado-vazio">Nenhum arquivo enviado.</div>'}
      `,
    })}`,
  });
}

/* ============================== BANNERS ============================== */
export function telaBanners(ctx, { banners, midias }) {
  return paginaAdmin(ctx, {
    titulo: 'Banners',
    ativo: 'banners',
    conteudo: `
    <h1 class="mt-0">Banners da home</h1>
    ${painel({
      titulo: 'Novo banner',
      corpo: `<form method="post" action="/admin/api/banners">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <div class="campo-linha">
          ${campoAdmin({ nome: 'titulo', rotulo: 'Título/descrição alternativa', obrigatorio: true })}
          ${campoAdmin({ nome: 'link', rotulo: 'Link ao clicar', valor: '/ofertas' })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'imagem', rotulo: 'Imagem (URL)', atributos: 'id="campoBannerImagem"', dica: 'Cole a URL de um arquivo da biblioteca ou envie abaixo.' })}
          ${campoAdmin({ nome: 'imagemMobile', rotulo: 'Imagem para celular (opcional)' })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'posicao', rotulo: 'Posição', opcoes: [{ valor: 'principal', texto: 'Carrossel principal' }, { valor: 'secundario', texto: 'Faixa secundária' }] })}
          ${campoAdmin({ nome: 'ordem', rotulo: 'Ordem', tipo: 'number', valor: 99 })}
        </div>
        ${campoAdmin({ nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', valor: true })}
        <button class="botao" type="submit">Salvar banner</button>
      </form>
      <div class="zona-upload mt-2" id="zonaUploadBanner" role="button" tabindex="0">
        <strong>Enviar imagem do banner</strong>
        <input type="file" id="inputUploadBanner" accept="image/*" style="display:none">
      </div>`,
    })}
    ${painel({
      titulo: 'Banners cadastrados',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Imagem', 'Título', 'Posição', 'Ordem', 'Situação', 'Ações'],
        linhas: banners.map((b) => `<tr>
          <td><img class="mini" src="${e(b.imagem)}" alt="" style="width:90px;height:auto"></td>
          <td>${e(b.titulo)}<br><span class="texto-pequeno texto-suave">${e(b.link || '')}</span></td>
          <td>${e(b.posicao || 'principal')}</td>
          <td>${e(String(b.ordem ?? 99))}</td>
          <td>${b.ativo !== false ? etiquetaStatus('ativo') : etiquetaStatus('inativo')}</td>
          <td class="acoes-linha">
            <button class="botao pequeno" data-alternar-banner="${e(b.id)}">${b.ativo !== false ? 'Desativar' : 'Ativar'}</button>
            <button class="botao pequeno perigo" data-excluir-banner="${e(b.id)}">Excluir</button>
          </td>
        </tr>`),
        vazio: 'Nenhum banner cadastrado.',
      }),
    })}`,
  });
}

/* ============================= PROMOÇÕES ============================= */
export function telaPromocoes(ctx, { cupons, categorias }) {
  return paginaAdmin(ctx, {
    titulo: 'Cupons e promoções',
    ativo: 'promocoes',
    conteudo: `
    <h1 class="mt-0">Cupons e promoções</h1>
    ${painel({
      titulo: 'Novo cupom',
      corpo: `<form method="post" action="/admin/api/cupons">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <div class="campo-linha">
          ${campoAdmin({ nome: 'codigo', rotulo: 'Código', obrigatorio: true, dica: 'Ex.: BEMVINDO10' })}
          ${campoAdmin({ nome: 'tipo', rotulo: 'Tipo de desconto', opcoes: [
            { valor: 'percentual', texto: 'Percentual (%)' },
            { valor: 'fixo', texto: 'Valor fixo (R$)' },
            { valor: 'frete_gratis', texto: 'Frete grátis' },
          ] })}
          ${campoAdmin({ nome: 'valor', rotulo: 'Valor (% ou R$)', tipo: 'number', step: '0.01', min: '0' })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'valorMinimo', rotulo: 'Valor mínimo da compra (R$)', tipo: 'number', step: '0.01', min: '0' })}
          ${campoAdmin({ nome: 'usoMaximo', rotulo: 'Limite de usos', tipo: 'number', min: '0', dica: 'Deixe vazio para ilimitado.' })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'validoDe', rotulo: 'Válido de', tipo: 'date' })}
          ${campoAdmin({ nome: 'validoAte', rotulo: 'Válido até', tipo: 'date' })}
        </div>
        ${campoAdmin({ nome: 'primeiroPedido', rotulo: 'Válido apenas para o primeiro pedido', tipo: 'checkbox' })}
        ${campoAdmin({ nome: 'ativo', rotulo: 'Cupom ativo', tipo: 'checkbox', valor: true })}
        ${campoAdmin({ nome: 'categoriasPermitidas', rotulo: 'Restringir a categorias (opcional)', dica: 'Separe os IDs por vírgula. Vazio = todas.', valor: '' })}
        <button class="botao" type="submit">Criar cupom</button>
      </form>`,
    })}
    ${painel({
      titulo: 'Cupons cadastrados',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Código', 'Tipo', 'Valor', 'Mínimo', 'Usos', 'Validade', 'Situação', 'Ações'],
        linhas: cupons.map((c) => `<tr>
          <td><strong>${e(c.codigo)}</strong></td>
          <td>${e(c.tipo)}</td>
          <td>${c.tipo === 'percentual' ? `${e(c.valor)}%` : c.tipo === 'fixo' ? money(toCents(c.valor)) : '—'}</td>
          <td>${c.valorMinimo ? money(c.valorMinimo) : '—'}</td>
          <td>${e(String(c.usos || 0))}${c.usoMaximo ? ` / ${e(c.usoMaximo)}` : ''}</td>
          <td>${c.validoDe ? formatDate(c.validoDe) : '—'} até ${c.validoAte ? formatDate(c.validoAte) : '—'}</td>
          <td>${c.ativo ? etiquetaStatus('ativo') : etiquetaStatus('inativo')}</td>
          <td class="acoes-linha">
            <button class="botao pequeno" data-alternar-cupom="${e(c.id)}">${c.ativo ? 'Desativar' : 'Ativar'}</button>
            <button class="botao pequeno perigo" data-excluir-cupom="${e(c.id)}">Excluir</button>
          </td>
        </tr>`),
        vazio: 'Nenhum cupom cadastrado.',
      }),
    })}
    <div class="alerta aviso mt-2">
      <strong>Atenção:</strong> promoções de medicamentos devem respeitar as regras de publicidade sanitária aplicáveis
      (não incentivar o uso irracional, não prometer resultados, respeitar as restrições de cada produto).
    </div>`,
  });
}
