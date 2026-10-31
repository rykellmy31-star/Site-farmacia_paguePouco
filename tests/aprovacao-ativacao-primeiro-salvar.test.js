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

test('importado sem avaliação permanece bloqueado, mesmo com caixa de receita vazia',()=>{
  const {db,produto,executar,body}=preparar({
    sanitario:{classificacao:'nao_aplicavel',requerReceita:false,
      aprovadoFarmaceutico:false,controlado:false},
  });
  db.collection('products').update(produto.id,{
    inovaCatalogo:{origem:'substituicao_total_csv',revisaoSanitariaPendente:true},
  });
  const atual=db.collection('products').get(produto.id);
  assert.equal(podeAtivarAposAprovacao(atual).codigo,'REVISAO_SANITARIA_INOVA');
  const tentativaAtivar=executar('/admin/api/produtos/:id/ativar');
  assert.equal(tentativaAtivar.code,409);
  assert.equal(db.collection('products').get(produto.id).ativo,false);
  const semRevisao=executar('/admin/api/produtos/:id',body({aprovarAoSalvar:'1'}));
  assert.equal(semRevisao.code,409);
  assert.equal(db.collection('products').get(produto.id).sanitario.aprovadoFarmaceutico,false);
  const salvarSemAprovar=executar('/admin/api/produtos/:id',body({ativo:'1'}));
  assert.equal(salvarSemAprovar.code,200);
  assert.equal(db.collection('products').get(produto.id).ativo,false);
  const liberado=executar('/admin/api/produtos/:id',
    body({aprovarAoSalvar:'1',confirmouRevisaoSanitaria:'1',
      classificacao:'cosmético'}));
  assert.equal(liberado.code,200,JSON.stringify(liberado.body));
  assert.equal(liberado.body.ativacaoAutomatica,true);
  const depois=db.collection('products').get(produto.id);
  assert.equal(depois.inovaCatalogo.revisaoSanitariaPendente,false);
  assert.equal(depois.sanitario.aprovadoFarmaceutico,true);
  assert.equal(podeVender(depois).ok,true);
});

test('produto importado já aprovado conclui revisão e ativa no mesmo salvamento',()=>{
  const aprovadoEm='2026-10-31T17:08:00.000Z';
  const {db,produto,executar,body}=preparar({
    sanitario:{classificacao:'nao_aplicavel',requerReceita:false,controlado:false,
      aprovadoFarmaceutico:true,aprovadoPor:'Super Administrador',aprovadoEm},
  });
  db.collection('products').update(produto.id,{
    inovaCatalogo:{origem:'substituicao_total_csv',revisaoSanitariaPendente:true},
  });
  const bloqueado=executar('/admin/api/produtos/:id/ativar');
  assert.equal(bloqueado.code,409);
  assert.match(bloqueado.body.erro,/não revisada/);
  const resultado=executar('/admin/api/produtos/:id',
    body({ativo:'1',confirmouRevisaoSanitaria:'1',classificacao:'cosmético'}));
  assert.equal(resultado.code,200,JSON.stringify(resultado.body));
  assert.equal(resultado.body.aprovacaoAplicada,false);
  assert.equal(resultado.body.revisaoConcluida,true);
  assert.equal(resultado.body.ativacaoAutomatica,true);
  const salvo=db.collection('products').get(produto.id);
  assert.equal(salvo.ativo,true);
  assert.equal(salvo.inovaCatalogo.revisaoSanitariaPendente,false);
  assert.equal(salvo.inovaCatalogo.revisadoPor,'u1');
  assert.equal(salvo.sanitario.aprovadoPor,'Super Administrador');
  assert.equal(salvo.sanitario.aprovadoEm,aprovadoEm);
  assert.equal(podeVender(salvo).ok,true);
  assert.equal(db.collection('auditLogs').all().filter(
    x=>x.acao==='concluiu_revisao_sanitaria_inova').length,1);
  assert.equal(executar('/admin/api/produtos/:id/ativar').body.ativo,false);
});

