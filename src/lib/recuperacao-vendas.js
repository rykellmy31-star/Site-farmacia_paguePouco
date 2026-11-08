/**
 * Recuperação consentida de carrinhos. Trabalha exclusivamente no banco do site:
 * não consulta InovaFarma, não cria pedidos, não cobra nem reserva estoque.
 * A primeira mensagem e o cupom têm chaves estáveis por carrinho.
 */
import { randomToken } from './security.js';
import { nowISO } from './store.js';
import { getSetting } from './settings.js';
import { evolutionConfig, numeroWhatsapp } from './evolution-whatsapp.js';
import { podeVender, estoqueDisponivel, precoVigenteCentavos } from './catalog.js';
import { config } from '../config.js';
import { destinoRecuperacao } from './recuperacao-destino.js';

export const CONFIG_RECUPERACAO = Object.freeze({
  ativo: false, primeiroLembreteHoras: 1, enviarCupomAposHoras: 24,
  descontoPercentual: 5, descontoMaximoCentavos: 1500,
  compraMinimaCentavos: 6000, validadeHoras: 48,
  intervaloDias: 15, apenasPrimeiraCompra: true,
  maximoPorCiclo: 8, ativadoEm: null,
});

export function configRecuperacao(db) {
  return { ...CONFIG_RECUPERACAO, ...(getSetting(db, 'recuperacaoVendas') || {}) };
}

export const CONFIG_RECUPERACAO_LOCAL=Object.freeze({
  ...CONFIG_RECUPERACAO,
  primeiroLembreteHoras:1,
  enviarCupomAposHoras:4,
  descontoPercentual:5,
  descontoMaximoCentavos:1500,
  compraMinimaCentavos:6000,
  validadeHoras:48,
  intervaloDias:15,
  ativo:false,
  ativadoEm:null,
});
export function configRecuperacaoLocal(db) {
  return { ...CONFIG_RECUPERACAO_LOCAL, ...(getSetting(db,'recuperacaoVendasLocal')||{}) };
}
export function validarConfigRecuperacaoLocal(body,anterior=CONFIG_RECUPERACAO_LOCAL) {
  return validarConfigRecuperacao(body,anterior);
}


