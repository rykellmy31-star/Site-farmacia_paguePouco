import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classificarExportacaoInova, examinarExportacoes } from '../scripts/inovafarma-robo-windows.mjs';

const csvEstoque = [
  'Código Interno;EAN;Descrição;Quantidade;Preço de Venda;Marca',
  '00071;7891234567890;Absorvente noturno 24 unidades;2;7,21;Marca A',
  '00072;7891234567891;Produto com estoque zerado;0;12,50;Marca B',
].join('\r\n');
const csvPromo = [
  'RELATÓRIO DE PROMOÇÕES' + ';'.repeat(28),
  '"Empresa:\nStatus:";;;;"FARMACIA PAGUE POUCO\nAPENAS PROMOÇÕES ATIVAS"' + ';'.repeat(24),
  'Promoção;;111;;;OFERTA DE OUTUBRO' + ';'.repeat(23),
  'Início;;Final;;;;Formas de pagamento' + ';'.repeat(22),
  '01/10/2026;;31/10/2026;;;;Vista;[X];Cheque;;[X];Cartão;;;[X];Cart. Digital;;;[X];Prazo;;;Red. Prazo;;;0,00 %;;;',
  'Código;Produto;;;;;;;;Grupo;;;;Grupo de preço;;;;Seção;;;;Desc.%;;Custo Médio;Preço Venda;;;Preço Promoção;',
  '834991;3 EM 1 BOCA LINDA (BATOM, GLOSS E LIPTINT);;;;;;;;PERFUMARIA;;;;;;;PERFUMES COSMETICOS E MAKE;;;;;30,00;;10,00;24,55;;;17,19;',
].join('\r\n');

test('valida CSV de estoque, inclusive zero e código interno com zeros',()=>{
  const r=classificarExportacaoInova(Buffer.from(csvEstoque));
  assert.deepEqual(r,{tipo:'estoque',total:2,semEstoque:1});
});
test('reconhece promoções e datas sem ativar campanha',()=>{
  const r=classificarExportacaoInova(Buffer.from(csvPromo,'utf8'));
  assert.equal(r.tipo,'promocoes');
  assert.equal(r.total,1);
  assert.equal(r.campanhas,1);
});
test('rejeita CSV desconhecido ou estrutura parcial em vez de inventar saldos',()=>{
  assert.throws(()=>classificarExportacaoInova(Buffer.from('Produto;Quantidade\nSabonete;4')),
    /CSV não reconhecido/);
  assert.throws(()=>classificarExportacaoInova(Buffer.alloc(9*1024*1024,65)),/8 MB/);
});
test('varredura local: fila por SHA, cópia idêntica, idempotência e nenhuma rede', async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'robo-inova-'));
  try{
    const orig=path.join(base,'exportados');
    await fs.mkdir(orig);
    await fs.writeFile(path.join(orig,'posicao.csv'),csvEstoque);
    let r=await examinarExportacoes({origem:orig,agora:Date.now()+12000});
    assert.equal(r.prontos,1);
    assert.equal(r.rejeitados,0);
    const meta=r.itens[0];
    assert.equal(meta.tipo,'estoque');
    assert.equal(meta.total,2);
    assert.equal(meta.situacao,'pronto_para_revisao');
    assert.deepEqual(await fs.readFile(path.join(r.fila,meta.arquivoFila)),
      Buffer.from(csvEstoque));
    assert.equal((await fs.readdir(r.fila)).length,2,'apenas CSV e metadados');
    r=await examinarExportacoes({origem:orig,agora:Date.now()+12000});
    assert.equal(r.prontos,0);
    assert.equal(r.duplicados,1);
    await fs.writeFile(path.join(orig,'promocoes.csv'),csvPromo);
    r=await examinarExportacoes({origem:orig,agora:Date.now()+12000});
    assert.equal(r.prontos,1);
    assert.equal(r.itens[0].tipo,'promocoes');
    assert.deepEqual((await fs.readdir(orig)).filter(x=>x.endsWith('.csv')).sort(),
      ['posicao.csv','promocoes.csv'],'originais intactos');
  }finally{await fs.rm(base,{recursive:true,force:true})}
});
test('não processa arquivo parcialmente exportado; rejeitados não são colocados na fila',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'robo-inova-'));
  try{
    const exportados=path.join(base,'csv');
    await fs.mkdir(exportados);
    await fs.writeFile(path.join(exportados,'novo.csv'),csvEstoque);
    let r=await examinarExportacoes({origem:exportados});
    assert.equal(r.prontos,0);
    assert.equal(r.aindaExportando,1);
    await fs.writeFile(path.join(exportados,'ruim.csv'),'Produto;Quantidade\nA;1');
    r=await examinarExportacoes({origem:exportados,agora:Date.now()+12000});
    assert.equal(r.prontos,1);
    assert.equal(r.rejeitados,1);
    assert.equal((await fs.readdir(r.fila)).filter(x=>x.endsWith('.csv')).length,1);
  }finally{await fs.rm(base,{recursive:true,force:true})}
});
test('falha fechada com estado JSON corrompido; nao apaga historico',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'robo-inova-'));
  try{
    const dir=path.join(base,'origem'),saida=path.join(dir,'.robo-inovafarma');
    await fs.mkdir(saida,{recursive:true});
    await fs.writeFile(path.join(saida,'estado.json'),'INVALIDO');
    await assert.rejects(()=>examinarExportacoes({origem:dir}),/Estado do robô indisponível/);
    assert.equal(await fs.readFile(path.join(saida,'estado.json'),'utf8'),'INVALIDO');
  }finally{await fs.rm(base,{recursive:true,force:true})}
});
