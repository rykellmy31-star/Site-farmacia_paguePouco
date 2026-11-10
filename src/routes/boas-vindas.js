/** Cadastro e verificação do cupom + painel administrativo isolado. */
import {configBoasVindas, validarConfigBoasVindas, iniciarBoasVindas,
  confirmarBoasVindas, listarBoasVindas, excluirCadastroBoasVindas} from '../lib/boas-vindas.js';
import {evolutionConfig} from '../lib/evolution-whatsapp.js';
import {patchSetting, getAllSettings} from '../lib/settings.js';
import {rateLimit, randomToken, escapeHtml as e} from '../lib/security.js';
import {can} from '../lib/permissions.js';
import {logAdmin} from '../lib/audit.js';
import {paginaAdmin, painel, campoAdmin, tabelaAdmin, cartaoMetrica} from '../views/admin/layout.js';
import {formatDateTime} from '../lib/format.js';

function telaPainel(ctx, resumo, evoAtivo, erro) {
  const cfg=ctx.settings.boasVindas;
  const v=(x)=>e(String(x??''));
  const metricas=resumo.metricas;
  const form=[
    '<form method="post" action="/admin/boas-vindas">',
    '<input type="hidden" name="_csrf" value="'+v(ctx.csrf)+'">',
    campoAdmin({nome:'ativo',rotulo:'Ativar o pop-up e a campanha',tipo:'checkbox',valor:cfg.ativo}),
    '<div class="campo-linha">',
    campoAdmin({nome:'validadeHoras',rotulo:'Validade após confirmação (horas)',tipo:'number',min:1,max:720,valor:cfg.validadeHoras,obrigatorio:true}),
    campoAdmin({nome:'maxCadastrosIpDia',rotulo:'Máximo de cadastros por rede em 24h',tipo:'number',min:2,max:10,valor:cfg.maxCadastrosIpDia,obrigatorio:true}),
    '</div><div class="campo-linha">',
    campoAdmin({nome:'tipo',rotulo:'Tipo',valor:cfg.tipo,opcoes:[{valor:'percentual',texto:'Percentual (%)'},{valor:'fixo',texto:'Valor fixo (R$)'}]}),
    campoAdmin({nome:'valor',rotulo:'Desconto (% ou R$)',tipo:'number',step:'0.01',min:'0.01',valor:cfg.valor,obrigatorio:true}),
    campoAdmin({nome:'compraMinima',rotulo:'Compra mínima (R$)',tipo:'number',step:'0.01',min:'0',valor:(Number(cfg.compraMinimaCentavos||0)/100).toFixed(2)}),
    '</div>',
    campoAdmin({nome:'titulo',rotulo:'Título do pop-up',valor:cfg.titulo,obrigatorio:true}),
    campoAdmin({nome:'subtitulo',rotulo:'Subtítulo',valor:cfg.subtitulo,obrigatorio:true}),
    '<p class="texto-pequeno texto-suave">Cupom exclusivo por WhatsApp verificado, e-mail e navegador. O IP limita abusos sem impedir automaticamente familiares na mesma rede. Só será utilizado no primeiro pedido com os mesmos dados.</p>',
    '<button type="submit" class="botao">Salvar configurações</button></form>',
  ].join('');
  const podeExcluir=can(ctx.adminUser,'promocoes.excluir');
  const linhas=resumo.registros.map(r=>{
    const c=ctx.db.collection('coupons').get(r.cupomId);
    const situacao=r.status!=='confirmado'?'Aguardando confirmação':
      (c?.usos||0)>0?'Utilizado':
      Date.parse(c?.expiraEm||'')<=Date.now()?'Expirado':'Ativo';
    const excluir=podeExcluir
      ? '<form method="post" action="/admin/boas-vindas/'+encodeURIComponent(r.id)+
        '/excluir" onsubmit="return confirm(&quot;Excluir este pré-cadastro? O cupom será cancelado e os avisos pendentes interrompidos. As contas da loja e os pedidos não serão apagados.&quot;)">'+
        '<input type="hidden" name="_csrf" value="'+v(ctx.csrf)+'">'+
        '<button type="submit" class="botao pequeno perigo">Excluir</button></form>'
      : '—';
    return '<tr><td>'+v(r.nome)+'</td><td>'+v(r.email)+'</td><td>'+v(r.telefone)+
      '</td><td>'+(r.marketing?'Sim':'Não')+'</td><td>'+v(c?.codigo||'—')+
      '</td><td>'+v(situacao)+'</td><td>'+v(formatDateTime(r.confirmadoEm||r.criadoEm))+
      '</td><td>'+excluir+'</td></tr>';
  });
  return paginaAdmin(ctx,{
    titulo:'Cupons de boas-vindas',ativo:'boas_vindas',
    conteudo:[
      '<h1 class="mt-0">🎁 Cadastro e cupons de boas-vindas</h1>',
      '<p>Controle a oferta de entrada no site, confira a lista de contatos e acompanhe o uso dos cupons.</p>',
      erro?'<div class="alerta aviso">'+e(erro)+'</div>':'',
      !evoAtivo?'<div class="alerta aviso">A Evolution API precisa estar ativa no painel WhatsApp para enviar o código de verificação. A campanha não pode ser ativada até configurar a integração.</div>':'',
      '<div class="cartoes">',
      cartaoMetrica('Cadastros iniciados',metricas.iniciados),
      cartaoMetrica('WhatsApps verificados',metricas.confirmados),
      cartaoMetrica('Cupons usados',metricas.resgatados),
      cartaoMetrica('Cupons expirados',metricas.expirados),
      '</div>',
      painel({titulo:'Configurações da campanha',corpo:form}),
      cfg.ativo ? '<p><a class="botao secundario" href="/?visualizarBoasVindas=1" target="_blank" rel="noopener noreferrer">👁️ Pré-visualizar pop-up no site</a></p>' : '',
      cfg.ativo ? '<p class="texto-pequeno texto-suave">A prévia sempre abre o pop-up neste navegador, mesmo que já tenha sido fechado anteriormente. Clientes cadastrados não verão ofertas repetidas na navegação normal.</p>' : '',
      painel({titulo:'Cadastros recentes (até 100)',corpo:tabelaAdmin({
        colunas:['Nome','E-mail','WhatsApp','Ofertas autorizadas','Cupom','Situação','Data','Ações'],
        linhas,vazio:'Nenhum cadastro captado.'
      }),semPadding:true}),
      '<p class="texto-pequeno texto-suave">Os contatos com “Não” em ofertas autorizadas não devem receber publicidade. A confirmação por WhatsApp é separada do consentimento para marketing. Ao desativar, novos cadastros param; cupons emitidos continuam com a validade originalmente concedida.</p>',
    ].join('')
  });
}

