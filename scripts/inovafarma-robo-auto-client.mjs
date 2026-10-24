/** Robô InovaFarma V3 — Node 22/Windows, zero dependências.
 * Lê SOMENTE CSV exportado pelo operador, nunca acessa API ou DB do ERP.
 * Atualiza o site automaticamente APÓS pareamento único no painel.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SITE='https://site.farmaciapaguepouco.app';
const LIMITE_BYTES=8*1024*1024, POR_LOTE=200, MIN_MS=12000;
const EAN=/^\d{8,14}$/, COD=/^\d{1,20}$/;
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]/g,'');
const erro=(m)=>{throw Error(m)};
const dormir=ms=>new Promise(r=>setTimeout(r,ms));
function csvLinhas(txt){
  const rows=[];let row=[],campo='',aspas=false;
  for(let i=0;i<txt.length;i++){
    const ch=txt[i];
    if(ch==='"'){if(aspas&&txt[i+1]==='"'){campo+='"';i++;}else aspas=!aspas;}
    else if(ch===';'&&!aspas){row.push(campo.trim());campo='';}
    else if((ch==='\n'||ch==='\r')&&!aspas){
      if(ch==='\r'&&txt[i+1]==='\n')i++;
      row.push(campo.trim());if(row.some(Boolean))rows.push(row);
      row=[];campo='';if(rows.length>12500)erro('Mais de 12 mil linhas no relatório');
    }else campo+=ch;
  }
  if(aspas)erro('CSV com aspas inválidas');
  row.push(campo.trim());if(row.some(Boolean))rows.push(row);
  return rows;
}
function lerTexto(bytes){
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}
  catch{return new TextDecoder('windows-1252').decode(bytes).replace(/^\uFEFF/,'');}
}
function centavos(valor){
  const txt=String(valor||'').trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(txt))return null;
  const [reais,fracao='']=txt.split(',');
  const n=Number(reais.replaceAll('.',''))*100+Number(fracao.padEnd(2,'0'));
  return Number.isSafeInteger(n)&&n>0&&n<=100000000?n:null;
}
export function lerRelatorioOriginalRobo(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>LIMITE_BYTES)
    erro('Arquivo vazio ou maior que 8 MB');
  const csv=lerTexto(bytes);
  if(/^\s*RELAT[OÓ]RIO DE PROMO/i.test(csv))
    erro('Este arquivo é de promoções. Para atualizar estoque/preço, exporte Posição de Estoque.');
  const rows=csvLinhas(csv);
  let head=-1,cols={};
  for(let i=0;i<Math.min(rows.length,80);i++){
    const n=rows[i].map(norm);
    const campo=ali=>n.findIndex(x=>ali.includes(x));
    const t={
      codigo:campo(['codigo','codigointerno','cod']),
      ean:campo(['codbarra','codbarras','codigobarras','ean','codigodebarras']),
      nome:campo(['produto','descricao','nome']),
      estoque:campo(['estoque','quantidade','saldo']),
      preco:campo(['precovenda','precodevenda']),
      marca:campo(['fabricante','marca']),
    };
    if(t.codigo>=0&&t.nome>=0&&t.estoque>=0&&t.preco>=0){
      head=i;cols=t;break;
    }
  }
  if(head<0)erro('Não foi localizado o cabeçalho Código, Produto, Estoque e Preço Venda');
  const itens=[],codigos=new Set();const resumo={
    semEan:0,eanInvalido:0,negativosNeutralizados:0,precoInvalido:0,
    duplicados:0,linhasInvalidas:0,
  };
  for(const r of rows.slice(head+1)){
    const get=k=>cols[k]>=0?String(r[cols[k]]??'').trim():'';
    const codigo=get('codigo');
    if(!COD.test(codigo))continue; // Rodapé do relatório não é produto.
    const nome=get('nome'),strQtd=get('estoque');
    const precoCentavos=centavos(get('preco'));
    const rawQtd=/^-?\d+(?:[,.]0+)?$/.test(strQtd)?
      Number(strQtd.replace(/[,.]0+$/,'')):NaN;
    if(codigos.has(codigo)){resumo.duplicados++;continue;}
    codigos.add(codigo);
    if(!nome||nome.length>220||/[<>\x00-\x1f]/.test(nome)||
       !Number.isSafeInteger(rawQtd)||Math.abs(rawQtd)>1000000){
      resumo.linhasInvalidas++;continue;
    }
    if(precoCentavos===null){resumo.precoInvalido++;continue;}
    const originalEAN=get('ean');
    if(!originalEAN)resumo.semEan++;
    else if(!EAN.test(originalEAN))resumo.eanInvalido++;
    if(rawQtd<0)resumo.negativosNeutralizados++;
    itens.push({codigoInterno:codigo,ean:EAN.test(originalEAN)?originalEAN:'',
      nome,marca:get('marca').slice(0,80),
      quantidade:Math.max(0,rawQtd),precoCentavos});
  }
  if(itens.length<3000||itens.length>12000||
    (resumo.duplicados+resumo.linhasInvalidas+resumo.precoInvalido)>rows.length*.03)
    erro('Relatório incompleto ou com erros excessivos; não aplicar parcialmente.');
  return {itens,resumo};
}
export function dataExtracaoRobo(nome){
  // InovaFarma: Análise de produtos-24-10-2026 193856.csv.
  const m=/(\d{2})-(\d{2})-(\d{4})\s+(\d{6})/.exec(nome);
  if(!m)erro('O nome do CSV não contém data de exportação. Exporte novamente pelo InovaFarma.');
  const [,dia,mes,ano,hora]=m;
  const iso=`${ano}-${mes}-${dia}T${hora.slice(0,2)}:${hora.slice(2,4)}:${hora.slice(4)}-03:00`;
  const ms=Date.parse(iso);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==new Date(ms).toISOString()||
    ms>Date.now()+5*60*1000||ms<Date.now()-90*86400000)erro('Data de extração inválida.');
  return iso;
}
function tokenSeguroWindows(pasta) {
  if(process.platform!=='win32')erro('O pareamento DPAPI requer Windows.');
  const arq=path.join(pasta,'.robo-inovafarma','segredo.dpapi');
  const escapePS=arq.replaceAll("'","''");
  const ps=`$ErrorActionPreference='Stop';$v=(Get-Content -LiteralPath '${escapePS}' -Raw).Trim();$s=ConvertTo-SecureString $v;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}`;
  const cmd=Buffer.from(ps,'utf16le').toString('base64');
  const token=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',cmd],{
    encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024,
  }).trim();
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))erro('A chave de pareamento foi inválida.');
  return token;
}
async function enviar(url,token,dados,{fetchFn=fetch}={}){
  let ultimaFalha;
  for(let tentativa=0;tentativa<4;tentativa++){
    try{
      const res=await fetchFn(SITE+url,{
        method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+token},
        body:JSON.stringify(dados),signal:AbortSignal.timeout(20000),
      });
      const json=await res.json();
      if(!res.ok||!json.ok){
        if(res.status>=400&&res.status<500)erro(json.erro||'Servidor recusou relatório');
        throw Error(json.erro||'Erro temporário do servidor');
      }
      return json;
    }catch(e){
      ultimaFalha=e;
      if(/Servidor recusou relatório|não pareado|antigo|Relatório|incompleto/i.test(e.message))
        break;
      if(tentativa<3)await dormir(1000*(tentativa+1));
    }
  }
  throw ultimaFalha;
}
export async function sincronizarRobo({bytes,nome,token,fetchFn=fetch}){
  const {itens,resumo}=lerRelatorioOriginalRobo(bytes);
  const geradoEm=dataExtracaoRobo(nome);
  const arquivoHash=crypto.createHash('sha256').update(bytes).digest('hex');
  const blocos=Math.ceil(itens.length/POR_LOTE);
  for(let bloco=0;bloco<blocos;bloco++){
    const r=await enviar('/webhooks/robo-inovafarma/lote',token,
      {arquivoHash,geradoEm,total:itens.length,bloco,blocos,
        itens:itens.slice(bloco*POR_LOTE,(bloco+1)*POR_LOTE)},{fetchFn});
    if(r.concluido)return {ok:true,duplicado:true,arquivoHash,resumo};
  }
  let final;
  for(let bloco=0;bloco<blocos;bloco++){
    final=await enviar('/webhooks/robo-inovafarma/aplicar',token,
      {arquivoHash,bloco},{fetchFn});
  }
  return {...final,arquivoHash,resumo};
}
async function main() {
  const pasta=path.resolve(process.argv[2]||'C:\\InovaExportacoes');
  await fs.mkdir(pasta,{recursive:true});
  const dir=path.join(pasta,'.robo-inovafarma');
  await fs.mkdir(dir,{recursive:true});
  const statePath=path.join(dir,'sincronizados.json');
  let sincronizados={};
  try{sincronizados=JSON.parse(await fs.readFile(statePath,'utf8'));}
  catch(e){if(e.code!=='ENOENT')erro('Histórico local danificado; não sobrescrever.');}
  const token=tokenSeguroWindows(pasta);
  console.log('ROBÔ INOVAFARMA AUTOMÁTICO: arquivo exportado -> farmácia (sem intermediários).');
  console.log('Monitorando '+pasta+'. O navegador não precisa permanecer aberto.');
  let emAndamento=false;
  const verificar=async()=>{
    if(emAndamento)return;emAndamento=true;
    try{
      const arquivos=(await fs.readdir(pasta,{withFileTypes:true}))
        .filter(x=>x.isFile()&&/\.csv$/i.test(x.name)&&/an[aá]lise de produtos|posi[cç][aã]o de estoque/i.test(x.name));
      const novos=[];
      for(const a of arquivos){
        const local=path.join(pasta,a.name),st=await fs.stat(local);
        if(Date.now()-st.mtimeMs<MIN_MS||st.size<100||st.size>LIMITE_BYTES)continue;
        const stamp=dataExtracaoRobo(a.name);
        const bytes=await fs.readFile(local);
        const hash=crypto.createHash('sha256').update(bytes).digest('hex');
        if(!sincronizados[hash])novos.push({nome:a.name,bytes,hash,stamp});
      }
      // Apenas o relatório MAIS RECENTE; não sobrescrever o ERP com arquivo antigo.
      novos.sort((a,b)=>Date.parse(b.stamp)-Date.parse(a.stamp));
      if(novos.length){
        const r=await sincronizarRobo({...novos[0],token});
        sincronizados[novos[0].hash]={em:new Date().toISOString(),atualizados:r.atualizados,
          pendentes:r.pendentes,novosInativos:r.novosInativos};
        const tmp=statePath+'.tmp';
        await fs.writeFile(tmp,JSON.stringify(sincronizados,null,2));
        await fs.rename(tmp,statePath);
        console.log('SINCRONIZADO:',novos[0].nome,
          '| Atualizados:',r.atualizados??0,'| Novos inativos:',r.novosInativos??0,
          '| Para conferir no painel:',r.pendentes??0);
      }
    }catch(e){console.error('Não foi possível sincronizar:',e.message,
      '— dados no site não serão presumidos atualizados.');}
    finally{emAndamento=false;}
  };
  await verificar();
  console.log('Agora basta exportar o relatório de estoque na pasta indicada.');
  setInterval(verificar,20000);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('Falha na configuração:',e.message);process.exitCode=1;});
