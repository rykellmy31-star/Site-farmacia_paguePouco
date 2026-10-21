/** Painel seguro para preparação de integração. Nunca chama API do ERP. */
import { escapeHtml as e } from '../../lib/security.js';
import { formatDateTime } from '../../lib/format.js';
import { paginaAdmin, painel, tabelaAdmin } from './layout.js';

const SIM_NAO = b => b ? 'Sim' : 'Não';
const QUANDO = t => t ? formatDateTime(t) : 'Ainda não verificada';
const LABELS = {
  desativada: 'Desativada — aguardando documentação e homologação',
  configurada_nao_conectada: 'Configurada localmente — conexão não homologada',
  ativada_por_ambiente: 'HABILITADA POR VARIÁVEL EXTERNA — verifique configuração!',
};
export function telaIntegracaoInova(ctx, { dados, erro = '', salvo = '' }) {
  const superAdmin = ctx.adminUser?.role === 'super_admin';
  const { configuracao: cfg, segredo, estoque, vendas, auditoria, eventos } = dados;
  return paginaAdmin(ctx, {
    titulo: 'Integração InovaFarma',
    ativo: 'inovafarma',
    conteudo: `
      <h1 class="mt-0">Integração InovaFarma</h1>
      <p class="texto-suave">Integração preparada, sem conexão externa. Fonte oficial de estoque: InovaFarma <strong>somente após homologação</strong>.</p>
      ${erro ? `<div class="alerta aviso" role="alert">${e(erro)}</div>` : ''}
      ${salvo ? '<div class="alerta sucesso" role="status">Alteração salva. Nenhuma comunicação externa foi executada.</div>' : ''}
      <div class="alerta aviso"><strong>Status:</strong> ${e(LABELS[dados.status] || 'Estado desconhecido')}.
        Testes reais, envio de vendas e sincronização aguardam a documentação da Precisão Sistemas e sua autorização explícita.
      </div>
      ${painel({ titulo: '1. Conexão com a InovaFarma', corpo: `
        <div class="grade-form duas-colunas">
          <p><strong>Estado atual:</strong> ${e(LABELS[dados.status] || 'Não verificado')}</p>
          <p><strong>Última conexão validada:</strong> ${QUANDO(dados.ultimaConexaoValidada)}</p>
        </div>
        ${superAdmin ? `<form method="post" action="/admin/inovafarma/configuracao">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <div class="campo"><label for="inovaURL">Endereço HTTPS do conector autorizado (cadastro apenas)</label>
            <input id="inovaURL" type="url" name="urlConector" value="${e(cfg?.urlConector || '')}"
              maxlength="250" placeholder="Aguardando endereço oficial do fornecedor">
            <span class="dica">Este endereço NÃO será contatado. Não são aceitos IPs, hosts locais ou portas alternativas.</span></div>
          <div class="campo"><label for="inovaEst">Identificador da empresa/estabelecimento (se exigido)</label>
            <input id="inovaEst" name="estabelecimento" maxlength="80" value="${e(cfg?.estabelecimento || '')}"></div>
          <div class="campo"><label>Método de autenticação</label>
            <input value="A definir pela documentação oficial" disabled></div>
          <div class="campo"><label for="inovaIntervalo">Intervalo planejado (minutos)</label>
            <select name="intervaloMinutos" id="inovaIntervalo">
              ${[5,15,30,60].map(n=>`<option value="${n}" ${Number(cfg?.intervaloMinutos || 15) === n ? 'selected' : ''}>${n} minutos</option>`).join('')}
            </select><span class="dica">Planejamento somente; não agenda sincronização.</span></div>
          <button class="botao" type="submit">Salvar configurações</button>
        </form>
        <hr>
        <p><strong>Chave criptográfica na Cloudflare:</strong> ${segredo.chaveDisponivel ? 'Configurada' : 'Ainda ausente'}.
          Configure <code>INOVA_CREDENTIALS_KEY</code> como Secret do Worker para habilitar o cofre exclusivo.</p>
        <p><strong>Credencial protegida:</strong> ${segredo.cadastrada ? (segredo.legivel ? 'Armazenada e legível pelo cofre' : 'Armazenada, porém inacessível — conferir a chave') : 'Não cadastrada'}.</p>
        <form method="post" action="/admin/inovafarma/credencial">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <div class="campo"><label for="inovaToken">Credencial do conector oficial (nunca exibida após salvar)</label>
            <input id="inovaToken" name="credencial" type="password" autocomplete="new-password"
              minlength="20" maxlength="2048" required placeholder="Não preencha até receber a credencial oficial"></div>
          <button class="botao secundario" type="submit" ${segredo.chaveDisponivel ? '' : 'disabled'}>Guardar credencial com criptografia</button>
        </form>
        ${segredo.cadastrada ? `<form method="post" action="/admin/inovafarma/credencial/remover"
          onsubmit="return confirm('Remover somente a credencial armazenada? O cadastro de estoque e as vendas serão preservados.')">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <button class="botao pequeno secundario" type="submit">Remover credencial do cofre</button>
        </form>` : ''}
        <p><button class="botao secundario" type="button" disabled>Testar conexão — aguardando homologação</button></p>
      ` : '<p>Somente Super Administrador pode visualizar e alterar endereço, credenciais e parâmetros. Este acesso exibe apenas estado e monitoramento.</p>'}
      ` })}
      ${painel({ titulo: '2. Sincronização de estoque', corpo: `
        <div class="grade-form duas-colunas">
          <p><strong>Estado:</strong> ${dados.status === 'ativada_por_ambiente' ? 'Variável externa ativa; verificar homologação' : 'Desativada — sem conector homologado'}</p>
          <p><strong>Última sincronização registrada:</strong> ${QUANDO(estoque.ultimaSincronizacao)}</p>
          <p><strong>Produtos no último lote:</strong> ${estoque.quantidadeUltimoLote}</p>
          <p><strong>Produtos com divergência:</strong> ${estoque.divergencias}</p>
          <p><strong>Produtos sem EAN válido:</strong> ${estoque.semCorrespondenciaEAN}</p>
          <p><strong>Estoque desatualizado ou não verificado:</strong> ${SIM_NAO(estoque.desatualizado)}</p>
        </div>
        <button type="button" class="botao secundario" disabled>Sincronizar estoque agora — aguardando homologação</button>
        <p class="texto-pequeno texto-suave">Os números mostram apenas dados persistidos do site; não comprovam conexão com o ERP. Nenhum saldo será enviado pela interface.</p>` })}
      ${painel({ titulo: '3. Envio de vendas à InovaFarma', corpo: `
        <div class="grade-form duas-colunas">
          <p><strong>Vendas com envio pendente na fila existente:</strong> ${vendas.pendentes}</p>
          <p><strong>Vendas com confirmação registrada do ERP:</strong> ${vendas.confirmadas}</p>
          <p><strong>Pendências de EAN para conferir:</strong> ${vendas.conferir}</p>
          <p><strong>Envio automático:</strong> desativado nesta interface</p>
        </div>
        <a class="botao pequeno secundario" href="#inova-vendas-pendentes">Consultar vendas pendentes</a>
        <p class="texto-pequeno texto-suave">Modelo de preparação contém pedido, data, EAN, quantidades, preços, descontos, frete, total, forma de pagamento e código histórico do vendedor. Não há formato oficial de transmissão homologado.</p>
      ` })}
      ${painel({ titulo: '4. Integração com vendedores', corpo: `
        <p>Os dados profissionais cadastrados no módulo Vendedores são vinculados aos pedidos no checkout. O código InovaFarma é preservado como texto, inclusive zeros à esquerda.</p>
        <p><a class="botao pequeno secundario" href="/admin/vendedores">Consultar vendedores</a></p>
      ` })}
      ${painel({ titulo: '5. Monitoramento e diagnósticos', corpo: `
        <p><strong>Última comunicação bem-sucedida:</strong> não verificada — não há teste oficial de conexão.</p>
        <p><strong>Falhas de comunicação confirmadas por este painel:</strong> não disponível até ativar conector homologado.</p>
        <p><strong>Ativação:</strong> bloqueada até documentação, homologação e autorização expressa.</p>
        <button class="botao pequeno secundario" type="button" disabled>Ativar integração — indisponível</button>
        <a href="#inova-erros" class="botao pequeno secundario">Ver histórico e erros</a>
      ` })}
      <section id="inova-vendas-pendentes">
      ${painel({ titulo: '6. Vendas pendentes e registros de estoque', corpo:
        `<p>Vendas na fila: ${vendas.pendentes}. Pedidos de períodos anteriores não são enviados automaticamente quando a integração está desligada.</p>
        ${tabelaAdmin({colunas:['Lote recebido','Itens','Registrado em'],
        linhas:eventos.map(ev=>`<tr><td>${e(ev.id)}</td><td>${Number(ev.total||0)}</td><td>${QUANDO(ev.recebidoEm)}</td></tr>`),
        vazio:'Nenhuma sincronização foi registrada.'})}` })}</section>
      <section id="inova-erros">
      ${painel({ titulo:'7. Histórico de configurações (sem credenciais)', corpo:
        tabelaAdmin({ colunas:['Evento','Data/hora'], linhas:auditoria.map(ev=>`
          <tr><td>${e(ev.tipo)}</td><td>${QUANDO(ev.criadoEm)}</td></tr>`),
          vazio:'Nenhuma alteração administrativa registrada.' }) })}</section>
    `,
  });
}
