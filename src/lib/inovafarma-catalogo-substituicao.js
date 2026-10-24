/**
 * Troca INTEGRAL e atômica do catálogo: NÃO reutiliza cadastros antigos.
 * Os 6.128+ produtos do CSV são recriados com IDs novos e todos INATIVOS
 * até revisão de disponibilidade, fotos e classificação sanitária.
 *
 * Pedidos/cobranças/históricos NÃO são apagados. Produtos antigos saem da
 * coleção "products", mas cada documento integral vai para o arquivo
 * privado "inovaCatalogoHistorico", protegido por acesso administrativo.
 *
 * ATENÇÃO: exige cópia de segurança externa confirmada pelo operador,
 * não substituída pelo histórico interno; verifica pendências e reservas
 * antes de oferecer confirmação. Nunca executa na rota de upload.
 */
import crypto from 'node:crypto';
import { uid } from './store.js';
import { slugify } from './security.js';
import { inovaAtiva } from './inovafarma-stock.js';

const LIMITE_BYTES=8*1024*1024;
const MINIMO=6128, MAXIMO=12000;
const PRAZO_MS=20*60*1000;
const BLOCO=200;
const FRASE='SUBSTITUIR TODO O CATALOGO';
const normal=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]/g,'');
const asText=v=>String(v??'').trim();

export class ErroSubstituicaoInova extends Error {
  constructor(message, status=400){super(message);this.name='ErroSubstituicaoInova';this.status=status;}
}

