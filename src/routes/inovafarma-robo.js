/** Pareamento uma vez pelo Superadmin e transferência automática de lotes CSV. */
import {paginaAdmin} from '../views/admin/layout.js';
import {escapeHtml as e, csrfToken} from '../lib/security.js';
import {getAllSettings} from '../lib/settings.js';
import {formatDateTime,formatBRL} from '../lib/format.js';
import {can} from '../lib/permissions.js';
import {avaliarUltimoRelatorioControlados} from '../lib/triagem-controlados.js';
import {logAdmin} from '../lib/audit.js';
import {
 configurarRoboInova,consultarRoboInova,autenticarRoboInova,
 receberBlocoRoboInova,aplicarBlocoRoboInova,consultarAlteracoesUltimoRoboInova,
} from '../lib/inovafarma-robo-sync.js';

const protegerAdmin=(req,res)=>{
  if(!req.adminUser)return res.redirect('/admin/login?next=%2Fadmin%2Frobo-inovafarma'),false;
  if(req.adminUser.role!=='super_admin'||!can(req.adminUser,'produtos.editar')){
    res.html('<h1>403 — Somente o Superadmin pode configurar o robô.</h1>',403);
    return false;
  }
  return true;
};
export function registrarRotasRoboInova(app,db) {
  // Leitura exclusiva do catálogo já sincronizado. O robô Windows e seus lotes não são alterados.
  const blocoProdutosNovos=(ultimo,req)=>{
    if(ultimo?.status!=='concluido')return '';
    if(!ultimo.novosInativos)return '<p>Nenhum produto novo foi cadastrado neste relatório.</p>';
    const inicio=Date.parse(ultimo.iniciadoEm||'');
    const fim=Date.parse(ultimo.concluidoEm||'');
    const novos=Number.isFinite(inicio)&&Number.isFinite(fim)&&fim>=inicio?
      db.collection('products').all().filter(p=>{
        if(p.inovaCatalogo?.origem!=='robo_csv_automatico')return false;
        const data=Date.parse(p.inovaCatalogo.importadoEm||'');
        return Number.isFinite(data)&&data>=inicio&&data<=fim;
      }).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR')):[];
    const titulo='<h3>Produtos novos cadastrados neste relatório ('+
      e(String(ultimo.novosInativos))+')</h3>';
    if(!novos.length)return titulo+
      '<p>O relatório registrou novos produtos, mas não foi possível localizá-los no catálogo atual. Confira se foram removidos ou substituídos após a importação.</p>';
    const porPagina=50;
    const paginas=Math.ceil(novos.length/porPagina);
    const solicitada=Number(req.query?.get('novosPagina')||1);
    const pagina=Number.isSafeInteger(solicitada)?
      Math.min(Math.max(1,solicitada),paginas):1;
    const itens=novos.slice((pagina-1)*porPagina,pagina*porPagina).map(p=>
      '<li><a href="/admin/produtos/'+encodeURIComponent(String(p.id))+'"><strong>'+
      e(p.nome||'Produto sem nome')+'</strong></a> — Código interno: '+
      e(p.codigoInterno||'não informado')+
      (p.ean?' · EAN: '+e(p.ean):'')+
      ' · Situação atual: '+(p.inovaArquivado?.em?'arquivado':p.ativo?'ativo':'inativo')+
      '</li>').join('');
    const anterior=pagina>1?'<a href="/admin/robo-inovafarma?novosPagina='+
      (pagina-1)+'">Anterior</a> ':'';
    const proxima=pagina<paginas?'<a href="/admin/robo-inovafarma?novosPagina='+
      (pagina+1)+'">Próxima</a>':'';
    const navegacao=paginas>1?'<p>Página '+pagina+' de '+paginas+'. '+
      anterior+proxima+'</p>':'';
    return titulo+'<p class="texto-pequeno">Localizados no cadastro atual: '+novos.length+
      '. Todos entram inicialmente inativos; a situação abaixo é a atual.</p>'+
      '<ol start="'+((pagina-1)*porPagina+1)+'">'+itens+'</ol>'+navegacao;
  };
  // Histórico de modificações pertencente ao relatório; não depende do
  // estoque atual do produto e não presume que toda queda foi uma venda.
  const blocoProdutosAtualizados=(ultimo,req)=>{
    if(ultimo?.status!=='concluido')return '';
    const titulo='<h3>Produtos atualizados neste relatório ('+
      e(String(ultimo.atualizados||0))+')</h3>';
    const pagina=Number(req.query?.get('atualizadosPagina')||1);
    const relatorio=consultarAlteracoesUltimoRoboInova(db,{pagina,porPagina:50});
    if(!relatorio.disponivel)return titulo+
      (ultimo.atualizados?
        '<p>O total de atualizações foi registrado, mas os valores anteriores não estão disponíveis neste relatório. O detalhamento começa nas importações realizadas após esta atualização do site.</p>':
        '<p>Nenhum produto teve estoque ou preço alterado.</p>');
    if(!relatorio.total)return titulo+'<p>Nenhum produto teve estoque ou preço alterado.</p>';
    const itens=relatorio.itens.map(p=>{
      const estoque=p.estoqueAntes!==p.estoqueDepois?
        'Estoque: <strong>'+e(String(p.estoqueAntes))+' → '+e(String(p.estoqueDepois))+
        ' unidades</strong>':'';
      const preco=p.precoAntesCentavos!==p.precoDepoisCentavos?
        'Preço de venda: <strong>'+
        e(formatBRL(p.precoAntesCentavos/100))+' → '+
        e(formatBRL(p.precoDepoisCentavos/100))+'</strong>':'';
      const campos=[estoque,preco].filter(Boolean).join(' · ');
      return '<li><a href="/admin/produtos/'+encodeURIComponent(String(p.produtoId))+
        '"><strong>'+e(p.nome||'Produto sem nome')+'</strong></a>'+
        ' — Código: '+e(String(p.codigoInterno||'não informado'))+
        (p.ean?' · EAN: '+e(String(p.ean)):'')+
        '<div>'+campos+'</div></li>';
    }).join('');
    const pageBase='/admin/robo-inovafarma?atualizadosPagina=';
    const anterior=relatorio.pagina>1?
      '<a href="'+pageBase+(relatorio.pagina-1)+'">Anterior</a> ':'';
    const proxima=relatorio.pagina<relatorio.paginas?
      '<a href="'+pageBase+(relatorio.pagina+1)+'">Próxima</a>':'';
    const navegacao=relatorio.paginas>1?
      '<p>Página '+relatorio.pagina+' de '+relatorio.paginas+'. '+
      anterior+proxima+'</p>':'';
    return titulo+'<p class="texto-pequeno">Detalhes das mudanças de estoque e preço de venda, comparados com os valores que estavam no site antes da importação. Uma redução do saldo não confirma, por si só, uma venda.</p>'+
      '<ol start="'+((relatorio.pagina-1)*50+1)+'">'+itens+'</ol>'+navegacao;
  };
  // Leitura exclusiva dos blocos CSV que o V3 já enviou. Nunca altera produtos.
  const blocoTriagemControlados=(ultimo,req)=>{
    if(ultimo?.status!=='concluido')return '';
    const n=Number(req.query?.get('controladosPagina')||1);
    const t=avaliarUltimoRelatorioControlados(db,{pagina:n,porPagina:40});
    if(!t.disponivel)return '<section class="painel"><h2>Triagem de possíveis controlados</h2>'+
      '<p>Relatório ainda indisponível ou incompleto. Nenhum produto foi classificado.</p></section>';
    const produtos=db.collection('products').all();
    const porCodigo=new Map(produtos.map(p=>[String(p.codigoInterno||''),p]));
    const itens=t.itens.map(x=>{
      const p=porCodigo.get(x.codigoInterno);
      const nome=p?'<a href="/admin/produtos/'+encodeURIComponent(String(p.id))+'">'+
        '<strong>'+e(x.nome)+'</strong></a>':'<strong>'+e(x.nome)+'</strong>';
      return '<li>'+nome+' — código '+e(x.codigoInterno)+
        (x.ean?' · EAN '+e(x.ean):'')+
        ' · termo encontrado: '+e(x.substancias.join(', '))+'</li>';
    }).join('');
    const base='/admin/robo-inovafarma?controladosPagina=';
    const anterior=t.pagina>1?'<a href="'+base+(t.pagina-1)+'">Anterior</a> ':'';
    const proxima=t.pagina<t.paginas?'<a href="'+base+(t.pagina+1)+'">Próxima</a>':'';
    return '<section class="painel"><h2>Triagem de possíveis medicamentos controlados</h2>'+
      '<p><strong>'+t.total+' possíveis ocorrências</strong> em '+t.analisados+
      ' itens do último CSV. Esta é uma busca inicial por alguns nomes de substâncias, '+ 
      'não uma classificação completa da Anvisa. Remédios por nome comercial podem não aparecer.</p>'+
      '<p class="alerta aviso">A conferência e classificação sanitária devem ser feitas pelo '+ 
      'farmacêutico responsável, consultando a Portaria 344/1998 atualizada e o registro do produto. '+
      'Esta triagem não libera venda, não atesta receita e não modifica o cadastro.</p>'+
      (t.total?'<ol start="'+((t.pagina-1)*40+1)+'">'+itens+'</ol>':
        '<p>Nenhuma correspondência encontrada na lista inicial; isso não significa ausência de controlados.</p>')+
      (t.paginas>1?'<p>Página '+t.pagina+' de '+t.paginas+'. '+anterior+proxima+'</p>':'')+
      '</section>';
  };
  const html=(req,{token='',mensagem=''}={})=>{
    const estado=consultarRoboInova(db);
    const ultimo=estado.ultimo;
    const aviso=!estado.ativo?'Desativado — nenhum computador tem acesso ainda':
      'Pareado — o computador poderá enviar automaticamente os relatórios de estoque.';
    const ctx={db,req,adminUser:req.adminUser,settings:getAllSettings(db),
      csrf:csrfToken(req)};
    return paginaAdmin(ctx,{titulo:'Robô de Estoque InovaFarma',ativo:'robo_inova',
      conteudo:`<h1>Robô de Estoque InovaFarma</h1>
        <div class="alerta info"><strong>${e(aviso)}</strong>
          <p>O trabalho diário será somente exportar o CSV de Posição de Estoque
          para a pasta monitorada pelo Windows. O robô enviará os lotes e
          atualizará automaticamente estoques e preços de venda dos produtos
          identificados com segurança. Não acessa a base privada do ERP.</p>
          <p>Não inventa EANs nem publica novos medicamentos. Produtos
          inéditos entram inativos e os casos ambíguos são separados para revisão.
          Nenhum produto ausente da exportação é apagado ou zerado.</p>
        </div>
        ${token?`<div class="alerta aviso"><strong>Copie agora a chave de pareamento.</strong>
          Será exibida somente nesta página. Não compartilhe a chave.
          <textarea readonly rows="3" style="width:100%;max-width:650px"
          id="chaveRobo">${e(token)}</textarea>
          <button class="botao pequeno" type="button" onclick="navigator.clipboard.writeText(document.getElementById('chaveRobo').value)">Copiar chave</button></div>`:''}
        ${mensagem?`<p class="alerta sucesso">${e(mensagem)}</p>`:''}
        <section class="painel"><h2>Conectar computador (apenas uma vez)</h2>
          <p>1. Faça o backup dos dados no menu Sistema e backups.<br>
          2. Clique em <strong>Gerar chave para o robô</strong>.<br>
          3. Copie a chave e cole no inicializador do robô Windows.<br>
          4. Depois, basta exportar o CSV do InovaFarma para
          <code>C:\\InovaExportacoes</code>.</p>
          <form method="post" action="/admin/robo-inovafarma/parear">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <label><input type="checkbox" name="backup" value="1" required>
              Tenho um backup recente e autorizado da loja.</label>
            <p class="texto-pequeno">Gerar uma chave nova invalida imediatamente a antiga.</p>
            <button class="botao" type="submit">Gerar chave para o robô</button>
          </form>
          <form method="post" action="/admin/robo-inovafarma/desativar">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <p><button class="botao secundario" type="submit">Revogar acesso do computador</button></p>
          </form>
        </section>
        <section class="painel"><h2>Último relatório automático</h2>
          ${ultimo?`<p><strong>Status:</strong> ${e(ultimo.status)};
          <strong>Recebidos:</strong> ${ultimo.recebidos}/${ultimo.total};
          <strong>Atualizados:</strong> ${ultimo.atualizados};
          <strong>Sem alteração:</strong> ${ultimo.semAlteracao};
          <strong>Novos inativos:</strong> ${ultimo.novosInativos};
          <strong>Pendências:</strong> ${ultimo.pendentes}.</p>
          <p>Relatório exportado em: ${e(formatDateTime(ultimo.geradoEm))};
          processamento: ${e(formatDateTime(ultimo.concluidoEm || ultimo.iniciadoEm))}
          <span class="texto-pequeno">(horário de Brasília)</span></p>
          ${blocoProdutosNovos(ultimo,req)}
          ${blocoProdutosAtualizados(ultimo,req)}
          ${blocoTriagemControlados(ultimo,req)}
          ${ultimo.detalhes?.length?`<h3>Conferências necessárias</h3><ul>${ultimo.detalhes.map(x=>
            `<li>Código ${e(x.codigoInterno)}: ${e(x.motivo)}</li>`).join('')}</ul>`:''}
          `:'<p>Nenhum relatório sincronizado por este robô.</p>'}
        </section>`});
  };
  app.get('/admin/robo-inovafarma',(req,res)=>{
    if(!protegerAdmin(req,res))return;
    res.set('Cache-Control','no-store');
    res.html(html(req));
  });
  app.post('/admin/robo-inovafarma/parear',(req,res)=>{
    if(!protegerAdmin(req,res))return;
    if(req.body.backup!=='1')return void res.html('Confirme o backup antes de habilitar o robô.',400);
    const r=configurarRoboInova(db);
    logAdmin(db,req.adminUser,'pareou_robo_csv_inova','integracao','principal',{},req);
    res.set('Cache-Control','no-store');
    res.html(html(req,{token:r.token,mensagem:'Chave criada. Configure o computador uma única vez.'}));
  });
  app.post('/admin/robo-inovafarma/desativar',(req,res)=>{
    if(!protegerAdmin(req,res))return;
    configurarRoboInova(db,{desativar:true});
    logAdmin(db,req.adminUser,'revogou_robo_csv_inova','integracao','principal',{},req);
    res.set('Cache-Control','no-store');
    res.html(html(req,{mensagem:'Acesso remoto revogado. O robô não poderá enviar arquivos.'}));
  });
  const auth=(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!autenticarRoboInova(db,req.headers.authorization)){
      res.json({ok:false,erro:'Robô não pareado ou chave revogada.'},401);
      return false;
    }
    return true;
  };
  app.post('/webhooks/robo-inovafarma/lote',{maxBodyBytes:160*1024},(req,res)=>{
    if(!auth(req,res))return;
    const r=receberBlocoRoboInova(db,req.body);
    return void res.json(r,r.ok?200:r.status||400);
  });
  app.post('/webhooks/robo-inovafarma/aplicar',{maxBodyBytes:16*1024},(req,res)=>{
    if(!auth(req,res))return;
    const r=aplicarBlocoRoboInova(db,req.body);
    return void res.json(r,r.ok?200:r.status||400);
  });
}
