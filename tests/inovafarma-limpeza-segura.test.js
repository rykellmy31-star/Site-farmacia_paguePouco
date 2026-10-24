import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  lerIdentidadesInovaParaLimpeza, prepararLimpezaInova, consultarLimpezaInova,
  aplicarLimpezaInova, restaurarProdutoArquivado,
} from '../src/lib/inovafarma-limpeza-segura.js';
import { telaPreviaLimpezaInova } from '../src/views/admin/limpeza-catalogo-inova.js';
import { telaProdutos } from '../src/views/admin/catalogo.js';

function csv(qtd = 6128) {
  const linhas=['Código;Cód. Barra;Produto;Estoque;Preço Venda'];
  for(let i=1;i<=qtd;i++)linhas.push([String(800000+i),i%40===0 ? '' : String(7891000000000+i),
    'Produto Inova ' + i, i%53===0 ? '-2' : '4', '20,00'].join(';'));
  return Buffer.from(linhas.join('\r\n'), 'utf8');
}
function dbTeste(produtos, pedidos=[],carts=[]) {
  const dados=new Map(Object.entries({
    products:produtos.map(p=>({...p})),
    orders:pedidos.map(p=>({...p})),
    carts:carts.map(p=>({...p})),
    inovaLimpezaPrevias:[],
  }));
  let id=0;
  const db={
    collections:new Map(),
    storage:{transactionSync: fn=>fn()},
    collection(name){
      if(!dados.has(name))dados.set(name,[]);
      return {
        all:()=>dados.get(name),
        get:(id)=>dados.get(name).find(x=>String(x.id)===String(id))||null,
        insert:(p)=>{
          const doc={...p,id:p.id||'auto_'+(++id)};
          dados.get(name).push(doc);return doc;
        },
        update:(id,patch)=>{
          const row=dados.get(name).find(x=>String(x.id)===String(id));
          if(!row)return null;
          Object.assign(row,patch);return row;
        },
        remove:()=>{throw new Error('Não pode remover produto na limpeza');},
      };
    },
  };
  return {db,dados};
}
const ctx={
  adminUser:{id:'super',nome:'Super',role:'super_admin'},
  settings:{empresa:{nomeFantasia:'Pague Pouco'},tema:{}},
  csrf:'CSRF_TESTE',req:{pathname:'/admin/estoque/importar',query:new URLSearchParams()},
  db:{collection:()=>({get:()=>null})},
};
test('CSV integral aceita estoque negativo e produtos sem EAN identificados pelo código interno',()=>{
  const origem=lerIdentidadesInovaParaLimpeza(csv());
  assert.equal(origem.estatisticas.total,6128);
  assert.equal(origem.estatisticas.coberturaCompleta,true);
  assert.equal(origem.itens[39].ean,'');
  assert.equal(origem.itens[39].codigoInterno,'800040');
});
test('CSV parcial de 6062 linhas nunca habilita limpeza em massa',()=>{
  const origem=lerIdentidadesInovaParaLimpeza(csv(6062));
  assert.equal(origem.estatisticas.coberturaCompleta,false);
  const {db}=dbTeste([{id:'legado',ean:'7899999999999',ativo:true}]);
  const previa=prepararLimpezaInova(db,csv(6062),'admin');
  assert.equal(previa.habilitado,false);
  assert.equal(aplicarLimpezaInova(db,previa.id,'admin',{
    frase:'LIMPAR PRODUTOS ANTIGOS',conferido:'1'
  }).ok,false);
});
test('só arquiva produto ausente do Inova, com confirmação e mantendo pedidos, carrinhos e reservas',()=>{
  const {db}=dbTeste([
    {id:'inova',ean:'7891000000001',codigoInterno:'800001',ativo:true,estoque:{}},
    {id:'interno',ean:'',codigoInterno:'800040',ativo:true,estoque:{}},
    {id:'antigo',ean:'7899999999999',codigoInterno:'LEGADO',ativo:true,estoque:{}},
    {id:'com_pedido',ean:'7899999999998',ativo:true,estoque:{}},
    {id:'com_reserva',ean:'7899999999997',ativo:true,estoque:{reservado:2}},
    {id:'no_carrinho',ean:'7899999999996',ativo:true,estoque:{}},
  ],[{id:'pedido1',itens:[{produtoId:'com_pedido'}]}],
  [{id:'c1',itens:[{produtoId:'no_carrinho'}]}]);
  const previa=prepararLimpezaInova(db,csv(),'super');
  assert.equal(previa.habilitado,true);
  assert.deepEqual(previa.elegiveis.map(i=>i.id),['antigo']);
  assert.equal(previa.emCarrinhos.length,1);
  assert.equal(aplicarLimpezaInova(db,previa.id,'super',{
    frase:'CONFIRMO',conferido:'1'
  }).status,400);
  assert.equal(db.collection('products').get('antigo').ativo,true);
  assert.equal(aplicarLimpezaInova(db,previa.id,'outro',{
    frase:'LIMPAR PRODUTOS ANTIGOS',conferido:'1'
  }).status,404);
  const resultado=aplicarLimpezaInova(db,previa.id,'super',{
    frase:'LIMPAR PRODUTOS ANTIGOS',conferido:'1'
  });
  assert.equal(resultado.ok,true);
  assert.equal(resultado.arquivados,1);
  assert.equal(db.collection('products').get('antigo').ativo,false);
  assert.equal(db.collection('products').get('antigo').inovaArquivado.ativoAnterior,true);
  for(const id of ['inova','interno','com_pedido','com_reserva','no_carrinho'])
    assert.equal(db.collection('products').get(id).ativo,true);
  assert.equal(aplicarLimpezaInova(db,previa.id,'super',{
    frase:'LIMPAR PRODUTOS ANTIGOS',conferido:'1'
  }).status,409);
  const r=restaurarProdutoArquivado(db,'antigo');
  assert.equal(r.ok,true);
  assert.equal(db.collection('products').get('antigo').ativo,false);
  assert.equal(db.collection('products').get('antigo').inovaArquivado,null);
});
test('alteração de catálogo após prévia impede arquivamento',()=>{
  const {db}=dbTeste([{id:'antigo',ean:'7899999999999',ativo:true,estoque:{}}]);
  const previa=prepararLimpezaInova(db,csv(),'admin');
  db.collection('products').update('antigo',{ean:'7891000000001'});
  assert.equal(consultarLimpezaInova(db,previa.id,'admin').inalterado,false);
  assert.equal(aplicarLimpezaInova(db,previa.id,'admin',{
    frase:'LIMPAR PRODUTOS ANTIGOS',conferido:'1'
  }).status,409);
  assert.equal(db.collection('products').get('antigo').ativo,true);
});
test('botão habilitado somente após relatório completo e confirmação',()=>{
  const {db}=dbTeste([{id:'antigo',ean:'7899999999999',ativo:true,estoque:{}}]);
  const previa=prepararLimpezaInova(db,csv(),'super');
  const html=telaPreviaLimpezaInova(ctx,{
    ...previa.previa,id:previa.id,fonte:previa.fonte,
    habilitado:previa.habilitado,inalterado:true,
    elegiveis:previa.elegiveis,emCarrinhos:previa.emCarrinhos,
  });
  assert.match(html,/Limpar produtos antigos/);
  assert.match(html,/action="\/admin\/estoque\/limpeza\/aplicar"/);
  assert.match(html,/name="_csrf" value="CSRF_TESTE"/);
  assert.match(html,/LIMPAR PRODUTOS ANTIGOS/);
  const invalido=prepararLimpezaInova(db,csv(6062),'super');
  const html2=telaPreviaLimpezaInova(ctx,{
    ...invalido.previa,id:invalido.id,fonte:invalido.fonte,
    habilitado:invalido.habilitado,inalterado:true,
    elegiveis:invalido.elegiveis,emCarrinhos:invalido.emCarrinhos,
  });
  assert.doesNotMatch(html2,/action="\/admin\/estoque\/limpeza\/aplicar"/);
  assert.match(html2,/Limpeza bloqueada/);
});
test('rota de exclusão normal não permite excluir produto arquivado',()=>{
  const source=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(source,/p\.inovaArquivado\?\.em/);
  assert.match(source,/Restaure o produto arquivado antes de ativá-lo/);
  assert.match(source,/Limpeza restrita ao Super Administrador/);
  assert.match(source,/guard\(req, res, 'produtos.excluir'\)/);
  const page=readFileSync(new URL('../src/routes/public.js',import.meta.url),'utf8');
  assert.match(page,/produto\.inovaArquivado\?\.em/);
});