export function registrarBoasVindas(app, db) {
  const limiteIniciar=rateLimit('boas-vindas-iniciar',8,60*60_000);
  const limiteConfirmar=rateLimit('boas-vindas-confirmar',30,60*60_000);

  app.post('/api/boas-vindas/iniciar',(req,res)=>{
    res.set('Cache-Control','no-store');
    if (!limiteIniciar(req,res))
      return void res.json({ok:false,erro:'Muitas tentativas. Aguarde um pouco.'},429);
    const device=/^[a-zA-Z0-9_-]{24,100}$/.test(req.cookies?.pp_bv_dispositivo||'')
      ?req.cookies.pp_bv_dispositivo:randomToken(32);
    const resultado=iniciarBoasVindas(db,req.body,{dispositivo:device,ip:req.ip});
    if (resultado.ok)
      res.cookie('pp_bv_dispositivo',device,{path:'/',maxAge:3600*24*365,httpOnly:true,sameSite:'Lax'});
    res.json(resultado,resultado.ok?200:400);
  });
  app.post('/api/boas-vindas/confirmar',(req,res)=>{
    res.set('Cache-Control','no-store');
    if (!limiteConfirmar(req,res))
      return void res.json({ok:false,erro:'Muitas tentativas. Aguarde um pouco.'},429);
    const resultado=confirmarBoasVindas(db,req.body);
    res.json(resultado,resultado.ok?200:400);
  });

  app.get('/admin/boas-vindas',(req,res)=>{
    if (!req.adminUser) return void res.redirect('/admin/login?next=/admin/boas-vindas');
    if (!can(req.adminUser,'promocoes.ver'))
      return void res.status(403).html('Acesso negado.');
    res.set('Cache-Control','private, no-store');
    const settings={...getAllSettings(db),boasVindas:configBoasVindas(db)};
    const ctx={req,db,settings,adminUser:req.adminUser,csrf:req.adminSession?.csrf||req.cookies?.pp_csrf||''};
    const evo=evolutionConfig(db);
    const erro=String(req.query.get('erro')||'').slice(0,180);
    res.html(telaPainel(ctx,listarBoasVindas(db),evo.ativo&&!!evo.instancia,erro));
  });
  app.post('/admin/boas-vindas/:id/excluir',(req,res)=>{
    if (!req.adminUser) return void res.redirect('/admin/login');
    if (!can(req.adminUser,'promocoes.excluir'))
      return void res.status(403).html('Acesso negado.');
    res.set('Cache-Control','no-store');
    const resultado=excluirCadastroBoasVindas(db,req.params.id);
    if(!resultado.ok)
      return void res.redirect('/admin/boas-vindas?erro='+encodeURIComponent(resultado.erro));
    logAdmin(db,req.adminUser,'excluiu_cadastro_boas_vindas','cadastroBoasVindas',req.params.id,{
      cupomId:resultado.cupomId,cupomUtilizado:resultado.cupomUtilizado,
    },req);
    res.redirect('/admin/boas-vindas?salvo=1');
  });
  app.post('/admin/boas-vindas',(req,res)=>{
    if (!req.adminUser) return void res.redirect('/admin/login');
    if (!can(req.adminUser,'promocoes.editar'))
      return void res.status(403).html('Acesso negado.');
    const dados=validarConfigBoasVindas(req.body);
    const evo=evolutionConfig(db);
    const erro=!dados.ok?dados.erro:
      dados.dados.ativo&&(!evo.ativo||!evo.instancia)
        ?'Configure a Evolution API antes de ativar a campanha.':'';
    if (erro) return void res.redirect('/admin/boas-vindas?erro='+encodeURIComponent(erro));
    patchSetting(db,'boasVindas',dados.dados,req.adminUser,req);
    logAdmin(db,req.adminUser,'configurou_cupons_boas_vindas','settings','boasVindas',
      {ativo:dados.dados.ativo,validadeHoras:dados.dados.validadeHoras},req);
    res.redirect('/admin/boas-vindas?salvo=1');
  });
}
