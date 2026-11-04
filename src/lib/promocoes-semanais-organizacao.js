/**
 * Organização dos produtos por dia de promoção.
 * NÃO altera preços, períodos do InovaFarma nem inicia desconto no checkout.
 * Marcações manuais servem somente ao planejamento e aos filtros do painel.
 */
export const DIAS_PROMOCAO=[
  {id:'segunda',nome:'Segunda-feira'},
  {id:'terca',nome:'Terça-feira'},
  {id:'quarta',nome:'Quarta-feira'},
  {id:'quinta',nome:'Quinta-feira'},
  {id:'sexta',nome:'Sexta-feira'},
  {id:'sabado',nome:'Sábado'},
  {id:'domingo',nome:'Domingo'}
];
const VALIDOS=new Set(DIAS_PROMOCAO.map(d=>d.id));
const LISTA_LIMITE=25;
export function diasPromocaoInova(produto){
  return [...new Set((Array.isArray(produto?.inovaPromocoes)?produto.inovaPromocoes:[])
    .filter(p=>p&&VALIDOS.has(p.diaSemana))
    .map(p=>p.diaSemana))];
}
export function diasPromocaoMarcados(produto){
  return [...new Set((Array.isArray(produto?.diasPromocaoOrganizacao)?
    produto.diasPromocaoOrganizacao:[]).filter(d=>VALIDOS.has(d)))];
}
export function diasPromocaoProduto(produto){
  const atual=new Set([...diasPromocaoMarcados(produto),...diasPromocaoInova(produto)]);
  return DIAS_PROMOCAO.filter(x=>atual.has(x.id)).map(x=>x.id);
}
export function filtrarPromocoesPorDia(produtos,dia){
  if(!dia)return produtos;
  if(dia==='sem_dia')return produtos.filter(p=>diasPromocaoProduto(p).length===0);
  if(!VALIDOS.has(dia))return produtos;
  return produtos.filter(p=>diasPromocaoProduto(p).includes(dia));
}
export function alterarMarcacoesPromocao(db,{produtoIds,dia,acao}={}){
  if(!VALIDOS.has(dia)||!['marcar','desmarcar'].includes(acao))
    return {ok:false,status:400,erro:'Escolha um dia e uma ação válida.'};
  if(!Array.isArray(produtoIds)||!produtoIds.length||produtoIds.length>LISTA_LIMITE)
    return {ok:false,status:400,erro:'Selecione de 1 a 25 produtos desta página.'};
  const ids=produtoIds.map(String);
  if(ids.some(id=>!/^[a-z0-9_-]{4,100}$/i.test(id))||
     new Set(ids).size!==ids.length)
    return {ok:false,status:400,erro:'A seleção contém produtos inválidos ou repetidos.'};
  const col=db.collection('products');
  const registros=ids.map(id=>col.get(id));
  if(registros.some(p=>!p||p.inovaArquivado?.em))
    return {ok:false,status:409,erro:'A seleção contém produto inexistente ou arquivado. Atualize a página.'};
  // Não usar markInova: campanhas importadas são controladas pelo ERP.
  const mudancas=registros.map(p=>{
    const set=new Set(diasPromocaoMarcados(p));
    if(acao==='marcar')set.add(dia);
    else set.delete(dia);
    return {id:p.id,diasPromocaoOrganizacao:DIAS_PROMOCAO.filter(x=>set.has(x.id)).map(x=>x.id)};
  });
  if(typeof db.storage?.transactionSync!=='function')
    return {ok:false,status:503,erro:'A organização em lote exige transação segura no servidor.'};
  try{
    db.storage.transactionSync(()=>{
      for(const item of mudancas){
        const p=col.get(item.id);
        if(!p||p.inovaArquivado?.em)throw new Error('PRODUTO_ALTERADO');
        col.update(item.id,{diasPromocaoOrganizacao:item.diasPromocaoOrganizacao});
      }
    });
  }catch{
    db.collections?.delete('products');
    return {ok:false,status:409,erro:'Não foi possível concluir a seleção. Recarregue a lista.'};
  }
  return {ok:true,atualizados:mudancas.length,dia,acao};
}
