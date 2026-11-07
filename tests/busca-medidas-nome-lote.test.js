import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  nomeMedidasValido,resultadoPertenceAoProduto,extrairMedidasEmbalagem,
  extrairPesoBruto,buscarMedidasPorNome,buscarMedidasNoCatalogoPorNome,
  medidasCompletas,buscaLogisticaPendente,
} from '../src/lib/busca-medidas-nome.js';
import {aplicarMedidasAusentes} from '../src/lib/busca-medidas-ean.js';
import {extrairResultadosRSS} from '../src/lib/busca-medidas-web-publica.js';

const nome='Absorvente Intimus Days 80UN';
const item={
  title:'Absorvente Intimus Days 80UN — medidas',
  snippet:'Absorvente Intimus Days 80UN. Dimensões da embalagem: 20 x 12 x 7 cm. Peso bruto: 350 g.',
  link:'https://example.org/produto',
};
const rss=(itens)=>'<?xml version="1.0"?><rss version="2.0"><channel>'+itens.map((x,i)=>
  '<item><title><![CDATA['+x.title+']]></title>'+
  '<description><![CDATA['+x.snippet+']]></description>'+
  '<link>https://www.magazineluiza.com.br/produto'+i+'</link></item>').join('')+
  '</channel></rss>';
const network=(items)=>async(url)=>{
  const q=new URL(url);
  assert.equal(q.hostname,'www.bing.com');
  assert.equal(q.pathname,'/search');
  assert.equal(q.searchParams.get('format'),'rss');
  assert.match(q.searchParams.get('q'),/Absorvente Intimus Days 80UN/);
  assert.doesNotMatch(q.searchParams.get('q'),/789\d{8,}/);
  return {ok:true,status:200,headers:{get:()=>null},text:async()=>rss(items)};
};

test('busca automática na internet pelo nome, SEM chave de API',async()=>{
  const r=await buscarMedidasPorNome(nome,{fetcher:network([item])});
  assert.equal(r.encontrado,true);
  assert.equal(r.origem,'Pesquisa pública na internet');
  assert.deepEqual(r.dimensoes,{comprimento:20,largura:12,altura:7});
  assert.equal(r.peso,0.35);
  assert.match(r.url,/magazineluiza/);
  assert.equal(extrairResultadosRSS(rss([item])).length,1);
});

test('ignorar medidas de produto de outra apresentação e qualquer peso líquido',async()=>{
  const trocarUnidades={...item,title:'Absorvente Intimus Days 40UN',
    snippet:'Absorvente Intimus Days 40UN. Dimensões da embalagem: 18 x 10 x 5 cm.'};
  const r=await buscarMedidasPorNome(nome,{fetcher:network([trocarUnidades])});
  assert.equal(r.encontrado,false);
  assert.equal(extrairPesoBruto('Contém 500ml, 20 comprimidos; peso líquido 300 g'),0);
  assert.equal(extrairMedidasEmbalagem('Tamanho da foto: 300 x 300 px.'),null);
  assert.equal(extrairMedidasEmbalagem('20 x 12 x 7'),null);
  assert.equal(resultadoPertenceAoProduto(nome,'Absorvente Intimus Days 40UN'),false);
});

test('fontes divergentes impedem gravar uma dimensão errada',async()=>{
  const outro={...item,snippet:'Absorvente Intimus Days 80UN. Medidas da embalagem: 19 x 12 x 7 cm.'};
  const r=await buscarMedidasPorNome(nome,{fetcher:network([item,outro])});
  assert.equal(r.encontrado,false);
  assert.equal(r.divergencia,true);
});

test('completa apenas campos vazios, nunca altera medidas cadastradas manualmente',()=>{
  const atual={peso:1.5,dimensoes:{largura:0,altura:7,comprimento:0}};
  const r={encontrado:true,nome,origem:'Google — resultado por nome',
    peso:0.35,dimensoes:{largura:12,altura:9,comprimento:20}};
  const patch=aplicarMedidasAusentes(atual,r);
  assert.equal(patch.peso,undefined);
  assert.deepEqual(patch.dimensoes,{largura:12,altura:7,comprimento:20});
  assert.equal(patch.logisticaFonte.revisaoPendente,true);
  assert.deepEqual(aplicarMedidasAusentes({
    peso:1.5,dimensoes:{largura:12,altura:7,comprimento:20},
  },r),{});
});

