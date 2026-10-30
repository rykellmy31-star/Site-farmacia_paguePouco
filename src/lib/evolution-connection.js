/** Gerenciamento seguro da instância WhatsApp da farmácia, somente no servidor. */
import {evolutionConfig,hostValido} from './evolution-whatsapp.js';

export function credenciaisEvolution(db, env = {}) {
  const cfg = evolutionConfig(db);
  // A URL e a chave são configuradas na Cloudflare; preserva o endereço já salvo
  // na instalação antiga para não interromper os avisos existentes.
  const baseUrl = String(env.EVOLUTION_API_URL || env.EVOLUTION_BASE_URL ||
    process.env.EVOLUTION_API_URL || process.env.EVOLUTION_BASE_URL || cfg.baseUrl || '')
    .trim().replace(/\/+$/, '');
  const apiKey = String(env.EVOLUTION_API_KEY || process.env.EVOLUTION_API_KEY || '').trim();
  return {baseUrl, apiKey, configurado: Boolean(hostValido(baseUrl) && apiKey)};
}

function nomeInstancia(value) {
  const nome = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{2,64}$/.test(nome) ? nome : '';
}

async function consultar(baseUrl, apiKey, path, {method = 'GET', body, enviar = globalThis.fetch} = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await enviar(baseUrl + path, {
      method, headers: {'apikey': apiKey, ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
      signal: ctrl.signal, redirect: 'manual',
    });
    // O conteúdo externo jamais é repassado diretamente à página: pode conter chave ou dados.
    if (!res.ok) return {ok:false, status:res.status};
    const raw = await res.text();
    if (raw.length > 450000) return {ok:false, status:502};
    try {return {ok:true, data:JSON.parse(raw)};}
    catch {return {ok:false,status:502};}
  } catch {return {ok:false,status:503};}
  finally {clearTimeout(timer);}
}

function estadoConexao(data) {
  const state = String(data?.instance?.state || data?.instance?.status ||
    data?.state || '').toLowerCase();
  if (state === 'open' || state === 'connected') return 'conectado';
  if (state === 'connecting') return 'conectando';
  if (state === 'close' || state === 'disconnected') return 'desconectado';
  return 'nao_criada';
}

function imagemQr(data) {
  const candidate = data?.base64 || data?.qrcode?.base64 || data?.qrcode?.qrcode?.base64;
  if (typeof candidate !== 'string') return null;
  const normalized = candidate.replace(/^data:image\/(?:png|jpeg);base64,/i,'').trim();
  if (normalized.length < 100 || normalized.length > 300000 ||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(normalized)) return null;
  return 'data:image/png;base64,' + normalized;
}

export async function estadoEvolution(db, env = {}, enviar = globalThis.fetch) {
  const {baseUrl,apiKey,configurado} = credenciaisEvolution(db,env);
  if (!configurado) return {ok:false, erro:'A integração ainda não está configurada no servidor.'};
  const instancia = nomeInstancia(evolutionConfig(db).instancia);
  if (!instancia) return {ok:false, erro:'Salve primeiro o nome da instância da farmácia.'};
  const r = await consultar(baseUrl,apiKey,
    '/instance/connectionState/'+encodeURIComponent(instancia),{enviar});
  if (r.status === 404) return {ok:true, estado:'nao_criada'};
  if (!r.ok) return {ok:false, erro:'Não foi possível consultar a Evolution API.',codigo:r.status};
  return {ok:true,estado:estadoConexao(r.data)};
}

export async function conectarEvolution(db,env = {},enviar = globalThis.fetch) {
  const {baseUrl,apiKey,configurado}=credenciaisEvolution(db,env);
  if(!configurado)return {ok:false,erro:'Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no Worker da farmácia.'};
  const instancia=nomeInstancia(evolutionConfig(db).instancia);
  if(!instancia)return {ok:false,erro:'Salve o nome da instância antes de conectar.'};
  const atual=await estadoEvolution(db,env,enviar);
  if (!atual.ok) return atual;
  if (atual.estado === 'conectado') return {ok:true,estado:'conectado',qr:null};
  let retorno;
  if (atual.estado === 'nao_criada') {
    retorno=await consultar(baseUrl,apiKey,'/instance/create',{
      method:'POST', body:{instanceName:instancia,integration:'WHATSAPP-BAILEYS',qrcode:true},
      enviar,
    });
    // Uma instância criada em outra sessão pode aparecer entre os dois pedidos.
    if(!retorno.ok && ![400,403,409].includes(retorno.status))
      return {ok:false,erro:'Não foi possível criar a instância WhatsApp.'};
    const qr=retorno.ok?imagemQr(retorno.data):null;
    if(qr)return {ok:true,estado:'conectando',qr};
  }
  retorno=await consultar(baseUrl,apiKey,
    '/instance/connect/'+encodeURIComponent(instancia),{enviar});
  if(!retorno.ok)return {ok:false,erro:'Não foi possível gerar o QR Code. Verifique a instância no servidor.'};
  const estado=estadoConexao(retorno.data);
  return {ok:true,estado:estado==='nao_criada'?'conectando':estado,
    qr:imagemQr(retorno.data)};
}
