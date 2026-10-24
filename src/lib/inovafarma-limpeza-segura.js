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

export class ErroRelatorioInova extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroRelatorioInova';
    this.codigo = codigo;
  }
}

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
function csvLinhas(texto, separador) {
  const linhas = [];
  let campos = [], valor = '', aspas = false;
  const terminar = () => {
    campos.push(valor.trim());
    if (campos.some(Boolean)) linhas.push(campos);
    valor = ''; campos = [];
    if (linhas.length > MAX_ROWS + 100)
      throw new ErroRelatorioInova('MUITAS_LINHAS','O relatório tem mais de 12 mil linhas; exporte apenas a posição de estoque.');
  };
  for (let i=0; i<texto.length; i++) {
    const ch=texto[i];
    if (ch==='"') {
      if (aspas && texto[i+1]==='"') {valor+='"';i++;}
      else aspas=!aspas;
    } else if (ch===separador && !aspas) {
      campos.push(valor.trim());valor='';
    } else if ((ch==='\r'||ch==='\n')&&!aspas) {
      if (ch==='\r' && texto[i+1]==='\n') i++;
      terminar();
    } else valor+=ch;
  }
  if (aspas) throw new ErroRelatorioInova('ASPAS_INVALIDAS','CSV com aspas não fechadas. Exporte o arquivo novamente no formato CSV.');
  terminar();
  return linhas;
}
function indicesCabecalho(linhas) {
  for (let i=0;i<Math.min(linhas.length,100);i++) {
    const nomes=linhas[i].map(normal);
    const idx=Object.fromEntries(Object.entries(aliases).map(([campo,apelidos])=>
      [campo,nomes.findIndex(x=>apelidos.includes(x))]));
    if (idx.nome>=0 && idx.codigoInterno>=0 && idx.ean>=0)
      return {indice:i,colunas:idx};
  }
  return null;
}
function decodificarCsv(bytes) {
  if (bytes[0]===0xff && bytes[1]===0xfe)
    return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0]===0xfe && bytes[1]===0xff)
    return new TextDecoder('utf-16be').decode(bytes);
  try {return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch {return new TextDecoder('windows-1252').decode(bytes);}
}
/**
 * Lê SOMENTE identidades; estoque negativo, produto sem EAN e preço ausente
 * não podem impedir a conciliação. Suporta:
 * - exportação bruta cp1252 "POSIÇÃO DE ESTOQUE", com capa e várias colunas;
 * - CSV UTF-8 importado anteriormente, com EAN, Descricao e Codigo Interno;
 * - CSV reduzido seguro para conciliação (Codigo Interno;EAN;Descricao).
 */
export function lerIdentidadesInovaParaLimpeza(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength>MAX_BYTES)
    throw new ErroRelatorioInova('ARQUIVO_INVALIDO','Envie um CSV de até 8 MB exportado do InovaFarma.');
  const texto=decodificarCsv(bytes).replace(/^\uFEFF/,'');
  let selecionado=null;
  for (const separador of [';','\t',',']) {
    const linhas=csvLinhas(texto,separador);
    const cabecalho=indicesCabecalho(linhas);
    if (cabecalho) {selecionado={linhas,...cabecalho};break;}
  }
  if (!selecionado) {
    const inicio=normal(texto.slice(0,300));
    if (inicio.startsWith('relatoriodepromocoes'))
      throw new ErroRelatorioInova('TIPO_PROMOCOES',
        'Você enviou o relatório de Promoções. Para limpar produtos, use Posição de Estoque do InovaFarma.');
    if (/codigobarra|produto|preco|estoque|ean/.test(inicio))
      throw new ErroRelatorioInova('COLUNAS_AUSENTES',
        'Faltam as colunas Código Interno, EAN/Cód. Barra e Produto/Descrição. '+
        'Use Posição de Estoque do InovaFarma ou o CSV completo de conferência, '+
        'não a exportação de produtos do próprio site.');
    throw new ErroRelatorioInova('FORMATO_DESCONHECIDO',
      'Arquivo não reconhecido. Exporte Posição de Estoque em CSV no InovaFarma. '+
      'O relatório deve conter Código, Cod. Barra e Produto.');
  }
  const {linhas,indice,colunas}=selecionado;
  const itens=[];
  let invalidos=0,repetidos=0,semBarras=0;
  const eans=new Set(),codigos=new Set();
  for (let i=indice+1;i<linhas.length;i++) {
    const r=linhas[i];
    const interno=codigo(r[colunas.codigoInterno]);
    const ean=codigo(r[colunas.ean]);
    const nome=codigo(r[colunas.nome]);
    if(!interno&&!ean&&!nome)continue;
    // Ignorar rodapés do relatório oficial (ESTOQUE, TOTAL, Fonte).
    if (/^(estoque|total|fonte|pagina)\b/i.test(interno)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/.test(interno) ||
        !nome || nome.length<2 || nome.length>220 ||
        ean.length>30 || /[<>\x00-\x1f]/.test(nome+ean)) {
      invalidos++;continue;
    }
    if(codigos.has(interno) || (ean && eans.has(ean)))repetidos++;
    codigos.add(interno);
    if (ean)eans.add(ean);else semBarras++;
    itens.push({codigoInterno:interno,ean,nome});
  }
  if (!itens.length)
    throw new ErroRelatorioInova('SEM_PRODUTOS','O arquivo foi lido, mas nenhum produto com Código Interno foi encontrado.');
  return {itens,estatisticas:{
    total:itens.length,semBarras,invalidos,repetidos,
    minimoEsperado:MIN_ROWS_COMPLETO,
    coberturaCompleta:itens.length>=MIN_ROWS_COMPLETO && !invalidos && !repetidos,
    tipoRelatorio:normal(texto.slice(0,150)).startsWith('posicaodeestoque')?'inovafarma_original':'csv_conferencia',
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
