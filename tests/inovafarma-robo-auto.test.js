import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {lerRelatorioOriginalRobo,dataExtracaoRobo,sincronizarRobo} from '../scripts/inovafarma-robo-auto-client.mjs';
import {configurarRoboInova,autenticarRoboInova,receberBlocoRoboInova,
  aplicarBlocoRoboInova,consultarRoboInova,consultarAlteracoesUltimoRoboInova} from '../src/lib/inovafarma-robo-sync.js';

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
      findOne:pred=>[...map.values()].find(pred)||null,
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
  const linhasExtras=Array.from({length:2996},(_,i)=>linha(900001+i,
    String(7893000000000+i),i%3));
  const originalLongo=csvOriginal.replace('ESTOQUE:;;;;;;;;;;;;;;;;;12;;;',
    linhasExtras.join('\r\n')+'\r\nESTOQUE:;;;;;;;;;;;;;;;;;12;;;');
  const dados=lerRelatorioOriginalRobo(Buffer.from(originalLongo,'utf8'));
  assert.equal(dados.itens.length,3000);
  assert.equal(dados.resumo.semEan,1);
  assert.equal(dados.resumo.eanInvalido,1);
  assert.equal(dados.resumo.negativosNeutralizados,1);
  assert.deepEqual(dados.itens.slice(0,4).map(x=>x.quantidade),[0,0,2,3]);
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
  const mudancas=db.collection('inovaRoboBlocos').get(sha+':0').alteracoes;
  assert.deepEqual(mudancas,[{
    produtoId:'existente',nome:'Nome preservado',
    codigoInterno:'800001',ean:'7891000000001',
    estoqueAntes:9,estoqueDepois:5,
    precoAntesCentavos:1900,precoDepoisCentavos:1525,
  }],'registrar antes e depois, incluindo preco, sem alterar pedidos ou promocoes');
  const novos=db.collection('products').all().filter(x=>x.id!=='existente'&&x.id!=='reservado');
  assert.equal(novos.length,198);
  assert.ok(novos.every(x=>x.ativo===false));
  assert.equal(aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0}).duplicado,true);
  assert.equal(db.collection('inovaRoboBlocos').get(sha+':0').alteracoes.length,1,
    'reenvio nao registra a mesma alteracao duas vezes');
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

test('relatório pagina atualizações completas e não inventa histórico legado',()=>{
  const db=fakeDB();
  configurarRoboInova(db);
  db.collection('inovaRoboConfiguracao').update('principal',{ultimaExecucao:sha});
  db.collection('inovaRoboExecucoes').insert({id:sha,status:'concluido',atualizados:2,blocos:1});
  const produtoA={produtoId:'p1',nome:'Álcool',codigoInterno:'1001',ean:'',estoqueAntes:15,estoqueDepois:14,
    precoAntesCentavos:500,precoDepoisCentavos:500};
  const produtoB={produtoId:'p2',nome:'Vitamina',codigoInterno:'1002',ean:'',estoqueAntes:7,estoqueDepois:7,
    precoAntesCentavos:800,precoDepoisCentavos:900};
  db.collection('inovaRoboBlocos').insert({id:sha+':0',aplicadoEm:new Date().toISOString(),
    alteracoes:[produtoB,produtoA]});
  const p1=consultarAlteracoesUltimoRoboInova(db,{pagina:1,porPagina:1});
  assert.equal(p1.disponivel,true);assert.equal(p1.total,2);
  assert.equal(p1.paginas,2);assert.deepEqual(p1.itens,[produtoA]);
  const p2=consultarAlteracoesUltimoRoboInova(db,{pagina:2,porPagina:1});
  assert.deepEqual(p2.itens,[produtoB]);
  assert.equal(consultarAlteracoesUltimoRoboInova(db,{pagina:99,porPagina:1}).pagina,2);
  db.collection('inovaRoboBlocos').update(sha+':0',{alteracoes:undefined});
  const antigo=consultarAlteracoesUltimoRoboInova(db);
  assert.equal(antigo.disponivel,false);
  assert.equal(antigo.motivo,'sem_historico');
  db.collection('inovaRoboBlocos').update(sha+':0',{alteracoes:[produtoA]});
  assert.equal(consultarAlteracoesUltimoRoboInova(db).motivo,'divergencia');
});

