import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { podeVender, estoqueDisponivel } from '../src/lib/catalog.js';
import { prepararRelatorioEstoque, consultarRelatorioEstoque, aplicarRelatorioEstoque, interpretarPrecoVendaCentavos } from '../src/lib/inovafarma-csv-import.js';
import { readFileSync } from 'node:fs';

const EAN1='7891234567890',EAN2='7891234567891';
function criarDB(){
  const db={cols:new Map(),collection(name){
    if(!this.cols.has(name))this.cols.set(name,new Collection({_commit(){}},name));
    return this.cols.get(name);
  }};
  db.collection('products').insert({
    id:'existente',ean:EAN1,codigoInterno:'100',nome:'Produto original',
    precoCentavos:1500,ativo:true,imagens:[{url:'/img/original.png'}],
    sanitario:{classificacao:'nao_aplicavel',aprovadoFarmaceutico:true},
    estoque:{quantidade:9,reservado:0,quarentena:0,minimo:3},vendas:0,
  });
  return db;
}
const csv=(text)=>Buffer.from(text,'utf8');
const relatorio=(qt1=0,qt2=6)=>csv('Codigo de Barras;Descrição;Estoque Atual;Codigo Interno\n'
  + EAN1+';"Produto; importado";'+qt1+';100\n'
  + EAN2+';Produto novo;'+qt2+';101\n');
test('primeiro envio apenas prepara prévia, sem alterar estoque ou preço',()=>{
  const db=criarDB();
  const resposta=prepararRelatorioEstoque(db,relatorio(),{operadorId:'admin'});
  assert.equal(resposta.ok,true);
  assert.equal(resposta.resumo.novos,1);
  assert.equal(resposta.resumo.ajustes,1);
  assert.equal(resposta.resumo.esgotados,1);
  assert.equal(db.collection('products').count(),1);
  assert.equal(db.collection('products').get('existente').estoque.quantidade,9);
  assert.equal(db.collection('stockMovements').count(),0);
  const previa=consultarRelatorioEstoque(db,resposta.id,'admin');
  assert.equal(previa.plano[0].nome,'Produto; importado');
  assert.equal(consultarRelatorioEstoque(db,resposta.id,'outro').status,404);
});
test('confirmação aplica saldo absoluto, inclusive zero; cria produto INATIVO e idempotente',()=>{
  const db=criarDB(); const p=prepararRelatorioEstoque(db,relatorio(),{operadorId:'admin'});
  const a=aplicarRelatorioEstoque(db,p.id,'admin');
  assert.equal(a.ok,true);
  assert.equal(db.collection('products').count(),2);
  const antigo=db.collection('products').get('existente');
  assert.equal(antigo.estoque.quantidade,0);
  assert.equal(antigo.precoCentavos,1500);
  assert.equal(antigo.nome,'Produto original');
  assert.equal(antigo.imagens[0].url,'/img/original.png');
  assert.equal(estoqueDisponivel(antigo),0);
  assert.equal(podeVender(antigo).ok,false);
  const novo=db.collection('products').findOne(x=>x.ean===EAN2);
  assert.equal(novo.estoque.quantidade,6);
  assert.equal(novo.ativo,false);
  assert.equal(novo.sanitario.requerReceita,true);
  assert.equal(podeVender(novo).ok,false);
  assert.equal(db.collection('stockMovements').count(),2);
  assert.equal(aplicarRelatorioEstoque(db,p.id,'admin').status,409);
  assert.equal(db.collection('products').count(),2);
  assert.equal(db.collection('stockMovements').count(),2);
});
test('arquivo repetido em novo lote não soma quantidades',()=>{
  const db=criarDB(); let r=prepararRelatorioEstoque(db,relatorio(4,6),{operadorId:'admin'});
  assert.equal(aplicarRelatorioEstoque(db,r.id,'admin').ok,true);
  r=prepararRelatorioEstoque(db,relatorio(4,6),{operadorId:'admin'});
  assert.equal(r.resumo.ajustes,0);
  assert.equal(r.resumo.semAlteracao,2);
  assert.equal(aplicarRelatorioEstoque(db,r.id,'admin').ok,true);
  assert.equal(db.collection('stockMovements').count(),2);
  assert.equal(db.collection('products').get('existente').estoque.quantidade,4);
});
test('reserva não pode ser perdida nem receber ajuste inferior à reserva',()=>{
  const db=criarDB();
  db.collection('products').update('existente',{estoque:{quantidade:9,reservado:4,quarentena:0,minimo:3}});
  const r=prepararRelatorioEstoque(db,relatorio(0,6),{operadorId:'admin'});
  assert.equal(r.resumo.conflitos,1);
  assert.equal(aplicarRelatorioEstoque(db,r.id,'admin').status,409);
  assert.equal(db.collection('products').get('existente').estoque.quantidade,9);
  assert.equal(db.collection('products').count(),1);
});
test('EAN duplicado e falta de cabeçalhos são recusados integralmente',()=>{
  const db=criarDB();
  for(const csvBody of [
    'EAN,Descricao,Quantidade\n'+EAN1+',Primeiro,2\n'+EAN1+',Segundo,3',
    'Produto;Saldo\nExemplo;5',
    'EAN;Descricao;Quantidade\n'+EAN1+';Produto;3,5',
    'EAN;Descricao;Quantidade\n'+EAN1+';Produto;-1',
    'EAN;Descricao;Quantidade\n'+EAN1+';Produto;abc',
  ]){
    assert.equal(prepararRelatorioEstoque(db,csv(csvBody),{operadorId:'admin'}).ok,false);
  }
  assert.equal(db.collection('inovaCsvImportacoes').count(),0);
});
test('relatório não reconhecido por EAN não edita produtos pelo nome',()=>{
  const db=criarDB();
  const r=prepararRelatorioEstoque(db,csv('EAN;Descricao;Estoque\n7891234567892;Produto original;2'),{operadorId:'admin'});
  assert.equal(r.resumo.novos,1);
  assert.equal(aplicarRelatorioEstoque(db,r.id,'admin').ok,true);
  assert.equal(db.collection('products').get('existente').estoque.quantidade,9);
});
test('conflito de código interno impede aplicar qualquer linha',()=>{
  const db=criarDB();
  const r=prepararRelatorioEstoque(db,csv('EAN;Descricao;Estoque;Codigo interno\n'
    +EAN2+';Produto diferente;8;100'),{operadorId:'admin'});
  assert.equal(r.resumo.conflitos,1);
  assert.equal(aplicarRelatorioEstoque(db,r.id,'admin').status,409);
});
test('rotas de importação exigem superadmin, confirmação e CSRF global',()=>{
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const a=routes.indexOf("app.post('/admin/api/produtos/inova-csv/preparar'");
  const b=routes.indexOf("app.post('/admin/api/produtos/inova-csv/aplicar'");
  assert(a>=0&&b>a);
  assert.match(routes.slice(a,b),/super_admin/);
  assert.match(routes.slice(b,b+1100),/super_admin/);
  assert.match(routes.slice(b,b+1100),/req\.body\.confirmar/);
});


