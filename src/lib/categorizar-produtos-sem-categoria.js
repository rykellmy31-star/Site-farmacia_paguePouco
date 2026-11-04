/**
 * Classificação prudente para produtos SEM categoria.
 * Sem IA/consulta externa: somente termos explícitos e departamentos existentes.
 * Regra ambígua, medicamento, categoria não cadastrada ou produto arquivado:
 * nenhuma alteração. Nunca toca em preço, estoque, foto ou status sanitário.
 */
import crypto from 'node:crypto';

const texto=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

// Regras intencionalmente conservadoras: correspondência textual inequívoca.
// A categoria deve existir e estar ativa NO BANCO DA FARMÁCIA; nunca criar outra.
const REGRAS=[
  ['fraldas-geriatricas',/\bfraldas?\b.*\b(geriatrica|geriatrico|adulto|adultos)\b|\b(geriatrica|geriatrico|adulto|adultos)\b.*\bfraldas?\b/],
  ['fraldas-descartaveis',/\bfraldas?\b/],
  ['lencos-umedecidos',/\blencos?\s+umedecidos?\b/],
  ['absorventes',/\babsorventes?\b/],
  ['alcool-70',/\balcool\s*(?:70|70 porcento|70 por cento)\b/],
  ['sabonetes',/\bsabonetes?\b/],
  ['desodorantes',/\bdesodorantes?\b/],
  ['papel-higienico',/\bpapeis?\s+higienicos?\b|\bpapel\s+higienico\b/],
  ['higiene-bucal',/\b(creme|pasta)\s+dental\b|\bfio\s+dental\b|\b(enxaguante|antisseptico)\s+bucal\b/],
  ['aparelhos-de-pressao',/\b(aparelho|medidor|monitor)\s+(de\s+)?pressao\b/],
  ['termometros',/\btermometros?\b/],
  ['nebulizadores',/\bnebulizadores?\b/],
  ['oximetros',/\boximetros?\b/],
  ['medidores-de-glicose',/\b(glicosimetro|medidor\s+de\s+glicose|monitor\s+de\s+glicose)\b/],
  ['chupetas-e-mamadeiras',/\b(chupetas?|mamadeiras?)\b/],
  ['formulas-infantis',/\bformula\s+infantil\b/],
  ['curativos',/\b(curativos?|band\s+aid)\b/],
  ['ataduras',/\bataduras?\b/],
  ['protetor-facial',/\bprotetor\s+solar\s+facial\b/],
  ['protetor-corporal',/\bprotetor\s+solar\s+corporal\b/],
  ['pos-sol',/\bpos\s+sol\b/],
  ['esmaltes',/\besmaltes?\s+(?:de\s+)?unhas?\b/], // não há essa subcategoria no catálogo padrão: ignorar
  ['unhas',/\besmaltes?\b|\bremovedor\s+de\s+esmalte\b/],
  ['maquiagem',/\b(batom|blush|rimel|mascara\s+de\s+cilios)\b/],
  ['barbear',/\b(espuma|gel|creme)\s+de\s+barbear\b|\baparelho\s+de\s+barbear\b/],
  ['doces-e-chocolates',/\b(chocolates?|bombons?|barras?\s+de\s+chocolate)\b/],
  ['bebidas',/\b(refrigerantes?|sucos?\s+(de\s+fruta|natural|integral)|agua\s+mineral)\b/],
];
// Termos farmacológicos jamais devem ser categorizados por suposição.
// Mesmo "termometro" com composto sanitário suspeito fica para revisão.
const BLOQUEIOS=/\b(antibiotico|psicotropico|tarja\s+preta|controlado|receita\s+retida)\b/;
const GERIATRICO=/\b(geriatrica|geriatrico|adulto|adultos)\b/;