function inteiro(valor, min, max) {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}
function percentual(valor) {
  const s = String(valor ?? '').trim().replace(',', '.');
  if (!/^\d{1,2}(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 50 ? n : null;
}
function moeda(valor) {
  const s = String(valor ?? '').trim();
  if (!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s.replace(',','.')) * 100);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function validarConfigRecuperacao(body, anterior = CONFIG_RECUPERACAO) {
  const descontoPercentual = percentual(body.descontoPercentual);
  const descontoMaximoCentavos = moeda(body.descontoMaximo);
  const compraMinimaCentavos = moeda(body.compraMinima);
  const validadeHoras = inteiro(body.validadeHoras, 1, 720);
  const primeiroLembreteHoras = inteiro(body.primeiroLembreteHoras, 1, 168);
  const enviarCupomAposHoras = inteiro(body.enviarCupomAposHoras, 2, 720);
  const intervaloDias = inteiro(body.intervaloDias, 1, 365);
  if ([descontoPercentual,descontoMaximoCentavos,compraMinimaCentavos,
    validadeHoras,primeiroLembreteHoras,enviarCupomAposHoras,intervaloDias].some(v=>v==null) ||
    descontoMaximoCentavos === 0 || enviarCupomAposHoras <= primeiroLembreteHoras) {
    return { ok:false, erro:'Informe percentual entre 0 e 50%, valores monetários válidos, validade entre 1 e 720 horas, e prazo do cupom maior que o primeiro lembrete.' };
  }
  const ativo = body.ativo === '1';
  return { ok:true, config:{
    ativo, descontoPercentual, descontoMaximoCentavos, compraMinimaCentavos,
    validadeHoras, primeiroLembreteHoras, enviarCupomAposHoras, intervaloDias,
    apenasPrimeiraCompra: body.apenasPrimeiraCompra === '1',
    maximoPorCiclo: 8,
    ativadoEm: ativo ? (anterior?.ativo ? anterior.ativadoEm || nowISO() : nowISO()) : null,
  } };
}

// Telefone e autorização para OFERTAS, independentemente do opt-in transacional.
function clienteElegivel(db, cliente, config, numero) {
  if (!cliente || cliente.ativo === false || cliente.marketing !== true || !numero) return false;
  if (db.collection('orders').all().some(o=>o.clienteId===cliente.id &&
      o.statusFinanceiro==='pendente')) return false;
  if (config.apenasPrimeiraCompra && db.collection('orders').all().some(o =>
    o.clienteId === cliente.id && o.statusFinanceiro === 'aprovado')) return false;
  return true;
}
function carrinhoAbandonado(db, cart, cliente, config, agora, ativadoEm) {
  if (!cart?.clienteId || !cliente || !(cart.itens || []).length || !cart.atualizadoEm) return false;
  const ultimaAtividade = Date.parse(cart.atualizadoEm);
  if (!Number.isFinite(ultimaAtividade) || ultimaAtividade > agora ||
      ultimaAtividade < ativadoEm || agora - ultimaAtividade > 30*86_400_000) return false; // nunca gerar campanhas retroativas
  if (db.collection('orders').all().some(o =>
    o.carrinhoId === cart.id && !['recusado','expirado'].includes(o.statusFinanceiro))) return false;
  return (cart.itens || []).every(i => Number.isInteger(Number(i.quantidade)) && Number(i.quantidade) > 0);
}
// Lista conservadora: não enviar ofertas de medicamentos, aparelhos, testes
// ou qualquer item fora de higiene, beleza e fraldas.
const CATEGORIAS_PERMITIDAS = new Set([
 'higiene-pessoal','sabonetes','desodorantes','higiene-bucal',
 'papel-higienico','beleza','cabelos','maquiagem','unhas',
 'cuidados-com-o-corpo','dermocosmeticos','hidratantes','cuidados-faciais',
 'fraldas','fraldas-descartaveis','lencos-umedecidos','chupetas-e-mamadeiras',
]);
function itensRecuperaveis(db, cart) {
  const items = [];
  for (const item of cart.itens || []) {
    const p = db.collection('products').get(item.produtoId);
    const categoria=db.collection('categories').get(p?.categoriaId);
    if (!p || !podeVender(p).ok ||
        !Number.isSafeInteger(Number(item.quantidade)) || Number(item.quantidade)<1 ||
        estoqueDisponivel(p)<Number(item.quantidade)) return [];
    if (!CATEGORIAS_PERMITIDAS.has(String(categoria?.slug||''))) return [];
    const tipo=String(p.sanitario?.classificacao||'nao_aplicavel').toLowerCase();
    if (!['nao_aplicavel','cosmetico','cosmético','higiene'].includes(tipo) ||
        p.sanitario?.requerReceita || p.sanitario?.controlado ||
        p.sanitario?.antimicrobiano) return [];
    items.push(p);
  }
  return items;
}
function descontoFormato(n) { return (n / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function nomeSeguro(v) { return String(v || 'cliente').replace(/[\r\n*~_<>\x60]/g,' ').trim().slice(0,48) || 'cliente'; }
function textoProduto(v) { return String(v||'').replace(/[\x00-\x1f*~_<>\x60]/g,' ').replace(/\s+/g,' ').trim().slice(0,80); }
function mensagemLembrete(cliente,token,modo='nacional') {
  if (modo==='local') return 'Olá, '+nomeSeguro(cliente.nome)+'! 👋\n'+
    '🛒 Sua seleção ainda está esperando na *Farmácia Pague Pouco*!\n'+
    '🏪 Você pode finalizar o pedido pelo site e pagar na retirada ou no recebimento da entrega local, sem pagamento antecipado.\n'+
    '🛍️ Retome seu carrinho: '+linkCarrinho(token)+'\n'+
    '❤️ *Farmácia Pague Pouco, cuidando da sua saúde.*';
  return 'Olá, '+nomeSeguro(cliente.nome)+'! 👋\n'+
    '🛒 Sua seleção continua esperando no carrinho da Farmácia Pague Pouco!\n'+
    'Quando quiser, continue sua compra pelo site: '+linkCarrinho(token)+'\n'+
    '❤️ *Farmácia Pague Pouco, cuidando da sua saúde.*';
}
function linkCarrinho(token) {
  // Token aleatório + verificação de sessão impedem acesso cruzado.
  return String(config.publicBaseUrl||'https://site.farmaciapaguepouco.app').replace(/\/+$/,'')+
    '/conta/recuperar-carrinho/'+encodeURIComponent(token);
}
function mensagemCupom(cliente, itens, cupom, config, token, modo='nacional') {
  const nomes = cliente.consentimentoWhatsappMarketingDetalhes === true
    ? itens.slice(0,3).map((p,i)=>'• '+textoProduto(p.nome)).join('\n') : '';
  const produtos = nomes ? '\n🛍️ *Sua seleção:*\n'+nomes+'\n' :
    '\n🛍️ *Os produtos que você selecionou estão esperando!*\n';
  return '🛒 *'+nomeSeguro(cliente.nome)+', esquecendo alguma coisa?* 👀\n\n'+
    'Olá! ❤️\n\nPercebemos que você deixou alguns produtinhos no carrinho da *Farmácia Pague Pouco*!'+
    produtos+'\n🎁 *TEMOS UM PRESENTE PARA VOCÊ!*\n'+
    'Seu desconto exclusivo: *'+String(config.descontoPercentual).replace('.',',')+'%*'+
    ' (até '+descontoFormato(config.descontoMaximoCentavos)+
    ', em compras a partir de '+descontoFormato(config.compraMinimaCentavos)+').\n'+
    '🎟️ *Cupom individual:* '+cupom.codigo+'\n'+
    '⏰ Válido por *'+config.validadeHoras+' horas após o envio*.\n'+
    (modo==='local'?'🏪 Finalize pelo site e pague apenas na retirada ou no recebimento da entrega local.\n':'')+
    '🛍️ *Finalize aqui:* '+linkCarrinho(token)+'\n\n'+
    '❤️ *Farmácia Pague Pouco, cuidando da sua saúde.*';
}
function codigoNovo(db,modo='nacional') {
  for (let n=0;n<8;n++) {
    const codigo=(modo==='local'?'PP-LOCAL-':'PP-')+randomToken(9).replace(/[^a-zA-Z0-9]/g,'').slice(0,11).toUpperCase();
    if (codigo.length>=10 && !db.collection('coupons').findOne(c=>c.codigo===codigo)) return codigo;
  }
  throw new Error('Não foi possível gerar código individual seguro.');
}
export function proximaRecuperacaoPendente(db,agora=Date.now()) {
  return db.collection('carts').all().some(cart=>{
    if (!cart.clienteId) return false;
    const cliente=db.collection('customers').get(cart.clienteId);
    const modo=destinoRecuperacao(db,cart,cliente);
    if (modo==='indefinido') return false;
    const cfg=modo==='local'?configRecuperacaoLocal(db):configRecuperacao(db);
    const inicio=Date.parse(cfg.ativadoEm||'');
    return cfg.ativo && Number.isFinite(inicio) &&
      carrinhoAbandonado(db,cart,cliente,cfg,agora,inicio) &&
      clienteElegivel(db,cliente,cfg,numeroWhatsapp(cliente?.telefone)) &&
      itensRecuperaveis(db,cart).length>0 &&
      (agora-Date.parse(cart.atualizadoEm))/3_600_000 >= cfg.primeiroLembreteHoras;
  });
}
export function temRecuperacaoMonitoravel(db) {
  const cfg=configRecuperacao(db);
  const cupomPendente=db.collection('coupons').all().some(c=>
    c.recuperacaoVenda===true&&c.ativo===true&&c.expiraEm&&
    Date.parse(c.expiraEm)>Date.now());
  return cupomPendente || ((cfg.ativo && Boolean(cfg.ativadoEm) ||
    configRecuperacaoLocal(db).ativo && Boolean(configRecuperacaoLocal(db).ativadoEm)) &&
    db.collection('carts').all().some(c=>c.clienteId && (c.itens||[]).length &&
      Date.now()-Date.parse(c.atualizadoEm||'') < 30*86_400_000));
}
/** Expiração materializa o estado no banco, além da checagem obrigatória do checkout. */
export function expirarCuponsRecuperacao(db,{agora=Date.now()}={}) {
  const col=db.collection('coupons');
  let total=0;
  for (const c of col.all()) {
    if (c.recuperacaoVenda===true && c.ativo===true &&
        c.expiraEm && Number.isFinite(Date.parse(c.expiraEm)) &&
        Date.parse(c.expiraEm)<=agora) {
      col.update(c.id,{ativo:false,expiradoEm:new Date(agora).toISOString()});
      total++;
    }
  }
  return total;
}
export function executarRecuperacao(db,{agora=Date.now()}={}) {
  expirarCuponsRecuperacao(db,{agora});
  const evo=evolutionConfig(db), nacional=configRecuperacao(db), local=configRecuperacaoLocal(db);
  const resumo={avaliados:0,lembretes:0,cupons:0,locais:0,nacionais:0};
  if ((!nacional.ativo && !local.ativo) || !evo.ativo || !evo.instancia) return resumo;
  const fila=db.collection('evolutionWhatsappOutbox');
  const campanhas=db.collection('recuperacoesVendas');
  const cupons=db.collection('coupons');
  const processados={local:0,nacional:0};
  const carts=db.collection('carts').all()
    .filter(c=>c.clienteId && (c.itens||[]).length)
    .sort((a,b)=>String(a.atualizadoEm).localeCompare(String(b.atualizadoEm)));
  for (const cart of carts) {
    const cliente=db.collection('customers').get(cart.clienteId);
    const modo=destinoRecuperacao(db,cart,cliente);
    if (modo==='indefinido') continue;
    const cfg=modo==='local'?local:nacional;
    if (!cfg.ativo || !cfg.ativadoEm || !Number.isFinite(Date.parse(cfg.ativadoEm)) ||
        processados[modo] >= cfg.maximoPorCiclo) continue;
    const numero=numeroWhatsapp(cliente?.telefone);
    if (!clienteElegivel(db,cliente,cfg,numero) ||
        !carrinhoAbandonado(db,cart,cliente,cfg,agora,Date.parse(cfg.ativadoEm))) continue;
    const itens=itensRecuperaveis(db,cart);
    if (!itens.length) continue;
    // Se uma cesta já entrou em outra modalidade, nunca duplicar campanhas.
    if (campanhas.all().some(c=>c.carrinhoId===cart.id &&
        (c.modo||'nacional')!==modo)) continue;
    processados[modo]++;
    resumo.avaliados++;
    const idadeHoras=(agora-Date.parse(cart.atualizadoEm))/3_600_000;
    const prefixo=modo==='local'?'recuperacao:local:':'recuperacao:';
    const lembreteId=prefixo+'lembrete:'+cart.id;
    if (idadeHoras >= cfg.primeiroLembreteHoras &&
        idadeHoras < cfg.enviarCupomAposHoras && !fila.get(lembreteId)) {
      const token=randomToken(24);
      fila.insert({id:lembreteId,tipo:'recuperacao_lembrete',modo,carrinhoId:cart.id,
        clienteId:cliente.id,numero,texto:mensagemLembrete(cliente,token,modo),status:'fila',
        criadoEm:nowISO(),tentativas:0});
      campanhas.insert({id:lembreteId,carrinhoId:cart.id,clienteId:cliente.id,modo,
        tipo:'lembrete',criadoEm:nowISO(),cupomId:null,token});
      resumo.lembretes++;
    }
    if (idadeHoras < cfg.enviarCupomAposHoras) continue;
    const cupomId=prefixo+'cupom:'+cart.id;
    if (fila.get(cupomId)) continue;
    const ultimo=caminhosUltimosCupons(campanhas,cliente.id);
    if (ultimo && agora-Date.parse(ultimo.criadoEm) < cfg.intervaloDias*86_400_000) continue;
    const subtotal=cart.itens.reduce((n,i)=>{
      const p=db.collection('products').get(i.produtoId);
      return n+precoVigenteCentavos(p)*Number(i.quantidade);
    },0);
    if (subtotal < cfg.compraMinimaCentavos) continue;
    const token=randomToken(24);
    const codigo=codigoNovo(db,modo);
    const produtosExclusivos=[...new Set(cart.itens.map(i=>String(i.produtoId)))].sort();
    const cupom=cupons.insert({codigo,tipo:'percentual',valor:cfg.descontoPercentual,
      valorMinimo:cfg.compraMinimaCentavos,descontoMaximoCentavos:cfg.descontoMaximoCentavos,
      usoMaximo:1,usos:0,ativo:false,primeiroPedido:cfg.apenasPrimeiraCompra,
      clienteExclusivoId:cliente.id,produtosExclusivos,recuperacaoVenda:true,
      modoRecuperacao:modo,criadoEm:nowISO(),validadeHoras:cfg.validadeHoras,
      descricao:modo==='local'?'Recuperação local individual':'Recuperação de carrinho individual'});
    fila.insert({id:cupomId,tipo:'recuperacao_cupom',modo,carrinhoId:cart.id,
      clienteId:cliente.id,cupomId:cupom.id,numero,
      texto:mensagemCupom(cliente,itens,cupom,cfg,token,modo),
      status:'fila',criadoEm:nowISO(),tentativas:0});
    campanhas.insert({id:cupomId,carrinhoId:cart.id,clienteId:cliente.id,modo,
      tipo:'cupom',cupomId:cupom.id,criadoEm:nowISO(),token});
    resumo.cupons++;
    if (modo==='local') resumo.locais++;
    else resumo.nacionais++;
  }
  return resumo;
}
function caminhosUltimosCupons(campanhas,clienteId) {
  return campanhas.all().filter(c=>c.clienteId===clienteId&&c.tipo==='cupom')
    .sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm)))[0];
}
export function painelRecuperacao(db) {
  expirarCuponsRecuperacao(db);
  const campanhas=db.collection('recuperacoesVendas').all()
    .sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm)));
  const outbox=db.collection('evolutionWhatsappOutbox');
  const cupons=db.collection('coupons');
  const pedidos=db.collection('orders').all();
  const recuperados=pedidos.filter(p=>p.statusFinanceiro==='aprovado'&&
    cupons.get(p.cupom?.cupomId)?.recuperacaoVenda===true);
  const pedidosLocais=pedidos.filter(p=>
    cupons.get(p.cupom?.cupomId)?.modoRecuperacao==='local');
  const locaisPagos=pedidosLocais.filter(p=>p.statusFinanceiro==='aprovado');
  return {
    carrinhosElegiveis:db.collection('carts').all().filter(c=>c.clienteId&&(c.itens||[]).length).length,
    lembretes:campanhas.filter(c=>c.tipo==='lembrete').length,
    cuponsGerados:campanhas.filter(c=>c.tipo==='cupom').length,
    enviados:campanhas.filter(c=>outbox.get(c.id)?.status==='enviado').length,
    recuperados:recuperados.length,
    pedidosLocaisGerados:pedidosLocais.length,
    pedidosLocaisPagos:locaisPagos.length,
    receitaLocalCentavos:locaisPagos.reduce((n,p)=>n+Number(p.totalCentavos||0),0),
    cuponsLocais:campanhas.filter(c=>c.modo==='local'&&c.tipo==='cupom').length,
    cuponsNacionais:campanhas.filter(c=>(c.modo||'nacional')==='nacional'&&c.tipo==='cupom').length,
    receitaRecuperadaCentavos:recuperados.reduce((n,p)=>n+Number(p.totalCentavos||0),0),
    linhas:campanhas.slice(0,100).map(c=>({
      ...c, modo:c.modo||'nacional',
      nome:db.collection('customers').get(c.clienteId)?.nome||'Cliente',
      codigo:cupons.get(c.cupomId)?.codigo||'—',
      desconto:cupons.get(c.cupomId)?.valor||0,
      expiraEm:cupons.get(c.cupomId)?.expiraEm||null,
      situacao:outbox.get(c.id)?.status||'desconhecido',
      ativo:cupons.get(c.cupomId)?.ativo===true,
    })),
  };
}
export function cancelarCupomRecuperacao(db,id) {
  const cupom=db.collection('coupons').get(id);
  if (!cupom?.recuperacaoVenda) return false;
  db.collection('coupons').update(id,{ativo:false,canceladoEm:nowISO()});
  return true;
}
