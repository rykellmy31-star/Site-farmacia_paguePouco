import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {credenciaisEvolution,estadoEvolution,conectarEvolution} from '../src/lib/evolution-connection.js';
import {validarEvolutionConfig} from '../src/lib/evolution-whatsapp.js';

function db(instancia='farmacia-pague-pouco') {
  const cfg={id:'evolutionWhatsapp',instancia,ativo:true,baseUrl:'',
    numeroResponsavel:'5573999999999',avisarResponsavel:true,avisarCliente:true};
  return {collection(name) {
    assert.equal(name,'settings');
    return {get:key=>key==='evolutionWhatsapp'?cfg:null};
  }};
}
const env={EVOLUTION_API_URL:'https://evo.exemplo.com',EVOLUTION_API_KEY:'chave-secreta'};
const resposta=(status,data)=>({ok:status>=200&&status<300,status,
  text:async()=>JSON.stringify(data)});
test('apenas instância e destinatário bastam; remetente não é exigido',()=>{
  assert.equal(validarEvolutionConfig({
    ativo:true,baseUrl:env.EVOLUTION_API_URL,instancia:'farmacia-pague-pouco',
    numeroResponsavel:'5573999999999',avisarResponsavel:true,
    avisarCliente:true,numeroRemetente:'',
  }).ok,true);
});
test('configuração da infraestrutura não é retirada de valores do navegador',()=>{
  assert.equal(credenciaisEvolution(db(),env).configurado,true);
  assert.equal(credenciaisEvolution(db(),{EVOLUTION_API_URL:'http://localhost:8080',
    EVOLUTION_API_KEY:'chave'}).configurado,false);
});
test('instância existente desconectada usa connect e entrega QR, não o segredo',async()=>{
  const urls=[];
  const enviar=async(url,options)=>{
    urls.push({url,method:options.method,apikey:options.headers.apikey,redirect:options.redirect});
    if(url.includes('/connectionState/'))return resposta(200,{instance:{state:'close'}});
    return resposta(200,{base64:'data:image/png;base64,'+'A'.repeat(200)});
  };
  const r=await conectarEvolution(db(),env,enviar);
  assert.deepEqual({ok:r.ok,estado:r.estado},{ok:true,estado:'conectando'});
  assert.match(r.qr,/^data:image\/png;base64,/);
  assert.equal(urls.length,2);
  assert.match(urls[1].url,/\/instance\/connect\/farmacia-pague-pouco$/);
  assert.equal(urls[1].redirect,'manual');
  assert.equal(urls[1].apikey,env.EVOLUTION_API_KEY);
  assert.ok(!JSON.stringify(r).includes('chave-secreta'));
});
test('instância inexistente é criada automaticamente com QR',async()=>{
  const requisicoes=[];
  const enviar=async(url,opts)=>{
    requisicoes.push({url,opts});
    if(url.includes('/connectionState/'))return resposta(404,{message:'not found'});
    if(url.endsWith('/instance/create'))return resposta(201,{
      hash:'segredo-nao-deve-vazar',
      qrcode:{base64:'data:image/png;base64,'+'A'.repeat(200)}});
    throw Error('Nao deve fazer mais requisicoes');
  };
  const r=await conectarEvolution(db(),env,enviar);
  assert.equal(r.ok,true);
  assert.equal(r.estado,'conectando');
  assert.equal(requisicoes.length,2);
  assert.equal(JSON.parse(requisicoes[1].opts.body).integration,'WHATSAPP-BAILEYS');
  assert.equal(JSON.parse(requisicoes[1].opts.body).instanceName,'farmacia-pague-pouco');
  assert.ok(!JSON.stringify(r).includes('segredo-nao-deve-vazar'));
});
test('instância conectada não cria outra nem gera novo QR',async()=>{
  let hits=0;
  const enviar=async()=>{hits++;return resposta(200,{instance:{state:'open'}});};
  const r=await conectarEvolution(db(),env,enviar);
  assert.equal(r.estado,'conectado');assert.equal(r.qr,null);assert.equal(hits,1);
  assert.equal((await estadoEvolution(db(),env,enviar)).estado,'conectado');
});
test('tela não exige URL, remetente ou segredo; endpoints restritos a superadmin',()=>{
  const tela=readFileSync(new URL('../src/views/admin/evolution.js',import.meta.url),'utf8');
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.doesNotMatch(tela,/campo\('baseUrl'/);
  assert.doesNotMatch(tela,/campo\('numeroRemetente'/);
  assert.match(tela,/evo-gerar-qr/);
  assert.match(tela,/numeroResponsavel/);
  assert.match(routes,/\/admin\/api\/evolution-whatsapp\/qr/);
  assert.match(routes,/req\.adminUser\.role!=='super_admin'/);
  assert.match(routes,/baseUrl:infra\.baseUrl\|\|atual\.baseUrl/);
});
