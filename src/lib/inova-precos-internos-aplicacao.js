/**
 * Prévia e aplicação OPCIONAL, transacional, dos dois preços do cadastro
 * interno do InovaFarma. Isolado de promoções por período e do robô de estoque.
 */
import crypto from 'node:crypto';
import {lerPrecosInovaXlsx} from './inova-precos-internos-xlsx.js';

const TTL=30*60*1000;
const idDe=p=>String(p.codigoInterno||p.inovaCatalogo?.codigoInterno||'').trim();
const hash=lista=>crypto.createHash('sha256').update(JSON.stringify(lista
  .map(p=>[p.id,idDe(p),p.ean,p.precoCentavos,p.precoPromocionalCentavos,
    p.precoInternoInovaCentavos,p.precoFixoSite===true,p.ativo,p.inovaArquivado?.em,p.inovaPromocoes])
  .sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex');
const error=(erro,status=400)=>({ok:false,erro,status});

export function avaliarPrecosInternos(db, itens) {
  const produtos=db.collection('products').all();
  const byCode=new Map(),byEan=new Map();
  for(const p of produtos){
    const code=idDe(p),ean=String(p.ean||'');
    if(code)byCode.set(code,[...(byCode.get(code)||[]),p]);
    if(/^\d{8,14}$/.test(ean))byEan.set(ean,[...(byEan.get(ean)||[]),p]);
  }
  const plano=[],resumo={total:itens.length,aplicaveis:0,comDesconto:0,
    semDesconto:0,semCadastro:0,identificacaoAmbigua:0,eanDivergente:0,
    controlados:0,arquivados:0,precoFixoSite:0,precoDivergente:0,promocaoManual:0,
    campanhaConflitante:0,semMudanca:0,alertasPreco:0};
  for(const linha of itens){
    const encontrados=byCode.get(linha.codigo)||[];
    const eans=linha.ean?(byEan.get(linha.ean)||[]):[];
    let motivo='',p=encontrados[0]||null;
    if(encontrados.length>1||eans.length>1||
       (p&&eans.length&&eans[0].id!==p.id)){
      motivo='identificacao_ambigua';resumo.identificacaoAmbigua++;
    }else if(!p&&eans.length===1&&!idDe(eans[0])){
      p=eans[0];
    }else if(!p){motivo='sem_cadastro';resumo.semCadastro++;}
    // Código interno do InovaFarma é a chave principal. Um EAN antigo
    // no catálogo não impede atualizar o mesmo código; EAN de outro SKU
    // continua bloqueado pela conferência de identidade acima.
    if(!motivo&&p&&linha.ean&&p.ean&&linha.ean!==p.ean)
      resumo.eanDivergente++; // aviso; não alterar EAN sem conferência
    if(!motivo&&p?.inovaArquivado?.em){motivo='arquivado';resumo.arquivados++;}
    if(!motivo&&(linha.controlado||p?.bloqueioControladoInova?.ativo||
      p?.sanitario?.controlado)){motivo='controlado';resumo.controlados++;}
    if(!motivo&&p?.precoFixoSite===true){
      motivo='preco_fixo_site';resumo.precoFixoSite++;
    }
    const normal=Number(p?.precoCentavos||0);
    // Preço do InovaFarma tem precedência comercial. Desconto manual,
    // campanha pré-existente e mudança expressiva NÃO bloqueiam o preço
    // exportado; todas as demais informações comerciais permanecem salvas.
    if(!motivo&&normal>0&&(linha.precoCentavos<normal*0.5||
        linha.precoCentavos>normal*1.5||
        (linha.promocaoCentavos>0&&
         linha.promocaoCentavos<linha.precoCentavos*0.2)))
      resumo.alertasPreco++;
    if(!motivo&&Number(p?.precoPromocionalCentavos||0)>0)resumo.promocaoManual++;
    if(!motivo&&Array.isArray(p?.inovaPromocoes)&&p.inovaPromocoes.length)
      resumo.campanhaConflitante++;
    const atual=Number(p?.precoInternoInovaCentavos||0);
    if(!motivo&&normal===linha.precoCentavos&&atual===linha.promocaoCentavos){
      motivo='sem_mudanca';resumo.semMudanca++;
    }
    if(!motivo){
      resumo.aplicaveis++;
      if(linha.promocaoCentavos)resumo.comDesconto++;else resumo.semDesconto++;
    }
    plano.push({codigo:linha.codigo,nome:linha.nome,ean:linha.ean,
      produtoId:p?.id||'',atualBase:normal,atualPromo:atual,
      novoBase:linha.precoCentavos,novoPromo:linha.promocaoCentavos,
      motivo:motivo||'apto'});
  }
  return {plano,resumo,fingerprint:hash(produtos)};
}
export function prepararPrecosInternos(db,bytes,operadorId) {
  let importacao;
  try{importacao=lerPrecosInovaXlsx(bytes);}
  catch(e){return error(e.message||'Excel de preços inválido.');}
  const avaliacao=avaliarPrecosInternos(db,importacao.itens);
  const lote=db.collection('inovaPrecosInternosLotes').insert({
    operadorId,criadoEm:new Date().toISOString(),aplicadoEm:null,
    hash:importacao.hash,fonteResumo:importacao.resumo,
    itens:importacao.itens,fingerprint:avaliacao.fingerprint,
  });
  return {ok:true,id:lote.id,fonte:importacao.resumo,...avaliacao};
}
export function consultarPrecosInternos(db,id,operadorId) {
  const lote=db.collection('inovaPrecosInternosLotes').get(id);
  if(!lote||lote.operadorId!==operadorId)return error('Prévia não localizada.',404);
  const elapsed=Date.now()-Date.parse(lote.criadoEm);
  if(elapsed<0||elapsed>TTL)return error('Prévia expirou. Envie uma exportação recente.',410);
  const avaliacao=avaliarPrecosInternos(db,lote.itens);
  if(avaliacao.fingerprint!==lote.fingerprint&&!lote.aplicadoEm)
    return error('O catálogo mudou após a prévia. Envie o arquivo novamente.',409);
  return {ok:true,id,fonte:lote.fonteResumo,aplicado:!!lote.aplicadoEm,
    ...avaliacao};
}
export function aplicarPrecosInternos(db,id,operadorId,{frase,confirmado,autorizacaoOnline}={}) {
  if(frase!=='APLICAR PRECOS INTERNOS INOVA'||confirmado!=='1'||autorizacaoOnline!=='1')
    return error('Confira os preços e autorize expressamente a aplicação online.',400);
  if(typeof db.storage?.transactionSync!=='function')
    return error('Aplicação exige transação atômica no Worker Cloudflare.',503);
  const previa=consultarPrecosInternos(db,id,operadorId);
  if(!previa.ok)return previa;
  if(previa.aplicado)return error('Lote já aplicado. Não é permitido repetir.',409);
  if(!previa.resumo.aplicaveis)return error('Nenhuma alteração elegível.',409);
  let atualizados=0;
  try {
    db.storage.transactionSync(()=>{
      const col=db.collection('inovaPrecosInternosLotes'),lote=col.get(id);
      if(!lote||lote.aplicadoEm)throw new Error('Lote aplicado anteriormente.');
      const revalidado=avaliarPrecosInternos(db,lote.itens);
      if(revalidado.fingerprint!==lote.fingerprint)throw new Error('Catálogo alterado.');
      const prods=db.collection('products'),agora=new Date().toISOString();
      for(const item of revalidado.plano){
        if(item.motivo!=='apto')continue;
        if(prods.get(item.produtoId)?.precoFixoSite===true)
          throw new Error('Preço fixo ativado depois da prévia.');
        // Não altera EAN, ativo, estoque, sanitarismo, fotos ou campanhas.
        prods.update(item.produtoId,{
          precoCentavos:item.novoBase,precoInternoInovaCentavos:item.novoPromo,
          precoInternoInovaAtualizadoEm:agora,
          atualizadoEm:agora,
        });atualizados++;
      }
      col.update(id,{aplicadoEm:agora,atualizados});
    });
  }catch{
    for(const nome of ['products','inovaPrecosInternosLotes'])db.collections?.delete(nome);
    return error('Falha ao aplicar de forma atômica; não confirme atualização.',500);
  }
  return {ok:true,atualizados};
}