export function sugerirCategoriaProduto(produto,categorias){
  if(!produto||produto.inovaArquivado?.em||produto.categoriaId||produto.subcategoriaId)return null;
  const nome=texto(produto.nome);
  if(nome.length<5||BLOQUEIOS.test(nome))return null;
  const disponiveis=new Map((categorias||[]).filter(c=>c?.ativa!==false)
    .map(c=>[String(c.slug),c]));
  const hits=[];
  for(const [slug,re] of REGRAS){
    if(slug==='fraldas-descartaveis'&&GERIATRICO.test(nome))continue;
    if(re.test(nome)&&disponiveis.has(slug))hits.push(disponiveis.get(slug));
  }
  // Exige UM único destino (subcategoria ou categoria principal).
  if(hits.length!==1)return null;
  const cat=hits[0];
  const pai=cat.paiId?String(cat.paiId):null;
  const parent=pai?(categorias||[]).find(c=>c.id===pai&&c.ativa!==false):cat;
  if(!parent||parent.paiId)return null;
  return {
    produtoId:produto.id,nome:produto.nome,
    categoriaId:parent.id,
    subcategoriaId:pai?cat.id:null,
    categoriaNome:parent.nome,
    subcategoriaNome:pai?cat.nome:null
  };
}
export function planejarCategoriasProdutos(db){
  const produtos=db.collection('products').all();
  const categorias=db.collection('categories').all();
  const candidatos=produtos.filter(p=>!p.inovaArquivado?.em&&!p.categoriaId&&!p.subcategoriaId);
  const sugestoes=candidatos.map(p=>sugerirCategoriaProduto(p,categorias)).filter(Boolean)
    .sort((a,b)=>String(a.produtoId).localeCompare(String(b.produtoId)));
  const hash=crypto.createHash('sha256')
    .update(JSON.stringify({
      // Mudança em nome, categoria, subcategoria ou elegibilidade invalida aprovação.
      produtos:produtos.map(p=>[p.id,p.nome,p.categoriaId||'',p.subcategoriaId||'',
        p.inovaArquivado?.em||'']).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
      categorias:categorias.map(c=>[c.id,c.slug,c.nome,c.paiId||'',c.ativa!==false])
        .sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
      sugestoes:sugestoes.map(x=>[x.produtoId,x.categoriaId,x.subcategoriaId])
    }))
    .digest('hex');
  return {
    fingerprint:hash,
    resumo:{totalProdutos:produtos.length,semCategoria:candidatos.length,
      sugeridos:sugestoes.length,paraRevisao:candidatos.length-sugestoes.length,
      preservados:produtos.length-candidatos.length},
    sugestoes,
    amostra:sugestoes.slice(0,80)
  };
}
export function aplicarCategoriasProdutos(db,{
  fingerprint,confirmacao,operadorId
}={}){
  if(!/^[a-f0-9]{64}$/.test(String(fingerprint||''))||
     confirmacao!=='CLASSIFICAR PRODUTOS'||!operadorId)
    return {ok:false,status:400,erro:'Confirme a prévia e escreva CLASSIFICAR PRODUTOS.'};
  if(typeof db.storage?.transactionSync!=='function')
    return {ok:false,status:503,erro:'Organização em lote exige transação segura na Cloudflare.'};
  try{
    let contador=0;
    db.storage.transactionSync(()=>{
      const atual=planejarCategoriasProdutos(db);
      if(atual.fingerprint!==fingerprint)throw new Error('CATALOGO_ALTERADO');
      const col=db.collection('products');
      for(const item of atual.sugestoes){
        const p=col.get(item.produtoId);
        if(!p||p.categoriaId||p.subcategoriaId||p.inovaArquivado?.em)
          throw new Error('CATALOGO_ALTERADO');
        col.update(p.id,{
          categoriaId:item.categoriaId,
          subcategoriaId:item.subcategoriaId
        });
        contador++;
      }
    });
    return {ok:true,atualizados:contador};
  }catch(e){
    db.collections?.delete('products');
    return {ok:false,status:409,erro:e?.message==='CATALOGO_ALTERADO'?
      'O catálogo mudou desde a prévia. Reabra a conferência antes de aplicar.':
      'A classificação não foi confirmada. Nenhuma categoria deve ser alterada.'};
  }
}
