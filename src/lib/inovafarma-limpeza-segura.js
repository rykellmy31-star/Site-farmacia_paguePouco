/**
 * Arquivamento reversível de produtos que NÃO constam no relatório COMPLETO
 * do InovaFarma. Nunca exclui registros do banco, nem altera pedidos ou vendas.
 * O CSV de 6062 produtos omite 66 pendentes: para a limpeza exige >=6128 linhas.
 */
import crypto from 'node:crypto';
import { planejarLimpezaCatalogoInova } from './inovafarma-limpeza-previa.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 12000;
const MIN_ROWS_COMPLETO = 6128;
const PRAZO_MS = 20 * 60 * 1000;
const normal = v => String(v ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const codigo = v => String(v ?? '').trim();
const aliases = {
  codigoInterno: ['codigointerno','codigoproduto','codigodoproduto',
    'codprod','codigo','cod'],
  ean: ['ean','gtin','codigobarras','codigodebarras','codigobarra',
    'codigodebarra','codbarra','codigoean','codbarras'],
  nome: ['nome','descricao','descricaoproduto','descricaodoproduto',
    'produto','nomedoproduto'],
};
function csvLinhas(texto) {
  const trecho = texto.slice(0, 5000);
  const delimitador = [';', '\t', ','].sort((a,b) =>
    trecho.split(b).length - trecho.split(a).length)[0];
  const linhas=[];let campos=[],valor='',aspas=false;
  const termina=()=>{
    campos.push(valor.trim()); valor='';
    if(campos.some(Boolean))linhas.push(campos);
    campos=[];
    if(linhas.length>MAX_ROWS+100)
      throw new Error('Relatório excede o máximo de linhas permitido.');
  };
  for(let i=0;i<texto.length;i++){
    const ch=texto[i];
    if(ch==='"'){
      if(aspas && texto[i+1]==='"'){valor+='"';i++;}
      else aspas=!aspas;
    } else if(ch===delimitador && !aspas){
      campos.push(valor.trim());valor='';
    } else if((ch==='\r'||ch==='\n') && !aspas){
      if(ch==='\r'&&texto[i+1]==='\n')i++;
      termina();
    } else valor+=ch;
  }
  if(aspas)throw new Error('CSV com aspas não fechadas.');
  termina();
  return linhas;
}
export function lerIdentidadesInovaParaLimpeza(bytes) {
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)
    throw new Error('Relatório CSV inválido ou maior que 8 MB.');
  let texto;
  try { texto=new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { texto=new TextDecoder('windows-1252').decode(bytes); }
  const linhas=csvLinhas(texto.replace(/^\uFEFF/,''));
  let headerIndex=-1,indices=null;
  for(let i=0;i<Math.min(linhas.length,100);i++){
    const h=linhas[i].map(normal);
    const idx=Object.fromEntries(Object.entries(aliases).map(([campo, valores])=>
      [campo,h.findIndex(x=>valores.includes(x))]));
    if(idx.nome>=0 && idx.codigoInterno>=0 && idx.ean>=0){
      headerIndex=i;indices=idx;break;
    }
  }
  if(headerIndex<0)
    throw new Error('Cabeçalho com Código Interno, Código de Barras e Produto não encontrado.');
  const itens=[];let invalidos=0;
  const eans=new Set(),codigos=new Set();let repetidos=0,semBarras=0;
  for(let i=headerIndex+1;i<linhas.length;i++){
    const r=linhas[i];
    const code=codigo(r[indices.codigoInterno]);
    const ean=codigo(r[indices.ean]);
    const nome=codigo(r[indices.nome]);
    if(!code&&!ean&&!nome)continue;
    if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/.test(code)) {
      if(nome && !/total|rodape|pagina|relatorio/i.test(normal(nome)))invalidos++;
      continue;
    }
    if(!nome||nome.length<2||nome.length>220){invalidos++;continue;}
    if(ean.length>30||/[<>\x00-\x1f]/.test(nome+ean)){invalidos++;continue;}
    if(codigos.has(code)||(ean&&eans.has(ean)))repetidos++;
    codigos.add(code);if(ean)eans.add(ean);else semBarras++;
    itens.push({codigoInterno:code,ean,nome});
  }
  if(!itens.length)throw new Error('Nenhum produto identificado no CSV.');
  return {itens,estatisticas:{
    total:itens.length,semBarras,invalidos,repetidos,
    minimoEsperado:MIN_ROWS_COMPLETO,
    coberturaCompleta:itens.length>=MIN_ROWS_COMPLETO&&!invalidos&&!repetidos,
  }};
}
const colecoes = db => ({
  produtos:db.collection('products').all(),
  pedidos:db.collection('orders').all(),
  carrinhos:db.collection('carts').all(),
});
const fingerprint = (colecoes, relatorio, elegiveis) => {
  const produtos=colecoes.produtos.map(p=>[p.id,p.ean,p.codigoInterno,
    p.ativo,p.atualizadoEm,p.updatedAt,
    p.estoque?.reservado,p.estoque?.quarentena,p.inovaArquivado?.em]);
  const pedidos=colecoes.pedidos.map(p=>[p.id,(p.itens||[]).map(i=>i.produtoId)]);
  // Cestas vazias são criadas a cada visita; não invalidam a prévia.
  // Mas qualquer alteração dos IDs elegíveis a arquivamento invalida.
  return crypto.createHash('sha256').update(JSON.stringify({
    produtos,pedidos,elegiveis:elegiveis.map(i=>i.id).sort(),
    fonte:relatorio.map(i=>[i.ean,i.codigoInterno])
  })).digest('hex');
};
function montarPlano(db,fonte) {
  const dados=colecoes(db);
  const previa=planejarLimpezaCatalogoInova(
    dados.produtos,fonte.itens,dados.pedidos);
  const idsCarrinho=new Set(dados.carrinhos.flatMap(c=>
    (c.itens||[]).map(i=>String(i.produtoId||''))));
  const elegiveis=previa.itens.filter(i=>
    i.status==='candidato_sem_historico'&&!idsCarrinho.has(i.id));
  const emCarrinhos=previa.itens.filter(i=>
    i.status==='candidato_sem_historico'&&idsCarrinho.has(i.id));
  return {previa,elegiveis,emCarrinhos,
    fingerprint:fingerprint(dados,fonte.itens,elegiveis)};
}
const validoLote=(lote,operadorId)=>{
  if(!lote||lote.operadorId!==operadorId)
    return {ok:false,status:404,erro:'Prévia não encontrada.'};
  if(Date.now()-Date.parse(lote.criadoEm)>PRAZO_MS)
    return {ok:false,status:410,erro:'Prévia vencida. Envie o relatório novamente.'};
  if(lote.aplicadoEm)
    return {ok:false,status:409,erro:'Limpeza já concluída para esta prévia.'};
  return {ok:true};
};
export function prepararLimpezaInova(db,arquivo,operadorId) {
  const fonte=lerIdentidadesInovaParaLimpeza(arquivo);
  const plano=montarPlano(db,fonte);
  const id='limpeza_'+crypto.randomUUID();
  const lote={
    id,operadorId,criadoEm:new Date().toISOString(),aplicadoEm:null,
    fonte,hash:crypto.createHash('sha256').update(arquivo).digest('hex'),
    fingerprint:plano.fingerprint,quantidadePrevista:plano.elegiveis.length,
  };
  db.collection('inovaLimpezaPrevias').insert(lote);
  return {ok:true,id,...plano,fonte:fonte.estatisticas,
    habilitado:fonte.estatisticas.coberturaCompleta&&plano.elegiveis.length>0};
}
export function consultarLimpezaInova(db,id,operadorId) {
  const lote=db.collection('inovaLimpezaPrevias').get(id);
  const validacao=validoLote(lote,operadorId);
  if(!validacao.ok)return validacao;
  const plano=montarPlano(db,lote.fonte);
  const inalterado=plano.fingerprint===lote.fingerprint &&
    plano.elegiveis.length===lote.quantidadePrevista;
  return {ok:true,id,...plano,fonte:lote.fonte.estatisticas,
    habilitado:lote.fonte.estatisticas.coberturaCompleta&&
      inalterado&&plano.elegiveis.length>0,
    inalterado};
}
/**
 * Arquiva só candidatos sem vínculo. Registros originais ficam intactos.
 * Nunca usa remove, delete ou clear.
 */