function linhasCSV(texto) {
  const linhas=[];let row=[],campo='',aspas=false;
  const fim=()=>{
    row.push(campo.trim());
    if(row.some(x=>x!==''))linhas.push(row);
    row=[];campo='';
    if(linhas.length>MAXIMO+110)throw new ErroSubstituicaoInova('Arquivo com linhas demais (máximo 12 mil produtos).');
  };
  // O arquivo de substituição é deliberadamente padronizado com ;.
  for(let i=0;i<texto.length;i++){
    const ch=texto[i];
    if(ch==='"'){
      if(aspas&&texto[i+1]==='"'){campo+='"';i++;}
      else aspas=!aspas;
    }else if(ch===';'&&!aspas){row.push(campo.trim());campo='';}
    else if((ch==='\r'||ch==='\n')&&!aspas){
      if(ch==='\r'&&texto[i+1]==='\n')i++;
      fim();
    } else campo+=ch;
  }
  if(aspas)throw new ErroSubstituicaoInova('CSV com aspas não fechadas.');
  fim();
  return linhas;
}
function reaisCentavos(valor) {
  const v=asText(valor).replace(/^R\$\s*/i,'');
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(v))return null;
  const [bruto,decimal='']=v.split(',');
  const n=Number(bruto.replace(/\./g,''))*100+Number(decimal.padEnd(2,'0'));
  return Number.isSafeInteger(n)&&n>0&&n<=100000000?n:null;
}
export function lerCatalogoNovoInova(arquivo) {
  if (!(arquivo instanceof Uint8Array)||!arquivo.length||arquivo.length>LIMITE_BYTES)
    throw new ErroSubstituicaoInova('Selecione o CSV completo do InovaFarma, com até 8 MB.');
  let texto;
  try {texto=new TextDecoder('utf-8',{fatal:true}).decode(arquivo);}
  catch {texto=new TextDecoder('windows-1252').decode(arquivo);}
  const rows=linhasCSV(texto.replace(/^\uFEFF/,''));
  const h=(rows[0]||[]).map(normal);
  const names={
    codigoInterno:['codigointerno','codigo'],
    ean:['ean','codigobarras','codigodebarras'],
    nome:['descricao','produto','nome'],
    quantidade:['quantidade','estoque','saldo'],
    preco:['precodevenda','precovenda'],
    marca:['marca','fabricante'],
    pendencia:['pendencia'],
    estoqueOriginal:['estoqueoriginal'],
  };
  const col=Object.fromEntries(Object.entries(names).map(([n,aliases])=>[
    n,h.findIndex(x=>aliases.includes(x)),
  ]));
  if(['codigoInterno','ean','nome','quantidade','preco'].some(k=>col[k]<0))
    throw new ErroSubstituicaoInova(
      'Use o arquivo único com Código Interno, EAN, Descrição, Quantidade e Preço de Venda. '+
      'A exportação para limpar produtos não contém estoque/preço para importar.');
  const result=[],codes=new Set(),eans=new Set();
  let semEAN=0, estoqueNegativo=0, eanCorrigido=0, semEstoque=0;
  for(let i=1;i<rows.length;i++){
    const r=rows[i],get=k=>col[k]<0?'':asText(r[col[k]]);
    const codigoInterno=get('codigoInterno'), ean=get('ean');
    const nome=get('nome'),marca=get('marca');
    const bruto=get('quantidade'),valor=get('preco');
    const pendencia=get('pendencia');
    if(!/^\d{1,20}$/.test(codigoInterno)||codes.has(codigoInterno))
      throw new ErroSubstituicaoInova('Código interno ausente, repetido ou inválido na linha '+(i+1)+'.');
    if(ean && (!/^\d{8,14}$/.test(ean)||eans.has(ean)))
      throw new ErroSubstituicaoInova('EAN inválido ou repetido na linha '+(i+1)+'.');
    if(!nome||nome.length<2||nome.length>220||/[<>\x00-\x1f]/.test(nome)||
       marca.length>80||/[<>\x00-\x1f]/.test(marca))
      throw new ErroSubstituicaoInova('Descrição ou marca inválida na linha '+(i+1)+'.');
    if(!/^\d+$/.test(bruto)||Number(bruto)>1000000)
      throw new ErroSubstituicaoInova('Quantidade inválida na linha '+(i+1)+'.');
    const precoCentavos=reaisCentavos(valor);
    if(precoCentavos===null)
      throw new ErroSubstituicaoInova('Preço de venda inválido na linha '+(i+1)+'.');
    const origem=get('estoqueOriginal');
    if(origem && !/^-?\d+$/.test(origem))
      throw new ErroSubstituicaoInova('Saldo original inválido na linha '+(i+1)+'.');
    if(origem.startsWith('-')&&bruto!=='0')
      throw new ErroSubstituicaoInova('Saldo negativo deve ser zerado para venda, linha '+(i+1)+'.');
    codes.add(codigoInterno);if(ean)eans.add(ean);else semEAN++;
    if(bruto==='0')semEstoque++;
    if(origem.startsWith('-'))estoqueNegativo++;
    if(/EAN inv[aá]lido/i.test(pendencia))eanCorrigido++;
    result.push({
      codigoInterno,ean,nome,quantidade:Number(bruto),
      precoCentavos,marca,pendencia:pendencia.slice(0,160),
      estoqueOriginal:origem?Number(origem):Number(bruto),
    });
  }
  if(result.length<MINIMO||result.length>MAXIMO)
    throw new ErroSubstituicaoInova(
      'O arquivo tem '+result.length+' registros. Esta substituição requer o '+
      'catálogo integral (pelo menos '+MINIMO+'), inclusive os 66 pendentes.');
  return {itens:result,resumo:{
    importar:result.length,semEAN,estoqueNegativo,eanCorrigido,semEstoque,
  }};
}
function situacaoOperacional(order) {
  const f=asText(order.statusFinanceiro),o=asText(order.statusOperacional);
  // Pagamentos pendentes / estornos em andamento exigem IDs e reservas antigos.
  if(['pendente','estorno_solicitado'].includes(f))return true;
  if(f==='aprovado')return o!=='entregue';
  if(f==='estornado')
    return !['cancelado','devolucao_recebida','encerrado_sem_devolucao'].includes(o);
  if(['recusado','expirado'].includes(f))
    return !['cancelado',''].includes(o);
  return true; // Estado financeiro desconhecido: bloquear.
}
function diagnostico(db) {
  const antigos=db.collection('products').all();
  const pedidos=db.collection('orders').all();
  const carrinhos=db.collection('carts').all();
  const abertos=pedidos.filter(situacaoOperacional);
  const reservados=antigos.filter(p=>
    Number(p.estoque?.reservado||0)>0 ||
    Number(p.estoque?.quarentena||0)>0 ||
    Number(p.estoque?.inovaPendente||0)>0);
  const cestasAtivas=carrinhos.filter(c=>(c.itens||[]).length);
  return {antigos,pedidos,carrinhos,abertos,reservados,cestasAtivas};
}
const hashAtual = d => {
  const hash=crypto.createHash('sha256');
  // O conteúdo dos produtos (não só quantidade) precisa ser o mesmo na aplicação.
  for(const p of d.antigos.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))))
    hash.update(JSON.stringify(p));
  for(const p of d.pedidos.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))))
    hash.update(JSON.stringify([p.id,p.statusFinanceiro,p.statusOperacional,p.atualizadoEm]));
  // Carrinhos vazios podem ser criados por visitantes enquanto o operador
  // confere. Só carrinhos que contêm produtos atuais invalidam a prévia.
  for(const p of d.cestasAtivas.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))))
    hash.update(JSON.stringify([p.id,p.itens]));
  return hash.digest('hex');
};
/**
 * Apenas identificação das pendências para o Superadmin (sem cliente, CPF,
 * e-mail ou dados de pagamento). As rotas de pedido/estoque existentes
 * continuam sendo a única forma de resolver os bloqueios.
 */
