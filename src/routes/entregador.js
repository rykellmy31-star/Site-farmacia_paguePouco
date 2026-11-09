/** Rotas administrativas e privadas do entregador. Não usam login do cliente. */
import { config } from '../config.js';
import { createSession, destroySession, csrfToken } from '../lib/security.js';
import { logAdmin } from '../lib/audit.js';
import {
  novoEntregador, editarEntregador, loginEntregador,
  entregasDisponiveis, rotaAtiva, iniciarRota, atualizarEntrega, resumoRotas,
} from '../lib/entregadores.js';
import {
  telaLoginEntregador, telaPainelEntregador, telaAdminEntregadores,
} from '../views/entregadores.js';

function somenteAdministrador(req,res){
  if(!req.adminUser)return void res.redirect('/admin/login?next=/admin/entregadores');
  if(!['super_admin','admin'].includes(req.adminUser.role))
    return void res.status(403).html('403 — Área restrita à administração.');
  return true;
}
function somenteEntregador(req,res){
  if(req.entregador)return true;
  res.redirect('/entregador/login');
  return false;
}
const voltarComErro=(res,raiz,erro)=>res.redirect(raiz+'?erro='+encodeURIComponent(erro));

export function registrarRotasEntregador(app,db){
  app.get('/admin/entregadores',(req,res)=>{
    if(!somenteAdministrador(req,res))return;
    res.set('Cache-Control','no-store');
    // Mesmo contexto do painel, sem conceder perfil administrativo ao entregador.
    const ctx={req,db,adminUser:req.adminUser,
      settings:{
        empresa:db.collection('settings').get('empresa')||{},
        tema:db.collection('settings').get('tema')||{},
      },
      csrf:csrfToken(req)};
    res.html(telaAdminEntregadores(ctx,{
      entregadores:db.collection('entregadores').all()
        .sort((a,b)=>String(a.nome).localeCompare(String(b.nome),'pt-BR')),
      rotas:resumoRotas(db),disponiveis:entregasDisponiveis(db),
      erro:String(req.query.get('erro')||''),
    }));
  });
  app.post('/admin/entregadores/criar',(req,res)=>{
    if(!somenteAdministrador(req,res))return;
    const r=novoEntregador(db,req.body||{});
    if(!r.ok)return void voltarComErro(res,'/admin/entregadores',r.erro);
    logAdmin(db,req.adminUser,'cadastrou_entregador','entregador',r.entregador.id,
      {ativo:true},req);
    res.redirect('/admin/entregadores?salvo=1');
  });
  app.post('/admin/entregadores/:id/editar',(req,res)=>{
    if(!somenteAdministrador(req,res))return;
    const r=editarEntregador(db,req.params.id,{
      nome:req.body.nome,senha:req.body.senha,
      ativo:String(req.body.ativo||'')==='1',
    });
    if(!r.ok)return void voltarComErro(res,'/admin/entregadores',r.erro);
    logAdmin(db,req.adminUser,'editou_entregador','entregador',req.params.id,
      {ativo:r.entregador.ativo,senhaAlterada:!!req.body.senha},req);
    res.redirect('/admin/entregadores?salvo=1');
  });

  app.get('/entregador/login',(req,res)=>{
    if(req.entregador)return void res.redirect('/entregador');
    res.set('Cache-Control','no-store');
    res.html(telaLoginEntregador({csrf:csrfToken(req),
      erro:String(req.query.get('erro')||'')}));
  });
  app.post('/entregador/login',(req,res)=>{
    const e=loginEntregador(db,req.body?.cpf,req.body?.senha);
    if(!e)return void voltarComErro(res,'/entregador/login',
      'CPF ou senha inválidos, ou acesso desativado.');
    if(req.entregadorSession)destroySession(db,req.entregadorSession.id);
    const sid=createSession(db,'driver',e.id,{
      ip:req.ip,userAgent:req.headers['user-agent'],
    });
    db.collection('entregadores').update(e.id,{ultimoAcessoEm:new Date().toISOString()});
    res.cookie('pp_entregador_sess',sid,{
      maxAge:12*3600,path:'/entregador',sameSite:'Strict',
    });
    res.redirect('/entregador');
  });
  app.post('/entregador/sair',(req,res)=>{
    if(req.entregadorSession)destroySession(db,req.entregadorSession.id);
    res.cookie('pp_entregador_sess','',{maxAge:0,path:'/entregador',sameSite:'Strict'});
    res.redirect('/entregador/login');
  });
  app.get('/entregador',(req,res)=>{
    if(!somenteEntregador(req,res))return;
    res.set('Cache-Control','no-store');
    res.html(telaPainelEntregador({
      entregador:req.entregador,csrf:csrfToken(req),
      disponiveis:entregasDisponiveis(db),
      rota:rotaAtiva(db,req.entregador.id),db,
      erro:String(req.query.get('erro')||''),
    }));
  });
  app.post('/entregador/rotas/iniciar',(req,res)=>{
    if(!somenteEntregador(req,res))return;
    const ids=String(req.body.pedidos||'').split(',').filter(Boolean);
    const r=iniciarRota(db,req.entregador.id,ids);
    if(!r.ok)return void voltarComErro(res,'/entregador',r.erro);
    res.redirect('/entregador');
  });
  for(const acao of ['cheguei','conclui','problema']){
    app.post('/entregador/rotas/:rotaId/:pedidoId/'+acao,(req,res)=>{
      if(!somenteEntregador(req,res))return;
      const r=atualizarEntrega(db,{
        entregadorId:req.entregador.id,rotaId:req.params.rotaId,
        pedidoId:req.params.pedidoId,acao,recebimento:req.body||{},
      });
      if(!r.ok)return void voltarComErro(res,'/entregador',r.erro);
      res.redirect('/entregador');
    });
  }
}
