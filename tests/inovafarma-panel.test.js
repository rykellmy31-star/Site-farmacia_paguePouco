import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { config } from '../src/config.js';
import { formatDateTime, formatDate, FUSO_LOJA } from '../src/lib/format.js';
import { can } from '../src/lib/permissions.js';
import { horarioAtendimentoAgora } from '../src/views/layout.js';
import {
  validarEnderecoConector, salvarConfiguracaoInova, armazenarCredencialInova,
  estadoCredencialInova, apagarCredencialInova, diagnosticoInova,
} from '../src/lib/inovafarma-panel.js';
import { telaIntegracaoInova } from '../src/views/admin/inovafarma.js';

class DB {
  constructor() { this.cols = new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name,new Collection({_commit() {}},name));
    return this.cols.get(name);
  }
}
const KEY = 'segredo-apenas-para-testes-32-bytes-distinto-mp';
const ctx=(db,role='super_admin')=>({db,settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{}},
  adminUser:{role,id:'admin1',nome:'Admin'},permissoes:{},csrf:'token-teste',req:{pathname:'/admin/inovafarma'} });

test('exibe a hora exata em America/Sao_Paulo (-3), independente do fuso do servidor',()=>{
  assert.equal(FUSO_LOJA,'America/Sao_Paulo');
  const old=process.env.TZ;
  try {
    process.env.TZ='UTC';
    assert.equal(formatDateTime('2026-10-21T17:21:00.000Z'),'21/10/2026 14:21');
    assert.equal(formatDateTime('2026-10-22T01:10:00.000Z'),'21/10/2026 22:10');
    assert.equal(formatDate('2026-10-22T01:10:00.000Z'),'21/10/2026');
    assert.equal(formatDate('2026-10-21'),'21/10/2026');
    assert.equal(formatDateTime('invalido'),'—');
    assert.equal(formatDateTime('2026-10-25T17:07:19.024Z'),'25/10/2026 14:07');
    assert.equal(formatDateTime('2026-10-25T13:34:13-03:00'),'25/10/2026 13:34');
  } finally { if(old === undefined)delete process.env.TZ; else process.env.TZ=old; }
});

test('horário do atendimento usa dia e hora de Brasília mesmo no Worker UTC',()=>{
  const whatsapp={respeitarHorario:true,mensagemIndisponivel:'Fechado',horarios:[
    {dia:'quarta',ativo:true,inicio:'14:00',fim:'15:00'},
    {dia:'quinta',ativo:false,inicio:'00:00',fim:'00:00'},
  ]};
  assert.equal(horarioAtendimentoAgora(whatsapp,new Date('2026-10-21T17:21:00Z')).aberto,true);
  assert.equal(horarioAtendimentoAgora(whatsapp,new Date('2026-10-21T19:21:00Z')).aberto,false);
  assert.equal(horarioAtendimentoAgora(whatsapp,new Date('2026-10-22T01:21:00Z')).aberto,false);
});

test('só superadmin configura Inova; administrador visualiza status e operador não acessa',()=>{
  assert.equal(can({role:'super_admin'},'inovafarma.ver'),true);
  assert.equal(can({role:'admin'},'inovafarma.ver'),true);
  assert.equal(can({role:'gerente'},'inovafarma.ver'),false);
  assert.equal(can({role:'operador_pedidos'},'inovafarma.ver'),false);
  const db=new DB();
  const status=diagnosticoInova(db);
  const superHtml=telaIntegracaoInova(ctx(db),{dados:status});
  const adminHtml=telaIntegracaoInova(ctx(db,'admin'),{dados:status});
  assert.match(superHtml,/Integração InovaFarma|Sincronização de estoque/i);
  assert.match(superHtml,/action="\/admin\/inovafarma\/configuracao"/);
  assert.match(superHtml,/Testar conexão — aguardando homologação/);
  assert.match(superHtml,/Sincronizar estoque agora — aguardando homologação/);
  assert.match(superHtml,/Ativar integração — indisponível/);
  assert.doesNotMatch(adminHtml,/action="\/admin\/inovafarma\/configuracao"/);
  assert.doesNotMatch(adminHtml,/name="credencial"/);
  assert.doesNotMatch(adminHtml,/name="urlConector"/);
});

