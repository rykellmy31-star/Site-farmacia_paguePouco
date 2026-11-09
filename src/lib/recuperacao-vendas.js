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
export const CONFIG_RECUPERACAO_PEDIDO=Object.freeze({
  ...CONFIG_RECUPERACAO,
  ativo:false,
  primeiroLembreteHoras:1,
  enviarCupomAposHoras:4,
  descontoPercentual:7,
  descontoMaximoCentavos:2000,
  compraMinimaCentavos:6000,
  validadeHoras:24,
  intervaloDias:15,
  ativadoEm:null,
});
export function configRecuperacaoPedido(db) {
  return {...CONFIG_RECUPERACAO_PEDIDO,...(getSetting(db,'recuperacaoPedidoOnline')||{})};
}
export function validarConfigRecuperacaoPedido(body,anterior=CONFIG_RECUPERACAO_PEDIDO) {
  return validarConfigRecuperacao(body,anterior);
}
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
  // Um pedido ANTIGO pendente, de outra cesta, não deve impedir o cliente
  // de recuperar uma nova cesta. O conflito de campanhas é tratado pela
  // idade do pedido em relação à atividade da cesta, abaixo.
  // A condição de primeira compra limita apenas o CUPOM, não o lembrete.
  return true;
}
function carrinhoAbandonado(db, cart, cliente, config, agora, ativadoEm) {
  if (!cart?.clienteId || !cliente || !(cart.itens || []).length || !cart.atualizadoEm) return false;
  const ultimaAtividade = Date.parse(cart.atualizadoEm);
  if (!Number.isFinite(ultimaAtividade) || ultimaAtividade > agora ||
      ultimaAtividade < ativadoEm || agora - ultimaAtividade > 30*86_400_000) return false; // nunca gerar campanhas retroativas
  // Depois de gerar pedido, o carrinho original pertence àquele pedido,
  // mesmo quando a cobrança expira. O fluxo de pagamento cuida da retomada.
  if (db.collection('orders').all().some(o => o.carrinhoId === cart.id)) return false;
  // Evita duas cobranças/campanhas para o mesmo cliente quando ele acabou
  // de iniciar um pagamento após mexer na cesta; pedido antigo não bloqueia.
  if (db.collection('orders').all().some(o=>o.clienteId===cart.clienteId &&
      o.statusFinanceiro==='pendente' && !o.pagamentoPresencial &&
      Number.isFinite(Date.parse(o.criadoEm||'')) &&
      Date.parse(o.criadoEm)>=ultimaAtividade)) return false;
  return (cart.itens || []).every(i => Number.isInteger(Number(i.quantidade)) && Number(i.quantidade) > 0);
}
/**
 * Sem lista fechada de categorias: qualquer SKU ativo, com estoque e
 * APROVADO para venda online participa da contagem da cesta.
 * podeVender() mantém as restrições sanitárias do próprio checkout.
 */
function itensRecuperaveis(db,cart,{verificarEstoque=true}={}) {
  const items=[];
  for(const item of cart.itens||[]) {
    const p=db.collection('products').get(item.produtoId);
    const qtd=Number(item.quantidade);
    if(!p || !podeVender(p).ok || !Number.isSafeInteger(qtd) || qtd<1 ||
        verificarEstoque && estoqueDisponivel(p)<qtd) return [];
    items.push(p);
  }
  return items;
}
export function subtotalRecuperavel(db,cart) {
  if(!itensRecuperaveis(db,cart).length) return null;
  let total=0;
  for(const item of cart.itens||[]) {
    const p=db.collection('products').get(item.produtoId);
    const preco=precoVigenteCentavos(p);
    const valor=preco*Number(item.quantidade);
    if(!Number.isSafeInteger(valor)||valor<0)return null;
    total+=valor;
    if(!Number.isSafeInteger(total))return null;
  }
  return total;
}
/**
 * Mínimo do site, NÃO o mínimo promocional do cupom.
 * A loja normalmente configura R$ 10 em valorMinimoPedido (centavos).
 * O fallback de R$ 10 preserva essa regra enquanto não existir setting.
 */