test('preço de venda em reais usa centavos exatos, sem arredondamento nem aceitar preços ambíguos',()=>{
  for(const [texto,esperado] of [
    ['R$ 12,90',1290],['12,90',1290],['31.90',3190],
    ['1.234,56',123456],['R$ 1.234,56',123456],['1.234',123400],
    ['10',1000],['2,5',250],
  ]) assert.equal(interpretarPrecoVendaCentavos(texto),esperado,texto);
  for(const invalido of ['','R$ 0,00','0','-4,99','abc','12,345','12.3.4','10,xx','1.2,3','1000001,00']) {
    assert.equal(interpretarPrecoVendaCentavos(invalido),null,invalido);
  }
});

test('prévia inclui nome, preço e saldo, mas não muda preços antes da confirmação',()=>{
  const db=criarDB();
  const file=csv('Código de barras;Descrição;Estoque atual;Preço de Venda;Código Interno\n'
    +EAN1+';Produto existente;8;R$ 19,90;100\n'
    +EAN2+';Produto novo;3;1.234,56;101\n');
  const r=prepararRelatorioEstoque(db,file,{operadorId:'admin'});
  assert.equal(r.ok,true);
  assert.equal(r.resumo.precosAtualizados,1);
  assert.equal(r.resumo.precosNovos,1);
  assert.equal(r.resumo.precosAusentes,0);
  const prev=consultarRelatorioEstoque(db,r.id,'admin');
  assert.equal(prev.plano[0].precoAnteriorCentavos,1500);
  assert.equal(prev.plano[0].precoCentavos,1990);
  assert.equal(prev.plano[0].alterarPreco,true);
  assert.equal(prev.plano[1].precoCentavos,123456);
  assert.equal(db.collection('products').get('existente').precoCentavos,1500);
  assert.equal(db.collection('stockMovements').count(),0);
  const apply=aplicarRelatorioEstoque(db,r.id,'admin');
  assert.equal(apply.ok,true);
  assert.equal(db.collection('products').get('existente').precoCentavos,1990);
  const novo=db.collection('products').findOne(p=>p.ean===EAN2);
  assert.equal(novo.precoCentavos,123456);
  assert.equal(novo.estoque.quantidade,3);
  assert.equal(novo.ativo,false);
  assert.equal(novo.imagens.length,0);
  assert.equal(novo.sanitario.requerReceita,true);
  assert.equal(db.collection('products').get('existente').imagens[0].url,'/img/original.png');
  assert.equal(aplicarRelatorioEstoque(db,r.id,'admin').status,409);
  const after=consultarRelatorioEstoque(db,r.id,'admin');
  assert.equal(after.aplicado,true);
  assert.equal(after.resumo.precosAtualizados,1);
});

