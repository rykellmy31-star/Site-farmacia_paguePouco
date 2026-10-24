/**
 * Importação inicial VOLUNTÁRIA via relatório CSV exportado pelo estabelecimento.
 * Nunca acessa nem modifica o aplicativo InovaFarma. Etapas: preparar -> revisar -> confirmar.
 * A conferência inteira precede qualquer gravação de estoque. Preços/cadastros
 * existentes, pedidos e regras sanitárias não são modificados.
 */
import crypto from 'node:crypto';
import { nowISO } from './store.js';
import { slugUnicoProduto } from './catalog.js';
import { registrarMovimentoEstoque } from './orders.js';
import { inovaAtiva } from './inovafarma-stock.js';

const MAX_LINHAS = 10000;
const PRAZO_MS = 30 * 60 * 1000;
const EAN = /^\d{8,14}$/;
const normalizar = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');
const opcoes = {
  ean: ['ean','gtin','codigobarras','codigodebarras','codigobarra','codigodebarra','codbarra','codigoean'],
  nome: ['nome','descricao','descricaoproduto','descricaodoproduto','produto','nomedoproduto'],
  quantidade: ['quantidade','qtd','qtdestoque','quantidadeestoque','quantidadeemestoque',
    'estoque','estoqueatual','saldodeestoque','saldodisponivel','saldo','estoquedisponivel'],
  codigoInterno: ['codigointerno','codigoproduto','codigodoproduto','codprod','codigo'],
  marca: ['marca','fabricante'],
};

function parseLinhas(texto) {
  const amostra = String(texto).slice(0,5000).split(/\r?\n/)[0] || '';
  const qt = d => { let aspas = false, n = 0; for (const c of amostra) {
    if (c === '"') aspas = !aspas;
    if (!aspas && c === d) n++;
  } return n; };
  const delim = [';',',','\t'].sort((a,b)=>qt(b)-qt(a))[0];
  if (!qt(delim)) throw new Error('Separador de colunas não encontrado.');
  const linhas=[];let row=[],campo='',aspas=false;
  const addCampo=()=>{row.push(campo.trim());campo='';};
  const addLinha=()=>{addCampo();if(row.some(v=>v!=='')) linhas.push(row);row=[];};
  for(let i=0;i<texto.length;i++){
    const c=texto[i];
    if (c==='"') { if (aspas && texto[i+1]==='"') {campo+='"';i++;}else aspas=!aspas; }
    else if (c===delim && !aspas) addCampo();
    else if ((c==='\n'||c==='\r')&&!aspas){if(c==='\r'&&texto[i+1]==='\n')i++;addLinha();}
    else campo+=c;
    if(linhas.length>MAX_LINHAS+1)throw new Error('O limite é de 10 mil produtos por arquivo.');
  }
  if(aspas)throw new Error('CSV com aspas não fechadas.');
  addLinha();return linhas;
}

