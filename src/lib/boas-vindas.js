/**
 * Captura consentida de contatos e cupom individual por telefone verificado.
 * Não cria conta sem senha: cliente conclui a conta no fluxo existente.
 */
import crypto from 'node:crypto';
import {config} from '../config.js';
import {uid, nowISO} from './store.js';
import {DEFAULT_SETTINGS, getSetting} from './settings.js';
import {evolutionConfig, numeroWhatsapp} from './evolution-whatsapp.js';

const COL = 'cadastrosBoasVindas';
const FILA = 'evolutionWhatsappOutbox';
const CODIGO_MS = 10 * 60_000;
const UM_DIA = 24 * 60 * 60_000;

export function configBoasVindas(db) {
  return {...DEFAULT_SETTINGS().boasVindas, ...(getSetting(db, 'boasVindas') || {})};
}

export function validarConfigBoasVindas(body) {
  const tipo = String(body.tipo || 'percentual');
  const valor = Number(String(body.valor || '').replace(',', '.'));
  const validadeHoras = Number(body.validadeHoras);
  const intervaloReexibicaoHoras = Number(body.intervaloReexibicaoHoras);
  const minimo = Number(String(body.compraMinima || '0').replace(',', '.'));
  const maxCadastrosIpDia = Number(body.maxCadastrosIpDia);
  const titulo = String(body.titulo || '').trim().slice(0, 80);
  const subtitulo = String(body.subtitulo || '').trim().slice(0, 160);
  if (!['percentual','fixo'].includes(tipo) || !Number.isFinite(valor) ||
      valor <= 0 || valor > (tipo === 'percentual' ? 100 : 1000) ||
      !Number.isFinite(valor * 100)) return {ok:false, erro:'Valor do desconto inválido.'};
  if (!Number.isSafeInteger(validadeHoras) || validadeHoras < 1 || validadeHoras > 720)
    return {ok:false, erro:'A validade deve ser de 1 a 720 horas.'};
  if (!Number.isSafeInteger(intervaloReexibicaoHoras) || intervaloReexibicaoHoras < 1 || intervaloReexibicaoHoras > 168)
    return {ok:false, erro:'O intervalo para reexibir o pop-up deve ser de 1 a 168 horas.'};
  if (!Number.isFinite(minimo) || minimo < 0 || minimo > 100000 ||
      !Number.isSafeInteger(Math.round(minimo * 100)))
    return {ok:false, erro:'Compra mínima inválida.'};
  if (!Number.isSafeInteger(maxCadastrosIpDia) || maxCadastrosIpDia < 2 || maxCadastrosIpDia > 10)
    return {ok:false, erro:'Limite diário por rede deve estar entre 2 e 10.'};
  if (titulo.length < 5 || subtitulo.length < 5)
    return {ok:false, erro:'Preencha os textos de apresentação.'};
  return {ok:true, dados:{
    ativo: body.ativo === '1' || body.ativo === 'on',
    titulo, subtitulo, tipo, valor: Math.round(valor * 100) / 100,
    validadeHoras, intervaloReexibicaoHoras, compraMinimaCentavos: Math.round(minimo * 100),
    maxCadastrosIpDia,
  }};
}