export function minimoLembreteRecuperacao(db) {
  const valor=Number(getSetting(db,'loja')?.valorMinimoPedido);
  return Number.isSafeInteger(valor)&&valor>0?valor:1000;
}
function podeOferecerCupomPrimeiraCompra(db,cliente,cfg) {
  return !cfg.apenasPrimeiraCompra || !db.collection('orders').all().some(o=>
    o.clienteId===cliente.id && o.statusFinanceiro==='aprovado');
}
function descontoFormato(n) { return (n / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function nomeSeguro(v) { return String(v || 'cliente').replace(/[\r\n*~_<>\x60]/g,' ').trim().slice(0,48) || 'cliente'; }
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
function primeiroNomeCupom(cliente) {
  return nomeSeguro(cliente?.nome).split(/\s+/)[0] || 'cliente';
}
function ofertaCompacta(cupom,cfg) {
  const percentual=String(cfg.descontoPercentual).replace('.',',');
  return '🎁 *'+percentual+'% de desconto* (até '+
    descontoFormato(cfg.descontoMaximoCentavos)+
    '; mínimo '+descontoFormato(cfg.compraMinimaCentavos)+').\n'+
    '🎟️ *Cupom:* '+cupom.codigo+'\n'+
    '⏰ *Validade:* '+cfg.validadeHoras+'h após o envio.\n';
}
function mensagemCupom(cliente, itens, cupom, config, token, modo='nacional') {
  // Mensagem curta em qualquer categoria, sem divulgar medicamentos e
  // sem descrições dos produtos escolhidos pelo cliente.
  return '🛒 Olá, '+primeiroNomeCupom(cliente)+'! Seu carrinho está esperando.\n'+
    ofertaCompacta(cupom,config)+
    (modo==='local'?'🏪 Pague na retirada ou na entrega local.\n':'')+
    '🛍️ *Concluir compra:* '+linkCarrinho(token)+'\n'+
    '❤️ *Farmácia Pague Pouco, cuidando da sua saúde.*';
}
function codigoNovo(db,modo='nacional') {
  for (let n=0;n<8;n++) {
    const codigo=(modo==='local'?'PP-LOCAL-':modo==='pedido'?'PP-PAGO-':'PP-')+randomToken(9).replace(/[^a-zA-Z0-9]/g,'').slice(0,11).toUpperCase();
    if (codigo.length>=10 && !db.collection('coupons').findOne(c=>c.codigo===codigo)) return codigo;
  }
  throw new Error('Não foi possível gerar código individual seguro.');
}
/**
 * Cada alteração real do carrinho cria um ciclo distinto. Chave determinística:
 * não duplica mensagens em duas passagens do alarme, mas não deixa mensagens
 * canceladas de ciclos antigos travarem lembretes posteriores.
 */
function chaveRecuperacaoCarrinho(cart,modo,tipo) {
  const prefixo=modo==='local'?'recuperacao:local:':'recuperacao:';
  const base=prefixo+tipo+':'+cart.id;
  return {atual:base+':'+Date.parse(cart.atualizadoEm||''),legada:base};
}
function registroCicloAtual(fila,cart,modo,tipo) {
  const chaves=chaveRecuperacaoCarrinho(cart,modo,tipo);
  const atual=fila.get(chaves.atual);
  if(atual)return atual;
  // Compatibilidade: não reenviar uma campanha antiga que já corresponde
  // à cesta ATUAL, mas ignorar as canceladas antes da última edição.
  const legado=fila.get(chaves.legada);
  if(legado && Date.parse(legado.criadoEm||'')>=Date.parse(cart.atualizadoEm||''))
    return legado;
  return null;
}
function outraCampanhaNoCiclo(campanhas,fila,cart,modo) {
  return campanhas.all().some(c=>
    c.carrinhoId===cart.id && (c.modo||'nacional')!==modo &&
    fila.get(c.id)?.status!=='cancelado' &&
    (c.carrinhoAtualizadoEm===cart.atualizadoEm ||
      !c.carrinhoAtualizadoEm &&
      Date.parse(c.criadoEm||'')>=Date.parse(cart.atualizadoEm||'')));
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
      (subtotalRecuperavel(db,cart)??-1)>=minimoLembreteRecuperacao(db) &&
      (agora-Date.parse(cart.atualizadoEm))/3_600_000 >= cfg.primeiroLembreteHoras;
  });
}
export function temRecuperacaoMonitoravel(db) {
  const cfg=configRecuperacao(db);
  const cupomPendente=db.collection('coupons').all().some(c=>
    c.recuperacaoVenda===true&&c.ativo===true&&c.expiraEm&&
    Date.parse(c.expiraEm)>Date.now());
  const cfgPedido=configRecuperacaoPedido(db);
  const pedidosMonitoraveis=cfgPedido.ativo && Boolean(cfgPedido.ativadoEm) &&
    db.collection('orders').all().some(p=>p.clienteId && !p.pagamentoPresencial &&
      ['pendente','expirado','recusado'].includes(p.statusFinanceiro) &&
      Date.now()-Date.parse(p.criadoEm||'') < 30*86_400_000);
  return cupomPendente || pedidosMonitoraveis || ((cfg.ativo && Boolean(cfg.ativadoEm) ||
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
  const resumo={avaliados:0,lembretes:0,cupons:0,locais:0,nacionais:0,pedidosLembretes:0,pedidosCupons:0};
  if ((!nacional.ativo && !local.ativo && !configRecuperacaoPedido(db).ativo) || !evo.ativo || !evo.instancia) return resumo;
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
    const subtotal=subtotalRecuperavel(db,cart);
    if(subtotal==null || subtotal<minimoLembreteRecuperacao(db)) continue;
    // Não misturar campanhas no mesmo ciclo, mas permitir uma nova cesta
    // após alterar itens, inclusive se uma campanha anterior foi cancelada.
    if (outraCampanhaNoCiclo(campanhas,fila,cart,modo)) continue;
    processados[modo]++;
    resumo.avaliados++;
    const idadeHoras=(agora-Date.parse(cart.atualizadoEm))/3_600_000;
    const lembreteId=chaveRecuperacaoCarrinho(cart,modo,'lembrete').atual;
    if (idadeHoras >= cfg.primeiroLembreteHoras &&
        (idadeHoras < cfg.enviarCupomAposHoras || subtotal < cfg.compraMinimaCentavos) &&
        !registroCicloAtual(fila,cart,modo,'lembrete')) {
      const token=randomToken(24);
      fila.insert({id:lembreteId,tipo:'recuperacao_lembrete',modo,carrinhoId:cart.id,
        carrinhoAtualizadoEm:cart.atualizadoEm,
        clienteId:cliente.id,numero,texto:mensagemLembrete(cliente,token,modo),status:'fila',
        criadoEm:nowISO(),tentativas:0});
      campanhas.insert({id:lembreteId,carrinhoId:cart.id,clienteId:cliente.id,modo,
        carrinhoAtualizadoEm:cart.atualizadoEm,
        tipo:'lembrete',criadoEm:nowISO(),cupomId:null,token});
      resumo.lembretes++;
    }
    if (idadeHoras < cfg.enviarCupomAposHoras) continue;
    const cupomId=chaveRecuperacaoCarrinho(cart,modo,'cupom').atual;
    if (registroCicloAtual(fila,cart,modo,'cupom')) continue;
    const ultimo=caminhosUltimosCupons(campanhas,cliente.id,fila);
    if (ultimo && agora-Date.parse(ultimo.criadoEm) < cfg.intervaloDias*86_400_000) continue;
    if (subtotal<cfg.compraMinimaCentavos ||
        !podeOferecerCupomPrimeiraCompra(db,cliente,cfg)) continue;
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
      carrinhoAtualizadoEm:cart.atualizadoEm,
      clienteId:cliente.id,cupomId:cupom.id,numero,
      texto:mensagemCupom(cliente,itens,cupom,cfg,token,modo),
      status:'fila',criadoEm:nowISO(),tentativas:0});
    campanhas.insert({id:cupomId,carrinhoId:cart.id,clienteId:cliente.id,modo,
      carrinhoAtualizadoEm:cart.atualizadoEm,
      tipo:'cupom',cupomId:cupom.id,criadoEm:nowISO(),token});
    resumo.cupons++;
    if (modo==='local') resumo.locais++;
    else resumo.nacionais++;
  }
  executarRecuperacaoPedidosOnline(db,{agora,resumo});
  return resumo;
}