export function identificarBloqueiosSubstituicaoInova(db) {
  const d=diagnostico(db);
  const pedidos=d.abertos.map(p=>({
    id:String(p.id||''),
    codigo:String(p.codigo||p.id||''),
    financeiro:String(p.statusFinanceiro||'desconhecido'),
    operacional:String(p.statusOperacional||'desconhecido'),
    conferenciaPagamento:
      p.statusFinanceiro==='pendente' &&
      ['criacao_em_andamento','conciliacao_necessaria'].includes(p.pendenciaPagamento),
    // Jamais presumir que pagamento desconhecido pode ser cancelado.
  }));
  const produtos=d.reservados.map(p=>{
    const e=p.estoque||{};
    const id=String(p.id||'');
    return {
      id,
      codigoInterno:String(p.codigoInterno||''),
      nome:String(p.nome||''),
      reservado:Number(e.reservado||0),
      quarentena:Number(e.quarentena||0),
      inovaPendente:Number(e.inovaPendente||0),
      // Pedidos encerrados também podem explicar uma reserva que ficou presa.
      // Só exibimos identificador e situação, sem dados do consumidor.
      pedidosRelacionados:d.pedidos.filter(o=>
        (o.itens||[]).some(i=>String(i.produtoId||'')===id)
      ).slice(-5).map(o=>({
        id:String(o.id),codigo:String(o.codigo||o.id),
        financeiro:String(o.statusFinanceiro||''),
        operacional:String(o.statusOperacional||''),
      })),
    };
  });
  return {pedidos,produtos,carrinhosParaEsvaziar:d.cestasAtivas.length};
}

const statusResumo=(d,resumo)=>({
  ...resumo,remover:d.antigos.length,pedidosAbertos:d.abertos.length,
  estoqueReservado:d.reservados.length,carrinhosASeremEsvaziados:d.cestasAtivas.length,
  bloqueado:d.abertos.length>0||d.reservados.length>0,
});
const chunkId=(id,n)=>id+'_bloco_'+String(n).padStart(3,'0');

