import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  lerCatalogoNovoInova, prepararSubstituicaoCatalogoInova,
  consultarSubstituicaoCatalogoInova, identificarBloqueiosSubstituicaoInova,
  aplicarSubstituicaoCatalogoInova,
  ErroSubstituicaoInova,
} from '../src/lib/inovafarma-catalogo-substituicao.js';
import {
  telaSubstituirCatalogoInova, telaRevisaoSubstituirCatalogoInova, telaPendenciasSubstituicaoInova
} from '../src/views/admin/substituir-catalogo-inova.js';

const now=new Date('2026-10-24T19:00:00Z');
const filename='Codigo Interno;EAN;Descricao;Quantidade;Preco de Venda;Marca;Pendencia;Estoque Original';
function csv(qtd=6128) {
  const rows=[filename];
  for(let i=1;i<=qtd;i++){
    const code=String(800000+i);
    const semEAN=i===3||i===4;
    const negative=i===5;
    const note=negative?'Estoque negativo no ERP — ajustar':i===4?'EAN inválido no ERP — conferir':'';
    rows.push([
      code,semEAN?'':String(7891000000000+i),
      'Produto exclusivo Inova '+i,negative?'0':String(i%6),
      '20,50',i===2?'LABORATÓRIO EXEMPLO':'',note,negative?'-2':String(i%6)
    ].join(';'));
  }
  return Buffer.from('\uFEFF'+rows.join('\r\n'),'utf8');
}
function criarDB({pedidos=[],reservas=0,carrinhos=true}={}){
  let id=0;
  const dados=new Map(Object.entries({
    products:[
      {id:'antigo_001',codigoInterno:'800001',ean:'7891000000001',
        nome:'Produto antigo reaproveitado anteriormente',slug:'produto-antigo',
        ativo:true,precoCentavos:1777,estoque:{quantidade:9,reservado:reservas}},
      {id:'antigo_002',codigoInterno:'999998',ean:'7899999999999',
        nome:'Produto inventado antes do Inova',slug:'catalogo-velho',ativo:true,
        precoCentavos:1000,estoque:{quantidade:0,reservado:0}},
    ],
    orders:pedidos,
    carts:carrinhos?[{id:'cart01',itens:[{produtoId:'antigo_001',quantidade:1}]}]:[],
    showcases:[{id:'showcase_01',produtosIds:['antigo_001']}],
    inovaCatalogoSubstituicoes:[],
    inovaCatalogoSubstituicaoPartes:[],
    inovaCatalogoHistorico:[],
  }));
  const col=name=>{
    if(!dados.has(name))dados.set(name,[]);
    return {
      all:()=>dados.get(name).slice(),
      count:fn=>fn?dados.get(name).filter(fn).length: dados.get(name).length,
      get:(key)=>dados.get(name).find(p=>String(p.id)===String(key))||null,
      insert:doc=>{
        const added={...doc};
        if(!added.id)added.id='teste_id_'+(++id);
        dados.get(name).push(added);
        return added;
      },
      remove:key=>{
        const list=dados.get(name),index=list.findIndex(p=>String(p.id)===String(key));
        if(index<0)return false;
        list.splice(index,1);return true;
      },
      update:(key,patch)=>{
        const p=dados.get(name).find(p=>String(p.id)===String(key));
        if(!p)return null;
        Object.assign(p,patch);return p;
      },
      updateMany:(pred,fn)=>{
        let count=0;
        for(const p of dados.get(name))if(pred(p)){Object.assign(p,fn(p));count++;}
        return count;
      },
    };
  };
  const db={
    collections:new Map(),
    storage:{
      transactionSync(fn){
        const antigo=structuredClone([...dados.entries()]);
        try{return fn();}
        catch(e){
          dados.clear();
          for(const [k,v] of antigo)dados.set(k,v);
          throw e;
        }
      }
    },
    collection:col,
  };
  return {db,dados};
}
function pedidoEncerrado(){
  return {id:'pedido_anterior',statusFinanceiro:'aprovado',
    statusOperacional:'entregue',itens:[
      {produtoId:'antigo_001',nome:'Produto que não será reaproveitado',
       precoUnitarioCentavos:1777}],totalCentavos:1777,
    atualizadoEm:'2026-10-23T18:00:00Z'};
}
test('CSV completo aceita 6128 SKUs, sem EAN e estoque negativo neutralizado',()=>{
  const r=lerCatalogoNovoInova(csv());
  assert.equal(r.resumo.importar,6128);
  assert.equal(r.resumo.semEAN,2);
  assert.equal(r.resumo.estoqueNegativo,1);
  assert.equal(r.itens[0].precoCentavos,2050);
  assert.equal(r.itens[4].quantidade,0);
  assert.equal(r.itens[4].estoqueOriginal,-2);
  assert.equal(r.itens[1].marca,'LABORATÓRIO EXEMPLO');
  assert.equal(r.itens[2].ean,'');
});
test('arquivo parcial, duplicidade interna e preço inválido nunca habilitam troca',()=>{
  assert.throws(()=>lerCatalogoNovoInova(csv(6062)),/catálogo integral/);
  const content=csv().toString('utf8').replace(
    '800002;7891000000002;','800001;7891000000002;');
  assert.throws(()=>lerCatalogoNovoInova(Buffer.from(content)),/repetido/);
  const broken=csv().toString('utf8').replace(
    '800001;7891000000001;Produto exclusivo Inova 1;1;20,50;',
    '800001;7891000000001;Produto exclusivo Inova 1;1;-20,50;'
  );
  assert.throws(()=>lerCatalogoNovoInova(Buffer.from(broken)),/Preço de venda inválido/);
});
test('preparar só grava prévia privada, sem remover ou aproveitar cadastros',()=>{
  const {db}=criarDB({pedidos:[pedidoEncerrado()]});
  const p=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  assert.equal(p.ok,true);
  assert.equal(p.resumo.importar,6128);
  assert.equal(p.resumo.remover,2);
  assert.equal(p.resumo.bloqueado,false);
  assert.equal(db.collection('products').count(),2);
  assert.equal(db.collection('products').get('antigo_001').ativo,true);
  const v=consultarSubstituicaoCatalogoInova(db,p.id,'super',now);
  assert.equal(v.pronto,true);
  assert.throws(()=>consultarSubstituicaoCatalogoInova(db,p.id,'intruso',now),/não encontrada/);
});
test('sem checkbox do backup/confirmacão explícita, a coleção permanece intacta',()=>{
  const {db}=criarDB({pedidos:[pedidoEncerrado()]});
  const p=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  assert.throws(()=>aplicarSubstituicaoCatalogoInova(db,p.id,'super',{
    frase:'SUBSTITUIR TODO O CATALOGO',autorizou:'1',backupConfirmado:'0'
  },now),/Confirme a cópia de segurança/);
  assert.equal(db.collection('products').count(),2);
  assert.equal(db.collection('inovaCatalogoHistorico').count(),0);
});
test('reset integral produz somente IDs novos, arquiva antigos e preserva pedidos',()=>{
  const pedido=pedidoEncerrado();
  const {db}=criarDB({pedidos:[pedido]});
  const p=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  const aplicado=aplicarSubstituicaoCatalogoInova(db,p.id,'super',{
    frase:'SUBSTITUIR TODO O CATALOGO',autorizou:'1',backupConfirmado:'1'
  },now);
  assert.equal(aplicado.ok,true);
  assert.equal(aplicado.antigosArquivados,2);
  assert.equal(aplicado.criados,6128);
  assert.equal(aplicado.carrinhosLimpos,1);
  const col=db.collection('products');
  assert.equal(col.count(),6128);
  assert.equal(col.get('antigo_001'),null);
  assert.equal(col.get('antigo_002'),null);
  assert.equal(col.find?.(()=>true),undefined); // mock only, no further assumptions
  assert.equal(col.all().every(x=>x.id.startsWith('inova_novo_')),true);
  assert.equal(col.all().every(x=>x.ativo===false),true);
  assert.equal(col.all().every(x=>!x.imagens.length),true);
  assert.equal(col.all().every(x=>x.precoPromocionalCentavos===0),true);
  assert.equal(col.all().every(x=>x.sanitario.aprovadoFarmaceutico===false),true);
  assert.equal(col.all().every(x=>x.sanitario.requerReceita===false),true);
  assert.equal(col.all().every(x=>x.inovaCatalogo.revisaoSanitariaPendente===true),true);
  const primeiro=col.all().find(p=>p.codigoInterno==='800001');
  assert.notEqual(primeiro?.id,'antigo_001');
  assert.equal(primeiro.precoCentavos,2050);
  assert.equal(db.collection('inovaCatalogoHistorico').count(),2);
  assert.equal(db.collection('inovaCatalogoHistorico').get(p.id+'__antigo_001')
    .produto.nome,'Produto antigo reaproveitado anteriormente');
  assert.equal(db.collection('orders').get('pedido_anterior').totalCentavos,1777);
  assert.equal(db.collection('orders').get('pedido_anterior').itens[0].produtoId,'antigo_001');
  assert.deepEqual(db.collection('carts').get('cart01').itens,[]);
  assert.deepEqual(db.collection('showcases').get('showcase_01').produtosIds,[]);
  assert.throws(()=>aplicarSubstituicaoCatalogoInova(db,p.id,'super',{
    frase:'SUBSTITUIR TODO O CATALOGO',autorizou:'1',backupConfirmado:'1'
  },now),/já foi executada/);
});
test('pedido Pix pendente ou reservas impedem a substituição',()=>{
  for(const options of [
    {pedidos:[{id:'p',statusFinanceiro:'pendente',
      statusOperacional:'aguardando_pagamento'}]},
    {reservas:1},
    {pedidos:[{id:'p',statusFinanceiro:'aprovado',statusOperacional:'enviado'}]},
    {pedidos:[{id:'p',statusFinanceiro:'estornado',
      statusOperacional:'devolucao_em_analise'}]},
  ]){
    const {db}=criarDB(options);
    const p=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
    assert.equal(p.resumo.bloqueado,true);
    assert.throws(()=>aplicarSubstituicaoCatalogoInova(db,p.id,'super',{
      frase:'SUBSTITUIR TODO O CATALOGO',autorizou:'1',backupConfirmado:'1'
    },now),/Há .* pedidos não encerrados ou .* reservas/);
    assert.equal(db.collection('products').count(),2);
  }
});
test('prévia bloqueada identifica pedido e produto exatos, sem expor dados de cliente',()=>{
  const pedido={id:'pedido_001',codigo:'PP2026000789',
    statusFinanceiro:'pendente',statusOperacional:'aguardando_pagamento',
    pendenciaPagamento:'criacao_em_andamento',
    cliente:{nome:'CLIENTE PRIVADO',email:'privado@exemplo.com'},
    itens:[{produtoId:'antigo_001',quantidade:1}],
    atualizadoEm:'2026-10-24T18:30:00Z'};
  const {db}=criarDB({pedidos:[pedido],reservas:2});
  db.collection('products').update('antigo_001',{nome:'<script>alert("x")</script>'});
  const qtdProdutos=db.collection('products').count();
  const pre=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  const consulta=consultarSubstituicaoCatalogoInova(db,pre.id,'super',now);
  assert.equal(consulta.pronto,false);
  assert.equal(consulta.resumo.pedidosAbertos,1);
  assert.equal(consulta.resumo.estoqueReservado,1);
  assert.equal(consulta.bloqueios.pedidos[0].codigo,'PP2026000789');
  assert.equal(consulta.bloqueios.pedidos[0].conferenciaPagamento,true);
  assert.equal(consulta.bloqueios.produtos[0].reservado,2);
  assert.equal(consulta.bloqueios.produtos[0].pedidosRelacionados[0].id,'pedido_001');
  assert.equal(db.collection('products').count(),qtdProdutos);
  assert.equal(db.collection('orders').get('pedido_001').statusFinanceiro,'pendente');
  const ctx={
    adminUser:{role:'super_admin',nome:'Super'},csrf:'CSRF_TESTE',
    settings:{empresa:{nomeFantasia:'Farmácia'},tema:{}},
    req:{pathname:'/admin/produtos/substituir-catalogo',query:new URLSearchParams()},
  };
  const html=telaRevisaoSubstituirCatalogoInova(ctx,consulta);
  assert.match(html,/PP2026000789/);
  assert.match(html,/href="\/admin\/pedidos\/pedido_001"/);
  assert.match(html,/href="\/admin\/produtos\/antigo_001"/);
  assert.match(html,/Confira a cobrança no Mercado Pago antes de cancelar/);
  assert.match(html,/Quarentena/);
  assert.doesNotMatch(html,/CLIENTE PRIVADO/);
  assert.doesNotMatch(html,/privado@exemplo.com/);
  assert.doesNotMatch(html,/<script>alert\("x"\)<\/script>/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/action="\/admin\/estoque\/substituicao\/aplicar"/);
});

