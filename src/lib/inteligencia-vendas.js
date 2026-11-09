/**
 * Sugestões contextuais simples, sem API externa ou perfil de saúde.
 * Só utiliza catálogo publicado e associação agregada de pedidos pagos.
 * Nunca sugere medicamentos, controlados ou itens indisponíveis.
 */
import { podeVender, estoqueDisponivel } from './catalog.js';
import { dataDaLoja } from './relatorio-operacional-vendas.js';

const normalizar=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const contem=(texto,re)=>re.test(texto);
const regex={
  fralda:/\bfralda(s)?\b/,
  lenco:/\blenco(s)?\b|\btoalha(s)? umedecida(s)?\b/,
  assadura:/\b(pomada|creme|preventivo)\b.*\b(assadura|bebe|infantil)\b|\bassadura(s)?\b/,
  sabonete:/\bsabonete(s)?\b/,
  shampoo:/\b(shampoo|xampu)\b/,
  condicionador:/\bcondicionador\b/,
  mamadeira:/\bmamadeira(s)?\b/,
  chupeta:/\bchupeta(s)?\b/,
  esmalte:/\besmalte(s)?\b/,
  removedor:/\bremovedor\b|\bacetona\b/,
  algodao:/\balgodao\b/,
  hidratante:/\bhidratante\b|\bhidratacao\b/,
};
const PAR={
  fralda:{lenco:16,assadura:14,sabonete:6, mamadeira:2},
  lenco:{fralda:16,assadura:11,sabonete:7},
  assadura:{fralda:14,lenco:11,sabonete:6},
  shampoo:{condicionador:18,hidratante:4},
  condicionador:{shampoo:18,hidratante:4},
  esmalte:{removedor:18,algodao:14,hidratante:5},
  removedor:{esmalte:16,algodao:9},
  mamadeira:{chupeta:8,sabonete:5,lenco:3},
  chupeta:{mamadeira:8,lenco:4},
  sabonete:{hidratante:6},
};
function familiaProduto(p,db){
  let categoria=db.collection('categories').get(p.categoriaId);
  const nomes=[p.nome||'',p.descricaoCurta||''];
  const visitados=new Set();
  while(categoria&&!visitados.has(categoria.id)){
    visitados.add(categoria.id);
    nomes.push(categoria.nome||'',categoria.slug||'');
    categoria=categoria.paiId?db.collection('categories').get(categoria.paiId):null;
  }
  const geral=normalizar(nomes.join(' ')),produto=normalizar(p.nome);
  const tags=Object.keys(regex).filter(k=>contem(produto,regex[k]));
  return {geral,produto,tags,infantil:/\b(bebe|baby|infantil|crianca|maternidade)\b/.test(geral),
    beleza:/\b(cabelo|capilar|unha|maquiagem|beleza)\b/.test(geral)};
}
function permitido(p){
  if(!p||!p.ativo||!podeVender(p).ok||estoqueDisponivel(p)<=0)return false;
  const s=p.sanitario||{};
  // Não utilizar recomendações de medicamentos como incentivo comercial.
  return !s.requerReceita&&!s.controlado&&
    !['isento_prescricao','generico','fitoterapico','controlado'].includes(s.classificacao);
}
function coComprasPagas(db,origemId){
  const mapa=new Map();
  for(const p of db.collection('orders').all()){
    if(p.statusFinanceiro!=='aprovado')continue;
    const ids=[...new Set((p.itens||[]).map(i=>String(i.produtoId)))];
    if(!ids.includes(String(origemId)))continue;
    for(const id of ids)if(id!==String(origemId))
      mapa.set(id,Math.min(8,(mapa.get(id)||0)+1));
  }
  return mapa;
}
export function recomendarParaProduto(db,origem,{excluir=[],limite=4}={}){
  if(!permitido(origem))return [];
  const info=familiaProduto(origem,db);
  const mapaCompras=coComprasPagas(db,origem.id);
  const excluidos=new Set([...excluir,origem.id].map(String));
  const manuais=new Set((origem.relacionados||[]).map(String));
  const candidatos=[];
  for(const p of db.collection('products').all()){
    if(excluidos.has(String(p.id))||!permitido(p))continue;
    const alvo=familiaProduto(p,db);
    let score=0;
    if(manuais.has(String(p.id)))score+=35;
    for(const tipo of info.tags)for(const [esperado,pontos] of Object.entries(PAR[tipo]||{}))
      if(alvo.tags.includes(esperado))score+=pontos;
    // Apenas contextos sem relação clínica inferida.
    if(info.infantil&&alvo.infantil)score+=3;
    if(info.beleza&&alvo.beleza)score+=2;
    if(info.infantil&&alvo.tags.some(t=>['fralda','lenco','assadura','sabonete'].includes(t)))score+=3;
    if(mapaCompras.has(String(p.id)) && (info.infantil||info.beleza||info.tags.length))
      score+=mapaCompras.get(String(p.id));
    if(score<=0)continue;
    candidatos.push({produto:p,origemId:origem.id,score});
  }
  return candidatos.sort((a,b)=>b.score-a.score ||
    String(a.produto.nome).localeCompare(String(b.produto.nome),'pt-BR') ||
    String(a.produto.id).localeCompare(String(b.produto.id)))
    .slice(0,Math.max(1,Math.min(8,limite)));
}
export function recomendarParaCarrinho(db,cart,{limite=4}={}){
  const itens=(cart?.itens||[]).slice(0,12);
  if(!itens.length)return [];
  const excluidos=itens.map(i=>String(i.produtoId));
  const escolhas=new Map();
  for(const item of itens){
    const p=db.collection('products').get(item.produtoId);
    if(!p)continue;
    for(const sug of recomendarParaProduto(db,p,{excluir:excluidos,limite:8})){
      const chave=String(sug.produto.id);
      const antiga=escolhas.get(chave);
      if(!antiga||sug.score>antiga.score)escolhas.set(chave,sug);
    }
  }
  return [...escolhas.values()].sort((a,b)=>b.score-a.score ||
    String(a.produto.nome).localeCompare(String(b.produto.nome),'pt-BR'))
    .slice(0,Math.max(1,Math.min(8,limite)));
}
export function recomendarNaCategoria(db,categoria,{limite=4}={}){
  if(!categoria)return [];
  const categorias=db.collection('categories').all();
  const ids=[String(categoria.id)];
  for(const c of categorias)if(String(c.paiId||'')===String(categoria.id))ids.push(String(c.id));
  const origens=db.collection('products').all()
    .filter(p=>ids.includes(String(p.categoriaId))&&permitido(p))
    .slice(0,8);
  const out=new Map();
  for(const p of origens){
    for(const sug of recomendarParaProduto(db,p,{excluir:origens.map(x=>x.id),limite:6})){
      const key=String(sug.produto.id);
      if(!out.has(key)||out.get(key).score<sug.score)out.set(key,sug);
    }
  }
  return [...out.values()].sort((a,b)=>b.score-a.score ||
    String(a.produto.nome).localeCompare(String(b.produto.nome),'pt-BR'))
    .slice(0,Math.max(1,Math.min(8,limite)));
}
/**
 * Atribuição auditável somente após clique real em "Adicionar à cesta" de
 * uma recomendação válida; não registra dados pessoais nem conta impressões
 * ou visualizações como vendas.
 */