function assinatura(valor) {
  return crypto.createHmac('sha256', config.sessionSecret)
    .update(String(valor)).digest('hex');
}
function dispositivoHash(token) {
  return token && /^[a-zA-Z0-9_-]{24,100}$/.test(token) ? assinatura('device:'+token) : '';
}
function redeHash(ip) {
  return ip && ip !== 'unknown' ? assinatura('ip:'+ip) : '';
}
function codigoHash(id, codigo) { return assinatura('otp:'+id+':'+codigo); }
function igualdadeSegura(a, b) {
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
const soDigitos = s => String(s || '').replace(/\D/g, '');
const emailValido = s => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s);
function nomeValido(s) {
  const palavras=s.trim().split(/\s+/).filter(Boolean);
  return s.length>=6 && s.length<=120 && palavras.length>=2 &&
    palavras.every(p=>/^[\p{L}'’-]{2,}$/u.test(p)) &&
    !/^(teste|test|asdf|fake|falso|cliente|usuario)\b/i.test(s);
}
function clienteExistente(db, email, numero) {
  return db.collection('customers').findOne(c =>
    c.email?.trim().toLowerCase() === email ||
    numeroWhatsapp(c.telefone) === numero);
}

/**
 * Evita reapresentar a oferta após o WhatsApp ter sido confirmado neste
 * navegador. O cookie contém token aleatório; buscamos só seu HMAC.
 */
export function jaConfirmouBoasVindasNesteNavegador(db, token) {
  const hash=dispositivoHash(token);
  if(!hash)return false;
  return Boolean(
    db.collection(COL).findOne(c=>c.status==='confirmado' && c.dispositivoHash===hash) ||
    db.collection('bloqueiosCupomBoasVindas').findOne(c=>c.dispositivoHash===hash)
  );
}

export function iniciarBoasVindas(db, dados, {dispositivo='', ip='', agora=Date.now()}={}) {
  const cfg=configBoasVindas(db);
  if (!cfg.ativo) return {ok:false, erro:'A campanha não está disponível.'};
  const evo=evolutionConfig(db);
  if (!evo.ativo || !evo.instancia)
    return {ok:false, erro:'A confirmação pelo WhatsApp está indisponível.'};
  const nome=String(dados.nome||'').trim().replace(/\s+/g,' ').slice(0,130);
  const email=String(dados.email||'').trim().toLowerCase().slice(0,255);
  const telefone=numeroWhatsapp(dados.telefone);
  if (!nomeValido(nome) || !emailValido(email) || !telefone)
    return {ok:false, erro:'Informe nome completo, e-mail válido e celular com DDD.'};
  if (dados.politica !== '1')
    return {ok:false, erro:'Leia e aceite as condições do cadastro e a Política de Privacidade.'};

  const col=db.collection(COL), dh=dispositivoHash(dispositivo), ih=redeHash(ip);
  const bloqueado=db.collection('bloqueiosCupomBoasVindas').findOne(b=>
    b.telefoneHash===assinatura('telefone:'+telefone) ||
    b.emailHash===assinatura('email:'+email) ||
    (dh && b.dispositivoHash===dh));
  if(bloqueado)
    return {ok:false,erro:'Este contato já utilizou um cupom de boas-vindas.'};

  if (clienteExistente(db,email,telefone) ||
      col.findOne(c=>c.status==='confirmado' &&
        (c.telefone===telefone || c.email===email || (dh && c.dispositivoHash===dh))))
    return {ok:false, erro:'Este cadastro já participou da oferta ou possui uma conta.'};
  const mesmoPendente=col.findOne(c=>c.status==='pendente' &&
    (c.telefone===telefone || c.email===email || (dh && c.dispositivoHash===dh)) &&
    Date.parse(c.codigoExpiraEm||'')>agora);
  if (mesmoPendente)
    return {ok:false, erro:'Já enviamos um código recentemente. Confira o WhatsApp antes de tentar novamente.'};

  const ipHoje=ih && col.count(c=>c.status==='confirmado' && c.ipHash===ih &&
    Date.parse(c.confirmadoEm||'')>agora-UM_DIA);
  if (ipHoje >= cfg.maxCadastrosIpDia)
    return {ok:false, erro:'Limite de participação nesta rede atingido. Entre em contato com a farmácia.'};
  const id='bv_'+uid();
  const codigo=String(crypto.randomInt(100000,1000000));
  const criadoEm=new Date(agora).toISOString();
  const codigoExpiraEm=new Date(agora+CODIGO_MS).toISOString();
  col.insert({
    id,nome,email,telefone,dispositivoHash:dh,ipHash:ih,
    status:'pendente',codigoHash:codigoHash(id,codigo),codigoExpiraEm,
    tentativas:0,criadoEm, marketing: dados.marketing==='1',
    receberCupomWhatsapp: dados.receberCupomWhatsapp==='1',
    consentimento: {aceitoEm:criadoEm,origem:'popup-home',versao:1,
      marketing: dados.marketing==='1',entregaCupomWhatsapp: dados.receberCupomWhatsapp==='1'},
  });
  db.collection(FILA).insert({
    id:'boas_vindas_otp:'+id,leadId:id,tipo:'boas_vindas_otp',
    numero:telefone,texto:'Farmácia Pague Pouco: seu código de confirmação é '+codigo+
      '. Ele vence em 10 minutos. Não compartilhe com ninguém.',
    status:'fila',tentativas:0,criadoEm,
  });
  return {ok:true,desafio:id,expiraEm:codigoExpiraEm};
}

export function confirmarBoasVindas(db, {desafio, codigo}, {agora=Date.now()}={}) {
  const cfg=configBoasVindas(db), col=db.collection(COL);
  if (!cfg.ativo) return {ok:false,erro:'Campanha desativada.'};
  const lead=col.get(String(desafio||''));
  if (!lead || lead.status!=='pendente')
    return {ok:false,erro:'Solicite um novo código de confirmação.'};
  if (Date.parse(lead.codigoExpiraEm||'') <= agora)
    return {ok:false,erro:'Código expirado. Solicite um novo cadastro.'};
  if (Number(lead.tentativas||0)>=5)
    return {ok:false,erro:'Muitas tentativas. Solicite um novo código.'};
  const cod=soDigitos(codigo);
  if (!/^\d{6}$/.test(cod) || !igualdadeSegura(codigoHash(lead.id,cod),lead.codigoHash)) {
    col.update(lead.id,{tentativas:(lead.tentativas||0)+1});
    return {ok:false,erro:'Código incorreto. Confira a mensagem recebida.'};
  }
  const bloqueado=db.collection('bloqueiosCupomBoasVindas').findOne(b=>
    b.telefoneHash===assinatura('telefone:'+lead.telefone) ||
    b.emailHash===assinatura('email:'+lead.email) ||
    (lead.dispositivoHash && b.dispositivoHash===lead.dispositivoHash));
  if(bloqueado)
    return {ok:false,erro:'Este contato já utilizou um cupom de boas-vindas.'};

  // Reválida antes de emitir: o intervalo entre solicitar e confirmar
  // não pode permitir cupom duplicado por telefone, e-mail ou navegador.
  if (clienteExistente(db,lead.email,lead.telefone) ||
      col.findOne(c=>c.id!==lead.id && c.status==='confirmado' &&
        (c.telefone===lead.telefone || c.email===lead.email ||
          (lead.dispositivoHash && c.dispositivoHash===lead.dispositivoHash))))
    return {ok:false,erro:'Este cadastro já participou da campanha.'};

  const cupons=db.collection('coupons');
  let codigoCupom;
  do { codigoCupom='BEMV'+crypto.randomBytes(6).toString('hex').toUpperCase(); }
  while(cupons.findOne(c=>c.codigo===codigoCupom));
  const emitidoEm=new Date(agora).toISOString();
  const expiraEm=new Date(agora+Number(cfg.validadeHoras)*3_600_000).toISOString();
  const cupom=cupons.insert({
    codigo:codigoCupom, tipo:cfg.tipo, valor:cfg.valor,
    valorMinimo:cfg.compraMinimaCentavos,usoMaximo:1,usos:0,
    ativo:true,primeiroPedido:true,boasVindas:true,
    leadBoasVindasId:lead.id,clienteExclusivoTelefone:lead.telefone,
    clienteExclusivoEmail:lead.email,emitidoEm,expiraEm,
    validadeHoras:cfg.validadeHoras,
    descricao:'Cupom exclusivo de boas-vindas',
  });
  col.update(lead.id,{status:'confirmado',confirmadoEm:emitidoEm,
    codigoHash:null,codigoExpiraEm:null,cupomId:cupom.id});
  // O código OTP não deve mais sair da fila após a confirmação.
  const pendenteOtp=db.collection(FILA).get('boas_vindas_otp:'+lead.id);
  if (pendenteOtp?.status==='fila')
    db.collection(FILA).update(pendenteOtp.id,{status:'cancelado',texto:null});
  if (lead.receberCupomWhatsapp) {
    const msg='🎁 Olá, '+lead.nome.split(' ')[0]+'! Seu cupom exclusivo da Farmácia Pague Pouco é *'+
      cupom.codigo+'*. Use em sua primeira compra, com o mesmo e-mail e WhatsApp do cadastro. '+
      'Válido até '+new Date(expiraEm).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+
      '. Compra mínima: R$ '+(cupom.valorMinimo/100).toFixed(2).replace('.',',')+
      '. Sujeito às condições da campanha.';
    db.collection(FILA).insert({id:'boas_vindas_cupom:'+lead.id,
      leadId:lead.id,cupomId:cupom.id,tipo:'boas_vindas_cupom',
      numero:lead.telefone,texto:msg,status:'fila',tentativas:0,criadoEm:emitidoEm});
  }
  return {ok:true,codigo:cupom.codigo,expiraEm,
    validadeHoras:cfg.validadeHoras,compraMinimaCentavos:cfg.compraMinimaCentavos};
}

/**
 * Exclusão administrativa de PRÉ-CADASTRO. Preserva a conta de compras e
 * pedidos. Cupons emitidos são revogados e mensagens pendentes canceladas.
 * Após um resgate, mantém-se somente assinaturas anti-repetição (sem PII em
 * claro) e o registro financeiro do cupom, para evitar novo benefício.
 */
export function excluirCadastroBoasVindas(db, id) {
  const cadastros=db.collection(COL);
  const lead=cadastros.get(String(id||''));
  if(!lead)return {ok:false,erro:'Cadastro de boas-vindas não encontrado.'};

  const cupons=db.collection('coupons');
  const cupom=lead.cupomId?cupons.get(lead.cupomId):null;
  if(lead.cupomId && (!cupom || cupom.boasVindas!==true ||
      cupom.leadBoasVindasId!==lead.id)) {
    return {ok:false,erro:'Não foi possível identificar o cupom vinculado. Nenhum dado foi alterado.'};
  }
  const data=nowISO();
  const foiUsado=Number(cupom?.usos||0)>0;
  if(foiUsado) {
    // Sem nomes, e-mails ou números em claro; impede segundo benefício
    // mesmo após a remoção da linha, preservando o histórico de resgates.
    const bloqueios=db.collection('bloqueiosCupomBoasVindas');
    bloqueios.insert({
      id:'resgate:'+cupom.id,
      telefoneHash:assinatura('telefone:'+lead.telefone),
      emailHash:assinatura('email:'+lead.email),
      dispositivoHash:lead.dispositivoHash||'',
      cupomId:cupom.id,
      motivo:'cupom_utilizado',
      criadoEm:data,
    });
  }
  if(cupom) {
    cupons.update(cupom.id,{
      ativo:false,
      canceladoEm:data,
      clienteExclusivoTelefone:null,
      clienteExclusivoEmail:null,
    });
    // A cesta pode ter armazenado o desconto antes da revogação.
    db.collection('carts').updateMany(
      cart=>cart.cupom?.cupomId===cupom.id,
      ()=>({cupom:null,atualizadoEm:data})
    );
  }
  db.collection(FILA).updateMany(
    msg=>msg.leadId===lead.id &&
      ['boas_vindas_otp','boas_vindas_cupom'].includes(msg.tipo),
    msg=>({
      numero:null,texto:null,
      status:msg.status==='fila'?'cancelado':msg.status,
      atualizadoEm:data,
    })
  );
  cadastros.remove(lead.id);
  return {ok:true,cupomId:cupom?.id||null,cupomUtilizado:foiUsado};
}

export function listarBoasVindas(db) {
  const registros=db.collection(COL).all()
    .sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm)));
  const cupons=db.collection('coupons');
  const agora=Date.now();
  const confirmados=registros.filter(r=>r.status==='confirmado');
  return {
    registros:registros.slice(0,100),
    metricas:{
      iniciados:registros.length,
      confirmados:confirmados.length,
      resgatados:confirmados.filter(r=>(cupons.get(r.cupomId)?.usos||0)>0).length,
      expirados:confirmados.filter(r=>{
        const c=cupons.get(r.cupomId);
        return c && (c.usos||0)===0 && Date.parse(c.expiraEm||'')<=agora;
      }).length,
    },
  };
}