test('preço altera mesmo se estoque já estiver igual; reaplicar mesmo relatório não duplica ações',()=>{
  const db=criarDB();
  const file=csv('ean;nome;quantidade;preco venda\n'
    + EAN1+';Produto original;9;15,50\n');
  const a=prepararRelatorioEstoque(db,file,{operadorId:'admin'});
  assert.equal(a.ok,true);
  assert.equal(a.resumo.ajustes,0);
  assert.equal(a.resumo.semAlteracao,1);
  assert.equal(a.resumo.precosAtualizados,1);
  assert.equal(aplicarRelatorioEstoque(db,a.id,'admin').ok,true);
  assert.equal(db.collection('products').get('existente').precoCentavos,1550);
  assert.equal(db.collection('stockMovements').count(),0);
  const b=prepararRelatorioEstoque(db,file,{operadorId:'admin'});
  assert.equal(b.resumo.precosAtualizados,0);
  assert.equal(aplicarRelatorioEstoque(db,b.id,'admin').ok,true);
  assert.equal(db.collection('products').get('existente').precoCentavos,1550);
  assert.equal(db.collection('stockMovements').count(),0);
});

test('sem coluna de preço conserva o preço existente e deixa novos produtos inativos sem valor',()=>{
  const db=criarDB();
  const r=prepararRelatorioEstoque(db,relatorio(7,4),{operadorId:'admin'});
  assert.equal(r.resumo.precosAusentes,2);
  assert.equal(r.resumo.precosAtualizados,0);
  assert.equal(aplicarRelatorioEstoque(db,r.id,'admin').ok,true);
  assert.equal(db.collection('products').get('existente').precoCentavos,1500);
  assert.equal(db.collection('products').findOne(x=>x.ean===EAN2).precoCentavos,0);
});

test('coluna de preço inválida ou zero impede criar lote e evita preços incorretos',()=>{
  for(const valor of ['0','R$ 0,00','-1,00','12.345,678','R$ XYZ','','1000001,00']){
    const db=criarDB();
    const file=csv('ean;nome;quantidade;preco de venda\n'
      + EAN1+';Produto original;3;'+valor+'\n');
    const r=prepararRelatorioEstoque(db,file,{operadorId:'admin'});
    assert.equal(r.ok,false,'valor não rejeitado: '+valor);
    assert.equal(db.collection('products').get('existente').precoCentavos,1500);
    assert.equal(db.collection('inovaCsvImportacoes').count(),0);
  }
});
test('conflito de estoque impede reprecificação de todo o lote',()=>{
  const db=criarDB();
  db.collection('products').update('existente',{estoque:{quantidade:9,reservado:8,quarentena:0,minimo:3}});
  const file=csv('ean;nome;quantidade;preco venda\n'
    + EAN1+';Produto original;1;999,99\n');
  const r=prepararRelatorioEstoque(db,file,{operadorId:'admin'});
  assert.equal(r.resumo.conflitos,1);
  assert.equal(aplicarRelatorioEstoque(db,r.id,'admin').status,409);
  assert.equal(db.collection('products').get('existente').precoCentavos,1500);
  assert.equal(db.collection('products').get('existente').estoque.quantidade,9);
});

test('prévia mostra coluna de preço anterior e novo, inclui alerta de diferenças',async()=>{
  const { telaPreviaRelatorioInova } = await import('../src/views/admin/inova-csv.js');
  const db=criarDB();
  const file=csv('ean;nome;quantidade;valor de venda\n'
    + EAN1+';Produto original;9;25,90\n');
  const r=prepararRelatorioEstoque(db,file,{operadorId:'admin'});
  assert.equal(r.resumo.alertasPreco,1);
  const prev=consultarRelatorioEstoque(db,r.id,'admin');
  const ctx={adminUser:{role:'super_admin',nome:'Admin'},csrf:'teste',
    req:{query:new URLSearchParams()},settings:{empresa:{nomeFantasia:'Farmácia Teste'},tema:{}}};
  const html=telaPreviaRelatorioInova(ctx,prev);
  assert.match(html,/Preço de venda \(CSV\)/);
  assert.match(html,/25,90/);
  assert.match(html,/15,00/);
  assert.match(html,/diferença superior a 50%/);
  assert.match(html,/saldos e preços de venda/);
});