export function registrarAdicaoRecomendada(db,{carrinhoId,origemId,produtoId,quantidade=1}){
  if(!carrinhoId||!origemId||!produtoId||!Number.isSafeInteger(quantidade)||quantidade<1)return false;
  const origem=db.collection('products').get(origemId);
  if(!origem||!recomendarParaProduto(db,origem,{limite:8}).some(r=>String(r.produto.id)===String(produtoId)))
    return false;
  const id='sug_'+String(carrinhoId)+'_'+String(produtoId);
  // Uma atribuição por SKU/cesta. Quantidade efetiva vem do pedido pago.
  if(db.collection('recomendacoesAdicoes').get(id))return true;
  db.collection('recomendacoesAdicoes').insert({
    id,carrinhoId,origemId,produtoId,adicionadoEm:new Date().toISOString(),
  });
  return true;
}
export function relatorioInteligenciaVendas(db,{de,ate}={}){
  const hoje=dataDaLoja(new Date());
  const inicio=de||hoje,fim=ate||hoje;
  const pedidos=db.collection('orders').all().filter(p=>{
    const dia=String(p.criadoEm||'').slice(0,10);
    return dia>=inicio&&dia<=fim;
  });
  const pagos=pedidos.filter(p=>p.statusFinanceiro==='aprovado');
  const receitaCentavos=pagos.reduce((v,p)=>v+Number(p.totalCentavos||0),0);
  const ticketMedioCentavos=pagos.length?Math.round(receitaCentavos/pagos.length):0;
  const pedidosPorCliente=new Map();
  for(const p of pagos)if(p.clienteId)pedidosPorCliente.set(p.clienteId,
    (pedidosPorCliente.get(p.clienteId)||0)+1);
  const forma=new Map();
  for(const p of pagos){
    const k=p.pagamentoPresencial?'presencial':p.metodoPagamento||'outros';
    const anterior=forma.get(k)||{metodo:k,quantidade:0,receitaCentavos:0};
    anterior.quantidade++;anterior.receitaCentavos+=Number(p.totalCentavos||0);
    forma.set(k,anterior);
  }
  const registro=new Map();
  for(const x of db.collection('recomendacoesAdicoes').all()){
    const key=String(x.carrinhoId||'');
    if(!registro.has(key))registro.set(key,new Set());
    registro.get(key).add(String(x.produtoId));
  }
  let pedidosComRecomendacao=0,itensRecomendadosVendidos=0,
    valorBrutoItensRecomendadosCentavos=0;
  const ranking=new Map();
  for(const p of pagos){
    const recomendados=registro.get(String(p.carrinhoId||''))||new Set();
    let pedidoRecomendado=false;
    for(const item of p.itens||[]){
      if(!recomendados.has(String(item.produtoId)))continue;
      const qtd=Number(item.quantidade)||0;
      const valor=Number(item.subtotalCentavos)||0;
      if(qtd<=0||valor<0)continue;
      pedidoRecomendado=true;
      itensRecomendadosVendidos+=qtd;
      valorBrutoItensRecomendadosCentavos+=valor;
      const atual=ranking.get(String(item.produtoId))||{
        produtoId:String(item.produtoId),nome:item.nome||'Produto',quantidade:0,
        receitaCentavos:0};
      atual.quantidade+=qtd;atual.receitaCentavos+=valor;
      ranking.set(String(item.produtoId),atual);
    }
    if(pedidoRecomendado)pedidosComRecomendacao++;
  }
  const campanhas=db.collection('recuperacoesVendas').all();
  const cartsRecuperados=new Set(campanhas.flatMap(c=>
    [c.carrinhoId,c.carrinhoRestauradoId].filter(Boolean).map(String)));
  const vendasRecuperadas=pagos.filter(p=>cartsRecuperados.has(String(p.carrinhoId)));
  const dias=new Map();
  for(const p of pagos){
    const dia=String(p.criadoEm).slice(0,10);
    dias.set(dia,(dias.get(dia)||0)+Number(p.totalCentavos||0));
  }
  return {
    de:inicio,ate:fim,receitaCentavos,ticketMedioCentavos,
    pedidosTotal:pedidos.length,pedidosPagos:pagos.length,
    pedidosPendentes:pedidos.filter(p=>p.statusFinanceiro==='pendente').length,
    pedidosCancelados:pedidos.filter(p=>p.statusOperacional==='cancelado').length,
    clientesRecorrentes:[...pedidosPorCliente.values()].filter(n=>n>=2).length,
    pedidosComRecomendacao,itensRecomendadosVendidos,valorBrutoItensRecomendadosCentavos,
    taxaConversaoRecomendacoes:pagos.length?Math.round(1000*pedidosComRecomendacao/pagos.length)/10:0,
    vendasRecuperadas:vendasRecuperadas.length,
    receitaRecuperadaCentavos:vendasRecuperadas.reduce((n,p)=>n+Number(p.totalCentavos||0),0),
    pagamentos:[...forma.values()].sort((a,b)=>b.receitaCentavos-a.receitaCentavos),
    recomendadosMaisVendidos:[...ranking.values()].sort((a,b)=>b.receitaCentavos-a.receitaCentavos).slice(0,10),
    porDia:[...dias.entries()].map(([dia,centavos])=>({dia,centavos})).sort((a,b)=>a.dia.localeCompare(b.dia)),
  };
}