test('produto importado já aprovado não reabre venda sem confirmação explícita',()=>{
  const {db,produto,executar,body}=preparar({
    sanitario:{classificacao:'nao_aplicavel',requerReceita:false,
      controlado:false,aprovadoFarmaceutico:true},
  });
  db.collection('products').update(produto.id,{
    inovaCatalogo:{origem:'substituicao_total_csv',revisaoSanitariaPendente:true},
  });
  const r=executar('/admin/api/produtos/:id',body({ativo:'1'}));
  assert.equal(r.code,200);
  assert.equal(db.collection('products').get(produto.id).ativo,false);
  assert.equal(db.collection('products').get(produto.id).inovaCatalogo.revisaoSanitariaPendente,true);
  const negado=executar('/admin/api/produtos/:id',body({
    ativo:'1',confirmouRevisaoSanitaria:'1',classificacao:'cosmético',
  }),'atendente');
  assert.equal(negado.code,403);
  assert.equal(db.collection('products').get(produto.id).ativo,false);
});

test('revisão de importado aprovado não libera medicamento com receita ou sem registro',()=>{
  for(const overrides of [
    {requerReceita:'1',classificacao:'isento_prescricao',registroMS:'12345'},
    {controlado:'1',classificacao:'controlado',registroMS:'12345'},
    {classificacao:'isento_prescricao',registroMS:''},
  ]){
    const {db,produto,executar,body}=preparar({
      sanitario:{classificacao:'nao_aplicavel',requerReceita:false,
        controlado:false,aprovadoFarmaceutico:true},
    });
    db.collection('products').update(produto.id,{
      inovaCatalogo:{revisaoSanitariaPendente:true,origem:'substituicao_total_csv'},
    });
    const res=executar('/admin/api/produtos/:id',body({
      ativo:'1',confirmouRevisaoSanitaria:'1',...overrides,
    }));
    const salvo=db.collection('products').get(produto.id);
    assert.equal(salvo?.ativo,false,JSON.stringify(overrides));
    assert.equal(podeVender(salvo).ok,false);
    if(overrides.requerReceita||overrides.controlado){
      assert.equal(res.code,409);
      assert.equal(salvo.inovaCatalogo.revisaoSanitariaPendente,true);
    }else{
      assert.equal(res.code,200);
      assert.equal(res.body.revisaoConcluida,true);
      assert.equal(res.body.ativacaoAutomatica,false);
      assert.equal(res.body.motivoAtivacao.includes('registro'),true);
    }
  }
});

test('lista leva produto importado pendente para Revisar e ativar em vez de gerar erro',()=>{
  const {db,produto}=preparar({
    sanitario:{classificacao:'nao_aplicavel',aprovadoFarmaceutico:true},
  });
  db.collection('products').update(produto.id,{
    inovaCatalogo:{revisaoSanitariaPendente:true},
  });
  const ctx={db,adminUser:{role:'super_admin',nome:'Super'},
    settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{}},
    req:{pathname:'/admin/produtos',query:new URLSearchParams()},
    csrf:'teste',podeAprovar:true};
  const html=telaProdutos(ctx,{produtos:[db.collection('products').get(produto.id)],
    total:1,pagina:1,porPagina:25,busca:'',categorias:[],
    filtros:{categoria:'',status:''}});
  assert.match(html,/Revisar e ativar/);
  assert.doesNotMatch(html,/data-alternar-produto="p1"/);
  const editor=telaProdutoForm(ctx,{produto:db.collection('products').get(produto.id),
    categorias:[],marcas:[],todasMidia:[]});
  assert.match(editor,/Este produto já está aprovado: não é necessário aprovar novamente/);
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
  assert.match(tela,/Após clicar em Aprovar cadastro, clique em Salvar alterações/);
  const js=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
  assert.match(js,/input\[name="aprovarAoSalvar"\]/);
  assert.match(js,/Aprovação preparada — salve o produto/);
  assert.match(js,/resposta\.ativacaoAutomatica/);
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(routes,/aprovarAoSalvar && !can\(req\.adminUser, 'produtos\.aprovar'\)/);
  assert.match(routes,/podeAtivarAposAprovacao\(\{ \.\.\.produto, \.\.\.dados \}\)/);
});