/**
 * Pedidos online com cobrança registrada (Pix ou cartão) não são carrinhos abandonados.
 * Para evitar indicar incorretamente que alguém não pagou, somente mensagens
 * de pagamento ainda pendente exigem confirmação autenticada do provedor há
 * menos de 15 minutos. Novo desconto apenas após expiração/recusa confirmada.
 */
export function pedidoOnlineRecuperavel(db,pedido,{agora=Date.now(),cupom=false}={}) {
  if (!pedido?.clienteId || pedido.pagamentoPresencial ||
      !['pix','credit_card','debit_card'].includes(pedido.metodoPagamento) ||
      !pedido.pagamentoId ||
      pedido.statusOperacional==='cancelado' && pedido.statusFinanceiro==='pendente' ||
      !['pendente','expirado','recusado'].includes(pedido.statusFinanceiro) ||
      pedido.pendenciaPagamento==='conciliacao_necessaria') return false;
  const sede=getSetting(db,'empresa')?.endereco?.cep;
  const cep=pedido.endereco?.cep;
  if (destinoPedidoLocal(cep,sede)) return false;
  const pagamento=db.collection('payments').get(pedido.pagamentoId);
  if (!pagamento || pagamento.provedor!=='mercadopago' ||
      pagamento.metodo!==pedido.metodoPagamento || pagamento.pedidoId!==pedido.id ||
      Number(pagamento.valorCentavos)!==Number(pedido.totalCentavos)) return false;
  const mesmoCliente=db.collection('orders').all().filter(o=>o.clienteId===pedido.clienteId && o.id!==pedido.id);
  if (mesmoCliente.some(o=>o.statusFinanceiro==='aprovado' &&
      Date.parse(o.criadoEm||'')>=Date.parse(pedido.criadoEm||'') ||
      Date.parse(o.criadoEm||'')>Date.parse(pedido.criadoEm||''))) return false;
  const confirmado=String(pagamento.ultimoStatusConfirmado||'').toLowerCase();
  const ultima=Date.parse(pagamento.ultimaConfirmacaoProvedorEm||'');
  const recente=Number.isFinite(ultima)&&agora>=ultima&&agora-ultima<=15*60_000;
  if (pedido.statusFinanceiro==='pendente') {
    return !cupom && recente && confirmado==='pending' &&
      !['approved','expired','cancelled','rejected','refunded'].includes(String(pagamento.status||'').toLowerCase());
  }
  // O estado terminal já foi confirmado pela conciliação autenticada.
  return (pedido.statusFinanceiro==='expirado' && confirmado==='expired' ||
          pedido.statusFinanceiro==='recusado' && ['rejected','cancelled'].includes(confirmado));
}
function destinoPedidoLocal(cep,cepSede) {
  const n=x=>String(x||'').replace(/\D/g,'');
  return n(cep).length!==8 || n(cepSede).length!==8 || n(cep)===n(cepSede);
}
function mensagemPagamentoPendente(cliente,pedido,token,terminado) {
  const titulo='Olá, '+nomeSeguro(cliente.nome)+'! ❤️\n';
  const link=terminado?linkCarrinho(token):
    String(config.publicBaseUrl||'https://site.farmaciapaguepouco.app').replace(/\/+$/,'')+
    '/conta/pedidos/'+encodeURIComponent(String(pedido.codigo));
  return titulo+'💳 O pagamento do seu pedido *#'+String(pedido.codigo).replace(/[^a-zA-Z0-9-]/g,'').slice(0,32)+
    '* ainda não foi confirmado.\n'+
    (terminado?'A cobrança anterior foi encerrada. Para comprar novamente, revise seus produtos e gere um novo pagamento pelo site.\n':
      'Se você ainda deseja concluir sua compra, confira a cobrança no site. Não gere outro pagamento para o mesmo pedido.\n')+
    '🛍️ '+(terminado?'Retomar compra: ':'Acompanhar pedido: ')+link+'\n'+
    '❤️ *Farmácia Pague Pouco, cuidando da sua saúde.*';
}
function mensagemCupomPagamento(cliente,pedido,cupom,cfg,token) {
  return '💳 Olá, '+primeiroNomeCupom(cliente)+'! Seu pagamento anterior não foi concluído.\n'+
    ofertaCompacta(cupom,cfg)+
    '🛍️ *Gerar novo pagamento:* '+linkCarrinho(token)+'\n'+
    '❤️ *Farmácia Pague Pouco, cuidando da sua saúde.*';
}
export function executarRecuperacaoPedidosOnline(db,{agora=Date.now(),resumo={}}={}) {
  const cfg=configRecuperacaoPedido(db);
  const evo=evolutionConfig(db);
  if (!cfg.ativo || !cfg.ativadoEm || !evo.ativo || !evo.instancia) return resumo;
  const inicio=Date.parse(cfg.ativadoEm);
  if (!Number.isFinite(inicio)) return resumo;
  const fila=db.collection('evolutionWhatsappOutbox');
  const campanhas=db.collection('recuperacoesVendas');
  const cupons=db.collection('coupons');
  let avaliados=0;
  const pedidos=db.collection('orders').all()
    .filter(p=>p.clienteId && !p.pagamentoPresencial)
    .sort((a,b)=>String(a.criadoEm).localeCompare(String(b.criadoEm)));
  for (const pedido of pedidos) {
    if (avaliados>=cfg.maximoPorCiclo) break;
    const horaPedido=Date.parse(pedido.criadoEm);
    if (!Number.isFinite(horaPedido)||horaPedido<inicio||horaPedido>agora ||
        agora-horaPedido>30*86_400_000 ||
        !pedidoOnlineRecuperavel(db,pedido,{agora})) continue;
    const cliente=db.collection('customers').get(pedido.clienteId);
    const numero=numeroWhatsapp(cliente?.telefone);
    if (!cliente || cliente.ativo===false || cliente.marketing!==true || !numero) continue;
    const cart=db.collection('carts').get(pedido.carrinhoId);
    if (!cart || cart.clienteId!==cliente.id || !(cart.itens||[]).length ||
        !itensRecuperaveis(db,cart,{verificarEstoque:false}).length) continue;
    const subtotalPedido=cart.itens.reduce((n,i)=>{
      const p=db.collection('products').get(i.produtoId);
      return n+precoVigenteCentavos(p)*Number(i.quantidade);
    },0);
    if(!Number.isSafeInteger(subtotalPedido)||subtotalPedido<minimoLembreteRecuperacao(db)) continue;
    avaliados++;
    const idadeHoras=(agora-horaPedido)/3_600_000;
    const lembreteId='recuperacao:pedido:lembrete:'+pedido.id;
    if (idadeHoras>=cfg.primeiroLembreteHoras && idadeHoras<cfg.enviarCupomAposHoras &&
        !fila.get(lembreteId)) {
      const token=randomToken(24);
      fila.insert({id:lembreteId,tipo:'recuperacao_pedido_lembrete',modo:'pedido',
        pedidoId:pedido.id,carrinhoId:cart.id,clienteId:cliente.id,numero,
        estadoAoCriar:pedido.statusFinanceiro,
        texto:mensagemPagamentoPendente(cliente,pedido,token,pedido.statusFinanceiro!=='pendente'),
        status:'fila',criadoEm:nowISO(),tentativas:0});
      campanhas.insert({id:lembreteId,pedidoId:pedido.id,carrinhoId:cart.id,
        clienteId:cliente.id,modo:'pedido',tipo:'pedido_lembrete',
        criadoEm:nowISO(),cupomId:null,token});
      resumo.pedidosLembretes=(resumo.pedidosLembretes||0)+1;
    }
    // Não ofereça desconto enquanto houver cobrança válida ou situação de pagamento incerta.
    if (idadeHoras<cfg.enviarCupomAposHoras ||
        !pedidoOnlineRecuperavel(db,pedido,{agora,cupom:true})) continue;
    const cupomId='recuperacao:pedido:cupom:'+pedido.id;
    if (fila.get(cupomId)) continue;
    const ultimo=campanhas.all().filter(c=>c.clienteId===cliente.id && c.tipo==='pedido_cupom')
      .sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm)))[0];
    if (ultimo && agora-Date.parse(ultimo.criadoEm)<cfg.intervaloDias*86_400_000) continue;
    const itens=itensRecuperaveis(db,cart);
    if (!itens.length || subtotalPedido<cfg.compraMinimaCentavos ||
        !podeOferecerCupomPrimeiraCompra(db,cliente,cfg)) continue;
    const token=randomToken(24);
    const codigo=codigoNovo(db,'pedido');
    const produtosExclusivos=[...new Set(cart.itens.map(i=>String(i.produtoId)))].sort();
    const cupom=cupons.insert({codigo,tipo:'percentual',valor:cfg.descontoPercentual,
      valorMinimo:cfg.compraMinimaCentavos,descontoMaximoCentavos:cfg.descontoMaximoCentavos,
      usoMaximo:1,usos:0,ativo:false,primeiroPedido:cfg.apenasPrimeiraCompra,
      clienteExclusivoId:cliente.id,produtosExclusivos,recuperacaoVenda:true,
      modoRecuperacao:'pedido',pedidoOrigemId:pedido.id,
      criadoEm:nowISO(),validadeHoras:cfg.validadeHoras,
      descricao:'Recuperação de pedido online sem pagamento confirmado'});
    fila.insert({id:cupomId,tipo:'recuperacao_pedido_cupom',modo:'pedido',
      pedidoId:pedido.id,carrinhoId:cart.id,clienteId:cliente.id,cupomId:cupom.id,
      estadoAoCriar:pedido.statusFinanceiro,
      numero,texto:mensagemCupomPagamento(cliente,pedido,cupom,cfg,token),
      status:'fila',criadoEm:nowISO(),tentativas:0});
    campanhas.insert({id:cupomId,pedidoId:pedido.id,carrinhoId:cart.id,
      clienteId:cliente.id,modo:'pedido',tipo:'pedido_cupom',
      cupomId:cupom.id,criadoEm:nowISO(),token});
    resumo.pedidosCupons=(resumo.pedidosCupons||0)+1;
  }
  return resumo;
}
function caminhosUltimosCupons(campanhas,clienteId,fila) {
  return campanhas.all().filter(c=>c.clienteId===clienteId && c.tipo==='cupom' &&
    // Desconto cancelado antes do envio não consome os dias de intervalo.
    ['fila','enviando','enviado','verificar'].includes(fila.get(c.id)?.status))
    .sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm)))[0];
}

