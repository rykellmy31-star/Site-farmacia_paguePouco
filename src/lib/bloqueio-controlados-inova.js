/**
 * Barreira administrativa para produtos potencialmente sujeitos a controle especial.
 * A lista recebida do InovaFarma é uma lista de EXCLUSÃO, não uma autorização.
 * Bloqueios não apagam cadastro, estoque ou histórico de pedidos.
 */
import crypto from 'node:crypto';

const COL = 'inovaControladosListaBloqueio';
const MAX_LINHAS = 12000;
const LIMIT_BYTES = 4 * 1024 * 1024;
export const TERMOS_INICIAIS = Object.freeze([
  'alprazolam','bromazepam','clonazepam','diazepam','fenobarbital',
  'lorazepam','metilfenidato','midazolam','morfina','oxicodona',
  'tramadol','zolpidem',
]);

export const normalizarNome = v => String(v ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim();

const coluna = v => normalizarNome(v).replace(/ /g,'');
const COD = /^\d{1,20}$/;
const EAN = /^\d{8,14}$/;
const opcoes = {
  codigoInterno: ['codigo','codigointerno','codigoproduto','codproduto','cod','codprod','codigodoitem'],
  ean: ['ean','gtin','codbarras','codbarra','codigobarra','codigobarras','codigodebarras','codigodebarra','codigoean','codbarraean'],
  nome: ['nome','produto','medicamento','nomeproduto','nomedoproduto','descricao','descricaoproduto','descricaodoproduto','nomecomercial'],
};
function lerLinhas(texto) {
  const primeira = texto.split(/\r?\n/,1)[0];
  const contar = separador => {
    let quoted = false, q = 0;
    for (const c of primeira) { if (c==='"') quoted=!quoted; else if (!quoted && c===separador) q++; }
    return q;
  };
  const sep = [';',',','\t'].sort((a,b)=>contar(b)-contar(a))[0];
  const linhas=[]; let linha=[], campo='', quoted=false;
  const fecharCampo=()=>{linha.push(campo.trim());campo='';};
  const fecharLinha=()=>{fecharCampo();if(linha.some(x=>x))linhas.push(linha);linha=[];};
  for(let i=0;i<texto.length;i++){
    const c=texto[i];
    if(c==='"'){if(quoted && texto[i+1]==='"'){campo+='"';i++;}else quoted=!quoted;}
    else if(!quoted && c===sep)fecharCampo();
    else if(!quoted && (c==='\r'||c==='\n')){
      if(c==='\r' && texto[i+1]==='\n')i++;
      fecharLinha();
    }else campo+=c;
    if(linhas.length>MAX_LINHAS+35)throw new Error('Arquivo ultrapassou o limite de linhas.');
    if(campo.length>4000)throw new Error('Campo muito extenso no CSV.');
  }
  if(quoted)throw new Error('CSV com aspas não fechadas.');
  if(campo||linha.length)fecharLinha();
  return linhas;
}

export function prepararListaControlados(arquivo) {
  if(!arquivo?.length || arquivo.length > LIMIT_BYTES)throw new Error('Envie CSV de até 4 MB.');
  let texto;
  try {texto=new TextDecoder('utf-8',{fatal:true}).decode(arquivo);}
  catch {texto=new TextDecoder('windows-1252').decode(arquivo);}
  const linhas=lerLinhas(texto.replace(/^\uFEFF/,''));
  if(linhas.length<2)throw new Error('CSV sem cabeçalho e produtos.');
  let inicio=-1,idx={};
  for(let i=0;i<Math.min(linhas.length,30);i++){
    const h=linhas[i].map(coluna);
    const candidatos=Object.fromEntries(Object.keys(opcoes).map(k=>[k,h.findIndex(x=>opcoes[k].includes(x))]));
    if(Object.values(candidatos).some(x=>x!==-1)){inicio=i;idx=candidatos;break;}
  }
  if(inicio<0)throw new Error('Colunas não reconhecidas. Use Código, Cod. Barra/EAN e/ou Produto.');
  const encontrados=new Map();
  for(const linha of linhas.slice(inicio+1)){
    const get=k=>idx[k]<0?'':String(linha[idx[k]]||'').trim();
    const codigoInterno=get('codigoInterno').replace(/\.0+$/,'');
    const ean=get('ean').replace(/\.0+$/,'');
    const nome=get('nome');
    // Ignorar rodapés sem identificadores, mas rejeitar dados evidentemente inválidos.
    if(!codigoInterno&&!ean&&!nome)continue;
    if(!COD.test(codigoInterno||'') && codigoInterno)throw new Error('Código interno inválido no CSV.');
    if(!EAN.test(ean||'') && ean)throw new Error('EAN inválido no CSV: '+ean.slice(0,30));
    if(nome.length>220 || /[<>\x00-\x1f]/.test(nome))throw new Error('Descrição inválida no CSV.');
    if(!codigoInterno && !ean && normalizarNome(nome).length<5)
      throw new Error('Nome insuficiente para identificação: '+nome);
    const id='inova-controlado-'+crypto.createHash('sha256').update(
      JSON.stringify([codigoInterno,ean,normalizarNome(nome)])).digest('hex').slice(0,32);
    encontrados.set(id,{id,codigoInterno,ean,nome});
  }
  if(!encontrados.size)throw new Error('Nenhuma linha de medicamento válida foi encontrada.');
  if(encontrados.size>MAX_LINHAS)throw new Error('Limite de 12 mil produtos por arquivo.');
  return [...encontrados.values()];
}

/** Acrescenta lista de bloqueio, nunca substitui/revoga entradas antigas silenciosamente. */
export function adicionarListaControlados(db,arquivo) {
  const linhas=prepararListaControlados(arquivo);
  const col=db.collection(COL);
  let novos=0, repetidos=0;
  for(const row of linhas){
    if(col.get(row.id)){repetidos++;continue;}
    col.insert({...row,adicionadoEm:new Date().toISOString()});
    novos++;
  }
  return {novos,repetidos,total:col.all().length,arquivo:linhas.length};
}
export function criarAvaliadorControlados(db){
  const rows=db.collection(COL).all();
  const codigos=new Set(),eans=new Set(),nomes=new Set();
  for(const r of rows) {
    if(r.codigoInterno)codigos.add(String(r.codigoInterno));
    if(r.ean)eans.add(String(r.ean));
    if(r.nome)nomes.add(normalizarNome(r.nome));
  }
  return item=>{
    const nome=normalizarNome(item.nome||'');
    const codigo=String(item.codigoInterno||'');
    const ean=String(item.ean||'');
    const termos=TERMOS_INICIAIS.filter(t=>(' '+nome+' ').includes(' '+t+' '));
    if(codigo && codigos.has(codigo))return {bloqueado:true,motivo:'codigo_na_lista_csv',termos};
    if(ean && eans.has(ean))return {bloqueado:true,motivo:'ean_na_lista_csv',termos};
    if(nome && nomes.has(nome))return {bloqueado:true,motivo:'nome_na_lista_csv',termos};
    if(termos.length)return {bloqueado:true,motivo:'principio_ativo_na_lista_inicial',termos};
    return {bloqueado:false,motivo:'',termos:[]};
  };
}
export function identificarPossivelControlado(nome,principioAtivo=''){
  const texto=normalizarNome(nome+' '+principioAtivo);
  return TERMOS_INICIAIS.filter(t=>(' '+texto+' ').includes(' '+t+' '));
}
/**
 * Inativa cadastros existentes somente quando correspondem à lista, sem apagá-los
 * nem alterar movimentações, saldos, preços, pedidos ou identificação sanitária.
 * Também protege cadastros antes da próxima sincronização.
 */
export function bloquearControladosExistentes(db) {
  const avaliar=criarAvaliadorControlados(db);
  const col=db.collection('products');
  let bloqueados=0,jaBloqueados=0;
  for(const p of col.all()){
    if(p.inovaArquivado?.em)continue;
    const r=avaliar(p);
    if(!r.bloqueado)continue;
    if(p.bloqueioControladoInova?.ativo && !p.ativo){jaBloqueados++;continue;}
    col.update(p.id,{
      ativo:false, destaque:false,
      bloqueioControladoInova:{ativo:true,motivo:r.motivo,bloqueadoEm:new Date().toISOString()},
      atualizadoEm:new Date().toISOString(),
    });
    bloqueados++;
  }
  return {bloqueados,jaBloqueados};
}
export function contarListaControlados(db){
  return db.collection(COL).all().length;
}
