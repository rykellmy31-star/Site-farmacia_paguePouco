import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCep, isValidCep, ufFromCep, lookupCep } from '../src/lib/cep.js';
import { defaultFreightConfig, calcularFrete, resolverFreteEscolhido } from '../src/lib/freight.js';

const cotar = (cep, uf, cidade = 'São Paulo') => calcularFrete({
  config: defaultFreightConfig(), cep, uf, cidade, items: [], subtotalCents: 2500,
});

test('CEP com máscara mantém zero inicial e identifica UF real', async () => {
  assert.equal(normalizeCep('01001-000'), '01001000');
  assert.equal(isValidCep('01001-000'), true);
  assert.equal(ufFromCep('01001-000'), 'SP');
  const resposta = await lookupCep('01001-000');
  assert.equal(resposta.valido, true);
  assert.equal(resposta.uf, 'SP');
});

test('CEP incompleto nunca é preenchido artificialmente com zeros', async () => {
  assert.equal(normalizeCep('1234567'), '1234567');
  assert.equal(isValidCep('1234567'), false);
  assert.equal(ufFromCep('1234567'), null);
  const resposta = await lookupCep('1234567');
  assert.equal(resposta.valido, false);
  assert.equal(resposta.uf, null);
});

test('CEP longo não pode ser truncado para simular CEP válido', async () => {
  assert.equal(normalizeCep('010010000'), '010010000');
  assert.equal(isValidCep('010010000'), false);
  assert.equal(ufFromCep('010010000'), null);
  assert.equal((await lookupCep('010010000')).valido, false);
});

test('cotação inválida não oferece nem retirada nem entrega local', () => {
  for (const cep of ['1234567', '010010000', '00000000']) {
    const r = cotar(cep, 'SP');
    assert.equal(r.disponivel, false, 'CEP ' + cep);
    assert.equal(r.opcoes.length, 0);
    assert.match(r.motivo, /CEP/i);
  }
});

test('UF divergente do CEP não autoriza cobrança de frete incorreta', () => {
  const r = cotar('01001000', 'BA');
  assert.equal(r.disponivel, false);
  assert.equal(r.uf, 'SP');
  assert.equal(r.opcoes.length, 0);
  assert.match(r.motivo, /não corresponde/i);
});

test('cotação correta continua disponível com UF coerente ou não informada', () => {
  for (const uf of ['SP', '', undefined]) {
    const r = cotar('01001-000', uf);
    assert.equal(r.disponivel, true);
    assert.equal(r.uf, 'SP');
    assert.ok(r.opcoes.some(o => o.id === '_padrao'));
  }
});

test('checkout nunca aceita frete com CEP incompleto ou UF forjada', () => {
  for (const [cep, uf] of [['1234567', 'SP'], ['01001000', 'BA']]) {
    const r = resolverFreteEscolhido({
      config: defaultFreightConfig(), cep, uf, cidade: 'São Paulo',
      items: [], subtotalCents: 2500, opcaoId: '_padrao', cupomFreteGratis: false,
    });
    assert.equal(r.ok, false);
  }
});

test('CEP igual ao cadastrado na sede mostra somente Entrega Local e Retirar na farmácia',()=>{
  const cfg=defaultFreightConfig();
  cfg.entregaLocal.valor=850;
  cfg.entregaLocal.cidades=['Outra cidade']; // A regra é pelo CEP, não pela cidade.
  const r=calcularFrete({config:cfg,cepFarmacia:'45970-000',cep:'45970000',
    uf:'BA',cidade:'Itanhém',items:[],subtotalCents:5000});
  assert.equal(r.disponivel,true);
  assert.deepEqual(r.opcoes.map(o=>o.id),['entrega_local','retirada']);
  assert.deepEqual(r.opcoes.map(o=>o.valor),[850,0]);
  assert.equal(r.opcoes[0].label,'Entrega Local');
});
test('CEP diferente restringe a entrega estadual mesmo na mesma cidade da farmácia',()=>{
  const cfg=defaultFreightConfig();
  for(const cep of ['45970001','01001000']){
    const uf=cep==='45970001'?'BA':'SP';
    const r=calcularFrete({config:cfg,cepFarmacia:'45970000',cep,uf,
      cidade:'Itanhém',items:[],subtotalCents:5000});
    assert.equal(r.disponivel,true);
    assert.deepEqual(r.opcoes.map(o=>o.id),['_padrao']);
    assert.equal(r.opcoes[0].valor,cfg.states[uf].valor);
  }
});
test('frete por CEP mantém frete grátis, bloqueios e UF validada',()=>{
  const cfg=defaultFreightConfig();
  const geral={config:cfg,cepFarmacia:'45970000',cep:'01001000',
    uf:'SP',cidade:'São Paulo',items:[],subtotalCents:30000};
  assert.equal(calcularFrete(geral).opcoes[0].valor,0);
  const falsificado=calcularFrete({...geral,uf:'BA'});
  assert.equal(falsificado.disponivel,false);
  const errado=resolverFreteEscolhido({...geral,opcaoId:'retirada'});
  assert.equal(errado.ok,false);
  assert.match(errado.erro,/não está disponível/);
  const correto=resolverFreteEscolhido({...geral,opcaoId:'_padrao'});
  assert.equal(correto.ok,true);
  assert.equal(correto.valor,0);
});
test('respeita canais desativados e falha de modo seguro para CEP local',()=>{
  const cfg=defaultFreightConfig();
  cfg.retirada.ativo=false;
  const same={config:cfg,cepFarmacia:'45970000',cep:'45970000',
    uf:'BA',cidade:'Itanhém',items:[],subtotalCents:1000};
  assert.deepEqual(calcularFrete(same).opcoes.map(o=>o.id),['entrega_local']);
  cfg.entregaLocal.ativo=false;
  const r=calcularFrete(same);
  assert.equal(r.disponivel,false);
  assert.equal(r.opcoes.length,0);
});
test('rotas e frontend não oferecem o velho botão Calcular frete',()=>{
  const root=new URL('../',import.meta.url);
  const front=readFileSync(new URL('src/views/checkout.js',root),'utf8');
  const js=readFileSync(new URL('public/js/app.js',root),'utf8');
  const checkout=readFileSync(new URL('src/routes/checkout.js',root),'utf8');
  const api=readFileSync(new URL('src/routes/api.js',root),'utf8');
  const pedidos=readFileSync(new URL('src/lib/orders.js',root),'utf8');
  assert.doesNotMatch(front,/id="botaoCalcularFrete"/);
  assert.match(front,/id="botaoIrPagamento"/);
  assert.match(js,/function iniciarCheckout\(\)/);
  assert.match(js,/cepInput.addEventListener\('input',agendar\)/);
  assert.match(js,/input\[name=enderecoSalvo\]/);
  assert.match(checkout,/cepFarmacia: ctx.settings.empresa\?\.endereco\?\.cep/);
  assert.match(api,/cepFarmacia: ctx.settings.empresa\?\.endereco\?\.cep/);
  assert.match(pedidos,/config: freteConfig, cepFarmacia/);
});
