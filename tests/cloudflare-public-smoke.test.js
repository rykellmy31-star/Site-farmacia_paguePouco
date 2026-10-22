import test from 'node:test';
import assert from 'node:assert/strict';
import { verificarCloudflarePublico, URL_PRODUCAO } from '../src/lib/cloudflare-public-smoke.js';

function responder(rotas={}) {
  const chamadas=[];
  const fetchImpl=async (url, options) => {
    const rota=new URL(url).pathname;
    chamadas.push({rota,options});
    const [status, body='',tipo='text/plain'] = rotas[rota] || [404,'','text/plain'];
    return new Response(body,{status,headers:{'content-type':tipo}});
  };
  return {fetchImpl,chamadas};
}
const base={
 '/__health':[200,JSON.stringify({ok:true,runtime:'cloudflare-workers',storage:'durable-object-sqlite'}),'application/json'],
 '/':[200,'<h1>Farmácia Pague Pouco</h1>','text/html; charset=utf-8'],
 '/ofertas':[200,'<h1>Ofertas e promoções</h1>','text/html; charset=utf-8'],
 '/departamentos':[200,'<h1>Departamentos</h1>','text/html; charset=utf-8'],
 '/admin/inovafarma':[302,'','text/html'],
 '/data/db/admins.json':[404,'','text/plain'],
 '/img/fundo-banner-vermelho.svg':[200,'<svg/>','image/svg+xml'],
};
test('somente GET, sem redirects seguidos ou dados de clientes',async()=>{
 const {fetchImpl,chamadas}=responder(base);
 const r=await verificarCloudflarePublico({fetchImpl});
 assert.equal(r.aprovado,true);
 assert.equal(chamadas.length,7);
 assert(chamadas.every(c=>c.options.method==='GET'&&c.options.redirect==='manual'));
 assert(chamadas.every(c=>!c.options.body&&!c.options.headers.Authorization));
 assert.deepEqual(chamadas.map(c=>c.rota),Object.keys(base));
});
test('arquivo privado exposto com 200 impede aprovação e não imprime corpo',async()=>{
 const {fetchImpl}=responder({...base,'/data/db/admins.json':[200,'[{"senha":"SEGREDO"}]','application/json']});
 const r=await verificarCloudflarePublico({fetchImpl});
 assert.equal(r.aprovado,false);
 assert.equal(r.verificacoes.dados_privados.aprovado,false);
 assert.doesNotMatch(JSON.stringify(r),/SEGREDO/);
});
test('admin acessível sem sessão impede aprovação',async()=>{
 const {fetchImpl}=responder({...base,'/admin/inovafarma':[200,'Credenciais','text/html']});
 const r=await verificarCloudflarePublico({fetchImpl});
 assert.equal(r.aprovado,false);
 assert.equal(r.verificacoes.painel_privado.aprovado,false);
 assert.doesNotMatch(JSON.stringify(r),/Credenciais/);
});
test('saúde com armazenamento diferente não é aceita',async()=>{
 const {fetchImpl}=responder({...base,'/__health':[200,'{"ok":true,"runtime":"node","storage":"json"}','application/json']});
 const r=await verificarCloudflarePublico({fetchImpl});
 assert.equal(r.verificacoes.saude.aprovado,false);
});
test('falhas de rede são relatadas sem vazar dados da exceção',async()=>{
 const fn=async()=>{throw new Error('authorization token-abc-PRIVATE');};
 const r=await verificarCloudflarePublico({fetchImpl:fn});
 assert.equal(r.aprovado,false);
 assert.equal(r.verificacoes.saude.http,'FALHA_REDE');
 assert.doesNotMatch(JSON.stringify(r),/token-abc|PRIVATE/);
});
test('restringe ensaio ao domínio real da farmácia',async()=>{
 await assert.rejects(()=>verificarCloudflarePublico({origem:'https://localhost.invalid',fetchImpl:async()=>null}),/domínio fixo/);
 assert.equal(URL_PRODUCAO,'https://site.farmaciapaguepouco.app');
});

test('falha se Ofertas ou Departamentos não funcionarem na produção', async () => {
  for (const rota of ['/ofertas','/departamentos']) {
    const {fetchImpl}=responder({...base,[rota]:[503,'Manutenção','text/html']});
    const resultado=await verificarCloudflarePublico({fetchImpl});
    assert.equal(resultado.aprovado,false);
  }
});
