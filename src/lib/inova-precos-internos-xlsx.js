/**
 * Leitura local de XLSX exportado em Gerenciar Produtos do InovaFarma.
 * Nunca lê preços de custo, não faz conexão com o ERP e não altera estoque.
 * ZIP/XML limitado para arquivos não confiáveis; sem dependências externas.
 */
import {inflateRawSync} from 'node:zlib';
import crypto from 'node:crypto';

const BYTES_MAX=8*1024*1024, XML_MAX=20*1024*1024;
const failure = texto => { throw new Error(texto); };
const norm = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
const entidades = value => String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,(all,x)=>{
  const fixed={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  if(fixed[x])return fixed[x];
  if(x[0]==='#'){const n=x[1]?.toLowerCase()==='x'?parseInt(x.slice(2),16):parseInt(x.slice(1),10);
    return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
  return all;
});
const attr=(attrs,key)=>new RegExp('(?:^|\\s)'+key+'="([^"]*)"').exec(attrs)?.[1]||'';

function arquivosZip(bytes){
  const b=Buffer.from(bytes);
  if(b.length>BYTES_MAX||b.length<100||b.readUInt32LE(0)!==0x04034b50)
    failure('Arquivo XLSX inválido ou maior que 8 MB.');
  let eocd=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)failure('Arquivo XLSX incompleto.');
  const total=b.readUInt16LE(eocd+10),offset=b.readUInt32LE(eocd+16);
  if(total===0||total>150||offset>=b.length)failure('Estrutura XLSX fora dos limites.');
  const entries=new Map(); let at=offset;
  for(let i=0;i<total;i++){
    if(at+46>b.length||b.readUInt32LE(at)!==0x02014b50)failure('Diretório XLSX inválido.');
    const method=b.readUInt16LE(at+10),flags=b.readUInt16LE(at+8);
    const zipped=b.readUInt32LE(at+20),unzipped=b.readUInt32LE(at+24);
    const nameLength=b.readUInt16LE(at+28),extra=b.readUInt16LE(at+30),
      comment=b.readUInt16LE(at+32),local=b.readUInt32LE(at+42);
    const name=b.toString('utf8',at+46,at+46+nameLength);
    if(flags&1||!([0,8].includes(method))||unzipped>XML_MAX||zipped>BYTES_MAX)
      failure('Arquivo XLSX contém dados compactados não suportados.');
    if(name.includes('..')||name.startsWith('/'))failure('Caminho XLSX inválido.');
    entries.set(name,{method,zipped,unzipped,local});
    at+=46+nameLength+extra+comment;
  }
  const read=name=>{
    const entry=entries.get(name);if(!entry)return null;
    const local=entry.local;
    if(local+30>b.length||b.readUInt32LE(local)!==0x04034b50)failure('Entrada XLSX inválida.');
    const start=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
    if(start+entry.zipped>b.length)failure('Dados XLSX incompletos.');
    const data=b.subarray(start,start+entry.zipped);
    const out=entry.method===8?inflateRawSync(data,{maxOutputLength:XML_MAX}):data;
    if(out.length!==entry.unzipped)failure('Tamanho descompactado XLSX inconsistente.');
    return out.toString('utf8');
  };
  return {read,names:[...entries.keys()]};
}

