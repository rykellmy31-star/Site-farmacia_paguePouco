import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { precoVigenteCentavos, temPromocao, descontoPercentual } from '../src/lib/catalog.js';
import { precoPromocaoInovaVigente } from '../src/lib/inovafarma-promocoes-precos.js';
import {
  prepararPromocoesInova,consultarPromocoesInova,aplicarPromocoesInova
} from '../src/lib/inovafarma-promocoes-aplicacao.js';
import { telaPreviaAplicacaoPromocoesInova } from '../src/views/admin/inovafarma-promocoes-aplicar.js';

const cell=(idx,val)=>{
  const arr=Array(29).fill('');for(const [n,v] of Object.entries(val))arr[Number(n)]=v;
  return arr.join(';');
};
const cabecalho=cell(29,{0:'Código',1:'Produto',21:'Desc.%',24:'Preço Venda',27:'Preço Promoção'});
const campanha=(id,nome,inicio,fim,linhas)=>[
  cell(29,{0:'Promoção',2:String(id),5:nome}),
  cell(29,{0:'Início',2:'Final',6:'Formas de pagamento'}),
  cell(29,{0:inicio,2:fim,6:'Vista',7:'[X]',11:'Cartão',14:'[X]',15:'Cart. Digital',18:'[X]'}),
  cabecalho,...linhas.map(r=>cell(29,r))
];
const item=(codigo,nome,promo='15,00',normal='20,00')=>({
  0:String(codigo),1:nome,21:'25,00',24:normal,27:promo
});
function csvRapido(){
  return Buffer.from([
    'RELATÓRIO DE PROMOÇÕES',
    ...campanha(111,'OFERTA DE OUTUBRO','01/10/2026','31/10/2026',[
      item('800001','Vitamina exemplo'),
      item('800002','Esmalte exemplo','18,00'),
      item('800003','Ausente do site'),
      item('800004','Preço diferente'),
    ]),
    ...campanha(121,'OFERTA DE NOVEMBRO','01/11/2026','30/11/2026',[
      item('800001','Vitamina exemplo','14,00')
    ]),
    ...campanha(171,'QUINTA DO ESMALTE','25/06/2025','',[
      item('800002','Esmalte exemplo','12,00')
    ])
  ].join('\r\n'),'utf8');
}
function montarDb() {
  const dados=new Map(Object.entries({
    products:[
      {id:'p1',codigoInterno:'800001',precoCentavos:2000,
       precoPromocionalCentavos:1700,ativo:true},
      {id:'p2',codigoInterno:'800002',precoCentavos:2000,ativo:true},
      {id:'p3',codigoInterno:'800004',precoCentavos:3000,ativo:true},
      {id:'p4',codigoInterno:'800007',precoCentavos:4500,
       precoPromocionalCentavos:4000,ativo:true},
    ],
    inovaPromocoesLotes:[],
  }));
  let seq=0;
  return {
    dados,
    db:{
      storage:{transactionSync:fn=>fn()},
      collections:new Map(),
      collection(name){
        if(!dados.has(name))dados.set(name,[]);
        return {
          all:()=>dados.get(name),
          get:(id)=>dados.get(name).find(x=>x.id===id)||null,
          insert:(p)=>{const obj={...p,id:p.id||'lote'+(++seq)};
            dados.get(name).push(obj);return obj;},
          update:(id,patch)=>{const p=dados.get(name).find(x=>x.id===id);
            if(!p)return null;Object.assign(p,patch);return p;},
          remove:()=>{throw new Error('Não apagar dados durante promoções');},
        };
      },
    }
  };
}
const ref = new Date('2026-10-24T12:00:00.000Z');
test('prévia não altera preços e condições de pagamento exigem autorização',()=>{
  const {db}=montarDb();
  const r=prepararPromocoesInova(db,csvRapido(),'super',{},ref);
  assert.equal(r.ok,true);
  assert.equal(r.resumo.prontos,0);
  assert.equal(r.resumo.pagamentosRestritos,2);
  assert.equal(db.collection('products').get('p1').precoPromocionalCentavos,1700);
  assert.equal(db.collection('products').get('p1').inovaPromocoes,undefined);
  assert.equal(aplicarPromocoesInova(db,r.id,'super',{
    frase:'APLICAR DESCONTOS INOVAFARMA',confirmado:'1'
  },ref).status,409);
});
test('ofertas futuras e de dia fixo aplicadas com expiração explícita e sem alterar preço base',()=>{
  const {db}=montarDb();
  const r=prepararPromocoesInova(db,csvRapido(),'super',{
    aceitaTodosOnline:'1',fimSemData:'2026-11-30'
  },ref);
  assert.equal(r.ok,true);
  assert.equal(r.resumo.prontos,2);
  assert.equal(r.resumo.precoDivergente,1);
  assert.equal(r.resumo.semProduto,1);
  assert.equal(r.resumo.manuaisSubstituidas,1);
  assert.equal(r.resumo.campanhasAceitas,4);
  assert.equal(db.collection('products').get('p1').precoPromocionalCentavos,1700);
  assert.equal(aplicarPromocoesInova(db,r.id,'super',{
    frase:'ERRO',confirmado:'1',aceitaTodosOnline:'1'
  },ref).status,400);
  assert.equal(aplicarPromocoesInova(db,r.id,'super',{
    frase:'APLICAR DESCONTOS INOVAFARMA',confirmado:'1'
  },ref).status,400);
  const ok=aplicarPromocoesInova(db,r.id,'super',{
    frase:'APLICAR DESCONTOS INOVAFARMA',
    confirmado:'1',aceitaTodosOnline:'1'
  },ref);
  assert.equal(ok.ok,true);
  assert.equal(ok.atualizados,2);
  const p1=db.collection('products').get('p1');
  const p2=db.collection('products').get('p2');
  assert.equal(p1.precoCentavos,2000);
  assert.equal(p1.precoPromocionalCentavos,0);
  assert.equal(precoVigenteCentavos(p1,ref),1500);
  assert.equal(precoVigenteCentavos(p1,new Date('2026-11-24T12:00:00Z')),1400);
  assert.equal(precoVigenteCentavos(p1,new Date('2026-12-01T12:00:00Z')),2000);
  assert.equal(temPromocao(p1,new Date('2026-12-01T12:00:00Z')),false);
  assert.equal(descontoPercentual(p1,ref),25);
  // Quinta recorrente usa preço mais baixo se não há campanha concorrente.
  assert.equal(precoVigenteCentavos(p2,new Date('2026-10-24T12:00:00Z')),1800);
  assert.equal(precoVigenteCentavos(p2,new Date('2026-10-29T12:00:00Z')),2000);
  assert.equal(precoVigenteCentavos(p2,new Date('2026-11-05T12:00:00Z')),1200);
  assert.equal(precoVigenteCentavos(p2,new Date('2026-12-01T12:00:00Z')),2000);
  // Oferta manual de outros produtos não desaparece.
  assert.equal(precoVigenteCentavos(db.collection('products').get('p4'),ref),4000);
  assert.equal(aplicarPromocoesInova(db,r.id,'super',{
    frase:'APLICAR DESCONTOS INOVAFARMA',confirmado:'1',
    aceitaTodosOnline:'1'
  },ref).status,409);
});
test('desconto com campanhas simultâneas é bloqueado, sem combinação',()=>{
  const p={precoCentavos:2000,precoPromocionalCentavos:0,inovaPromocoes:[
    {inicio:'2026-10-01',fim:'2026-10-31',precoVendaCentavos:2000,
     precoPromocionalCentavos:1600,diaSemana:null},
    {inicio:'2026-10-01',fim:'2026-10-31',precoVendaCentavos:2000,
     precoPromocionalCentavos:1000,diaSemana:'sabado'}
  ]};
  assert.equal(precoPromocaoInovaVigente(p,ref),null);
  assert.equal(precoVigenteCentavos(p,ref),2000);
  assert.equal(precoVigenteCentavos(p,new Date('2026-10-26T12:00:00Z')),1600);
});
test('conferência expira e preço/cadastro diferente bloqueia aplicação',()=>{
  const {db}=montarDb();
  const r=prepararPromocoesInova(db,csvRapido(),'super',
    {aceitaTodosOnline:'1'},ref);
  assert.equal(consultarPromocoesInova(db,r.id,'outro',ref).status,404);
  assert.equal(consultarPromocoesInova(db,r.id,'super',
    new Date(ref.getTime()+31*60000)).status,410);
  db.collection('products').update('p1',{precoCentavos:2100});
  assert.equal(consultarPromocoesInova(db,r.id,'super',ref).status,409);
  assert.equal(aplicarPromocoesInova(db,r.id,'super',{
    frase:'APLICAR DESCONTOS INOVAFARMA',confirmado:'1',
    aceitaTodosOnline:'1'
  },ref).status,409);
});
test('HTML exige CSRF e confirmação explícita; sem produto não habilita aplicação',()=>{
  const {db}=montarDb();
  const r=prepararPromocoesInova(db,csvRapido(),'super',
    {aceitaTodosOnline:'1'},ref);
  const ctx={adminUser:{id:'super',role:'super_admin',nome:'Super'},
    settings:{empresa:{nomeFantasia:'Farmácia'},tema:{}},
    csrf:'TOKEN_TESTE',req:{pathname:'/admin/estoque/importar',
      query:new URLSearchParams()}};
  const html=telaPreviaAplicacaoPromocoesInova(ctx,{...r});
  assert.match(html,/action="\/admin\/estoque\/promocoes\/aplicar"/);
  assert.match(html,/name="_csrf" value="TOKEN_TESTE"/);
  assert.match(html,/APLICAR DESCONTOS INOVAFARMA/);
  assert.match(html,/preço/i);
  assert.doesNotMatch(html,/<script>alert/);
});
test('rotas aplicam permissões e não permitem publicidade de descontos não confirmados',()=>{
  const source=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(source,/app\.post\('\/admin\/estoque\/promocoes\/preparar'/);
  assert.match(source,/app\.post\('\/admin\/estoque\/promocoes\/aplicar'/);
  assert.match(source,/role!=='super_admin'/);
  assert.match(source,/guard\(req,res,'promocoes\.editar'\)/);
  const page=readFileSync(new URL('../src/views/admin/importacao-estoque.js',import.meta.url),'utf8');
  assert.match(page,/formaction="\/admin\/estoque\/promocoes\/preparar"/);
});