function carregarCsv(data) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > 8*1024*1024)
    throw new Error('Envie CSV válido com até 8 MB.');
  let texto;
  try { texto = new TextDecoder('utf-8',{fatal:true}).decode(data); }
  catch { texto = new TextDecoder('windows-1252').decode(data); }
  const linhas=parseLinhas(texto.replace(/^\uFEFF/,''));
  if(linhas.length<2)throw new Error('CSV sem linhas de produtos.');
  const cabecalho=linhas.shift().map(normalizar);
  const idx={};
  for(const [campo,aliases] of Object.entries(opcoes)){
    idx[campo]=cabecalho.findIndex(x=>aliases.includes(x));
  }
  if(idx.ean<0||idx.nome<0||idx.quantidade<0)
    throw new Error('Colunas obrigatórias: código de barras/EAN, descrição e estoque/quantidade.');
  const itens=[],eanSet=new Set();
  for(const row of linhas) {
    const get=c=>idx[c]>=0?String(row[idx[c]]??'').trim():'';
    const ean=get('ean'),nome=get('nome'),valor=get('quantidade');
    if(!EAN.test(ean)||eanSet.has(ean))throw new Error('EAN inválido ou repetido no CSV. Corrija a exportação.');
    eanSet.add(ean);
    if(nome.length<2||nome.length>200||/[<>\x00-\x1f]/.test(nome))
      throw new Error('Nome de produto inválido no arquivo.');
    if(!/^\d+(?:[.,]0+)?$/.test(valor))throw new Error('Estoque deve conter quantidade inteira não negativa.');
    const quantidade=Number(valor.replace(/[,.]0+$/,''));
    if(!Number.isSafeInteger(quantidade)||quantidade>1000000)throw new Error('Quantidade fora do limite seguro.');
    const codigoInterno=get('codigoInterno'),marca=get('marca');
    if(codigoInterno.length>60||marca.length>80||/[<>\x00-\x1f]/.test(codigoInterno+marca))
      throw new Error('Código ou marca inválidos no arquivo.');
    itens.push({ean,nome,quantidade,codigoInterno,marca});
  }
  if(itens.length>MAX_LINHAS)throw new Error('O limite é de 10 mil produtos.');
  return itens;
}

function avaliar(db,itens) {
  const existentes=db.collection('products').all();
  const porEan=new Map(),porCodigo=new Map();
  for(const p of existentes) {
    if(p.ean){const k=String(p.ean).trim();porEan.set(k,[...(porEan.get(k)||[]),p]);}
    if(p.codigoInterno){const k=String(p.codigoInterno).trim();porCodigo.set(k,[...(porCodigo.get(k)||[]),p]);}
  }
  const plano=[];const resumo={novos:0,ajustes:0,semAlteracao:0,esgotados:0,conflitos:0,total:itens.length};
  const seenCod=new Map();
  for(const item of itens) {
    const encontrados=porEan.get(item.ean)||[];
    const codigoItens=item.codigoInterno && porCodigo.get(item.codigoInterno)||[];
    const codigoDuplicado=item.codigoInterno && seenCod.has(item.codigoInterno) && seenCod.get(item.codigoInterno)!==item.ean;
    if(item.codigoInterno)seenCod.set(item.codigoInterno,item.ean);
    const codIncompativel=codigoItens.length>1||codigoItens.some(p=>p.ean&&p.ean!==item.ean);
    const cadastrado=encontrados.length===1?encontrados[0]:null;
    const codigoOutro=codigoItens.length===1&&codigoItens[0].id!==cadastrado?.id;
    const saldo=cadastrado?.estoque||{};
    const reservado=Number(saldo.reservado||0),quarentena=Number(saldo.quarentena||0);
    let tipo='ajustar',motivo='';
    if(encontrados.length>1 || codigoDuplicado || codIncompativel || codigoOutro) {
      tipo='conflito'; motivo='Código associado a outro produto ou cadastro duplicado.';
    } else if(!cadastrado){tipo='novo';}
    else if(!Number.isSafeInteger(reservado)||reservado<0||
        !Number.isSafeInteger(quarentena)||quarentena<0||
        item.quantidade<reservado+quarentena){
      tipo='conflito';motivo='Saldo informado inferior a reservas/quarentena existentes.';
    } else if(Number(saldo.quantidade||0)===item.quantidade){tipo='igual';}
    if(tipo==='novo')resumo.novos++;
    if(tipo==='ajustar')resumo.ajustes++;
    if(tipo==='igual')resumo.semAlteracao++;
    if(tipo==='conflito')resumo.conflitos++;
    if(item.quantidade===0)resumo.esgotados++;
    plano.push({ ...item, tipo, motivo, produtoId:cadastrado?.id||null });
  }
  return {plano,resumo};
}

