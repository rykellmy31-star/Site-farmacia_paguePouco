import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buscarDadosExternosEAN, anexarImagemAusente } from '../src/lib/enriquecimento-ean.js';
import { selecionarVendedorPedido } from '../src/lib/sellers.js';

const ean='7891000100103';
const imagem='https://images.openfoodfacts.org/images/products/789/100/010/0103/front_pt.32.400.jpg';
function apiFactory(product,other={}){
  const chamados=[];
  const fetcher=async(url)=>{
    chamados.push(url);
    if(url.includes('googleapis.com')){
      return {ok:true,json:async()=>url.includes('searchType=image')
        ?{items:other.imagensGoogle||[]}:{items:other.webGoogle||[]}};
    }
    return {ok:true,json:async()=>({product})};
  };
  return {chamados,fetcher};
}
test('EAN real igual, foto licenciada incorporada e proveniência preservada',async()=>{
 const {chamados,fetcher}=apiFactory({code:ean,image_front_url:imagem});
 const r=await buscarDadosExternosEAN(ean,{fetcher,googleKey:'',googleCx:''});
 assert.equal(r.ok,true);
 assert.equal(r.imagem.url,imagem);
 assert.match(r.imagem.legenda,/CC BY-SA 3\.0/);
 assert.equal(r.imagem.fonteEAN.ean,ean);
 assert.equal(chamados.length,1);
 assert.equal(chamados.some(url=>url.includes('googleapis')),false);
 const patch=anexarImagemAusente({ean,imagens:[]},r.imagem);
 assert.equal(patch.imagens.length,1);
 assert.equal(patch.imagens[0].url,imagem);
 assert.deepEqual(anexarImagemAusente({ean,imagens:[{url:'/uploads/existente.jpg'}]},r.imagem),{});
});
test('não associa foto de EAN parecido, host suspeito ou URL sem licença',async()=>{
 const {fetcher}=apiFactory({code:'7891000100104',image_front_url:imagem});
 const r=await buscarDadosExternosEAN(ean,{fetcher});
 assert.equal(r.imagem,null);
 const r2=await buscarDadosExternosEAN(ean,{fetcher:apiFactory({
   code:ean,image_front_url:'https://loja-farmacia-exemplo.com/foto.jpg'
 }).fetcher});
 assert.equal(r2.imagem,null);
 const fake={url:imagem,fonteEAN:{ean:'7891000100104'}};
 assert.deepEqual(anexarImagemAusente({ean,imagens:[]},fake),{});
});
test('Google pesquisa dimensões explícitas de embalagem vinculadas ao EAN exato',async()=>{
 const {fetcher,chamados}=apiFactory({code:ean},{
  webGoogle:[
   {title:'Produto similar',snippet:'EAN 7891000100104 dimensões da embalagem: 30 x 20 x 10 cm'},
   {title:'Ficha técnica '+ean,snippet:'Dimensões da embalagem: 20 x 10 x 8 cm'}],
  imagensGoogle:[{title:ean+' foto Open Facts',link:imagem}]});
 const r=await buscarDadosExternosEAN(ean,{fetcher,googleKey:'chave-teste',googleCx:'cx-teste'});
 assert.deepEqual(r.dimensoes,{comprimento:20,largura:10,altura:8});
 assert.equal(r.origemDimensoes,'Google (medidas de embalagem a revisar)');
 assert.equal(r.imagem.url,imagem);
 assert.equal(chamados.filter(url=>url.includes('googleapis')).length,2);
 assert.ok(chamados.every(url=>url.startsWith('https://')));
});
test('Google não inventa dimensões de caixa baseado apenas no peso ou foto',async()=>{
 const {fetcher}=apiFactory({code:ean},{webGoogle:[
   {title:ean+' produto 100 ml',snippet:'imagem 200x200 pixels, peso líquido 100g'}]});
 const r=await buscarDadosExternosEAN(ean,{fetcher,googleKey:'chave',googleCx:'cx'});
 assert.equal(r.dimensoes,null);
});
test('sem vendedor escolhido o checkout não bloqueia o pedido, mesmo com vendedores ativos',()=>{
 const db={collection:()=>({all:()=>[{id:'s1',nome:'Vendedor',ativo:true}]})};
 assert.deepEqual(selecionarVendedorPedido(db,null),{ok:true,vendedor:null});
 assert.equal(selecionarVendedorPedido(db,'s1').vendedor.id,'s1');
});
test('cliente não vê seletor; as rotas mantêm registro interno sem exigir vendedor',()=>{
 const root=new URL('../',import.meta.url);
 const vista=readFileSync(new URL('src/views/checkout.js',root),'utf8');
 const route=readFileSync(new URL('src/routes/checkout.js',root),'utf8');
 const admin=readFileSync(new URL('src/routes/admin.js',root),'utf8');
 const js=readFileSync(new URL('public/js/admin.js',root),'utf8');
 assert.doesNotMatch(vista,/Selecione seu vendedor|SELECIONE SEU VENDEDOR/);
 assert.doesNotMatch(vista,/name="vendedorId"/);
 assert.match(route,/vendedorId: null/);
 assert.match(admin,/anexarImagemAusente\(p,externos\.imagem\)/);
 assert.match(js,/adicionarFotoEAN/);
 assert.match(js,/const precisaFoto=/);
});