export function aplicarLimpezaInova(db,id,operadorId,{frase,conferido}={}) {
  if(frase!=='LIMPAR PRODUTOS ANTIGOS'||conferido!=='1')
    return {ok:false,status:400,erro:'Confirmação explícita obrigatória.'};
  const previa=consultarLimpezaInova(db,id,operadorId);
  if(!previa.ok)return previa;
  if(!previa.habilitado)
    return {ok:false,status:409,erro:'Relatório parcial, ambiguidades ou catálogo alterado. Refaça a conferência.'};
  if(typeof db.storage?.transactionSync!=='function')
    return {ok:false,status:503,erro:'Limpeza disponível somente no ambiente Cloudflare com transação atômica.'};
  let arquivados=0;
  const agora=new Date().toISOString();
  try {
    db.storage.transactionSync(()=>{
      for(const item of previa.elegiveis){
        const p=db.collection('products').get(item.id);
        if(!p||p.inovaArquivado?.em)throw new Error('Produto alterado.');
        db.collection('products').update(p.id,{
          ativo:false,atualizadoEm:agora,
          inovaArquivado:{em:agora,loteId:id,operadorId,
            ativoAnterior:Boolean(p.ativo),motivo:'ausente_do_relatorio_integral_inovafarma'},
        });
        arquivados++;
      }
      db.collection('inovaLimpezaPrevias').update(id,{
        aplicadoEm:agora,quantidadeAplicada:arquivados,fonte:null,
      });
    });
  }catch{
    db.collections?.delete('products');
    db.collections?.delete('inovaLimpezaPrevias');
    return {ok:false,status:500,erro:'Arquivamento não concluído; dados preservados.'};
  }
  return {ok:true,arquivados,restamParaRevisao:
    previa.previa.resumo.conferirIdentificacao+
    previa.previa.resumo.vinculadosPedidos+
    previa.previa.resumo.comReserva+previa.emCarrinhos.length};
}
export function restaurarProdutoArquivado(db,produtoId) {
  const p=db.collection('products').get(produtoId);
  if(!p||!p.inovaArquivado?.em)
    return {ok:false,status:404,erro:'Produto não está arquivado.'};
  db.collection('products').update(produtoId,{
    inovaArquivado:null,ativo:false,atualizadoEm:new Date().toISOString(),
  });
  return {ok:true};
}