export function prepararRelatorioEstoque(db,arquivo,{operadorId}={}) {
  if(inovaAtiva())return {ok:false,status:409,erro:'A integração de estoque por API deve permanecer desligada para usar o relatório CSV.'};
  try {
    const itens=carregarCsv(arquivo);
    const analise=avaliar(db,itens);
    const id='csv_'+crypto.randomUUID();
    db.collection('inovaCsvImportacoes').insert({
      id,criadoEm:nowISO(),operadorId:operadorId||null,
      aplicadoEm:null,itens,
      hash:crypto.createHash('sha256').update(arquivo).digest('hex'),
    });
    return {ok:true,id,resumo:analise.resumo};
  }catch{return {ok:false,status:400,erro:'CSV incompatível ou inválido. Confira as colunas, EANs e quantidades inteiras (até 10 mil linhas e 8 MB).'};}
}

export function consultarRelatorioEstoque(db,id,operadorId) {
  const b=db.collection('inovaCsvImportacoes').get(id);
  if(!b||b.operadorId!==operadorId)return {ok:false,status:404,erro:'Prévia não encontrada.'};
  const vencido=Date.now()-Date.parse(b.criadoEm)>PRAZO_MS;
  if(vencido)return {ok:false,status:410,erro:'Prévia vencida; exporte e envie novamente.'};
  const analise=avaliar(db,b.itens);
  return {ok:true,id,aplicado:!!b.aplicadoEm,...analise};
}

export function aplicarRelatorioEstoque(db,id,operadorId) {
  if(inovaAtiva())return {ok:false,status:409,erro:'Sincronização API ligada; não misture fontes de estoque.'};
  const previa=consultarRelatorioEstoque(db,id,operadorId);
  if(!previa.ok)return previa;
  if(previa.aplicado)return {ok:false,status:409,erro:'Este relatório já foi aplicado. Nenhuma alteração repetida.'};
  if(previa.resumo.conflitos)return {ok:false,status:409,erro:'Existem conflitos de identificação ou reservas; nenhuma quantidade foi aplicada.'};
  const op=()=> {
    const agora=nowISO();
    for(const item of previa.plano) {
      let produtoId=item.produtoId;
      if(item.tipo==='novo') {
        const produto=db.collection('products').insert({
          nome:item.nome,slug:slugUnicoProduto(db,item.nome),ean:item.ean,
          codigoInterno:item.codigoInterno,sku:'',marca:item.marca,fabricante:'',
          categoriaId:null,subcategoriaId:null,descricao:'',caracteristicas:{},
          imagens:[],videos:[],precoCentavos:0,precoPromocionalCentavos:0,
          peso:0,dimensoes:{largura:0,altura:0,comprimento:0},
          ativo:false,destaque:false,sanitario:{
            classificacao:'nao_aplicavel',requerReceita:true,controlado:false,
            registroMS:'',aprovadoFarmaceutico:false,
          },
          estoque:{quantidade:0,reservado:0,minimo:5},vendas:0,relacionados:[],
          inovaCatalogo:{ean:item.ean,importadoEm:agora,revisaoSanitariaPendente:true,origem:'relatorio_csv'},
          criadoEm:agora,atualizadoEm:agora,
        });
        produtoId=produto.id;
      }
      if(item.tipo==='novo'||item.tipo==='ajustar') {
        registrarMovimentoEstoque(db,{
          produtoId,tipo:'ajuste',quantidade:item.quantidade,
          origem:'inovafarma_relatorio_csv',usuarioId:operadorId,
          observacao:'Saldo absoluto da exportação do ERP confirmado pelo superadministrador.',
        });
      }
    }
    db.collection('inovaCsvImportacoes').update(id,{
      aplicadoEm:agora,itens:[],resumoAplicado:previa.resumo,
    });
  };
  // No Worker as operações SQLite integram UMA transação atômica.
  try {
    if(typeof db.storage?.transactionSync==='function')db.storage.transactionSync(op);
    else op();
  } catch {return {ok:false,status:500,erro:'Não foi possível concluir; confira os dados antes de tentar novamente.'};}
  return {ok:true,...previa.resumo,aplicado:true};
}
