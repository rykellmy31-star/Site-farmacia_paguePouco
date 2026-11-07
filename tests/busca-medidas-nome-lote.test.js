import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  nomeMedidasValido,resultadoPertenceAoProduto,extrairMedidasEmbalagem,
  extrairPesoBruto,buscarMedidasPorNome,medidasCompletas,buscaLogisticaPendente,
} from '../src/lib/busca-medidas-nome.js';
import {aplicarMedidasAusentes} from '../src/lib/busca-medidas-ean.js';

const nome='Absorvente Intimus Days 80UN';
const item={
  title:'Absorvente Intimus Days 80UN — medidas',
  snippet:'Absorvente Intimus Days 80UN. Dimensões da embalagem: 20 x 12 x 7 cm. Peso bruto: 350 g.',
  link:'https://example.org/produto',
};
const network=(items)=>async(url)=>{
  const q=new URL(url);
  assert.equal(q.hostname,'www.googleapis.com');
  assert.equal(q.pathname,'/customsearch/v1');
  assert.equal(q.searchParams.get('q'),'"'+nome+'" dimensões da embalagem cm');
  assert.equal(q.searchParams.get('num'),'5');
  assert.doesNotMatch(q.searchParams.get('q'),/789\d{8,}/);
  return {ok:true,status:200,json:async()=>({items})};
};

test('busca pelo nome completo, não EAN, e dimensões explícitas da embalagem',async()=>{
  const r=await buscarMedidasPorNome(nome,{googleKey:'key',googleCx:'cx',fetcher:network([item])});
  assert.equal(r.encontrado,true);
  assert.equal(r.origem,'Google — resultado por nome');
  assert.deepEqual(r.dimensoes,{comprimento:20,largura:12,altura:7});
  assert.equal(r.peso,0.35);
  assert.equal(r.url,'https://example.org/produto');
});

test('ignorar medidas de produto de outra apresentação e qualquer peso líquido',async()=>{
  const trocarUnidades={...item,title:'Absorvente Intimus Days 40UN',
    snippet:'Absorvente Intimus Days 40UN. Dimensões da embalagem: 18 x 10 x 5 cm.'};
  const r=await buscarMedidasPorNome(nome,{googleKey:'key',googleCx:'cx',
    fetcher:network([trocarUnidades])});
  assert.equal(r.encontrado,false);
  assert.equal(extrairPesoBruto('Contém 500ml, 20 comprimidos; peso líquido 300 g'),0);
  assert.equal(extrairMedidasEmbalagem('Tamanho da foto: 300 x 300 px.'),null);
  assert.equal(extrairMedidasEmbalagem('20 x 12 x 7'),null);
  assert.equal(resultadoPertenceAoProduto(nome,'Absorvente Intimus Days 40UN'),false);
});

test('fontes divergentes impedem gravar uma dimensão errada',async()=>{
  const outro={...item,snippet:'Absorvente Intimus Days 80UN. Medidas da embalagem: 19 x 12 x 7 cm.'};
  const r=await buscarMedidasPorNome(nome,{googleKey:'key',googleCx:'cx',fetcher:network([item,outro])});
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

test('sem API, erro temporário ou cota esgotada não retorna dimensões fictícias',async()=>{
  const noKey=await buscarMedidasPorNome(nome,{googleKey:'',googleCx:''});
  assert.equal(noKey.encontrado,false);
  assert.equal(noKey.semIntegracao,true);
  const quota=await buscarMedidasPorNome(nome,{googleKey:'key',googleCx:'cx',
    fetcher:async()=>({ok:false,status:429})});
  assert.equal(quota.cotaEsgotada,true);
  const offline=await buscarMedidasPorNome(nome,{googleKey:'key',googleCx:'cx',
    fetcher:async()=>{throw Error('Offline');}});
  assert.equal(offline.temporario,true);
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

test('painel e rotas do lote exigem permissão e usam limite de consultas',()=>{
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
  assert.match(rotas,/LIMITE_MEDIDAS_GOOGLE_MES=90/);
  assert.match(rotas,/aplicarMedidasAusentes\(atual,resultado\)/);
  assert.match(js,/post\('\/admin\/api\/produtos\/dimensoes-nome'/);
  assert.match(js,/post\('\/admin\/api\/produtos\/medidas-lote\/proximo'/);
  assert.doesNotMatch(js,/post\('\/admin\/api\/produtos\/dimensoes-ean'/);
});
