import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultFreightConfig } from '../src/lib/freight.js';
import { prepararCotacaoMelhorEnvio, consultarMelhorEnvio,
  calcularFreteIntegrado, resolverFreteIntegrado } from '../src/lib/melhor-envio.js';

const cart=[{produtoId:'p1',quantidade:2,peso:0.5,largura:12,altura:8,
  comprimento:20,precoUnitarioCentavos:2000,categoriaId:'isentos'}];
const cfg=()=>{const c=defaultFreightConfig();c.melhorEnvio.ativo=true;c.freteGratis.ativo=false;return c};
const base={config:cfg(),cepFarmacia:'45970000',cep:'29885000',uf:'ES',
  cidade:'Ponto Belo',items:cart,subtotalCents:4000};
const ofertas=[
 {id:1,name:'PAC',company:{name:'Correios'},price:'25.00',custom_price:'22.50',
  delivery_time:7,custom_delivery_time:5},
 {id:2,name:'SEDEX',company:{name:'Correios'},price:'45.00',
  delivery_time:2,custom_delivery_time:2},
 {id:3,error:'Não disponível',company:{name:'x'}},
];
function provedor(output=ofertas) {
 const calls=[];
 const fetcher=async(url,opt)=>{calls.push({url,opt});return {
  ok:true,json:async()=>output,
 }};
 return {calls,fetcher};
}
test('cotação usa só produtos reais com medidas e valor em reais',()=>{
 const r=prepararCotacaoMelhorEnvio({origem:'45970-000',
   destino:'29885-000',items:cart});
 assert.equal(r.ok,true);
 assert.deepEqual(r.body.from,{postal_code:'45970000'});
 assert.deepEqual(r.body.to,{postal_code:'29885000'});
 assert.deepEqual(r.body.products,[{
  id:'p1',width:12,height:8,length:20,weight:0.5,
  insurance_value:20,quantity:2,
 }]);
 assert.equal(r.body.options.receipt,false);
});
test('não supõe peso/dimensões para medicamentos sem cadastro físico',()=>{
 for(const chave of ['peso','largura','altura','comprimento']){
  const errado=cart.map(x=>({...x,[chave]:0}));
  const r=prepararCotacaoMelhorEnvio({origem:'45970000',
    destino:'29885000',items:errado});
  assert.equal(r.ok,false);
  assert.match(r.erro,/cadastre peso/i);
 }
});
test('consulta apenas endpoint de cálculo com token privado e normaliza custom_price',async()=>{
 const {calls,fetcher}=provedor();
 const r=await consultarMelhorEnvio({origem:'45970000',destino:'29885000',
  items:cart,token:'chave-de-teste',contato:'suporte@example.com',fetcher});
 assert.equal(r.ok,true);
 assert.deepEqual(r.opcoes.map(o=>o.id),['me_1','me_2']);
 assert.deepEqual(r.opcoes.map(o=>o.valor),[2250,4500]);
 assert.equal(r.opcoes[0].prazoMax,5);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://melhorenvio.com.br/api/v2/me/shipment/calculate');
 assert.equal(calls[0].opt.method,'POST');
 assert.equal(calls[0].opt.headers.Authorization,'Bearer chave-de-teste');
 assert.match(calls[0].opt.headers['User-Agent'],/suporte@example.com/);
 assert.ok(!JSON.stringify(r).includes('chave-de-teste'));
});
test('CEP da farmácia conserva retirada e entrega local sem chamar API',async()=>{
 let chamadas=0;
 const r=await calcularFreteIntegrado({...base,cep:'45970000',uf:'BA',
   cidade:'Itanhém'},{token:'t',contato:'suporte@example.com',
     fetcher:async()=>{chamadas++;throw Error('não deveria chamar')}});
 assert.deepEqual(r.opcoes.map(o=>o.id),['entrega_local','retirada']);
 assert.equal(chamadas,0);
});
test('sem ativação do lojista mantém frete atual fixo',async()=>{
 const r=await calcularFreteIntegrado({...base,config:defaultFreightConfig()});
 assert.deepEqual(r.opcoes.map(o=>o.id),['_padrao']);
});
test('ativado e sem chave não exibe preço fictício e não finaliza pedido',async()=>{
 const r=await calcularFreteIntegrado(base,{token:'',contato:''});
 assert.equal(r.disponivel,false);
 assert.deepEqual(r.opcoes,[]);
 assert.match(r.motivo,/não configurada/i);
 const resolvido=await resolverFreteIntegrado({...base,opcaoId:'_padrao'},{token:'',contato:''});
 assert.equal(resolvido.ok,false);
});
test('cotação com erro externo não volta para preços fixos',async()=>{
 const r=await calcularFreteIntegrado(base,{
  token:'t',contato:'suporte@example.com',fetcher:async()=>{throw Error('offline')}});
 assert.equal(r.disponivel,false);
 assert.deepEqual(r.opcoes,[]);
});
test('cotação selecionada é checada por ID e transportadora, sem trocar serviço',async()=>{
 const {fetcher}=provedor();
 const opts={fetcher,token:'t',contato:'suporte@example.com'};
 const bom=await resolverFreteIntegrado({...base,opcaoId:'me_1'},opts);
 assert.equal(bom.ok,true);
 assert.equal(bom.valor,2250);
 const adulterado=await resolverFreteIntegrado({...base,opcaoId:'_padrao'},opts);
 assert.equal(adulterado.ok,false);
});
test('frete grátis de cupom aplica preço zero à cotação sem alterar serviço',async()=>{
 const {fetcher}=provedor();
 const r=await calcularFreteIntegrado({...base,cupomFreteGratis:true},
  {fetcher,token:'t',contato:'suporte@example.com'});
 assert.deepEqual(r.opcoes.map(o=>o.valor),[0,0]);
});
test('integração é estritamente só cotação em API, checkout e pedido',()=>{
 const baseUrl=new URL('../',import.meta.url);
 const me=readFileSync(new URL('src/lib/melhor-envio.js',baseUrl),'utf8');
 for(const path of ['cart','checkout','generate','print','tracking']){
  assert.doesNotMatch(me,new RegExp("'\/api\/v2\/me\/shipment\/"+path+"'"));
 }
 for(const path of ['src/routes/api.js','src/routes/checkout.js','src/lib/orders.js']){
  const source=readFileSync(new URL(path,baseUrl),'utf8');
  assert.match(source,/FreteIntegrado/);
 }
 const conf=readFileSync(new URL('src/config.js',baseUrl),'utf8');
 assert.match(conf,/env\.MELHOR_ENVIO_TOKEN/);
 assert.match(conf,/env\.MELHOR_ENVIO_CONTATO_EMAIL/);
});