test('produto em quarentena sem pedido é exibido para conciliação, não zerado',()=>{
  const {db}=criarDB({pedidos:[pedidoEncerrado()],carrinhos:false});
  const p=db.collection('products').get('antigo_002');
  db.collection('products').update(p.id,{estoque:{quantidade:3,quarentena:3,reservado:0,inovaPendente:0}});
  const antes=identificarBloqueiosSubstituicaoInova(db);
  assert.equal(antes.pedidos.length,0);
  assert.equal(antes.produtos.length,1);
  assert.equal(antes.produtos[0].quarentena,3);
  assert.equal(antes.produtos[0].pedidosRelacionados.length,0);
  const pre=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  const consulta=consultarSubstituicaoCatalogoInova(db,pre.id,'super',now);
  assert.equal(consulta.pronto,false);
  assert.equal(db.collection('products').get(p.id).estoque.quarentena,3);
});

test('falha depois de remover antigos causa rollback completo sem catálogo parcial',()=>{
  const {db}=criarDB({pedidos:[pedidoEncerrado()]});
  const pre=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  const orig=db.collection.bind(db);
  let count=0;
  db.collection=(name)=>{
    const col=orig(name);
    if(name!=='products')return col;
    const insert=col.insert;
    col.insert=(documento)=>{
      if(String(documento.id).startsWith('inova_novo_') && ++count===900)
        throw new Error('falha simulada durante a importação');
      return insert(documento);
    };
    return col;
  };
  assert.throws(()=>aplicarSubstituicaoCatalogoInova(db,pre.id,'super',{
    frase:'SUBSTITUIR TODO O CATALOGO',autorizou:'1',backupConfirmado:'1'
  },now),/transação revertida/);
  assert.equal(db.collection('products').count(),2);
  assert.equal(db.collection('products').get('antigo_001').ativo,true);
  assert.equal(db.collection('inovaCatalogoHistorico').count(),0);
  assert.equal(db.collection('inovaCatalogoSubstituicoes').get(pre.id).aplicadoEm,null);
  assert.equal(db.collection('orders').count(),1);
});

