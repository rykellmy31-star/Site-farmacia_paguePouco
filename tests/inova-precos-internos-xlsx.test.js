import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {Collection} from '../src/lib/store.js';
import {lerPrecosInovaXlsx} from '../src/lib/inova-precos-internos-xlsx.js';
import {prepararPrecosInternos,consultarPrecosInternos,aplicarPrecosInternos,
  avaliarPrecosInternos} from '../src/lib/inova-precos-internos-aplicacao.js';
import {precoVigenteCentavos} from '../src/lib/catalog.js';
import {readFileSync} from 'node:fs';

const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
function xlsx(dados){
  const sharedStrings=[
    'Código','Produto','Preço Venda','Preço Promoção','Código Barra',
    'Ativo','Controlado','APTAMIL PREMIUM 2 800G','SEM DESCONTO','PROMO MAIOR'
  ];
  const shared='<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    sharedStrings.map(s=>'<si><t>'+s+'</t></si>').join('')+'</sst>';
  const cell=(col,row,value,shared=false)=>'<c r="'+col+row+'"'+
    (shared?' t="s"':'')+'><v>'+value+'</v></c>';
  // Exportação real do InovaFarma inclui células vazias antes e entre campos:
  // <c r="A2" s="1" /> precede o cabeçalho Código em B2.
  const head='<c r="A2" s="1" />'+cell('B',2,0,true)+cell('C',2,1,true)+
    '<c r="D2" s="1" />'+cell('Y',2,2,true)+
    cell('AB',2,3,true)+cell('AH',2,4,true)+cell('AP',2,5,true)+
    cell('AM',2,6,true);
  const rows=dados.map((d,i)=>'<row r="'+(i+3)+'">'+
    '<c r="A'+(i+3)+'" s="2" />'+cell('B',i+3,d.code)+
    cell('C',i+3,d.name,true)+'<c r="D'+(i+3)+'" s="2" />'+
    cell('Y',i+3,d.price)+cell('AB',i+3,d.promo)+
    cell('AH',i+3,d.ean)+cell('AP',i+3,1)+cell('AM',i+3,0)+'</row>').join('');
  const sheet='<?xml version="1.0"?><worksheet><sheetData><row r="2">'+
    head+'</row>'+rows+'</sheetData></worksheet>';
  const entries=[['xl/sharedStrings.xml',Buffer.from(shared)],
    ['xl/worksheets/sheet0.xml',Buffer.from(sheet)]];
  let offset=0;const locals=[],centrals=[];
  for(const [name,data] of entries){
    const n=Buffer.from(name),deflate=deflateRawSync(data);
    const local=Buffer.concat([u32(0x04034b50),u16(20),u16(0),u16(8),u16(0),u16(0),
      u32(0),u32(deflate.length),u32(data.length),u16(n.length),u16(0),n,deflate]);
    const central=Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(8),
      u16(0),u16(0),u32(0),u32(deflate.length),u32(data.length),
      u16(n.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),n]);
    locals.push(local);centrals.push(central);offset+=local.length;
  }
  const dir=Buffer.concat(centrals);
  const end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),
    u16(entries.length),u32(dir.length),u32(offset),u16(0)]);
  return Buffer.concat([...locals,dir,end]);
}
const excel=xlsx([
  {code:795818,name:7,price:'84.9000',promo:'73.9000',ean:'7891025107897'},
  {code:111,name:8,price:'25.9000',promo:0,ean:'7891234567895'},
  {code:222,name:9,price:'45.9000',promo:'49.9000',ean:'7891234567896'},
]);
function dbFake(){
  const map=new Map();
  const db={storage:{transactionSync:fn=>fn()},
    collection(name){
      if(!map.has(name))map.set(name,new Collection({_commit(){}},name));
      return map.get(name);
    }};
  return db;
}
test('lê XLSX realístico Inova: preço normal, desconto, código e EAN',()=>{
  const resultado=lerPrecosInovaXlsx(excel);
  assert.equal(resultado.resumo.linhas,3);
  assert.equal(resultado.resumo.precoPromocional,1);
  assert.equal(resultado.resumo.semPromocao,1);
  assert.equal(resultado.resumo.promocaoInvalida,1);
  assert.equal(resultado.itens.length,2);
  assert.deepEqual(resultado.itens[0].precoCentavos,8490);
  assert.deepEqual(resultado.itens[0].promocaoCentavos,7390);
  assert.equal(resultado.itens[0].ean,'7891025107897');
  assert.equal(resultado.itens[0].codigo,'795818');
});
test('prévia não altera produto e aplicação exige confirmação tripla',()=>{
  const db=dbFake();
  const p=db.collection('products').insert({id:'p1',codigoInterno:'795818',
    ean:'7891025107897',nome:'APTAMIL PREMIUM 2 800G',precoCentavos:8490,
    precoPromocionalCentavos:0,ativo:true,inovaPromocoes:[],
    imagens:['imagem-existente.png'],estoque:{quantidade:10},sanitario:{requerReceita:false}});
  db.collection('products').insert({id:'p2',codigoInterno:'111',ean:'7891234567895',
    precoCentavos:2590,precoPromocionalCentavos:0,ativo:false,inovaPromocoes:[],
    estoque:{quantidade:7}});
  const prev=prepararPrecosInternos(db,excel,'admin');
  assert.equal(prev.ok,true);
  assert.equal(prev.resumo.aplicaveis,1);
  assert.equal(db.collection('products').get('p1').precoInternoInovaCentavos,undefined);
  assert.equal(aplicarPrecosInternos(db,prev.id,'admin',{}).ok,false);
  const revisao=consultarPrecosInternos(db,prev.id,'admin');
  assert.equal(revisao.ok,true);
  const autorizado=aplicarPrecosInternos(db,prev.id,'admin',{
    frase:'APLICAR PRECOS INTERNOS INOVA',confirmado:'1',autorizacaoOnline:'1'});
  assert.equal(autorizado.ok,true);
  assert.equal(autorizado.atualizados,1);
  const salvo=db.collection('products').get('p1');
  assert.equal(salvo.precoInternoInovaCentavos,7390);
  assert.equal(salvo.precoCentavos,8490);
  assert.equal(precoVigenteCentavos(salvo),7390);
  assert.deepEqual(salvo.imagens,['imagem-existente.png']);
  assert.equal(salvo.estoque.quantidade,10);
  assert.equal(salvo.ativo,true);
  assert.equal(db.collection('products').get('p2').ativo,false);
  assert.equal(aplicarPrecosInternos(db,prev.id,'admin',{
    frase:'APLICAR PRECOS INTERNOS INOVA',confirmado:'1',autorizacaoOnline:'1'}).ok,false);
});
test('desconto interno do Inova tem prioridade sem apagar campanha ou desconto manual',()=>{
  const normal={precoCentavos:8490,precoInternoInovaCentavos:7390,
    precoPromocionalCentavos:6990};
  assert.equal(precoVigenteCentavos(normal),7390);
  const campanha={...normal,inovaPromocoes:[{inicio:'2026-01-01',fim:'2027-01-01',
    precoVendaCentavos:8490,precoPromocionalCentavos:6490}]};
  assert.equal(precoVigenteCentavos(campanha,new Date('2026-11-07T12:00:00Z')),7390);
  assert.equal(precoVigenteCentavos({...campanha,precoInternoInovaCentavos:0},
    new Date('2026-11-07T12:00:00Z')),6490);
});
test('rejeita arquivo não-XLSX e não lê dados de custo nem altera ERP',()=>{
  assert.throws(()=>lerPrecosInovaXlsx(Buffer.from('não é excel')),/inválido|incompleto/);
  const src=readFileSync(new URL('../src/lib/inova-precos-internos-xlsx.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/precoCompra|precoCusto|senhaBanco|sql\.query/i);
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(routes,/admin\/estoque\/precos-internos\/preparar/);
  assert.match(routes,/admin\/estoque\/precos-internos\/aplicar/);
  const page=readFileSync(new URL('../src/views/admin/importacao-estoque.js',import.meta.url),'utf8');
  assert.match(page,/arquivoPrecosInternosInova/);
});


test('prévia permite localizar SKU fora dos 100 primeiros e mostra motivo de rejeição',async()=>{
  const {telaPreviaPrecosInternos}=await import('../src/views/admin/inova-precos-internos-previa.js');
  const ctx={settings:{empresa:{},tema:{}},adminUser:{id:'admin',nome:'Admin',role:'super_admin'},
    csrf:'teste',req:{query:new URLSearchParams('codigo=797222')}};
  const plano=Array.from({length:130},(_,i)=>({
    codigo:String(800000+i),nome:'Produto '+i,atualBase:4790,novoBase:4790,
    atualPromo:0,novoPromo:0,motivo:'sem_mudanca',
  }));
  plano.push({codigo:'797222',nome:'FRALDA BABYSEC ULTA MEGA M 38UN',
    atualBase:4790,novoBase:4790,atualPromo:0,novoPromo:3999,motivo:'ean_divergente'});
  const resumo={aplicaveis:0,comDesconto:0,semDesconto:0,semCadastro:0,
    eanDivergente:1,identificacaoAmbigua:0,promocaoManual:0,
    controlados:0,campanhaConflitante:0,alertasPreco:0,semMudanca:130};
  const html=telaPreviaPrecosInternos(ctx,{id:'lote',plano,resumo,
    aplicado:true,fonte:{linhas:131,precoPromocional:1,semPromocao:130,promocaoInvalida:0}});
  assert.match(html,/797222/);
  assert.match(html,/FRALDA BABYSEC ULTA MEGA M 38UN/);
  assert.match(html,/EAN diferente/);
  assert.match(html,/R\$\s*39,99/);
  assert.doesNotMatch(html,/>Produto 0</);
});



test('BABYSEC 797222: Inova R$47,90/R$39,99 sobrepõe campanha/manual sem ignorar EAN legado',()=>{
  const db=dbFake();
  db.collection('products').insert({
    id:'fralda-babysec',codigoInterno:'797222',ean:'7896061995903',
    nome:'FRALDA BABYSEC ULTA MEGA M 38UN',precoCentavos:4790,
    precoPromocionalCentavos:4590,precoInternoInovaCentavos:0,
    inovaPromocoes:[{inicio:'2026-01-01',fim:'2027-01-01',
      precoVendaCentavos:4790,precoPromocionalCentavos:4290}],
    estoque:{quantidade:12,reservado:0,quarentena:0},
    imagens:['foto-babysec.png'],ativo:true,
    sanitario:{controlado:false},
  });
  const item={codigo:'797222',nome:'FRALDA BABYSEC ULTA MEGA M 38UN',
    ean:'17896061995900',precoCentavos:4790,promocaoCentavos:3999,
    controlado:false,ativo:true};
  const prev=avaliarPrecosInternos(db,[item]);
  assert.equal(prev.resumo.aplicaveis,1);
  assert.equal(prev.resumo.promocaoManual,1);
  assert.equal(prev.resumo.campanhaConflitante,1);
  assert.equal(prev.resumo.eanDivergente,1);
  assert.equal(prev.plano[0].motivo,'apto');
  const lote=prepararPrecosInternos(db,xlsx([
    {code:797222,name:7,price:'47.9000',promo:'39.9900',ean:'17896061995900'}
  ]),'admin');
  assert.equal(lote.ok,true);
  assert.equal(lote.resumo.aplicaveis,1);
  const aplicado=aplicarPrecosInternos(db,lote.id,'admin',{
    frase:'APLICAR PRECOS INTERNOS INOVA',confirmado:'1',autorizacaoOnline:'1'});
  assert.equal(aplicado.ok,true);
  const produto=db.collection('products').get('fralda-babysec');
  assert.equal(produto.precoInternoInovaCentavos,3999);
  assert.equal(precoVigenteCentavos(produto,new Date('2026-11-08T12:00:00Z')),3999);
  assert.equal(produto.precoPromocionalCentavos,4590);
  assert.equal(produto.estoque.quantidade,12);
  assert.equal(produto.ean,'7896061995903');
  assert.deepEqual(produto.imagens,['foto-babysec.png']);
});

test('mudanças expressivas válidas do InovaFarma geram alerta, não são ignoradas',()=>{
  const db=dbFake();
  db.collection('products').insert({
    id:'produto',codigoInterno:'123',ean:'7891234567890',nome:'Produto',
    precoCentavos:9999,precoPromocionalCentavos:0,ativo:true,
    estoque:{quantidade:5,reservado:0,quarentena:0},
  });
  const r=avaliarPrecosInternos(db,[{codigo:'123',nome:'Produto',
    ean:'7891234567890',precoCentavos:19000,promocaoCentavos:1000,
    controlado:false}]);
  assert.equal(r.resumo.aplicaveis,1);
  assert.equal(r.resumo.alertasPreco,1);
  assert.equal(r.plano[0].motivo,'apto');
});

test('identificação conflitante e bloqueio sanitário continuam impedindo produto errado',()=>{
  const db=dbFake();
  db.collection('products').insert({id:'p1',codigoInterno:'797222',ean:'7891111111111',
    nome:'Fralda',precoCentavos:4790,ativo:true});
  db.collection('products').insert({id:'p2',codigoInterno:'999',ean:'17896061995900',
    nome:'Outro',precoCentavos:4790,ativo:true});
  let resultado=avaliarPrecosInternos(db,[{codigo:'797222',nome:'Fralda',
    ean:'17896061995900',precoCentavos:4790,promocaoCentavos:3999,
    controlado:false}]);
  assert.equal(resultado.resumo.aplicaveis,0);
  assert.equal(resultado.plano[0].motivo,'identificacao_ambigua');
  const r=avaliarPrecosInternos(db,[{codigo:'797222',nome:'Fralda',
    ean:'7891111111111',precoCentavos:4790,promocaoCentavos:3999,
    controlado:true}]);
  assert.equal(r.plano[0].motivo,'controlado');
});
