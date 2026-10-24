import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { registrarRotasAdmin } from '../src/routes/admin.js';
import { telaProdutoForm, telaProdutos } from '../src/views/admin/catalogo.js';
import { podeAtivarAposAprovacao, podeVender } from '../src/lib/catalog.js';

function preparar({ sanitario = { classificacao: 'nao_aplicavel', aprovadoFarmaceutico: false }, ativo = false, quantidade = 3 } = {}) {
  const col = new Map(),db = {
    collection(nome){
      if (!col.has(nome)) col.set(nome,new Collection({_commit() {}},nome));
      return col.get(nome);
    }
  };
  const produto=db.collection('products').insert({
    id:'p1',slug:'produto-original',nome:'Produto original',
    codigoInterno:'800111',ean:'7891234567890',precoCentavos:1250,
    imagens:[],ativo,sanitario,estoque:{quantidade,reservado:0,quarentena:0,minimo:5},
  });
  const rotas=new Map(),app={
    get(caminho,fn){rotas.set('GET '+caminho,fn);},
    post(caminho,fn){rotas.set('POST '+caminho,fn);},
  };
  registrarRotasAdmin(app,db);
  function executar(acao,body={},role='farmaceutico'){
    const res={
      code:200,body:null,
      json(data,code){this.code=code||200;this.body=data;},
      status(code){this.code=code;return this;},
      html(data,code){this.code=code||this.code;this.body=data;},
      redirect(){throw new Error('Não deveria redirecionar');},
    };
    const req={adminUser:{id:'u1',role,nome:'Farmacêutico Teste',crf:'1234'},
      params:{id:produto.id},body,headers:{'user-agent':'teste'},ip:'127.0.0.1'};
    rotas.get('POST '+acao)(req,res);
    return res;
  }
  const body=(extra={})=>({
    nome:'Produto editado e com foto',codigoInterno:produto.codigoInterno,
    ean:produto.ean,preco:'12.50',quantidade:String(quantidade),
    estoqueMinimo:'5',classificacao:sanitario.classificacao,
    'imagens[]':['/uploads/produtos/foto-teste.webp'],
    ...extra,
  });
  return {db,produto,executar,body};
}

test('Primeira aprovação + salvar: aplica imagem, sanitário e ativo numa única edição',()=>{
  const {db,produto,executar,body}=preparar();
  const r=executar('/admin/api/produtos/:id',body({aprovarAoSalvar:'1'}));
  assert.equal(r.code,200,JSON.stringify(r.body));
  assert.equal(r.body.aprovacaoAplicada,true);
  assert.equal(r.body.ativacaoAutomatica,true);
  const salvo=db.collection('products').get(produto.id);
  assert.equal(salvo.ativo,true);
  assert.equal(salvo.sanitario.aprovadoFarmaceutico,true);
  assert.match(salvo.sanitario.aprovadoPor,/CRF 1234/);
  assert.equal(salvo.nome,'Produto editado e com foto');
  assert.equal(salvo.imagens[0].url,'/uploads/produtos/foto-teste.webp');
  assert.equal(podeVender(salvo).ok,true);
  assert.equal(db.collection('auditLogs').all().filter(x=>x.acao==='ativou_produto_apos_aprovacao').length,1);
});

test('Exige receita (como na foto): salva aprovação mas NÃO ativa venda online',()=>{
  const {db,produto,executar,body}=preparar();
  const r=executar('/admin/api/produtos/:id',body({aprovarAoSalvar:'1',requerReceita:'1'}));
  assert.equal(r.code,200);
  assert.equal(r.body.ativacaoAutomatica,false);
  assert.match(r.body.motivoAtivacao,/prescrição\/controle especial/);
  const salvo=db.collection('products').get(produto.id);
  assert.equal(salvo.ativo,false);
  assert.equal(salvo.sanitario.aprovadoFarmaceutico,true);
  assert.equal(podeVender(salvo).ok,false);
});