test('mudança de produto ou carrinho invalida prévia; carrinho vazio novo não invalida',()=>{
  const {db}=criarDB({pedidos:[pedidoEncerrado()]});
  const p=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  db.collection('carts').insert({id:'cart_vazio',itens:[]});
  assert.equal(consultarSubstituicaoCatalogoInova(db,p.id,'super',now).pronto,true);
  db.collection('products').update('antigo_001',{precoCentavos:9999});
  assert.throws(()=>consultarSubstituicaoCatalogoInova(db,p.id,'super',now),
    /Produtos, carrinhos ou pedidos mudaram/);
  assert.equal(db.collection('products').count(),2);
});
test('prévia expirada e ambiente sem transação bloqueiam execução',()=>{
  const {db}=criarDB({pedidos:[pedidoEncerrado()]});
  const p=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  assert.throws(()=>consultarSubstituicaoCatalogoInova(db,p.id,'super',
    new Date(now.getTime()+21*60000)),/expirada/);
  db.storage={};
  assert.throws(()=>aplicarSubstituicaoCatalogoInova(db,p.id,'super',{
    frase:'SUBSTITUIR TODO O CATALOGO',autorizou:'1',backupConfirmado:'1'
  },now),/transação atômica/);
});
test('revisão e rotas exigem Superadmin, CSRF e confirmação do backup',()=>{
  const ctx={
    adminUser:{role:'super_admin',nome:'Super'},
    csrf:'CSRF_TESTE',settings:{empresa:{nomeFantasia:'Farmácia'},tema:{}},
    req:{pathname:'/admin/produtos/substituir-catalogo',query:new URLSearchParams()},
  };
  const html=telaSubstituirCatalogoInova(ctx);
  assert.match(html,/action="\/admin\/estoque\/substituicao\/preparar"/);
  assert.match(html,/name="_csrf" value="CSRF_TESTE"/);
  assert.match(html,/não reaproveita/i);
  const {db}=criarDB({pedidos:[pedidoEncerrado()]});
  const prev=prepararSubstituicaoCatalogoInova(db,csv(),'super',now);
  const review=telaRevisaoSubstituirCatalogoInova(ctx,{
    ...prev,resumo:prev.resumo,
  });
  assert.match(review,/action="\/admin\/estoque\/substituicao\/aplicar"/);
  assert.match(review,/name="backupConfirmado" value="1"/);
  assert.match(review,/SUBSTITUIR TODO O CATALOGO/);
  const source=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(source,/app\.post\('\/admin\/estoque\/substituicao\/aplicar'/);
  assert.match(source,/role!=='super_admin'/);
  assert.match(source,/guard\(req,res,'produtos.excluir'\)/);
});


test('diagnóstico independente de CSV mostra pedido e produto sem alterar financeiro/estoque',()=>{
  const pedido={id:'pedido_vinculado',codigo:'PP2026000099',
    statusFinanceiro:'pendente',statusOperacional:'aguardando_pagamento',
    pendenciaPagamento:'conciliacao_necessaria',itens:[{produtoId:'antigo_001'}],
    cliente:{nome:'Cliente que não deve aparecer',email:'segredo@teste.com'}};
  const {db}=criarDB({pedidos:[pedido],reservas:3});
  const anterior=structuredClone(db.collection('products').all());
  const bloq=identificarBloqueiosSubstituicaoInova(db);
  assert.equal(bloq.pedidos.length,1);
  assert.equal(bloq.produtos.length,1);
  assert.equal(bloq.produtos[0].reservado,3);
  const ctx={adminUser:{role:'super_admin',nome:'Super'},
    csrf:'CSRF_TESTE',settings:{empresa:{nomeFantasia:'Farmácia'},tema:{}},
    req:{pathname:'/admin/produtos/substituir-catalogo/pendencias',query:new URLSearchParams()}};
  const html=telaPendenciasSubstituicaoInova(ctx,bloq);
  assert.match(html,/PP2026000099/);
  assert.match(html,/href="\/admin\/pedidos\/pedido_vinculado"/);
  assert.match(html,/href="\/admin\/produtos\/antigo_001"/);
  assert.match(html,/Consulta somente leitura/);
  assert.doesNotMatch(html,/Cliente que não deve aparecer|segredo@teste\.com/);
  assert.doesNotMatch(html,/action="\/admin\/estoque\/substituicao\/aplicar"/);
  assert.deepEqual(db.collection('products').all(),anterior);
  assert.equal(db.collection('orders').get('pedido_vinculado').statusFinanceiro,'pendente');
  const path=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const inicio=path.indexOf("app.get('/admin/produtos/substituir-catalogo/pendencias'");
  const fim=path.indexOf("app.get('/admin/produtos/substituir-catalogo'",inicio+20);
  assert(inicio>0&&fim>inicio);
  const bloco=path.slice(inicio,fim);
  assert.match(bloco,/guard\(req,res,'produtos.excluir'\)/);
  assert.match(bloco,/req.adminUser.role !== 'super_admin'/);
  assert.match(bloco,/identificarBloqueiosSubstituicaoInova\(db\)/);
  assert.doesNotMatch(bloco,/\.(update|remove|delete|insert)\(/);
});
test('diagnóstico sem bloqueios não pede CSV nem executa substituição',()=>{
  const {db}=criarDB({pedidos:[pedidoEncerrado()],carrinhos:false});
  const bloq=identificarBloqueiosSubstituicaoInova(db);
  const ctx={adminUser:{role:'super_admin',nome:'Super'},
    csrf:'CSRF_TESTE',settings:{empresa:{nomeFantasia:'Farmácia'},tema:{}},
    req:{pathname:'/admin/produtos/substituir-catalogo/pendencias',query:new URLSearchParams()}};
  const html=telaPendenciasSubstituicaoInova(ctx,bloq);
  assert.match(html,/Nenhum bloqueio operacional encontrado/);
  assert.doesNotMatch(html,/action="\/admin\/estoque\/substituicao\/aplicar"/);
});
test('reserva órfã aponta pedidos anteriores mesmo se estiverem encerrados',()=>{
  const antigo=pedidoEncerrado();
  antigo.codigo='PP2026000042';
  const {db}=criarDB({pedidos:[antigo],reservas:1,carrinhos:false});
  const bloq=identificarBloqueiosSubstituicaoInova(db);
  assert.equal(bloq.pedidos.length,0);
  assert.equal(bloq.produtos.length,1);
  assert.equal(bloq.produtos[0].pedidosRelacionados[0].codigo,'PP2026000042');
  assert.equal(bloq.produtos[0].pedidosRelacionados[0].operacional,'entregue');
});