/**
 * Diagnóstico somente-leitura para o administrador: nenhuma mensagem é
 * criada/disparada. Explica bloqueios sem expor telefone, CEP, nem itens
 * sensíveis de saúde. Contém apenas cestas vinculadas a contas.
 */
export function diagnosticoCarrinhosRecuperacao(db,{agora=Date.now(),limite=20}={}) {
  const evo=evolutionConfig(db);
  const campanhas=db.collection('recuperacoesVendas');
  const fila=db.collection('evolutionWhatsappOutbox');
  return db.collection('carts').all()
    .filter(c=>c.clienteId && (c.itens||[]).length)
    .sort((a,b)=>String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)))
    .slice(0,Math.max(1,Math.min(30,limite)))
    .map(cart=>{
      const cliente=db.collection('customers').get(cart.clienteId);
      const modo=destinoRecuperacao(db,cart,cliente);
      const cfg=modo==='local'?configRecuperacaoLocal(db):configRecuperacao(db);
      const ultima=Date.parse(cart.atualizadoEm||'');
      const inicio=Date.parse(cfg.ativadoEm||'');
      const previstaEm=Number.isFinite(ultima) && Number.isFinite(cfg.primeiroLembreteHoras)
        ? new Date(ultima+cfg.primeiroLembreteHoras*3_600_000).toISOString() : null;
      const aviso=modo==='indefinido'?null:registroCicloAtual(fila,cart,modo,'lembrete');
      const cupom=modo==='indefinido'?null:registroCicloAtual(fila,cart,modo,'cupom');
      let situacao='';
      if(aviso) {
        const rotulos={fila:'Na fila do WhatsApp',enviado:'Lembrete aceito pela Evolution',
          verificar:'Verificar entrega pela Evolution',falha:'Falha de envio pela Evolution',
          cancelado:'Lembrete cancelado após mudança da cesta/pedido',enviando:'Enviando'};
        situacao=rotulos[aviso.status]||'Lembrete processado';
      }else if(cupom) {
        situacao=cupom.status==='enviado'?'Cupom aceito pela Evolution':
          cupom.status==='fila'?'Cupom aguardando envio':'Cupom: '+String(cupom.status);
      }else if(!cliente) situacao='Conta do cliente não encontrada';
      else if(!cfg.ativo) situacao='Recuperação desta modalidade desativada';
      else if(!evo.ativo || !evo.instancia) situacao='WhatsApp Evolution desativado ou sem instância';
      else if(!cliente.marketing) situacao='Cliente não autorizou mensagens promocionais';
      else if(!numeroWhatsapp(cliente.telefone)) situacao='WhatsApp do cliente inválido ou ausente';
      else if(modo==='indefinido') situacao='CEP de destino não identificado ou entrega local indisponível';
      else if(!Number.isFinite(ultima)) situacao='Horário da cesta inválido';
      else if(!Number.isFinite(inicio) || ultima<inicio) situacao='Cesta sem alteração posterior à ativação';
      else if(ultima>agora) situacao='Horário da cesta está no futuro';
      else if(agora-ultima>30*86_400_000) situacao='Cesta antiga fora da janela de recuperação';
      else if(db.collection('orders').all().some(o=>o.carrinhoId===cart.id))
        situacao='Esta cesta já gerou pedido; acompanhar pagamento conforme a modalidade';
      else if(db.collection('orders').all().some(o=>o.clienteId===cart.clienteId &&
        o.statusFinanceiro==='pendente' && !o.pagamentoPresencial &&
        Date.parse(o.criadoEm||'')>=ultima))
        situacao='Pagamento posterior à cesta ainda pendente';
      else if(!itensRecuperaveis(db,cart).length)
        situacao='Cesta possui itens inativos, indisponíveis ou bloqueados para venda online';
      else if((subtotalRecuperavel(db,cart)??-1)<minimoLembreteRecuperacao(db))
        situacao='Cesta abaixo do valor mínimo da loja para recuperação';
      else if(outraCampanhaNoCiclo(campanhas,fila,cart,modo))
        situacao='Já existe campanha de outra modalidade neste ciclo';
      else if(agora-ultima < cfg.primeiroLembreteHoras*3_600_000)
        situacao='Aguardando completar prazo de inatividade';
      else if(agora-ultima >= cfg.enviarCupomAposHoras*3_600_000 &&
        (subtotalRecuperavel(db,cart)??-1)<cfg.compraMinimaCentavos)
        situacao='Lembrete permitido; cupom exige valor mínimo promocional maior';
      else situacao='Prazo atingido; aguardando próximo ciclo automático (até 5 minutos)';
      return {
        cliente:cliente?.nome||'Cliente',modo,
        atualizadoEm:cart.atualizadoEm,
        previstaEm,
        quantidadeItens:(cart.itens||[]).length,
        situacao,
      };
    });
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
    lembretesPedidos:campanhas.filter(c=>c.tipo==='pedido_lembrete').length,
    cuponsPedidos:campanhas.filter(c=>c.tipo==='pedido_cupom').length,
    pedidosOnlinePendentes:pedidos.filter(p=>!p.pagamentoPresencial &&
      ['pix','credit_card','debit_card'].includes(p.metodoPagamento) &&
      p.statusFinanceiro==='pendente').length,
    receitaRecuperadaCentavos:recuperados.reduce((n,p)=>n+Number(p.totalCentavos||0),0),
    diagnosticos:diagnosticoCarrinhosRecuperacao(db),
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