test('Medicamento sem registro na Anvisa permanece inativo mesmo aprovado',()=>{
  const {db,produto,executar,body}=preparar();
  const r=executar('/admin/api/produtos/:id',body({aprovarAoSalvar:'1',classificacao:'isento_prescricao'}));
  assert.equal(r.body.ativacaoAutomatica,false);
  assert.equal(db.collection('products').get(produto.id).ativo,false);
  assert.match(r.body.motivoAtivacao,/registro na Anvisa/);
});

test('Ativação após salvar independe de saldo positivo, mas compra continua bloqueada',()=>{
  const {db,produto,executar,body}=preparar({quantidade:0});
  const r=executar('/admin/api/produtos/:id',body({aprovarAoSalvar:'1'}));
  assert.equal(r.body.ativacaoAutomatica,true);
  const salvo=db.collection('products').get(produto.id);
  assert.equal(salvo.ativo,true);
  assert.equal(podeVender(salvo).codigo,'SEM_ESTOQUE');
});

test('Produto já aprovado e desativado manualmente nunca reativa apenas por editar novamente',()=>{
  const {db,produto,executar,body}=preparar({ativo:false,
    sanitario:{classificacao:'nao_aplicavel',aprovadoFarmaceutico:true,aprovadoPor:'responsavel'}});
  const r=executar('/admin/api/produtos/:id',body());
  assert.equal(r.code,200);
  assert.equal(r.body.ativacaoAutomatica,false);
  assert.equal(db.collection('products').get(produto.id).ativo,false);
  const duplicado=executar('/admin/api/produtos/:id',body({aprovarAoSalvar:'1'}));
  assert.equal(duplicado.code,409);
  assert.equal(db.collection('products').get(produto.id).ativo,false);
});

test('Perfil sem permissão não aprova nem edita dados no servidor',()=>{
  const {db,produto,executar,body}=preparar();
  const r=executar('/admin/api/produtos/:id',body({aprovarAoSalvar:'1'}),'atendente');
  assert.equal(r.code,403);
  assert.equal(db.collection('products').get(produto.id).ativo,false);
  assert.equal(db.collection('products').get(produto.id).sanitario.aprovadoFarmaceutico,false);
});

test('Botão Ativar/Desativar permanece utilizável após aprovação',()=>{
  const {db,produto,executar,body}=preparar();
  executar('/admin/api/produtos/:id',body({aprovarAoSalvar:'1'}));
  const r=executar('/admin/api/produtos/:id/ativar');
  assert.equal(r.code,200);
  assert.equal(r.body.ativo,false);
  const salvo=db.collection('products').get(produto.id);
  assert.equal(salvo.ativo,false);
  assert.equal(salvo.sanitario.aprovadoFarmaceutico,true);
});

test('Painel prepara aprovação sem reload e sem perder fotos, informa comportamento',()=>{
  const {db,produto}=preparar();
  const ctx={db,adminUser:{role:'farmaceutico',nome:'Farmacêutico Teste'},
    settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{}},
    req:{pathname:'/admin/produtos/p1',query:new URLSearchParams()},csrf:'teste',podeAprovar:true};
  const tela=telaProdutoForm(ctx,{produto,categorias:[],marcas:[],todasMidia:[]});
  assert.match(tela,/data-aprovar-produto="p1"/);
  assert.match(tela,/Ao clicar em Aprovar cadastro, clique em Salvar alterações/);
  const js=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
  assert.match(js,/input\[name="aprovarAoSalvar"\]/);
  assert.match(js,/Aprovação preparada — salve o produto/);
  assert.match(js,/resposta\.ativacaoAutomatica/);
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(routes,/aprovarAoSalvar && !can\(req\.adminUser, 'produtos\.aprovar'\)/);
  assert.match(routes,/podeAtivarAposAprovacao\(\{ \.\.\.produto, \.\.\.dados \}\)/);
});