export function prepararSubstituicaoCatalogoInova(db,arquivo,operadorId,agora=new Date()) {
  if(inovaAtiva())throw new ErroSubstituicaoInova(
    'Desative a sincronização automática InovaFarma antes de substituir o catálogo.',409);
  const validacao=lerCatalogoNovoInova(arquivo);
  const estado=diagnostico(db);
  const hash=hashAtual(estado);
  const id='sub_'+crypto.randomUUID();
  const chunks=[];
  for(let i=0;i<validacao.itens.length;i+=BLOCO)
    chunks.push(validacao.itens.slice(i,i+BLOCO));
  const salvar=()=>{
    const partes=db.collection('inovaCatalogoSubstituicaoPartes');
    for(let i=0;i<chunks.length;i++)
      partes.insert({id:chunkId(id,i),loteId:id,itens:chunks[i]});
    db.collection('inovaCatalogoSubstituicoes').insert({
      id,operadorId,criadoEm:agora.toISOString(),quantidadePartes:chunks.length,
      quantidadeProdutos:validacao.itens.length,
      checksum:crypto.createHash('sha256').update(arquivo).digest('hex'),
      fingerprint:hash,aplicadoEm:null,resumo:statusResumo(estado,validacao.resumo)
    });
  };
  try {
    if(typeof db.storage?.transactionSync==='function')db.storage.transactionSync(salvar);
    else salvar();
  }catch(e){
    for(const name of ['inovaCatalogoSubstituicaoPartes','inovaCatalogoSubstituicoes'])
      db.collections?.delete(name);
    throw e;
  }
  return {ok:true,id,resumo:statusResumo(estado,validacao.resumo),
    amostra:validacao.itens.slice(0,25)};
}
function loteAtual(db,id,operadorId,agora=new Date()) {
  const lote=db.collection('inovaCatalogoSubstituicoes').get(id);
  if(!lote||lote.operadorId!==operadorId)
    throw new ErroSubstituicaoInova('Proposta de substituição não encontrada.',404);
  if(lote.aplicadoEm)
    throw new ErroSubstituicaoInova('Esta substituição já foi executada.',409);
  if(agora.getTime()<Date.parse(lote.criadoEm)||
     agora.getTime()-Date.parse(lote.criadoEm)>PRAZO_MS)
    throw new ErroSubstituicaoInova('Prévia expirada. Envie o arquivo novamente.',410);
  const estado=diagnostico(db);
  if(hashAtual(estado)!==lote.fingerprint)
    throw new ErroSubstituicaoInova(
      'Produtos, carrinhos ou pedidos mudaram após a prévia. Envie novamente o CSV.',409);
  return {lote,estado,resumo:statusResumo(estado,lote.resumo)};
}
export function consultarSubstituicaoCatalogoInova(db,id,operadorId,agora=new Date()) {
  const {lote,estado,resumo}=loteAtual(db,id,operadorId,agora);
  return {ok:true,id,resumo,
    pronto:!resumo.bloqueado,
    bloqueios:identificarBloqueiosSubstituicaoInova(db),
    aviso:'Todos os produtos atuais serão retirados, sem aproveitamento. '+
      'Novos produtos entram inativos. Pedidos e pagamentos ficam preservados.'};
}
function montarProduto(linha,idLote,agora,slugs) {
  const base=(slugify(linha.nome)||'produto').slice(0,115);
  let slug=base;
  if(slugs.has(slug))slug=(base.slice(0,92)+'-'+linha.codigoInterno);
  let num=2;
  while(slugs.has(slug))slug=base.slice(0,90)+'-'+linha.codigoInterno+'-'+num++;
  slugs.add(slug);
  return {
    id:uid('inova_novo_'),nome:linha.nome,slug,
    ean:linha.ean,codigoInterno:linha.codigoInterno,sku:'',
    marca:linha.marca,fabricante:'',categoriaId:null,subcategoriaId:null,
    descricao:'',caracteristicas:{},imagens:[],videos:[],
    precoCentavos:linha.precoCentavos,precoPromocionalCentavos:0,
    inovaPromocoes:[],
    peso:0,dimensoes:{largura:0,altura:0,comprimento:0},
    ativo:false,destaque:false,
    sanitario:{classificacao:'nao_aplicavel',requerReceita:true,
      registroMS:'',aprovadoFarmaceutico:false,controlado:false},
    estoque:{quantidade:linha.quantidade,reservado:0,quarentena:0,minimo:5},
    vendas:0,relacionados:[],
    inovaCatalogo:{
      codigoInterno:linha.codigoInterno,ean:linha.ean,origem:'substituicao_total_csv',
      importadoEm:agora,revisaoSanitariaPendente:true,
      pendencia:linha.pendencia,estoqueOriginal:linha.estoqueOriginal,
      loteId:idLote,
    },criadoEm:agora,atualizadoEm:agora,
  };
}
export function aplicarSubstituicaoCatalogoInova(db,id,operadorId,form={},agora=new Date()) {
  if(form.frase!==FRASE||form.autorizou!=='1'||form.backupConfirmado!=='1')
    throw new ErroSubstituicaoInova(
      'Confirme a cópia de segurança, marque a autorização e digite SUBSTITUIR TODO O CATALOGO.',400);
  if(inovaAtiva())throw new ErroSubstituicaoInova(
    'Sincronização InovaFarma por API está ativa. Substituição bloqueada.',409);
  if(typeof db.storage?.transactionSync!=='function')
    throw new ErroSubstituicaoInova(
      'Substituição integral exige transação atômica no Cloudflare Workers.',503);
  const {lote,estado,resumo}=loteAtual(db,id,operadorId,agora);
  if(resumo.bloqueado)throw new ErroSubstituicaoInova(
    'Há '+resumo.pedidosAbertos+' pedidos não encerrados ou '+
    resumo.estoqueReservado+' produtos com reservas/quarentena. Resolva antes.',409);
  // Todos os produtos do lote precisam ser lidos e validados ANTES da escrita.
  const linhas=[];
  for(let i=0;i<lote.quantidadePartes;i++){
    const parte=db.collection('inovaCatalogoSubstituicaoPartes').get(chunkId(id,i));
    if(!parte||!Array.isArray(parte.itens))
      throw new ErroSubstituicaoInova('Prévia incompleta: lote de produtos ausente.',409);
    linhas.push(...parte.itens);
  }
  if(linhas.length!==lote.quantidadeProdutos||linhas.length<MINIMO)
    throw new ErroSubstituicaoInova('Contagem do arquivo de importação alterada.',409);
  const slugs=new Set();
  const novos=linhas.map(p=>montarProduto(p,id,agora.toISOString(),slugs));
  if(new Set(novos.map(p=>p.id)).size!==novos.length)
    throw new ErroSubstituicaoInova('Conflito nos novos identificadores. Tente novamente.',409);
  let antigosArquivados=0,criados=0,carrinhosLimpos=0;
  try {
    db.storage.transactionSync(()=>{
      const col=db.collection('products');
      const backups=db.collection('inovaCatalogoHistorico');
      for(const p of estado.antigos){
        const archived=backups.insert({
          id:id+'__'+p.id,loteId:id,produtoIdOriginal:p.id,
          registradoEm:agora.toISOString(),produto:p,
        });
        if(!archived)throw new Error('Falha ao guardar histórico.');
        antigosArquivados++;
      }
      if(antigosArquivados!==estado.antigos.length)
        throw new Error('Cópia do catálogo antigo incompleta.');
      for(const p of estado.antigos){
        if(!col.remove(p.id))throw new Error('Falha ao excluir um cadastro antigo.');
      }
      if(col.count()!==0)throw new Error('Restaram cadastros antigos na tabela de produtos.');
      for(const p of novos){col.insert(p);criados++;}
      if(col.count()!==novos.length)throw new Error('Quantidade de produtos novos inconsistente.');
      for(const cart of estado.cestasAtivas){
        db.collection('carts').update(cart.id,{itens:[],frete:null,cupomCodigo:null});
        carrinhosLimpos++;
      }
      // Vitrines manuais nunca devem apontar para cadastros apagados.
      db.collection('showcases').updateMany(v=>Array.isArray(v.produtosIds)&&v.produtosIds.length,
        ()=>({produtosIds:[]}));
      db.collection('inovaCatalogoSubstituicoes').update(id,{
        aplicadoEm:agora.toISOString(),checksum:lote.checksum,
        quantidadeAntigos:antigosArquivados,quantidadeNovos:criados,
      });
      for(let i=0;i<lote.quantidadePartes;i++)
        db.collection('inovaCatalogoSubstituicaoPartes').remove(chunkId(id,i));
    });
  }catch(e){
    for(const name of ['products','carts','showcases','inovaCatalogoHistorico',
      'inovaCatalogoSubstituicoes','inovaCatalogoSubstituicaoPartes'])
      db.collections?.delete(name);
    throw new ErroSubstituicaoInova('Troca integral não concluída: transação revertida, catálogo anterior preservado.',500);
  }
  return {ok:true,antigosArquivados,criados,carrinhosLimpos,
    semEAN:resumo.semEAN,estoqueNegativo:resumo.estoqueNegativo,
    motivo:'Novo catálogo criado integralmente do InovaFarma, sem reaproveitar IDs.'};
}