test('indisponibilidade ou bloqueio do buscador público não inventa dimensões',async()=>{
  const bloqueado=await buscarMedidasPorNome(nome,{fetcher:async()=>({ok:false,status:403})});
  assert.equal(bloqueado.encontrado,false);
  assert.equal(bloqueado.temporario,true);
  assert.match(bloqueado.mensagem,/pesquisa pública/i);
  const offline=await buscarMedidasPorNome(nome,{fetcher:async()=>{throw Error('Offline');}});
  assert.equal(offline.temporario,true);
  const sem=await buscarMedidasPorNome(nome,{fetcher:network([])});
  assert.equal(sem.ok,true);
  assert.equal(sem.encontrado,false);
});

test('sem medidas no snippet, busca na página pública permitida, sem abrir sites arbitrários',async()=>{
  const chamadas=[];
  const fetcher=async url=>{
    chamadas.push(url);
    if(url.startsWith('https://www.bing.com/'))
      return {ok:true,status:200,text:async()=>rss([{
        title:item.title,snippet:'Detalhes e características do produto.'
      }])};
    assert.match(url,/^https:\/\/www\.magazineluiza\.com\.br\//);
    return {ok:true,status:200,text:async()=>(
      '<html><h1>Absorvente Intimus Days 80UN</h1>'+
      '<p>Dimensões da embalagem: 20 x 12 x 7 cm. Peso bruto: 350 g.</p></html>')};
  };
  const r=await buscarMedidasPorNome(nome,{fetcher});
  assert.equal(r.encontrado,true);
  assert.equal(r.origem,'Página pública do produto');
  assert.equal(chamadas.length,2);
});

test('lote escolhe só produtos incompletos e não inclui arquivados',()=>{
  assert.equal(nomeMedidasValido(nome),true);
  const incompleto={id:'p1',nome,peso:0,dimensoes:{}};
  const completo={...incompleto,peso:0.5,dimensoes:{largura:7,altura:8,comprimento:14}};
  assert.equal(medidasCompletas(incompleto),false);
  assert.equal(buscaLogisticaPendente(incompleto),true);
  assert.equal(buscaLogisticaPendente(completo),false);
  assert.equal(buscaLogisticaPendente({...incompleto,inovaArquivado:{em:'2026-10-28'}}),false);
});

test('painel e rotas do lote exigem permissão sem integração do Google',()=>{
  const root=new URL('../',import.meta.url);
  const rotas=readFileSync(new URL('src/routes/admin.js',root),'utf8');
  const tela=readFileSync(new URL('src/views/admin/catalogo.js',root),'utf8');
  const js=readFileSync(new URL('public/js/admin.js',root),'utf8');
  assert.match(tela,/Buscar dimensões pelo nome/);
  assert.match(tela,/id="botaoBuscarMedidasTodos"/);
  assert.match(rotas,/app\.post\('\/admin\/api\/produtos\/dimensoes-nome'/);
  assert.match(rotas,/app\.post\('\/admin\/api\/produtos\/medidas-lote\/iniciar'/);
  assert.match(rotas,/app\.post\('\/admin\/api\/produtos\/medidas-lote\/proximo'/);
  assert.match(rotas,/guardApi\(req,res,'produtos\.editar'\)/);
  assert.match(rotas,/role!=='super_admin'/);
  assert.doesNotMatch(rotas,/LIMITE_MEDIDAS_GOOGLE_MES|GOOGLE_CSE_API_KEY/);
  assert.doesNotMatch(rotas,/autorizarPesquisaNome/);
  assert.match(rotas,/aplicarMedidasAusentes\(atual,resultado\)/);
  assert.match(js,/post\('\/admin\/api\/produtos\/dimensoes-nome'/);
  assert.match(js,/post\('\/admin\/api\/produtos\/medidas-lote\/proximo'/);
  assert.doesNotMatch(js,/post\('\/admin\/api\/produtos\/dimensoes-ean'/);
});


test('nome completo consulta o catálogo antes do Google e sem reutilizar apresentação diferente',()=>{
  const db={collection:()=>({all:()=>[
    {id:'p1',nome:'Absorvente Intimus Days 80UN',peso:0.4,
      dimensoes:{largura:10,altura:7,comprimento:22}},
    {id:'p2',nome:'Absorvente Intimus Days 40UN',peso:0.2,
      dimensoes:{largura:8,altura:6,comprimento:18}},
    {id:'p3',nome:'Absorvente Intimus Days 80UN',peso:0,
      dimensoes:{}},
  ]})};
  const local=buscarMedidasNoCatalogoPorNome(db,'Absorvente Intimus Days 80UN',{ignorarId:'p3'});
  assert.equal(local.ok,true);
  assert.equal(local.encontrado,true);
  assert.deepEqual(local.dimensoes,{largura:10,altura:7,comprimento:22});
  assert.equal(local.peso,0.4);
  assert.match(local.origem,/Catálogo da farmácia/);
  assert.equal(buscarMedidasNoCatalogoPorNome(db,'Absorvente Intimus Days 60UN'),null);
});

test('nomes iguais com medidas divergentes exigem revisão e não inventam dimensões',()=>{
  const db={collection:()=>({all:()=>[
    {id:'p1',nome:'Absorvente Intimus Days 80UN',dimensoes:{largura:10,altura:7,comprimento:22}},
    {id:'p2',nome:'Absorvente Intimus Days 80UN',dimensoes:{largura:11,altura:7,comprimento:22}},
  ]})};
  const local=buscarMedidasNoCatalogoPorNome(db,'Absorvente Intimus Days 80UN');
  assert.equal(local.encontrado,false);
  assert.equal(local.divergencia,true);
  assert.match(local.mensagem,/diferentes/i);
});

test('conteúdo falso e fontes conflitantes não são aceitos',async()=>{
  const html=await buscarMedidasPorNome(nome,{fetcher:async()=>
    ({ok:true,status:200,text:async()=>'<html>Verifique se você é humano</html>'})});
  assert.equal(html.temporario,true);
  const outro={...item,snippet:'Absorvente Intimus Days 80UN. Medidas da embalagem: 19 x 12 x 7 cm.'};
  const conflito=await buscarMedidasPorNome(nome,{fetcher:network([item,outro])});
  assert.equal(conflito.divergencia,true);
  assert.equal(conflito.encontrado,false);
});

test('falha de busca por nome devolve erro ao painel em vez de mensagem genérica',()=>{
  const root=new URL('../',import.meta.url);
  const routes=readFileSync(new URL('src/routes/admin.js',root),'utf8');
  const js=readFileSync(new URL('public/js/admin.js',root),'utf8');
  const layout=readFileSync(new URL('src/views/admin/layout.js',root),'utf8');
  assert.match(routes,/responderConsultaMedidas\(res,resultado\)/);
  assert.match(routes,/erro:resultado\.erro\|\|resultado\.mensagem/);
  assert.match(routes,/buscarMedidasNoCatalogoPorNome\(db,nome/);
  assert.match(js,/dados\.erro \|\| dados\.mensagem/);
  assert.match(layout,/admin\.js\?v=medidas-web-publica-20261106/);
});

test('a ferramenta não exige API Google, credenciais ou token',()=>{
 const root=new URL('../',import.meta.url);
 const service=readFileSync(new URL('src/lib/busca-medidas-nome.js',root),'utf8');
 const rssService=readFileSync(new URL('src/lib/busca-medidas-web-publica.js',root),'utf8');
 const ui=readFileSync(new URL('src/views/admin/catalogo.js',root),'utf8');
 assert.doesNotMatch(service,/GOOGLE_CSE|googleapis\.com|googleKey/);
 assert.doesNotMatch(rssService,/googleapis\.com|apiKey|clientSecret/);
 assert.match(rssService,/www\.bing\.com\/search/);
 assert.match(ui,/sem API, chave ou mensalidade/);
});
