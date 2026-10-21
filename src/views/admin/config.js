import { config } from '../../config.js';
/** views/admin/config.js — Fretes, WhatsApp, configurações, páginas, usuários, auditoria, sistema e editor visual. */
import { escapeHtml as e, sanitizeHtml } from '../../lib/security.js';
import {
  paginaAdmin, painel, tabelaAdmin, cartaoMetrica, campoAdmin, barraFerramentas,
  etiquetaStatus, money,
} from './layout.js';
import { UFS, UF_NAMES } from '../../lib/cep.js';
import { formatDateTime, formatDate } from '../../lib/format.js';
import { ROLES, ROLE_LIST } from '../../lib/permissions.js';
import { uploadStats } from '../../lib/uploads.js';

/* ================================ FRETES ================================ */
export function telaFretes(ctx, { frete, categorias, produtos }) {
  const excecoes = frete.excecoes || [];
  return paginaAdmin(ctx, {
    titulo: 'Configuração de fretes',
    ativo: 'fretes',
    conteudo: `
    <h1 class="mt-0">Configuração de fretes</h1>
    <div class="alerta info">
      <strong>Como funciona:</strong> cada estado (26 estados + Distrito Federal) tem um valor fixo definido por você.
      Quando o cliente informa o CEP, identificamos a UF e aplicamos o valor desta tabela — <strong>sem depender da API dos Correios</strong>.
      O valor cobrado do cliente é o valor comercial do frete; o campo "custo estimado de postagem" serve para seu controle
      interno e não é exibido ao cliente.
    </div>

    <form method="post" action="/admin/api/fretes">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">

      ${painel({
        titulo: 'Tabela de fretes por estado',
        semPadding: true,
        corpo: `<div class="tabela-rolagem"><table class="tabela-admin">
          <thead><tr><th>UF</th><th>Estado</th><th>Ativo</th><th>Valor (R$)</th><th>Prazo mín.</th><th>Prazo máx.</th><th>Custo postagem (R$)</th><th>Observação</th></tr></thead>
          <tbody>
          ${UFS.map((u) => {
            const st = frete.states[u.uf] || {};
            return `<tr>
              <td><strong>${e(u.uf)}</strong></td>
              <td>${e(u.nome)}</td>
              <td><input type="checkbox" name="uf_ativo_${e(u.uf)}" value="1" ${st.ativo !== false ? 'checked' : ''} aria-label="Entrega ativa para ${e(u.uf)}"></td>
              <td><input type="number" step="0.01" min="0" name="uf_valor_${e(u.uf)}" value="${e(((st.valor || 0) / 100).toFixed(2))}" style="width:110px"></td>
              <td><input type="number" min="0" name="uf_min_${e(u.uf)}" value="${e(st.prazoMin ?? 0)}" style="width:80px"></td>
              <td><input type="number" min="0" name="uf_max_${e(u.uf)}" value="${e(st.prazoMax ?? 0)}" style="width:80px"></td>
              <td><input type="number" step="0.01" min="0" name="uf_custo_${e(u.uf)}" value="${st.custoPostagemEstimado != null ? e((st.custoPostagemEstimado / 100).toFixed(2)) : ''}" style="width:110px" placeholder="opcional"></td>
              <td><input type="text" name="uf_obs_${e(u.uf)}" value="${e(st.observacao || '')}" placeholder="Ex.: região metropolitana"></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table></div>`,
      })}

      <div class="grade-form duas-colunas">
        ${painel({
          titulo: 'Frete grátis',
          corpo: `
          ${campoAdmin({ nome: 'fg_ativo', rotulo: 'Frete grátis ativo', tipo: 'checkbox', valor: !!frete.freteGratis?.ativo })}
          ${campoAdmin({ nome: 'fg_valorMinimo', rotulo: 'A partir de (R$)', tipo: 'number', step: '0.01', valor: ((frete.freteGratis?.valorMinimo || 0) / 100).toFixed(2) })}
          ${campoAdmin({ nome: 'fg_aplicaPara', rotulo: 'Aplicar a', valor: frete.freteGratis?.aplicaPara || 'todos', opcoes: [{ valor: 'todos', texto: 'Todos os estados' }, { valor: 'estados', texto: 'Somente alguns estados' }] })}
          ${campoAdmin({ nome: 'fg_estados', rotulo: 'Estados com frete grátis (siglas separadas por vírgula)', valor: (frete.freteGratis?.estados || []).join(','), dica: 'Ex.: BA,SE,PE' })}
          `,
        })}

        ${painel({
          titulo: 'Retirada na farmácia e entrega local',
          corpo: `
          ${campoAdmin({ nome: 'ret_ativo', rotulo: 'Permitir retirada na farmácia', tipo: 'checkbox', valor: !!frete.retirada?.ativo })}
          ${campoAdmin({ nome: 'ret_endereco', rotulo: 'Endereço para retirada', tipo: 'textarea', valor: frete.retirada?.endereco || '' })}
          ${campoAdmin({ nome: 'ret_horario', rotulo: 'Horário de retirada', valor: frete.retirada?.horario || '' })}
          ${campoAdmin({ nome: 'ret_prazoMax', rotulo: 'Prazo (dias úteis)', tipo: 'number', min: '0', valor: frete.retirada?.prazoMax ?? 1 })}
          <hr style="border:0;border-top:1px solid var(--borda);margin:14px 0">
          ${campoAdmin({ nome: 'loc_ativo', rotulo: 'Entrega local ativa', tipo: 'checkbox', valor: !!frete.entregaLocal?.ativo })}
          ${campoAdmin({ nome: 'loc_cidades', rotulo: 'Cidades atendidas (separadas por vírgula)', valor: (frete.entregaLocal?.cidades || []).join(', ') })}
          ${campoAdmin({ nome: 'loc_valor', rotulo: 'Valor da entrega local (R$)', tipo: 'number', step: '0.01', valor: ((frete.entregaLocal?.valor || 0) / 100).toFixed(2) })}
          ${campoAdmin({ nome: 'loc_prazoMax', rotulo: 'Prazo (dias úteis)', tipo: 'number', min: '0', valor: frete.entregaLocal?.prazoMax ?? 2 })}
          `,
        })}

        ${painel({
          titulo: 'Peso, volume e excedente',
          corpo: `
          ${campoAdmin({ nome: 'peso_limiteKg', rotulo: 'Peso máximo por envio (kg)', tipo: 'number', step: '0.1', valor: frete.peso?.limiteKg ?? 30 })}
          ${campoAdmin({ nome: 'peso_franquiaKg', rotulo: 'Franquia de peso (kg)', tipo: 'number', step: '0.1', valor: frete.peso?.franquiaKg ?? 5, dica: 'Até este peso não há cobrança adicional.' })}
          ${campoAdmin({ nome: 'peso_valorKgExcedente', rotulo: 'Valor por kg excedente (R$)', tipo: 'number', step: '0.01', valor: ((frete.peso?.valorKgExcedente || 0) / 100).toFixed(2) })}
          ${campoAdmin({ nome: 'peso_cubagemLimite', rotulo: 'Volume máximo (m³)', tipo: 'number', step: '0.01', valor: frete.peso?.cubagemLimiteM3 ?? 0.3 })}
          `,
        })}

        ${painel({
          titulo: 'Bloqueios de transporte',
          corpo: `
          ${campoAdmin({ nome: 'bloq_categorias', rotulo: 'Categorias bloqueadas para envio', tipo: 'textarea',
            valor: (frete.bloqueios?.categorias || []).join(', '), dica: 'IDs separados por vírgula. Produtos destas categorias não poderão ser enviados.' })}
          ${campoAdmin({ nome: 'bloq_produtos', rotulo: 'Produtos bloqueados para envio', tipo: 'textarea',
            valor: (frete.bloqueios?.produtos || []).join(', '), dica: 'IDs separados por vírgula.' })}
          ${campoAdmin({ nome: 'msgIndisponivel', rotulo: 'Mensagem quando não há entrega', tipo: 'textarea', valor: frete.mensagemIndisponivel || '' })}
          <div class="alerta aviso mb-0">
            <strong>Integração com os Correios:</strong> ${frete.integracaoCorreios?.ativo
              ? '<span class="etiqueta verde">Ativa</span>'
              : '<span class="etiqueta cinza">Preparada, mas desativada</span>'}
            <div class="texto-pequeno mt-1">O frete fixo por estado continua funcionando independentemente. A cotação automática
            (SEDEX/PAC) pode ser ligada no futuro, mediante contrato e credenciais — isso pode gerar custo e depende da sua autorização.</div>
          </div>`,
        })}
      </div>

      <div class="linha" style="gap:8px">
        <button class="botao destaque grande" type="submit">Salvar configuração de fretes</button>
      </div>
    </form>

    ${painel({
      titulo: 'Exceções por cidade ou faixa de CEP',
      corpo: `
      <form method="post" action="/admin/api/fretes/excecao">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <div class="campo-linha">
          ${campoAdmin({ nome: 'tipo', rotulo: 'Tipo', opcoes: [{ valor: 'cidade', texto: 'Cidade' }, { valor: 'faixa-cep', texto: 'Faixa de CEP' }] })}
          ${campoAdmin({ nome: 'uf', rotulo: 'UF (para cidade)', opcoes: [{ valor: '', texto: '—' }, ...UFS.map((u) => ({ valor: u.uf, texto: u.uf }))] })}
          ${campoAdmin({ nome: 'cidade', rotulo: 'Cidade' })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'cepIni', rotulo: 'CEP inicial' })}
          ${campoAdmin({ nome: 'cepFim', rotulo: 'CEP final' })}
          ${campoAdmin({ nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', step: '0.01' })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'prazoMin', rotulo: 'Prazo mín.', tipo: 'number' })}
          ${campoAdmin({ nome: 'prazoMax', rotulo: 'Prazo máx.', tipo: 'number' })}
          ${campoAdmin({ nome: 'bloqueado', rotulo: 'Bloquear entrega', tipo: 'checkbox' })}
        </div>
        ${campoAdmin({ nome: 'motivo', rotulo: 'Motivo/observação' })}
        <button class="botao" type="submit">Adicionar exceção</button>
      </form>
      ${excecoes.length ? `<div class="tabela-rolagem mt-2"><table class="tabela-admin">
        <thead><tr><th>Tipo</th><th>Abrangência</th><th>Valor</th><th>Prazo</th><th>Bloqueio</th><th>Ações</th></tr></thead>
        <tbody>${excecoes.map((x) => `<tr>
          <td>${e(x.tipo)}</td>
          <td>${x.tipo === 'cidade' ? `${e(x.cidade || '')}/${e(x.uf || '')}` : `${e(x.cepIni || '')} a ${e(x.cepFim || '')}`}</td>
          <td>${x.valor != null ? money(x.valor) : '—'}</td>
          <td>${e(x.prazoMin ?? '—')} a ${e(x.prazoMax ?? '—')}</td>
          <td>${x.bloqueado ? '<span class="etiqueta vermelha">Bloqueado</span>' : '—'}</td>
          <td><button class="botao pequeno perigo" data-excluir-excecao="${e(x.id)}">Excluir</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="texto-pequeno texto-suave">Nenhuma exceção cadastrada.</p>'}`,
    })}`,
  });
}

/* ============================== WHATSAPP ============================== */
export function telaWhatsApp(ctx, { whatsapp, linkExemplo }) {
  return paginaAdmin(ctx, {
    titulo: 'WhatsApp de atendimento',
    ativo: 'whatsapp',
    conteudo: `
    <h1 class="mt-0">WhatsApp de atendimento</h1>
    <div class="alerta info">
      Este canal é <strong>exclusivo para dúvidas</strong>. O botão usa o link oficial do WhatsApp (wa.me) e
      <strong>não é um checkout</strong>: compras e pagamentos são concluídos somente no site.
    </div>

    <form method="post" action="/admin/api/whatsapp">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      <div class="grade-form duas-colunas">
        ${painel({
          titulo: 'Configuração do botão',
          corpo: `
          ${campoAdmin({ nome: 'ativo', rotulo: 'Botão ativo no site', tipo: 'checkbox', valor: whatsapp.ativo !== false })}
          ${campoAdmin({ nome: 'numero', rotulo: 'Número oficial (DDI + DDD + número)', valor: whatsapp.numero || '',
            dica: 'Somente dígitos. Ex.: 5573988887777', obrigatorio: true })}
          ${campoAdmin({ nome: 'mensagem', rotulo: 'Mensagem inicial', tipo: 'textarea', valor: whatsapp.mensagem || '',
            dica: 'Texto que já vem preenchido quando o cliente clica.' })}
          ${campoAdmin({ nome: 'textoBotao', rotulo: 'Texto do botão', valor: whatsapp.textoBotao || '' })}
          ${campoAdmin({ nome: 'posicao', rotulo: 'Posição na tela', valor: whatsapp.posicao || 'direita',
            opcoes: [{ valor: 'direita', texto: 'Canto inferior direito' }, { valor: 'esquerda', texto: 'Canto inferior esquerdo' }] })}
          ${campoAdmin({ nome: 'paginas', rotulo: 'Aparecer em quais páginas', valor: (whatsapp.paginas || ['todas']).join(', '),
            dica: 'Digite "todas" ou uma lista de endereços, ex.: /produto, /categoria' })}
          ${campoAdmin({ nome: 'avisoCheckout', rotulo: 'Aviso exibido no balão', tipo: 'textarea', valor: whatsapp.avisoCheckout || '' })}
          `,
        })}

        ${painel({
          titulo: 'Horários de atendimento',
          corpo: `
          ${campoAdmin({ nome: 'respeitarHorario', rotulo: 'Mostrar mensagem de indisponibilidade fora do horário', tipo: 'checkbox', valor: !!whatsapp.respeitarHorario })}
          ${['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'].map((dia) => {
            const h = (whatsapp.horarios || []).find((x) => x.dia === dia) || { ativo: false, inicio: '08:00', fim: '20:00' };
            return `<div class="campo-linha" style="align-items:center">
              <label class="check" style="flex:0 0 110px">
                <input type="checkbox" name="dia_ativo_${dia}" value="1" ${h.ativo ? 'checked' : ''}> <span>${e(dia)}</span>
              </label>
              <input type="time" name="dia_inicio_${dia}" value="${e(h.inicio || '08:00')}" aria-label="Início ${dia}">
              <input type="time" name="dia_fim_${dia}" value="${e(h.fim || '20:00')}" aria-label="Fim ${dia}">
            </div>`;
          }).join('')}
          ${campoAdmin({ nome: 'mensagemIndisponivel', rotulo: 'Mensagem quando fora do horário', tipo: 'textarea', valor: whatsapp.mensagemIndisponivel || '' })}
          `,
        })}
      </div>

      <div class="linha" style="gap:8px;flex-wrap:wrap;align-items:center">
        <button class="botao destaque grande" type="submit">Salvar configuração do WhatsApp</button>
        ${linkExemplo ? `<a class="botao secundario grande" href="${e(linkExemplo)}" target="_blank" rel="noopener">Testar link do WhatsApp ↗</a>` : ''}
      </div>
    </form>

    ${painel({
      titulo: 'Restrições e boas práticas (LGPD)',
      corpo: `<ul class="mb-0 texto-pequeno">
        <li>O botão <strong>não</strong> finaliza compras e <strong>não</strong> recebe pagamentos — a venda acontece no site.</li>
        <li>Não é necessário contratar a API paga do WhatsApp Business para este botão (usa o link oficial wa.me).</li>
        <li>Se a farmácia usar os dados do cliente para enviar mensagens, obtenha consentimento e ofereça forma de descadastramento.</li>
        <li>Atendimentos fora do horário ficam na caixa do WhatsApp e devem ser respondidos no próximo dia útil.</li>
      </ul>`,
    })}`,
  });
}

/* ============================ CONFIGURAÇÕES ============================ */
export function telaConfiguracoes(ctx, { settings }) {
  const emp = settings.empresa || {};
  const tema = settings.tema || {};
  const loja = settings.loja || {};
  const seo = settings.seo || {};
  const rod = settings.rodape || {};
  return paginaAdmin(ctx, {
    titulo: 'Configurações gerais',
    ativo: 'configuracoes',
    conteudo: `
    <h1 class="mt-0">Configurações gerais</h1>

    <form method="post" action="/admin/api/config/empresa">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      ${painel({
        titulo: 'Dados da empresa',
        corpo: `<div class="grade-form duas-colunas">
          <div>
            ${campoAdmin({ nome: 'nomeFantasia', rotulo: 'Nome fantasia', valor: emp.nomeFantasia || '' })}
            ${campoAdmin({ nome: 'razaoSocial', rotulo: 'Razão social', valor: emp.razaoSocial || '' })}
            ${campoAdmin({ nome: 'cnpj', rotulo: 'CNPJ', valor: emp.cnpj || '' })}
            ${campoAdmin({ nome: 'inscricaoEstadual', rotulo: 'Inscrição estadual', valor: emp.inscricaoEstadual || '' })}
          </div>
          <div>
            ${campoAdmin({ nome: 'telefone', rotulo: 'Telefone', valor: emp.telefone || '' })}
            ${campoAdmin({ nome: 'email', rotulo: 'E-mail de contato', tipo: 'email', valor: emp.email || '' })}
            ${campoAdmin({ nome: 'farmaceuticoResponsavel', rotulo: 'Farmacêutico responsável', valor: emp.farmaceuticoResponsavel || '', dica: 'Obrigatório por lei. Exibido no rodapé.' })}
            ${campoAdmin({ nome: 'crf', rotulo: 'CRF/UF', valor: emp.crf || '' })}
          </div>
        </div>
        ${campoAdmin({ nome: 'autorizacaoSanitaria', rotulo: 'Autorização sanitária / AFE', valor: emp.autorizacaoSanitaria || '' })}
        ${campoAdmin({ nome: 'horarioAtendimento', rotulo: 'Horário de atendimento', valor: emp.horarioAtendimento || '' })}
        <h4>Endereço da sede</h4>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'cep', rotulo: 'CEP', valor: emp.endereco?.cep || '' })}
          ${campoAdmin({ nome: 'logradouro', rotulo: 'Endereço', valor: emp.endereco?.logradouro || '' })}
          ${campoAdmin({ nome: 'numero', rotulo: 'Número', valor: emp.endereco?.numero || '' })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'bairro', rotulo: 'Bairro', valor: emp.endereco?.bairro || '' })}
          ${campoAdmin({ nome: 'cidade', rotulo: 'Cidade', valor: emp.endereco?.cidade || '' })}
          ${campoAdmin({ nome: 'uf', rotulo: 'UF', valor: emp.endereco?.uf || '' })}
        </div>
        <h4>Redes sociais</h4>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'instagram', rotulo: 'Instagram', valor: emp.redes?.instagram || '' })}
          ${campoAdmin({ nome: 'facebook', rotulo: 'Facebook', valor: emp.redes?.facebook || '' })}
        </div>
        <button class="botao" type="submit">Salvar dados da empresa</button>`,
      })}
    </form>

    <form method="post" action="/admin/api/config/tema" enctype="multipart/form-data">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      ${painel({
        titulo: 'Aparência (cores e logotipo)',
        corpo: `<div class="campo-linha">
            ${campoAdmin({ nome: 'corPrimaria', rotulo: 'Cor principal', tipo: 'color', valor: tema.corPrimaria || '#8b0000' })}
            ${campoAdmin({ nome: 'corPrimariaEscura', rotulo: 'Cor principal escura', tipo: 'color', valor: tema.corPrimariaEscura || '#6b0000' })}
            ${campoAdmin({ nome: 'corSecundaria', rotulo: 'Cor de destaque', tipo: 'color', valor: tema.corSecundaria || '#8b0000' })}
          </div>
          <div class="campo-linha">
            ${campoAdmin({ nome: 'corTexto', rotulo: 'Cor do texto', tipo: 'color', valor: tema.corTexto || '#8b0000' })}
            ${campoAdmin({ nome: 'corFundo', rotulo: 'Cor de fundo', tipo: 'color', valor: tema.corFundo || '#fffafa' })}
            ${campoAdmin({ nome: 'logoAltura', rotulo: 'Altura do logo (px)', tipo: 'number', valor: tema.logoAltura || 44 })}
          </div>
          <div class="campo">
            <label for="logoArquivo">Enviar logotipo (PNG/JPG/SVG)</label>
            <input type="file" id="logoArquivo" name="logo" accept="image/*">
          </div>
          ${tema.logoUrl ? `<p class="texto-pequeno">Logo atual: <a href="${e(tema.logoUrl)}" target="_blank">${e(tema.logoUrl)}</a></p>` : ''}
          ${campoAdmin({ nome: 'barraTopoAtiva', rotulo: 'Exibir barra superior', tipo: 'checkbox', valor: tema.barraTopoAtiva !== false })}
          ${campoAdmin({ nome: 'barraTopoTexto', rotulo: 'Texto da barra superior', valor: tema.barraTopoTexto || '' })}
          ${campoAdmin({ nome: 'mostrarConsultaCep', rotulo: 'Exibir consulta de CEP no cabeçalho', tipo: 'checkbox', valor: tema.mostrarConsultaCep !== false })}
          <button class="botao" type="submit">Salvar aparência</button>`,
      })}
    </form>

    <form method="post" action="/admin/api/config/loja">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      ${painel({
        titulo: 'Funcionamento da loja',
        corpo: `
        ${campoAdmin({ nome: 'lojaAberta', rotulo: 'Loja aberta para vendas', tipo: 'checkbox', valor: loja.lojaAberta !== false })}
        ${campoAdmin({ nome: 'mensagemLojaFechada', rotulo: 'Mensagem quando fechada', tipo: 'textarea', valor: loja.mensagemLojaFechada || '' })}
        ${campoAdmin({ nome: 'exigirLoginParaComprar', rotulo: 'Exigir login para finalizar compra', tipo: 'checkbox', valor: loja.exigirLoginParaComprar !== false })}
        ${campoAdmin({ nome: 'valorMinimoPedido', rotulo: 'Valor mínimo do pedido (R$)', tipo: 'number', step: '0.01', valor: ((loja.valorMinimoPedido || 0) / 100).toFixed(2) })}
        ${campoAdmin({ nome: 'mostrarAvisoSanitario', rotulo: 'Exibir avisos sanitários obrigatórios', tipo: 'checkbox', valor: loja.mostrarAvisoSanitario !== false })}
        ${campoAdmin({ nome: 'avisoMedicamento', rotulo: 'Frase obrigatória sobre medicamentos', tipo: 'textarea', valor: loja.avisoMedicamento || '' })}
        ${campoAdmin({ nome: 'avisoAutomedicacao', rotulo: 'Aviso sobre automedicação', tipo: 'textarea', valor: loja.avisoAutomedicacao || '' })}
        <button class="botao" type="submit">Salvar regras da loja</button>`,
      })}
    </form>

    <form method="post" action="/admin/api/config/seo">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      ${painel({
        titulo: 'SEO e integrações de analytics',
        corpo: `
        ${campoAdmin({ nome: 'tituloPadrao', rotulo: 'Título padrão do site', valor: seo.tituloPadrao || '' })}
        ${campoAdmin({ nome: 'descricaoPadrao', rotulo: 'Descrição padrão (meta description)', tipo: 'textarea', valor: seo.descricaoPadrao || '' })}
        ${campoAdmin({ nome: 'palavrasChave', rotulo: 'Palavras-chave', valor: seo.palavrasChave || '' })}
        <div class="campo-linha">
          ${campoAdmin({ nome: 'googleAnalyticsId', rotulo: 'Google Analytics / GA4 ID', valor: seo.googleAnalyticsId || '', dica: 'Opcional. Ativo somente se preenchido.' })}
          ${campoAdmin({ nome: 'pixelFacebookId', rotulo: 'Pixel (ID)', valor: seo.pixelFacebookId || '' })}
        </div>
        <p class="texto-pequeno texto-suave">Sitemap: <a href="/sitemap.xml" target="_blank">/sitemap.xml</a> ·
          Robots: <a href="/robots.txt" target="_blank">/robots.txt</a> (gerados automaticamente).</p>
        <button class="botao" type="submit">Salvar SEO</button>`,
      })}
    </form>

    <form method="post" action="/admin/api/config/rodape">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      ${painel({
        titulo: 'Rodapé',
        corpo: `
        ${campoAdmin({ nome: 'textoInstitucional', rotulo: 'Texto institucional do rodapé', tipo: 'textarea', valor: rod.textoInstitucional || '' })}
        ${campoAdmin({ nome: 'formasPagamento', rotulo: 'Formas de pagamento em destaque (separadas por vírgula)', valor: (rod.formasPagamento || []).join(', ') })}
        <button class="botao" type="submit">Salvar rodapé</button>`,
      })}
    </form>`,
  });
}

/* =============================== PÁGINAS =============================== */
export function telaPaginas(ctx, { paginas }) {
  return paginaAdmin(ctx, {
    titulo: 'Páginas',
    ativo: 'paginas',
    conteudo: `
    <div class="linha centro entre mb-2" style="flex-wrap:wrap;gap:8px">
      <h1 class="mt-0 mb-0">Páginas do site</h1>
      <a class="botao" href="/admin/paginas/nova">+ Nova página</a>
    </div>
    ${painel({
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Título', 'Endereço', 'Atualizada em', 'Situação', 'Ações'],
        linhas: paginas.map((p) => `<tr>
          <td><strong>${e(p.titulo)}</strong></td>
          <td><a href="/pagina/${e(p.slug)}" target="_blank">/pagina/${e(p.slug)}</a></td>
          <td>${formatDateTime(p.atualizadoEm || p.criadoEm)}</td>
          <td>${p.publicada ? etiquetaStatus('ativo') : etiquetaStatus('inativo')}</td>
          <td class="acoes-linha">
            <a class="botao pequeno secundario" href="/admin/paginas/${e(p.slug)}">Editar</a>
            <button class="botao pequeno" data-alternar-pagina="${e(p.id)}">${p.publicada ? 'Despublicar' : 'Publicar'}</button>
            <button class="botao pequeno perigo" data-excluir-pagina="${e(p.id)}" data-nome="${e(p.titulo)}">Excluir</button>
          </td>
        </tr>`),
        vazio: 'Nenhuma página cadastrada.',
      }),
    })}
    <div class="alerta aviso mt-2">Os textos jurídicos e sanitários (termos, privacidade, trocas, informações sanitárias)
    devem ser revisados e validados por profissional habilitado antes da publicação oficial.</div>`,
  });
}

export function telaPaginaForm(ctx, { pagina }) {
  const p = pagina || { titulo: '', slug: '', resumo: '', conteudo: '', publicada: false };
  return paginaAdmin(ctx, {
    titulo: pagina ? `Editar: ${p.titulo}` : 'Nova página',
    ativo: 'paginas',
    conteudo: `
    <div class="linha centro entre mb-2" style="flex-wrap:wrap;gap:8px">
      <h1 class="mt-0 mb-0">${pagina ? 'Editar página' : 'Nova página'}</h1>
      <a class="botao secundario" href="/admin/paginas">Voltar</a>
    </div>
    <form method="post" action="/admin/api/paginas${pagina ? `/${e(p.id)}` : ''}" id="formPagina">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      ${painel({
        titulo: 'Conteúdo',
        corpo: `
        <div class="campo-linha">
          ${campoAdmin({ nome: 'titulo', rotulo: 'Título da página', valor: p.titulo, obrigatorio: true })}
          ${campoAdmin({ nome: 'slug', rotulo: 'Endereço (slug)', valor: p.slug, dica: 'Ex.: quem-somos → /pagina/quem-somos' })}
        </div>
        ${campoAdmin({ nome: 'resumo', rotulo: 'Resumo (usado em buscas)', valor: p.resumo || '' })}
        <div class="editor-texto" data-editor>
          <div class="ferramentas">
            <button type="button" data-cmd="bold"><strong>N</strong></button>
            <button type="button" data-cmd="italic"><em>I</em></button>
            <button type="button" data-cmd="insertUnorderedList">• Lista</button>
            <button type="button" data-cmd="insertOrderedList">1. Lista</button>
            <button type="button" data-cmd="formatBlock:h2">Título</button>
            <button type="button" data-cmd="formatBlock:h3">Subtítulo</button>
            <button type="button" data-cmd="formatBlock:p">Parágrafo</button>
            <button type="button" data-cmd="createLink">Link</button>
            <button type="button" data-cmd="removeFormat">Limpar</button>
          </div>
          <div class="area" contenteditable="true" id="editorPagina">${sanitizeHtml(p.conteudo || '')}</div>
        </div>
        <textarea name="conteudo" id="campoConteudo" style="display:none">${e(p.conteudo || '')}</textarea>
        ${campoAdmin({ nome: 'publicada', rotulo: 'Página publicada', tipo: 'checkbox', valor: !!p.publicada })}
        <button class="botao destaque" type="submit">Salvar página</button>`,
      })}
    </form>`,
  });
}

/* =============================== USUÁRIOS =============================== */
export function telaUsuarios(ctx, { usuarios }) {
  const podeGerenciar = ctx.permissoes?.podeGerenciarUsuarios;
  return paginaAdmin(ctx, {
    titulo: 'Usuários e permissões',
    ativo: 'usuarios',
    conteudo: `
    <h1 class="mt-0">Usuários e permissões</h1>
    ${!podeGerenciar ? '<div class="alerta aviso">Seu perfil não pode criar ou alterar usuários. Apenas o Super Administrador tem essa permissão.</div>' : ''}
    ${podeGerenciar ? painel({
      titulo: 'Novo usuário administrativo',
      corpo: `<form method="post" action="/admin/api/usuarios">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <div class="campo-linha">
          ${campoAdmin({ nome: 'nome', rotulo: 'Nome completo', obrigatorio: true })}
          ${campoAdmin({ nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'role', rotulo: 'Perfil', opcoes: ROLE_LIST.map((r) => ({ valor: r.id, texto: r.nome })), obrigatorio: true })}
          ${campoAdmin({ nome: 'senha', rotulo: 'Senha provisória', tipo: 'password', dica: 'Mínimo de 8 caracteres, com letras e números.', obrigatorio: true })}
          ${campoAdmin({ nome: 'crf', rotulo: 'CRF/UF (farmacêutico)' })}
        </div>
        <button class="botao" type="submit">Criar usuário</button>
      </form>
      <p class="texto-pequeno texto-suave mb-0 mt-2">As permissões são verificadas no <strong>servidor</strong>, não apenas na interface.</p>`,
    }) : ''}

    ${painel({
      titulo: 'Usuários cadastrados',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Nome', 'E-mail', 'Perfil', 'Último acesso', 'Situação', 'Ações'],
        linhas: usuarios.map((u) => `<tr>
          <td><strong>${e(u.nome)}</strong></td>
          <td>${e(u.email)}</td>
          <td>${e(ROLES[u.role]?.nome || u.role)}<br><span class="texto-pequeno texto-suave">${e(ROLES[u.role]?.descricao || '')}</span></td>
          <td>${u.ultimoAcesso ? formatDateTime(u.ultimoAcesso) : '—'}</td>
          <td>${u.ativo !== false ? etiquetaStatus('ativo') : etiquetaStatus('inativo')}</td>
          <td class="acoes-linha">
            ${podeGerenciar ? `
              <button class="botao pequeno" data-alternar-usuario="${e(u.id)}">${u.ativo !== false ? 'Desativar' : 'Ativar'}</button>
              <button class="botao pequeno secundario" data-resetar-senha="${e(u.id)}">Redefinir senha</button>` : ''}
          </td>
        </tr>`),
      }),
    })}

    ${painel({
      titulo: 'Perfis e permissões',
      corpo: `<div class="tabela-rolagem"><table class="tabela-admin">
        <thead><tr><th>Perfil</th><th>Descrição</th><th>Permissões</th></tr></thead>
        <tbody>${ROLE_LIST.map((r) => `<tr>
          <td><strong>${e(r.nome)}</strong></td>
          <td>${e(r.descricao)}</td>
          <td class="texto-pequeno">${e(r.permissoes.join(', '))}</td>
        </tr>`).join('')}</tbody></table></div>`,
    })}`,
  });
}

/* ============================== AUDITORIA ============================== */
export function telaAuditoria(ctx, { logs, filtros }) {
  return paginaAdmin(ctx, {
    titulo: 'Auditoria',
    ativo: 'auditoria',
    conteudo: `
    <h1 class="mt-0">Trilha de auditoria</h1>
    <p class="texto-pequeno texto-suave">Registro de ações administrativas e de segurança (LGPD e boas práticas).</p>
    ${painel({
      corpo: `<form class="barra-ferramentas" method="get" action="/admin/auditoria" style="margin:0">
        <input type="text" name="q" placeholder="Buscar por ação, usuário ou detalhe" value="${e(filtros.q || '')}">
        <select name="tipo">
          <option value="admin" ${filtros.tipo === 'admin' ? 'selected' : ''}>Ações administrativas</option>
          <option value="cliente" ${filtros.tipo === 'cliente' ? 'selected' : ''}>Ações de clientes</option>
        </select>
        <select name="acao">
          <option value="">Todas as ações</option>
          ${logs.map((l) => l.acao).filter((v, i, a) => v && a.indexOf(v) === i).map((a) => `<option value="${e(a)}" ${filtros.acao === a ? 'selected' : ''}>${e(a)}</option>`).join('')}
        </select>
        <button class="botao secundario" type="submit">Filtrar</button>
      </form>`,
    })}
    ${painel({
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Data', 'Usuário', 'Perfil', 'Ação', 'Entidade', 'IP', 'Detalhes'],
        linhas: logs.map((l) => `<tr>
          <td>${formatDateTime(l.criadoEm)}</td>
          <td>${e(l.atorNome)}</td>
          <td>${e(l.atorRole)}</td>
          <td><strong>${e(l.acao)}</strong></td>
          <td>${e(l.entidade || '')}${l.entidadeId ? ` <span class="texto-pequeno texto-suave">#${e(String(l.entidadeId).slice(0, 8))}</span>` : ''}</td>
          <td>${e(l.ip || '')}</td>
          <td class="texto-pequeno">${e(JSON.stringify(l.detalhes || {}).slice(0, 160))}</td>
        </tr>`),
        vazio: 'Nenhum registro encontrado.',
      }),
    })}`,
  });
}

/* =============================== SISTEMA ================================ */
export function telaSistema(ctx, { emails, logs, stats, versao }) {
  return paginaAdmin(ctx, {
    titulo: 'Sistema e backups',
    ativo: 'sistema',
    conteudo: `
    <h1 class="mt-0">Sistema</h1>
    <div class="cartoes">
      ${cartaoMetrica('Arquivos de mídia', stats.midia.total, `${(stats.midia.bytes / 1024 / 1024).toFixed(1)} MB`)}
      ${cartaoMetrica('Pedidos', stats.pedidos)}
      ${cartaoMetrica('Produtos', stats.produtos)}
      ${cartaoMetrica('Logs de sistema', stats.logs)}
      ${cartaoMetrica('E-mails na fila', stats.emails)}
      ${cartaoMetrica('Node.js', versao.node)}
    </div>

    ${painel({
      titulo: 'Homologação financeira e conciliação automática',
      corpo: `<p class="texto-pequeno">Indicadores internos sem valores de pagamentos, nomes de clientes
        ou credenciais. O último ciclo registrado não comprova crédito bancário real.</p>
        <p><strong>Última execução do alarme:</strong> ${stats.conciliacaoFinanceira?.ultimaExecucaoEm
          ? formatDateTime(stats.conciliacaoFinanceira.ultimaExecucaoEm) : 'Ainda não registrada'}</p>
        <p><strong>Resultado do último ciclo:</strong> ${e(stats.conciliacaoFinanceira?.situacao || 'Sem registro')}</p>
        <div class="cartoes">
          ${cartaoMetrica('Pix pendentes', stats.conciliacaoFinanceira?.pixPendentes || 0)}
          ${cartaoMetrica('Estornos pendentes', stats.conciliacaoFinanceira?.estornosPendentes || 0)}
          ${cartaoMetrica('Checkouts interrompidos', stats.conciliacaoFinanceira?.checkoutsInterrompidos || 0)}
          ${cartaoMetrica('Pedidos para conferência', stats.conciliacaoFinanceira?.conferencias || 0)}
        </div>
        <p class="texto-pequeno">Se a conciliação mostrar pendências, confira os pagamentos no painel
          antes de qualquer nova cobrança, cancelamento ou liberação de estoque.
          Não há acionamento manual de cobrança nesta seção.</p>`
    })}

    ${painel({
      titulo: 'Backup dos dados',
      corpo: `<p class="texto-pequeno">${config.isCloudflare
        ? 'Baixe os cadastros, pedidos e configurações no JSON abaixo. Os arquivos de imagem/vídeo são exportados separadamente em suas versões originais; guarde tudo em local privado. Ainda não há restauração automática homologada.'
        : 'O backup copia os arquivos de todas as coleções e da pasta de uploads para uma pasta interna. A restauração deve ser homologada antes de uso real.'}</p>
      <form method="post" action="/admin/api/sistema/backup">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <button class="botao" type="submit">${config.isCloudflare ? "Baixar backup JSON" : "Gerar backup agora"}</button>
      </form>
      ${config.isCloudflare ? `<hr style="margin:18px 0;border:0;border-top:1px solid var(--borda)">
        <h3>Backup dos arquivos de imagem e vídeo</h3>
        <p class="texto-pequeno">Arquivos armazenados: <strong>${stats.backupMidias?.total || 0}</strong>.
          Baixe o manifesto com os nomes, tamanhos e hashes SHA-256 e depois os arquivos abaixo.
          Cada download exige sua sessão de superadministrador. Não compartilhe esse material.</p>
        <a class="botao secundario" href="/admin/api/sistema/backup/midias.json" download>Baixar manifesto de mídias</a>
        ${stats.backupMidias?.files?.length ? `
          <div class="tabela-rolagem mt-2"><table class="tabela">
            <thead><tr><th>Arquivo</th><th>Tamanho</th><th>Ação</th></tr></thead>
            <tbody>${stats.backupMidias.files.slice(0, 40).map((file) => `<tr>
              <td><code>${e(file.caminho)}</code></td>
              <td>${(file.tamanho / 1024).toFixed(1)} KB</td>
              <td><a class="botao pequeno secundario" href="/admin/api/sistema/backup/arquivo/${e(file.chave)}" download>Baixar original</a></td>
            </tr>`).join('')}</tbody>
          </table></div>
          ${stats.backupMidias.total > 40 ? '<p class="texto-pequeno">Exibindo apenas os primeiros 40 arquivos. O manifesto contém a lista completa para exportação assistida.</p>' : ''}
        ` : '<p class="texto-pequeno">Nenhuma imagem ou vídeo no armazenamento interno.</p>'}
      ` : ''}
      ${stats.backups.length ? `<p class="texto-pequeno mt-2 mb-0">Últimos backups: ${stats.backups.slice(0, 5).map((b) => `<code>${e(b)}</code>`).join(', ')}</p>` : ''}`,
    })}

    ${painel({
      titulo: 'Fila de e-mails (saída)',
      semPadding: true,
      corpo: `<p class="corpo texto-pequeno">
          ${config.isCloudflare
            ? 'No Worker publicado, as mensagens ficam armazenadas nesta fila privada e NÃO são entregues automaticamente por e-mail. A integração de envio precisa de um transporte compatível antes de ser homologada.'
            : 'Sem SMTP, mensagens ficam na fila e em arquivos .eml locais. Com credenciais SMTP válidas, o envio é tentado e precisa ser homologado.'}
        </p>
        ${tabelaAdmin({
          colunas: ['Data', 'Para', 'Assunto', 'Status', 'Arquivo'],
          linhas: emails.map((m) => `<tr>
            <td>${formatDateTime(m.criadoEm)}</td>
            <td>${e(m.para)}</td>
            <td>${e(m.assunto)}</td>
            <td>${etiquetaStatus(m.status === 'enviado' ? 'ativo' : m.status === 'erro' ? 'inativo' : 'pendente')} ${e(m.status)}</td>
            <td>${m.arquivo ? `<code>${e(m.arquivo)}</code>` : ''}</td>
          </tr>`),
          vazio: 'Nenhum e-mail registrado.',
        })}`,
    })}

    ${painel({
      titulo: 'Logs do sistema',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Data', 'Nível', 'Mensagem'],
        linhas: logs.map((l) => `<tr>
          <td>${formatDateTime(l.criadoEm)}</td>
          <td>${etiquetaStatus(l.nivel === 'error' || l.nivel === 'security' ? 'inativo' : l.nivel === 'warn' ? 'pendente' : 'ativo')} ${e(l.nivel)}</td>
          <td class="texto-pequeno">${e(l.mensagem)}</td>
        </tr>`),
        vazio: 'Nenhum log registrado.',
      }),
    })}`,
  });
}

/* ============================ EDITOR VISUAL ============================= */
export function telaAparencia(ctx, { secoes, vitrines, categorias, marcas }) {
  return paginaAdmin(ctx, {
    titulo: 'Editor visual do site',
    ativo: 'aparencia',
    conteudo: `
    <h1 class="mt-0">Editor visual do site</h1>
    <p class="texto-pequeno texto-suave">Organize as seções da página inicial, crie vitrines e altere destaques — sem editar código.</p>

    <form method="post" action="/admin/api/aparencia/secoes">
      <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
      ${painel({
        titulo: 'Seções da página inicial (ordem e visibilidade)',
        corpo: `<ul class="lista-ordenavel" id="listaSecoes">
          ${secoes.map((s, i) => `<li data-id="${e(s.id)}">
            <span class="empunhadura" aria-hidden="true">⠿</span>
            <input type="hidden" name="secao_id[]" value="${e(s.id)}">
            <input type="text" name="secao_titulo[]" value="${e(s.titulo)}" aria-label="Título da seção" style="flex:1;min-width:140px">
            <select name="secao_ativo[]" aria-label="Visibilidade">
              <option value="1" ${s.ativo ? 'selected' : ''}>Visível</option>
              <option value="0" ${!s.ativo ? 'selected' : ''}>Oculta</option>
            </select>
            <input type="number" name="secao_ordem[]" value="${e(s.ordem)}" style="width:80px" aria-label="Ordem">
          </li>`).join('')}
        </ul>
        <button class="botao" type="submit">Salvar seções</button>`,
      })}
    </form>

    ${painel({
      titulo: 'Nova vitrine personalizada',
      corpo: `<form method="post" action="/admin/api/aparencia/vitrines">
        <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
        <div class="campo-linha">
          ${campoAdmin({ nome: 'titulo', rotulo: 'Título da vitrine', obrigatorio: true })}
          ${campoAdmin({ nome: 'tipo', rotulo: 'Origem dos produtos', opcoes: [
            { valor: 'categoria', texto: 'Produtos de uma categoria' },
            { valor: 'marca', texto: 'Produtos de uma marca' },
            { valor: 'dinamica', texto: 'Seleção dinâmica (ofertas, mais vendidos...)' },
            { valor: 'manual', texto: 'Escolher produtos manualmente' },
          ] })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'categoriaSlug', rotulo: 'Categoria', opcoes: [{ valor: '', texto: '—' }, ...categorias.map((c) => ({ valor: c.slug, texto: c.nome }))] })}
          ${campoAdmin({ nome: 'marca', rotulo: 'Marca', opcoes: [{ valor: '', texto: '—' }, ...marcas.map((m) => ({ valor: m.nome, texto: `${m.nome} (${m.total})` }))] })}
          ${campoAdmin({ nome: 'origem', rotulo: 'Seleção dinâmica', opcoes: [
            { valor: 'ofertas', texto: 'Ofertas' }, { valor: 'destaques', texto: 'Destaques' },
            { valor: 'mais_vendidos', texto: 'Mais vendidos' }, { valor: 'novidades', texto: 'Novidades' },
          ] })}
        </div>
        <div class="campo-linha">
          ${campoAdmin({ nome: 'limite', rotulo: 'Quantidade de produtos', tipo: 'number', valor: 8 })}
          ${campoAdmin({ nome: 'ordem', rotulo: 'Ordem', tipo: 'number', valor: 99 })}
          ${campoAdmin({ nome: 'link', rotulo: 'Link "ver todos"' })}
        </div>
        <button class="botao" type="submit">Criar vitrine</button>
      </form>`,
    })}

    ${painel({
      titulo: 'Vitrines criadas',
      semPadding: true,
      corpo: tabelaAdmin({
        colunas: ['Título', 'Origem', 'Limite', 'Ordem', 'Situação', 'Ações'],
        linhas: vitrines.map((v) => `<tr>
          <td><strong>${e(v.titulo)}</strong></td>
          <td>${e(v.tipo)}${v.marca ? ` — ${e(v.marca)}` : ''}${v.origem ? ` (${e(v.origem)})` : ''}</td>
          <td>${e(String(v.limite || 8))}</td>
          <td>${e(String(v.ordem || 99))}</td>
          <td>${v.ativa !== false ? etiquetaStatus('ativo') : etiquetaStatus('inativo')}</td>
          <td class="acoes-linha">
            <button class="botao pequeno" data-alternar-vitrine="${e(v.id)}">${v.ativa !== false ? 'Ocultar' : 'Exibir'}</button>
            <button class="botao pequeno perigo" data-excluir-vitrine="${e(v.id)}">Excluir</button>
          </td>
        </tr>`),
        vazio: 'Nenhuma vitrine personalizada.',
      }),
    })}`,
  });
}
