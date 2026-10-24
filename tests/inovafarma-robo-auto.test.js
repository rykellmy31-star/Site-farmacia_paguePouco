import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {lerRelatorioOriginalRobo,dataExtracaoRobo,sincronizarRobo} from '../scripts/inovafarma-robo-auto-client.mjs';
import {configurarRoboInova,autenticarRoboInova,receberBlocoRoboInova,
  aplicarBlocoRoboInova,consultarRoboInova} from '../src/lib/inovafarma-robo-sync.js';

const linha=(codigo,ean,qtd,preco='7,21')=>{
  const cols=Array(21).fill('');
  cols[0]=String(codigo);cols[1]=ean;cols[4]='Produto de teste '+codigo;
  cols[5]='Marca A';cols[6]=String(qtd);cols[15]=preco;
  return cols.join(';');
};
const csvOriginal=[
  'POSIÇÃO DE ESTOQUE'+';'.repeat(20),
  '"Tipo:\r\nEmpresa(s):\r\nEstoque:";;;"POSIÇÃO DO ESTOQUE\r\nFARMÁCIA EXEMPLO\r\nESTOQUE GERAL";'+ ';'.repeat(16),
  'Código;Cod. Barra;;;Produto;Fabricante;Estoque;Preço Compra;Total Compra;Preço Custo;Total Custo;;Custo Médio;Total Custo Médio;;Preço Venda;Total Venda;;;;Curva ABC',
  linha('834991','',-2),linha('861481','7891234567890',0),
  linha('861511','123456789012345',2),linha('861512','7891234567891',3),
  'ESTOQUE:;;;;;;;;;;;;;;;;;12;;;','Fonte: INOVAFARMA;;;'
].join('\r\n');
function fakeDB(){
  const col=new Map(),db={collections:new Map(),storage:null};
  db.collection=(name)=>{
    if(!col.has(name))col.set(name,new Map());
    const map=col.get(name);
    return {
      get:id=>map.get(String(id))||null,
      all:()=>[...map.values()],
      count:()=>map.size,
      find:pred=>[...map.values()].filter(pred),
      insert(doc){const d={...doc,id:doc.id||'id_'+Math.random().toString(36).slice(2)};
        map.set(String(d.id),d);return d;},
      update(id,patch){const d=map.get(String(id));if(!d)return null;
        const x={...d,...patch};map.set(String(id),x);return x;},
    };
  };
  return db;
}
const item=(id,stock=2)=>({
  codigoInterno:String(800000+id),ean:String(7891000000000+id),
  nome:'Produto sintético '+id,marca:'Marca Teste',
  precoCentavos:1525,quantidade:stock,
});
const sha='a'.repeat(64);
function arquivo(n=3000){return Array.from({length:n},(_,i)=>item(i+1));}
function enviarTudo(db,itens,geradoEm='2026-10-24T19:38:56-03:00',hash=sha){
  const blocos=Math.ceil(itens.length/200);let last;
  for(let b=0;b<blocos;b++){
    last=receberBlocoRoboInova(db,{
      arquivoHash:hash,geradoEm,total:itens.length,blocos,bloco:b,
      itens:itens.slice(b*200,(b+1)*200),
    });
    assert.equal(last.ok,true,JSON.stringify(last));
  }
  return last;
}
test('CSV original com capa, campos de custos e EAN faltante gera saldos seguros',()=>{
  const dados=lerRelatorioOriginalRobo(Buffer.from(csvOriginal,'utf8'));
  assert.equal(dados.itens.length,4);
  assert.equal(dados.resumo.semEan,1);
  assert.equal(dados.resumo.eanInvalido,1);
  assert.equal(dados.resumo.negativosNeutralizados,1);
  assert.deepEqual(dados.itens.map(x=>x.quantidade),[0,0,2,3]);
  assert.equal(dados.itens[0].ean,'');
  assert.equal(dados.itens[2].ean,'');
  assert.equal(dados.itens[0].precoCentavos,721);
  assert.equal(dataExtracaoRobo('Análise de produtos-24-10-2026 193856.csv'),
    '2026-10-24T19:38:56-03:00');
});
test('pareamento gera segredo só uma vez e autentica sem liberar outro token',()=>{
  const db=fakeDB(),r=configurarRoboInova(db);
  assert.ok(r.token.length>40);
  assert.equal(autenticarRoboInova(db,'Bearer '+r.token),true);
  assert.equal(autenticarRoboInova(db,'Bearer invalid'),false);
  assert.equal(autenticarRoboInova(db,''),false);
  assert.equal(JSON.stringify(db.collection('inovaRoboConfiguracao').all()).includes(r.token),false);
  configurarRoboInova(db,{desativar:true});
  assert.equal(autenticarRoboInova(db,'Bearer '+r.token),false);
});
test('não aplica arquivo parcial, EAN duplicado ou report anterior',()=>{
  const db=fakeDB();configurarRoboInova(db);
  const lista=arquivo();
  const bloco=receberBlocoRoboInova(db,{arquivoHash:sha,
    geradoEm:'2026-10-24T19:38:56-03:00',total:3000,blocos:15,
    bloco:0,itens:lista.slice(0,200)});
  assert.equal(bloco.ok,true);
  const aplicado=aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0});
  assert.equal(aplicado.ok,false);
  assert.equal(db.collection('products').count(),0);
  assert.equal(db.collection('stockMovements').count(),0);
});
test('arquivo completo: concilia código interno sem EAN, não toca em pedidos, impede queda sob reserva',()=>{
  const db=fakeDB();
  configurarRoboInova(db);
  db.collection('products').insert({
    id:'existente',codigoInterno:'800001',ean:'7891000000001',nome:'Nome preservado',
    imagens:['imagem-antiga'],precoCentavos:1900,precoPromocionalCentavos:1600,
    ativo:true,sanitario:{aprovadoFarmaceutico:true},
    estoque:{quantidade:9,reservado:0,quarentena:0},
  });
  db.collection('products').insert({
    id:'reservado',codigoInterno:'800002',nome:'Reservado',
    precoCentavos:1900,estoque:{quantidade:8,reservado:3,quarentena:0},
  });
  db.collection('orders').insert({id:'pedido-antigo',statusFinanceiro:'aprovado',
    totalCentavos:1999,itens:[{produtoId:'reservado',quantidade:3}]});
  const itens=arquivo();
  itens[0].ean='';itens[0].quantidade=5;
  itens[1].quantidade=1;
  enviarTudo(db,itens);
  assert.equal(db.collection('products').get('existente').estoque.quantidade,9);
  const r=aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0});
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(db.collection('products').get('existente').estoque.quantidade,5);
  assert.equal(db.collection('products').get('existente').ean,'7891000000001');
  assert.equal(db.collection('products').get('existente').ativo,true);
  assert.equal(db.collection('products').get('existente').precoPromocionalCentavos,1600);
  assert.deepEqual(db.collection('products').get('existente').imagens,['imagem-antiga']);
  assert.equal(db.collection('products').get('reservado').estoque.quantidade,8);
  assert.equal(db.collection('products').get('reservado').estoque.reservado,3);
  assert.equal(db.collection('orders').get('pedido-antigo').totalCentavos,1999);
  assert.equal(r.pendentes,1);
  const novos=db.collection('products').all().filter(x=>x.id!=='existente'&&x.id!=='reservado');
  assert.equal(novos.length,198);
  assert.ok(novos.every(x=>x.ativo===false));
  assert.equal(aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0}).duplicado,true);
  assert.equal(db.collection('products').count(),200);
  assert.equal(aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:2}).ok,false);
  const second=aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:1});
  assert.equal(second.ok,true,JSON.stringify(second));
  const painel=consultarRoboInova(db);
  assert.equal(painel.ultimo.recebidos,3000);
  assert.equal(painel.ultimo.pendentes,1);
  assert.equal(painel.ultimo.atualizados,1);
  assert.equal(painel.ultimo.novosInativos,398);
});
test('Cliente Windows transmite formato JSON sem cartão, CPF ou preço de custo',async()=>{
  const linhas=Array.from({length:3000},(_,i)=>linha(800001+i,
    String(7891000000000+i),i%3,'20,50'));
  const txt=csvOriginal.split('\r\n').slice(0,7).concat(linhas,
    ['ESTOQUE:;;;;;;;;;;;;;;;;;;;;']).join('\r\n');
  const bytes=Buffer.from(txt);
  const chamadas=[];
  const fetchFn=async(url,options)=>{
    assert.match(url,/\/webhooks\/robo-inovafarma\//);
    assert.match(options.headers.Authorization,/^Bearer /);
    const body=JSON.parse(options.body);
    chamadas.push({url,body});
    return {ok:true,status:200,json:async()=>({ok:true,status:'concluido'})};
  };
  const r=await sincronizarRobo({bytes,nome:'Análise de produtos-24-10-2026 193856.csv',
    token:'x'.repeat(64),fetchFn});
  assert.equal(r.ok,true);
  assert.equal(chamadas.length,30,'15 lotes e 15 aplicações');
  assert.equal(chamadas[0].body.total,3000);
  assert.equal(chamadas[0].body.itens.length,200);
  assert.ok(!JSON.stringify(chamadas).includes('precoCompra'));
  assert.ok(!JSON.stringify(chamadas).includes('cpf'));
});
test('rotas autenticadas /webhooks e painel Superadmin, sem remover CSRF geral',()=>{
  const route=fs.readFileSync(new URL('../src/routes/inovafarma-robo.js',import.meta.url),'utf8');
  assert.match(route,/autenticarRoboInova\(db,req.headers.authorization\)/);
  assert.match(route,/req.adminUser.role!=='super_admin'/);
  assert.match(route,/name="backup"/);
  assert.match(route,/Cache-Control','no-store/);
  const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(source,/registrarRotasRoboInova\(app, db\)/);
});
