/**
 * Aplicação confirmada de promoções CSV no catálogo existente.
 * Sem mudar pedidos, estoque, preços BASE, EAN ou classificação sanitária.
 * A atualização é atômica no Durable Object da Cloudflare e respeita datas
 * em America/Bahia no catálogo e no checkout.
 */
import crypto from 'node:crypto';
import { analisarPromocoesInovaCsv } from './inovafarma-promocoes-csv.js';
import { diaLocalFarmacia } from './inovafarma-promocoes-precos.js';

const PRAZO_MS = 30 * 60 * 1000;
const LIMITE_MILIS = 90 * 86400000;
const CODIGO = /^\d{1,20}$/;
const SO_CONFIRMACAO = 'APLICAR DESCONTOS INOVAFARMA';
const assinatura = produtos => crypto.createHash('sha256').update(JSON.stringify(
  produtos.map(p=>[
    p.id,p.codigoInterno,p.ean,p.precoCentavos,
    p.precoPromocionalCentavos,p.inovaPromocoes,p.inovaArquivado?.em,
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
)).digest('hex');
const agrupar = promocao => {
  const codigos = new Map();
  for (const p of promocao) {
    const chave=String(p.codigoInterno||'').trim();
    const lista=codigos.get(chave)||[];
    lista.push(p);
    codigos.set(chave,lista);
  }
  return codigos;
};
function validarPolitica(politica, hoje) {
  const aceitaTodosOnline = politica?.aceitaTodosOnline === true;
  const fimAberto=String(politica?.fimSemData || '').trim();
  if (fimAberto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fimAberto))
      throw new Error('Data final das campanhas semanais inválida.');
    const d=new Date(fimAberto+'T12:00:00Z');
    const hojeMs=Date.parse(hoje+'T12:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==fimAberto ||
        fimAberto<hoje || d.getTime()-hojeMs>LIMITE_MILIS)
      throw new Error('A validade das campanhas sem data final deve estar entre hoje e 90 dias.');
  }
  return { aceitaTodosOnline, fimAberto };
}
function avaliar(db, linhas, politica, momento=new Date()) {
  const produtos=db.collection('products').all();
  const hoje=diaLocalFarmacia(momento);
  const plano=[];
  const encontrados=new Map();
  for (const produto of produtos) {
    const codigo=String(produto.codigoInterno||'').trim();
    if (!codigo) continue;
    const list=encontrados.get(codigo)||[];
    list.push(produto); encontrados.set(codigo,list);
  }
  const resumo={
    codigos:0,prontos:0,campanhasAceitas:0,semProduto:0,codigoDuplicado:0,
    precoDivergente:0,semDataFinal:0,semDiaSemanal:0,
    pagamentosRestritos:0,precosInvalidos:0,arquivados:0,
    vencidas:0,conflitosAtuais:0,manuaisSubstituidas:0,
  };
  for (const [codigo, campanhas] of agrupar(linhas)) {
    resumo.codigos++;
    const lista=encontrados.get(codigo)||[];
    const nome=campanhas[0]?.nome||'';
    const linha={codigoInterno:codigo,nome,produtoId:null,
      status:'pendente',ofertas:[],quantidade:campanhas.length};
    if (lista.length!==1) {
      linha.status=lista.length?'codigo_duplicado':'sem_produto';
      resumo[lista.length?'codigoDuplicado':'semProduto']++;
      plano.push(linha);continue;
    }
    const p=lista[0];linha.produtoId=p.id;
    if(p.inovaArquivado?.em){linha.status='arquivado';resumo.arquivados++;plano.push(linha);continue;}
    if(!CODIGO.test(codigo)){linha.status='codigo_invalido';resumo.precosInvalidos++;plano.push(linha);continue;}
    const base=Number(p.precoCentavos);
    if(!Number.isSafeInteger(base)||base<=0||
       campanhas.some(c=>c.precoVendaCentavos!==base)) {
      linha.status='preco_divergente';resumo.precoDivergente++;plano.push(linha);continue;
    }
    const ofertas=[];const chaves=new Set();let motivo=null;
    for(const c of campanhas) {
      const camp=c.campanha||{};
      if (!camp.fim && !politica.fimAberto) {
        motivo='sem_data_final';continue;
      }
      const fim=camp.fim||politica.fimAberto;
      if (!fim || fim<camp.inicio) {motivo='data_invalida';continue;}
      if (fim<hoje){resumo.vencidas++;continue;}
      if (!camp.fim && !camp.diaSugerido) {
        motivo='sem_dia_semanal';continue;
      }
      if ((camp.formasPagamento||[]).length && !politica.aceitaTodosOnline){
        motivo='pagamentos_restritos';continue;
      }
      if(!Number.isSafeInteger(c.precoPromocionalCentavos)||
         c.precoPromocionalCentavos<=0||c.precoPromocionalCentavos>=base) {
        motivo='preco_invalido';continue;
      }
      const chave=String(camp.codigo)+'/'+String(camp.inicio)+'/'+String(fim)+'/'+String(camp.diaSugerido||'');
      if(chaves.has(chave)){motivo='campanha_duplicada';continue;}
      chaves.add(chave);
      ofertas.push({
        codigo:String(camp.codigo||''),nome:String(camp.nome||'').slice(0,120),
        inicio:String(camp.inicio),fim:String(fim),
        diaSemana:camp.diaSugerido||null,
        precoVendaCentavos:base,
        precoPromocionalCentavos:c.precoPromocionalCentavos,
        percentual:c.descontoPercentual,
        pagamentoOriginal:[...(camp.formasPagamento||[])],
      });
    }
    if(!ofertas.length){
      linha.status=motivo||'vencida';
      const campo={
        sem_data_final:'semDataFinal',sem_dia_semanal:'semDiaSemanal',
        pagamentos_restritos:'pagamentosRestritos',
        preco_invalido:'precosInvalidos',campanha_duplicada:'precosInvalidos',
        data_invalida:'precosInvalidos',
      }[linha.status];
      if(campo)resumo[campo]++;
      plano.push(linha);continue;
    }
    linha.ofertas=ofertas;linha.status='pronto';
    resumo.prontos++;resumo.campanhasAceitas+=ofertas.length;
    if(p.precoPromocionalCentavos)resumo.manuaisSubstituidas++;
    // Duas campanhas atuais para mesmo produto: suspender promoção
    // no runtime, sem escolher desconto mais agressivo.
    const atuais=ofertas.filter(o=>o.inicio<=hoje&&o.fim>=hoje&&
      (!o.diaSemana || o.diaSemana===
       ['domingo','segunda','terca','quarta','quinta','sexta','sabado'][
         new Date(hoje+'T12:00:00Z').getUTCDay()]));
    if(atuais.length>1)resumo.conflitosAtuais++;
    plano.push(linha);
  }
  resumo.linhasNoRelatorio=linhas.length;
  resumo.linhasIgnoradas=linhas.length-resumo.campanhasAceitas;
  return {plano,resumo,fingerprint:assinatura(produtos)};
}
export function prepararPromocoesInova(db,bytes,operadorId,opcoes={},momento=new Date()) {
  if (!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)
    return {ok:false,status:400,erro:'Envie o Relatório de Promoções em CSV (até 8 MB).'};
  try {
    let csv;
    try { csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
    catch { csv=new TextDecoder('windows-1252').decode(bytes); }
    const relatorio=analisarPromocoesInovaCsv(csv);
    if (relatorio.erros.length)
      return {ok:false,status:400,erro:
        'O relatório contém '+relatorio.erros.length+' valores inválidos. Corrija antes de publicar descontos.'};
    const politica=validarPolitica({
      aceitaTodosOnline:opcoes.aceitaTodosOnline==='1',
      fimSemData:opcoes.fimSemData,
    },diaLocalFarmacia(momento));
    const analise=avaliar(db,relatorio.promocoes,politica,momento);
    const lote=db.collection('inovaPromocoesLotes').insert({
      operadorId,criadoEm:momento.toISOString(),
      fonteHash:crypto.createHash('sha256').update(bytes).digest('hex'),
      linhas:relatorio.promocoes,politica,
      fingerprint:analise.fingerprint,
      resumoPreparado:analise.resumo,
      aplicadoEm:null,
    });
    return {ok:true,id:lote.id,origem:relatorio,politica,...analise};
  } catch(e) {
    return {ok:false,status:400,erro:e.message||'CSV de promoções inválido.'};
  }
}
export function consultarPromocoesInova(db,id,operadorId,momento=new Date()) {
  const lote=db.collection('inovaPromocoesLotes').get(id);
  if(!lote||lote.operadorId!==operadorId)
    return {ok:false,status:404,erro:'Prévia de descontos não encontrada.'};
  if(lote.aplicadoEm)
    return {ok:false,status:409,erro:'Relatório já aplicado.'};
  if(momento.getTime()-Date.parse(lote.criadoEm)>PRAZO_MS ||
     momento.getTime()<Date.parse(lote.criadoEm))
    return {ok:false,status:410,erro:'Prévia expirada. Envie o CSV novamente.'};
  const analise=avaliar(db,lote.linhas,lote.politica,momento);
  if(analise.fingerprint!==lote.fingerprint)
    return {ok:false,status:409,erro:'O catálogo mudou depois da conferência. Reenvie o relatório.'};
  return {ok:true,id,politica:lote.politica,...analise};
}
export function aplicarPromocoesInova(db,id,operadorId,{
  frase,confirmado,aceitaTodosOnline
}={},momento=new Date()) {
  if(frase!==SO_CONFIRMACAO || confirmado!=='1')
    return {ok:false,status:400,erro:'A confirmação escrita e o aceite são obrigatórios.'};
  const previa=consultarPromocoesInova(db,id,operadorId,momento);
  if(!previa.ok)return previa;
  if(previa.politica.aceitaTodosOnline && aceitaTodosOnline!=='1')
    return {ok:false,status:400,erro:'Confirme a autorização para ofertas em todas as formas de pagamento online.'};
  if(!previa.resumo.prontos)
    return {ok:false,status:409,erro:'Nenhuma promoção segura para aplicar. Confira os bloqueios.'};
  if(typeof db.storage?.transactionSync!=='function')
    return {ok:false,status:503,erro:'Aplicação disponível somente no Worker Cloudflare com transação atômica.'};
  let total=0;
  try{
    db.storage.transactionSync(()=>{
      // Revalidação adicional dentro da transação para evitar aplicação dupla.
      const lote=db.collection('inovaPromocoesLotes').get(id);
      if(!lote||lote.aplicadoEm)throw new Error('Lote já aplicado.');
      const originais=db.collection('products');
      for(const item of previa.plano){
        if(item.status!=='pronto')continue;
        const p=originais.get(item.produtoId);
        if(!p||p.inovaArquivado?.em||Number(p.precoCentavos)!==item.ofertas[0].precoVendaCentavos)
          throw new Error('Produto foi alterado.');
        originais.update(p.id,{
          // ERP passa a ser fonte da promoção deste produto. Remover a
          // promoção manual anterior impede descontos vencidos após o término.
          precoPromocionalCentavos:0,
          inovaPromocoes:item.ofertas,
          inovaPromocoesAtualizadoEm:momento.toISOString(),
        });
        total++;
      }
      db.collection('inovaPromocoesLotes').update(id,{
        aplicadoEm:momento.toISOString(),linhas:[],resumoAplicado:previa.resumo
      });
    });
  }catch{
    db.collections?.delete('products');
    db.collections?.delete('inovaPromocoesLotes');
    return {ok:false,status:500,erro:'Operação revertida. Nenhum desconto foi confirmado.'};
  }
  return {ok:true,atualizados:total,resumo:previa.resumo};
}
