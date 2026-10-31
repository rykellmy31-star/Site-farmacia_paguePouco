/**
 * Corrige SOMENTE a marcação "exige receita" colocada como placeholder pela
 * importação do InovaFarma. Isso NÃO certifica que o item é isento de receita.
 * Todos esses produtos continuam inativos e aguardando revisão sanitária.
 *
 * A migração nunca altera produtos aprovados, ativos, com controle especial,
 * classificados/revisados pelo operador ou de origem diferente do Inova.
 */
const MARCADOR = 'inova-receita-placeholder-v1';

export function temReceitaAutomaticaInova(p) {
  const s=p?.sanitario || {};
  const chave=Object.keys(s).sort().join(',');
  return p?.inovaCatalogo?.revisaoSanitariaPendente===true &&
    p.ativo===false &&
    s.requerReceita===true && s.controlado===false &&
    s.aprovadoFarmaceutico===false && s.classificacao==='nao_aplicavel' &&
    (s.registroMS || '')==='' &&
    chave==='aprovadoFarmaceutico,classificacao,controlado,registroMS,requerReceita';
}

export function corrigirReceitaAutomaticaInova(db) {
  const meta=db.collection('__meta');
  if(meta.get(MARCADOR))return {jaExecutada:true,corrigidos:0};
  let corrigidos=0;
  if(db.sql?.exec && typeof db.storage?.transactionSync==='function') {
    // Uma única atualização SQL atômica: evita milhares de escritas JS no DO.
    // Os cinco campos do sanitário são exatamente os do placeholder importado.
    const condicao=`collection_name='products'
      AND json_extract(doc,'$.inovaCatalogo.revisaoSanitariaPendente')=1
      AND json_extract(doc,'$.ativo')=0
      AND json_extract(doc,'$.sanitario.requerReceita')=1
      AND json_extract(doc,'$.sanitario.controlado')=0
      AND json_extract(doc,'$.sanitario.aprovadoFarmaceutico')=0
      AND json_extract(doc,'$.sanitario.classificacao')='nao_aplicavel'
      AND json_extract(doc,'$.sanitario.registroMS')=''
      AND (SELECT COUNT(*) FROM json_each(doc,'$.sanitario'))=5`;
    db.storage.transactionSync(()=>{
      const rows=Array.from(db.sql.exec(
        'SELECT COUNT(*) AS total FROM documents WHERE '+condicao));
      corrigidos=Number(rows[0]?.total||0);
      if(corrigidos)
        db.sql.exec('UPDATE documents SET doc=json_set(doc,\'$.sanitario.requerReceita\',json(\'false\')) WHERE '+condicao);
      meta.insert({id:MARCADOR,valor:'correcao-importacao-somente',corrigidos,em:new Date().toISOString()});
    });
    // Se houve cache aberto durante a inicialização, reabrir com os dados novos.
    db.collections?.delete('products');
  } else {
    // Variante de teste/local: respeita os mesmos critérios da migração SQL.
    const produtos=db.collection('products');
    for(const p of produtos.all()){
      if(!temReceitaAutomaticaInova(p))continue;
      produtos.update(p.id,{sanitario:{...p.sanitario,requerReceita:false}});
      corrigidos++;
    }
    meta.insert({id:MARCADOR,valor:'correcao-importacao-somente',corrigidos,em:new Date().toISOString()});
  }
  return {jaExecutada:false,corrigidos};
}