function sharedStrings(xml){
  if(!xml) return [];
  const values=[]; const re=/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  for(const match of xml.matchAll(re)){
    const texts=[...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
    values.push(texts.map(m=>entidades(m[1])).join(''));
    if(values.length>100000)failure('Excesso de textos na planilha XLSX.');
  }
  return values;
}
function celulas(linha,shared){
  const cells={};
  // O Excel do Inova usa células vazias autoconclusivas, como <c r="A2" s="1" />.
  // Se ignoradas, a leitura da primeira célula vazia "engole" a próxima célula
  // com valor (B2 = Código), fazendo o importador rejeitar o cabeçalho correto.
  for(const match of linha.matchAll(/<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g)){
    const col=/^([A-Z]+)[0-9]+$/.exec(attr(match[1],'r'))?.[1];
    if(!col)continue;
    const conteudo=match[2]||'';
    const kind=attr(match[1],'t'),v=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(conteudo)?.[1];
    let val=v==null?'':kind==='s'?shared[Number(v)]??'':entidades(v);
    if(kind==='inlineStr')val=entidades(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(conteudo)?.[1]||'');
    cells[col]=String(val).trim();
  }
  return cells;
}
function moeda(valor){
  const s=String(valor||'').trim().replace(/^R\$\s*/,'');
  if(!s||s==='None')return null;
  const raw=s.includes(',')?s.replace(/\./g,'').replace(',','.'):s;
  if(!/^\d+(?:\.\d{1,4})?$/.test(raw))return null;
  const n=Number(raw),c=Math.round(n*100);
  return Number.isSafeInteger(c)&&c>=0&&c<=100000000?c:null;
}

export function lerPrecosInovaXlsx(bytes){
  const zip=arquivosZip(bytes);
  const shared=sharedStrings(zip.read('xl/sharedStrings.xml'));
  const sheet=zip.names.filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if(!sheet)failure('A planilha não contém dados de produtos.');
  const xml=zip.read(sheet),rows=[...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)];
  if(rows.length<3||rows.length>20000)failure('Quantidade de linhas inesperada no Excel.');
  let headers=null,start=-1;
  for(let i=0;i<Math.min(12,rows.length);i++){
    const cells=celulas(rows[i][2],shared),map={};
    for(const [col,v] of Object.entries(cells))map[norm(v)]=col;
    if(map.codigo&&map.produto&&map.precovenda&&map.precopromocao&&map.codigobarra){
      headers={codigo:map.codigo,nome:map.produto,preco:map.precovenda,
        promocao:map.precopromocao,ean:map.codigobarra,ativo:map.ativo,
        controlado:map.controlado};start=i+1;break;
    }
  }
  if(!headers)failure('Faltam colunas Código, Produto, Preço Venda, Preço Promoção ou Código Barra.');
  const itens=[],codigos=new Set();
  const resumo={linhas:0,precoPromocional:0,semPromocao:0,precoInvalido:0,
    promocaoInvalida:0,codigosDuplicados:0,controlados:0,semEan:0};
  for(const row of rows.slice(start)){
    const cell=celulas(row[2],shared),get=k=>String(cell[headers[k]]??'').trim();
    const codigo=get('codigo');
    if(!/^\d{1,20}$/.test(codigo))continue;
    resumo.linhas++;
    if(codigos.has(codigo)){resumo.codigosDuplicados++;continue;}
    codigos.add(codigo);
    const preco=moeda(get('preco')),promo=moeda(get('promocao'));
    const nome=get('nome').slice(0,220),ean=get('ean');
    if(!nome||!preco||!Number.isSafeInteger(preco)){resumo.precoInvalido++;continue;}
    if(promo===null){resumo.promocaoInvalida++;continue;}
    if(promo>0&&promo>=preco){resumo.promocaoInvalida++;continue;}
    if(promo)resumo.precoPromocional++;else resumo.semPromocao++;
    const controlado=get('controlado').toLowerCase()==='checked';
    if(controlado)resumo.controlados++;
    if(!ean||ean==='None')resumo.semEan++;
    itens.push({codigo,nome,ean: /^\d{8,14}$/.test(ean)?ean:'',
      precoCentavos:preco,promocaoCentavos:promo,
      controlado,ativo:get('ativo').toLowerCase()!=='unchecked'});
  }
  if(itens.length<1||resumo.codigosDuplicados||resumo.precoInvalido>Math.max(5,resumo.linhas*0.01))
    failure('Existem muitos preços ou códigos inconsistentes no Excel. Nenhum desconto foi preparado.');
  return {itens,resumo,hash:crypto.createHash('sha256').update(bytes).digest('hex')};
}