test('configuração persistente não ativa conector; URL de IP/local e portas alternativas recusadas',()=>{
  const db=new DB(), old=config.inova.enabled;
  const bad=[
    'http://erp.exemplo.com.br', 'https://127.0.0.1', 'https://[::1]',
    'https://localhost', 'https://erp.internal', 'https://192.168.1.1',
    'https://erp.example', 'https://user:pass@erp.com.br',
    'https://erp.com.br:9999', 'https://erp.com.br?target=localhost',
    'https://erp.com.br#segredo',
  ];
  for(const url of bad)assert.equal(validarEnderecoConector(url).ok,false,'aceitou URL '+url);
  assert.equal(salvarConfiguracaoInova(db,{urlConector:'https://conector.fornecedor.com.br/api',
    estabelecimento:'LOJA-12',intervaloMinutos:'15'}).ok,true);
  const saved=db.collection('inovaPanelConfig').get('integracao');
  assert.equal(saved.urlConector,'https://conector.fornecedor.com.br/api');
  assert.equal(saved.estabelecimento,'LOJA-12');
  assert.equal(saved.intervaloMinutos,15);
  assert.equal(saved.homologado,false);
  assert.equal(config.inova.enabled,old);
  assert.equal(salvarConfiguracaoInova(db,{urlConector:'https://erp.com.br',intervaloMinutos:0}).ok,false);
  assert.equal(db.collection('inovaPanelConfig').get('integracao').urlConector,saved.urlConector);
});

test('credencial é cifrada com AES-GCM no banco, não exibida, não entra em exportações',()=>{
  const db=new DB(), antigo=config.inova.credentialsKey;
  const secreto='TOKEN-TESTE-SOMENTE-NO-RUNTIME-NAO-REVELAR';
  try {
    config.inova.credentialsKey='';
    const negado=armazenarCredencialInova(db,secreto);
    assert.equal(negado.ok,false);
    assert.match(negado.erro,/INOVA_CREDENTIALS_KEY/);
    config.inova.credentialsKey=KEY;
    assert.equal(armazenarCredencialInova(db,secreto).ok,true);
    const registro=db.collection('inovaSecrets').get('inovafarma');
    assert.equal(registro.versao,1);
    assert(registro.iv&&registro.tag&&registro.cifra);
    assert.doesNotMatch(JSON.stringify(registro),new RegExp(secreto));
    assert.equal(estadoCredencialInova(db).legivel,true);
    const html=telaIntegracaoInova(ctx(db),{dados:diagnosticoInova(db)});
    assert.doesNotMatch(html,new RegExp(secreto));
    config.inova.credentialsKey='chave-errada-de-teste-32-caracteres-aqui';
    assert.equal(estadoCredencialInova(db).legivel,false);
    config.inova.credentialsKey=KEY;
    assert.equal(apagarCredencialInova(db).ok,true);
    assert.equal(estadoCredencialInova(db).cadastrada,false);
    const cloudSource=readFileSync(new URL('../src/cloudflare/store.js',import.meta.url),'utf8');
    assert.match(cloudSource,/proibidas = new Set\(\[[^\]]*'inovaSecrets'/);
  }finally{config.inova.credentialsKey=antigo}
});

test('monitoramento conta apenas fila interna real e mostra EAN pendente sem inventar conexão',()=>{
  const db=new DB(),antigo=config.inova.enabled;
  try {
    config.inova.enabled=false;
    const vendedor={id:'v1',nome:'Ana',codigoInova:'00125'};
    db.collection('orders').insert({id:'p1',codigo:'PP1',statusFinanceiro:'aprovado',
      inovaEnvioPendente:true,vendedor,itens:[{produtoId:'item1',ean:''}],totalCentavos:4800});
    db.collection('orders').insert({id:'p2',codigo:'PP2',statusFinanceiro:'pendente',
      inovaEnvioPendente:false,totalCentavos:9999});
    db.collection('orders').insert({id:'p3',codigo:'PP3',statusFinanceiro:'aprovado',
      inovaConfirmadoEm:new Date().toISOString()});
    db.collection('products').insert({id:'item1',ean:'',ativo:true,estoque:{quantidade:1}});
    const d=diagnosticoInova(db);
    assert.equal(d.status,'desativada');
    assert.equal(d.ultimaConexaoValidada,null);
    assert.equal(d.vendas.pendentes,1);
    assert.equal(d.vendas.confirmadas,1);
    assert.equal(d.vendas.conferir,1);
    assert.equal(d.vendas.pendentesDetalhes[0].vendedorCodigo,'00125');
    assert.equal(d.estoque.semCorrespondenciaEAN,1);
    assert.equal(d.estoque.desatualizado,true);
    const html=telaIntegracaoInova(ctx(db),{dados:d});
    assert.match(html,/PP1/);
    assert.match(html,/00125/);
    assert.doesNotMatch(html,/PP2|9999/);
    const viewer=telaIntegracaoInova(ctx(db,'admin'),{dados:d});
    assert.doesNotMatch(viewer,/PP1|00125/);
  }finally{config.inova.enabled=antigo}
});

test('módulo não realiza conexões nem baixa estoque sem API oficial',()=>{
  const raw=readFileSync(new URL('../src/lib/inovafarma-panel.js',import.meta.url),'utf8');
  assert.doesNotMatch(raw,/await fetch\(|fetch\s*\(/);
  assert.doesNotMatch(raw,/INOVA_STOCK_ENABLED\s*=\s*true/);
  const view=readFileSync(new URL('../src/views/admin/inovafarma.js',import.meta.url),'utf8');
  assert.match(view,/disabled>Testar conexão|disabled>Sincronizar estoque agora/);
});
