import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registrarVisita, revogarVisitas, separarVisitaAoSair,
  relatorioVisitas } from '../src/lib/visitas-site.js';
import { telaVisitasSite } from '../src/views/admin/visitas-site.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';

function banco() {
  const collections = new Map();
  return { collection(nome) {
    if (!collections.has(nome)) collections.set(nome,new Map());
    const dados = collections.get(nome);
    return {
      get(id) {return dados.get(String(id)) || null;},
      all() {return Array.from(dados.values());},
      insert(v) {dados.set(String(v.id),{...v});return {...v};},
      update(id,v) {const antes=dados.get(String(id));const atual={...antes,...v};
        dados.set(String(id),atual);return atual;},
      remove(id) {return dados.delete(String(id));},
    };
  } };
}
function navegador(aceito=true) {
  const cookies=aceito?{pp_cookies:'aceito'}:{pp_cookies:'recusado'};
  const req={cookies,headers:{'user-agent':'Mozilla teste'},ip:'127.0.0.1',user:null,adminUser:null};
  const res={cookie(nome,val) {cookies[nome]=val;},clearCookie(nome) {delete cookies[nome];}};
  return {req,res,cookies};
}
const quantidade=db=>db.collection('visitantesSite').all().length;

test('sem consentimento: nenhuma visita, cesta, login ou conta identificada',()=>{
  const db=banco(),{req,res,cookies}=navegador(false);
  for(const tipo of ['pagina','carrinho','checkout','pedido','login','cadastro'])
    assert.equal(registrarVisita(db,req,res,tipo,{cliente:{id:'1'},pedidoId:'a'}).registrado,false);
  assert.equal(quantidade(db),0);
  assert.equal(cookies.pp_visitante,undefined);
});

test('com consentimento: cookie HttpOnly seguro, sessões por navegador e funil sem IP/MAC',()=>{
  const db=banco(),{req,res,cookies}=navegador();
  registrarVisita(db,req,res,'pagina');
  registrarVisita(db,req,res,'pagina');
  registrarVisita(db,req,res,'carrinho');
  registrarVisita(db,req,res,'checkout');
  registrarVisita(db,req,res,'checkout');
  registrarVisita(db,req,res,'pedido',{pedidoId:'p1'});
  registrarVisita(db,req,res,'pedido',{pedidoId:'p1'});
  const v=db.collection('visitantesSite').get(cookies.pp_visitante);
  assert.equal(v.paginas,2);
  assert.equal(v.visitas,1);
  assert.equal(v.cliquesCarrinho,1);
  assert.equal(v.iniciosCheckout,1);
  assert.equal(v.pedidosCriados,1);
  assert.equal(v.clienteId,null);
  const doc=JSON.stringify(v).toLowerCase();
  for(const segredo of ['127.0.0.1','user-agent','mozilla','mac','produto','pedidoitens'])
    assert.ok(!doc.includes(segredo),'não pode armazenar '+segredo);
  assert.equal(relatorioVisitas(db).registros,1);
});

test('vincula apenas conta autenticada, separa troca de contas e logout',()=>{
  const db=banco(),{req,res,cookies}=navegador();
  registrarVisita(db,req,res,'pagina');
  const antes=cookies.pp_visitante;
  registrarVisita(db,req,res,'login',{cliente:{id:'cliente1',nome:'Marta'}});
  assert.equal(db.collection('visitantesSite').get(antes).clienteId,'cliente1');
  assert.equal(db.collection('visitantesSite').get(antes).logins,1);
  registrarVisita(db,req,res,'login',{cliente:{id:'cliente2',nome:'Joana'}});
  assert.notEqual(cookies.pp_visitante,antes);
  assert.equal(db.collection('visitantesSite').get(cookies.pp_visitante).clienteId,'cliente2');
  assert.equal(db.collection('visitantesSite').get(antes).clienteId,'cliente1');
  separarVisitaAoSair(req,res);
  assert.equal(cookies.pp_visitante,undefined);
  registrarVisita(db,req,res,'pagina');
  assert.notEqual(cookies.pp_visitante,antes);
  assert.equal(db.collection('visitantesSite').get(cookies.pp_visitante).clienteId,null);
});

test('revogar consentimento apaga registro e cookie, e inibe eventos seguintes',()=>{
  const db=banco(),{req,res,cookies}=navegador();
  registrarVisita(db,req,res,'pagina');
  assert.equal(quantidade(db),1);
  revogarVisitas(db,req,res);
  cookies.pp_cookies='recusado';
  assert.equal(quantidade(db),0);
  assert.equal(cookies.pp_visitante,undefined);
  registrarVisita(db,req,res,'pagina');
  assert.equal(quantidade(db),0);
});

test('painel privado mostra conversões e nome após login, com HTML escapado',()=>{
  const db=banco(),{req,res}=navegador();
  registrarVisita(db,req,res,'pagina');
  registrarVisita(db,req,res,'checkout');
  registrarVisita(db,req,res,'login',{cliente:{id:'c1'}});
  db.collection('customers').insert({id:'c1',nome:'Cliente <especial>'});
  const report=relatorioVisitas(db);
  assert.equal(report.possiveisDesistencias,1);
  const ctx={db,settings:DEFAULT_SETTINGS(),adminUser:{id:'a1',nome:'Admin',role:'super_admin'},
    csrf:'csrf',req:{query:new URLSearchParams()}};
  const html=telaVisitasSite(ctx,{relatorio:report,db});
  assert.match(html,/Visitas e conversões/);
  assert.match(html,/Inícios sem pedido/);
  assert.match(html,/Cliente &lt;especial&gt;/);
  assert.doesNotMatch(html,/Cliente <especial>/);
  assert.match(html,/MAC/);
});

test('rota privada usa permissão de relatório e exige admin; script só dispara com cookies aceitos',()=>{
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(routes,/app\.get\('\/admin\/visitas'/);
  assert.match(routes,/\['super_admin','admin'\]\.includes\(req\.adminUser\?\.role\)/);
  const script=readFileSync(new URL('../public/js/visitas-site.js',import.meta.url),'utf8');
  assert.match(script,/pp_cookies=aceito/);
  assert.match(script,/pp:consentimento/);
  const layout=readFileSync(new URL('../src/views/layout.js',import.meta.url),'utf8');
  assert.match(layout,/visitas-site\.js/);
});