test('salva apenas atualizações reais, incluindo mudança só de estoque ou só de preço',()=>{
  const db=fakeDB();configurarRoboInova(db);
  for(const [id,preco,qtd] of [['800001',1525,9],['800002',2000,2],['800003',1525,2]]){
    db.collection('products').insert({
      id:'produto-'+id,codigoInterno:id,ean:String(7891000000000+Number(id)-800000),
      nome:'Teste '+id,precoCentavos:preco,ativo:true,
      estoque:{quantidade:qtd,reservado:0,quarentena:0},
    });
  }
  const itens=arquivo();
  itens[0].quantidade=8; // Muda apenas quantidade.
  itens[1].quantidade=2; // Muda apenas preço.
  itens[2].quantidade=2; // Sem mudança.
  enviarTudo(db,itens);
  const r=aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0});
  assert.equal(r.ok,true);assert.equal(r.atualizados,2);
  const a=db.collection('inovaRoboBlocos').get(sha+':0').alteracoes;
  assert.equal(a.length,2);assert.deepEqual(a.map(v=>v.codigoInterno),['800001','800002']);
  assert.deepEqual([a[0].estoqueAntes,a[0].estoqueDepois,a[0].precoAntesCentavos,a[0].precoDepoisCentavos],
    [9,8,1525,1525]);
  assert.deepEqual([a[1].estoqueAntes,a[1].estoqueDepois,a[1].precoAntesCentavos,a[1].precoDepoisCentavos],
    [2,2,2000,1525]);
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
  assert.match(route,/formatDateTime\(ultimo\.geradoEm\)/);
  assert.match(route,/formatDateTime\(ultimo\.concluidoEm \|\| ultimo\.iniciadoEm\)/);
  assert.match(route,/horário de Brasília/);
  assert.match(route,/blocoProdutosAtualizados\(ultimo,req\)/);
  assert.match(route,/formatBRL\(p\.precoAntesCentavos\/100\)/);
  const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(source,/registrarRotasRoboInova\(app, db\)/);
});


test('V3: atualiza no mesmo bloco saldo, preço normal e promoção interna; mantém campanhas/manuais',()=>{
  const db=fakeDB();configurarRoboInova(db);
  db.collection('products').insert({
    id:'aptamil',codigoInterno:'800001',ean:'7891000000001',
    nome:'Aptamil',precoCentavos:8490,precoPromocionalCentavos:6990,
    precoInternoInovaCentavos:7390,
    inovaPromocoes:[{inicio:'2026-11-01',fim:'2026-11-30',
      precoVendaCentavos:8490,precoPromocionalCentavos:6490}],
    ativo:true,imagens:['nao-alterar.png'],estoque:{quantidade:21,reservado:0,quarentena:0}
  });
  const itens=arquivo();itens[0].quantidade=18;
  itens[0].precoCentavos=8990;itens[0].precoPromocionalCentavos=7790;
  enviarTudo(db,itens);
  const antes=db.collection('products').get('aptamil');
  assert.equal(antes.precoInternoInovaCentavos,7390);
  assert.equal(antes.estoque.quantidade,21);
  const aplicado=aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0});
  assert.equal(aplicado.ok,true);
  const produto=db.collection('products').get('aptamil');
  assert.equal(produto.estoque.quantidade,18);
  assert.equal(produto.precoCentavos,8990);
  assert.equal(produto.precoInternoInovaCentavos,7790);
  assert.equal(produto.precoPromocionalCentavos,6990);
  assert.deepEqual(produto.imagens,['nao-alterar.png']);
  assert.equal(produto.ativo,true);
  assert.equal(produto.inovaPromocoes[0].precoPromocionalCentavos,6490);
  const alteracoes=consultarAlteracoesUltimoRoboInova(db);
  // Outros blocos ainda não aplicados: relatório completo ainda não disponível.
  assert.equal(alteracoes.disponivel,false);
});

test('V3: promoção zero remove desconto interno, mas CSV antigo sem campo não altera promoção',()=>{
  const db=fakeDB();configurarRoboInova(db);
  db.collection('products').insert({
    id:'test1',codigoInterno:'800001',ean:'7891000000001',
    nome:'Produto',precoCentavos:1525,precoInternoInovaCentavos:1000,
    precoPromocionalCentavos:0,ativo:true,
    estoque:{quantidade:2,reservado:0,quarentena:0}
  });
  const itens=arquivo();itens[0].precoPromocionalCentavos=0;
  enviarTudo(db,itens);
  const r=aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0});
  assert.equal(r.ok,true);
  assert.equal(db.collection('products').get('test1').precoInternoInovaCentavos,0);
  assert.equal(db.collection('products').get('test1').estoque.quantidade,2);
  const db2=fakeDB();configurarRoboInova(db2);
  db2.collection('products').insert({
    id:'test2',codigoInterno:'800001',ean:'7891000000001',
    nome:'Produto',precoCentavos:1525,precoInternoInovaCentavos:1000,
    precoPromocionalCentavos:0,ativo:true,
    estoque:{quantidade:2,reservado:0,quarentena:0}
  });
  enviarTudo(db2,arquivo());
  assert.equal(aplicarBlocoRoboInova(db2,{arquivoHash:sha,bloco:0}).ok,true);
  assert.equal(db2.collection('products').get('test2').precoInternoInovaCentavos,1000);
});

test('V3: desconto inválido é rejeitado antes de gravar lote ou alterar catálogo',()=>{
  const db=fakeDB();configurarRoboInova(db);
  const itens=arquivo();itens[0].precoPromocionalCentavos=2000;
  const r=receberBlocoRoboInova(db,{arquivoHash:sha,geradoEm:'2026-10-24T19:38:56-03:00',
    total:3000,blocos:15,bloco:0,itens:itens.slice(0,200)});
  assert.equal(r.ok,false);
  assert.equal(r.status,422);
  assert.equal(db.collection('inovaRoboExecucoes').count(),0);
});


test('robô V3: preço promocional válido superior a 80% de desconto não bloqueia lote',()=>{
  const db=fakeDB();configurarRoboInova(db);
  const itens=arquivo();
  itens[0].precoPromocionalCentavos=100;
  enviarTudo(db,itens);
  assert.equal(aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0}).ok,true);
  const novo=db.collection('products').all().find(p=>p.codigoInterno==='800001');
  assert.equal(novo.precoInternoInovaCentavos,100);
  assert.equal(novo.ativo,false,'um produto novo continua inativo');
});


test('preço fixo do site impede reprecificação V3 sem bloquear atualização de estoque',()=>{
  const db=fakeDB();configurarRoboInova(db);
  db.collection('products').insert({
    id:'fixado',codigoInterno:'800001',ean:'7891000000001',nome:'Preço especial no site',
    precoCentavos:1000,precoPromocionalCentavos:800,
    precoInternoInovaCentavos:900,precoFixoSite:true,
    ativo:true,estoque:{quantidade:6,reservado:0,quarentena:0},
  });
  db.collection('products').insert({
    id:'fixado-sem-saldo',codigoInterno:'800002',ean:'7891000000002',
    nome:'Outro preço protegido',precoCentavos:1000,precoFixoSite:true,
    ativo:true,estoque:{quantidade:2,reservado:0,quarentena:0},
  });
  const itens=arquivo();itens[0].quantidade=4;
  itens[0].precoCentavos=1600;itens[0].precoPromocionalCentavos=1200;
  itens[1].precoCentavos=1800;itens[1].precoPromocionalCentavos=1500;
  enviarTudo(db,itens);
  const resultado=aplicarBlocoRoboInova(db,{arquivoHash:sha,bloco:0});
  assert.equal(resultado.ok,true,JSON.stringify(resultado));
  const fixado=db.collection('products').get('fixado');
  assert.equal(fixado.estoque.quantidade,4);
  assert.equal(fixado.precoCentavos,1000);
  assert.equal(fixado.precoInternoInovaCentavos,900);
  assert.equal(fixado.precoPromocionalCentavos,800);
  assert.equal(fixado.precoFixoSite,true);
  const semSaldo=db.collection('products').get('fixado-sem-saldo');
  assert.equal(semSaldo.estoque.quantidade,2);
  assert.equal(semSaldo.precoCentavos,1000);
  assert.equal(semSaldo.precoInternoInovaCentavos,undefined);
  const alteracoes=db.collection('inovaRoboBlocos').get(sha+':0').alteracoes;
  assert.equal(alteracoes.length,1);
  assert.deepEqual([alteracoes[0].estoqueAntes,alteracoes[0].estoqueDepois,
    alteracoes[0].precoAntesCentavos,alteracoes[0].precoDepoisCentavos],
    [6,4,1000,1000]);
});
