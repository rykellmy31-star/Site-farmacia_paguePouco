/**
 * Única operação permitida no Melhor Envio: COTAÇÃO.
 * Nunca chamar /cart, /checkout, /generate, etiquetas ou qualquer compra.
 * A chave permanece exclusivamente no servidor (Cloudflare secret).
 */
import { config } from '../config.js';
import { tokenOAuthMelhorEnvio } from './melhor-envio-oauth.js';
import { calcularFrete, normalizeFreightConfig } from './freight.js';
import { isValidCep, normalizeCep } from './cep.js';

const ENDPOINT = '/api/v2/me/shipment/calculate';
const texto = (v,max=90) => String(v||'').replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,max);
const numeroPositivo = (v) => Number.isFinite(Number(v)) && Number(v)>0;

export function prepararCotacaoMelhorEnvio({origem,destino,items=[]}) {
  const from=normalizeCep(origem),to=normalizeCep(destino);
  if(!isValidCep(from)||!isValidCep(to)||from===to)
    return {ok:false,erro:'Verifique os CEPs de origem e destino.'};
  if(!items.length||items.length>80)return {ok:false,erro:'Carrinho inválido para a cotação.'};
  const products=[];
  for(const i of items){
    const peso=Number(i.peso), largura=Number(i.largura),
      altura=Number(i.altura),comprimento=Number(i.comprimento);
    const quantidade=Number(i.quantidade);
    const precoCentavos=Number(i.precoUnitarioCentavos ?? i.precoUnitario);
    if(!numeroPositivo(peso)||!numeroPositivo(largura)||!numeroPositivo(altura)||
       !numeroPositivo(comprimento)||!Number.isSafeInteger(quantidade)||
       quantidade<1||quantidade>99||!numeroPositivo(precoCentavos)){
      return {ok:false,erro:'Para calcular o frete, cadastre peso (kg) e dimensões (cm) reais de todos os produtos da cesta.'};
    }
    products.push({
      id:texto(i.produtoId||i.id,80),
      width:largura,height:altura,length:comprimento,weight:peso,
      insurance_value:Math.round(precoCentavos)/100,quantity:quantidade,
    });
  }
  return {ok:true,body:{from:{postal_code:from},to:{postal_code:to},
    products,options:{receipt:false,own_hand:false}}};
}

/** Diagnóstico de integração: somente cotação de UM pacote fictício; jamais cria etiqueta. */
export async function testarCotacaoMelhorEnvio({ origem, destino, token, contato, sandbox=false, fetcher=globalThis.fetch }) {
  const calculo = await consultarMelhorEnvio({ origem, destino, token, contato, sandbox, fetcher,
    items: [{ produtoId:'simulacao-integracao', quantidade:1, peso:0.5,
      largura:15, altura:10, comprimento:20, precoUnitarioCentavos:3000 }],
    timeoutMs:7000,
  });
  if (!calculo.ok) return calculo;
  return { ok:true, ambiente:sandbox?'sandbox':'producao',
    opcoes:calculo.opcoes.slice(0,3).map(o=>({
      label:o.label, valor:o.valor, prazo:o.prazo,
    })) };
}

export async function consultarMelhorEnvio({origem,destino,items=[],token,contato,
  sandbox=false,fetcher=globalThis.fetch,timeoutMs=7000}) {
  if(!token||!contato||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contato))
    return {ok:false,erro:'Integração de cotação não configurada. Configure o token e e-mail técnico no servidor.'};
  const pedido=prepararCotacaoMelhorEnvio({origem,destino,items});
  if(!pedido.ok)return pedido;
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),Math.max(1000,Math.min(10000,Number(timeoutMs)||7000)));
  try {
    const base=sandbox?'https://sandbox.melhorenvio.com.br':'https://melhorenvio.com.br';
    const resp=await fetcher(base+ENDPOINT,{method:'POST',
      headers:{'Authorization':'Bearer '+token,'Accept':'application/json',
        'Content-Type':'application/json','User-Agent':'Farmacia Pague Pouco ('+contato+')'},
      body:JSON.stringify(pedido.body),signal:ctrl.signal});
    if(!resp.ok)return {ok:false,erro:'Não foi possível consultar as transportadoras agora. Tente novamente.'};
    const resposta=await resp.json();
    if(!Array.isArray(resposta))return {ok:false,erro:'A cotação retornou um formato inesperado.'};
    const opcoes=[];
    const ids=new Set();
    for(const item of resposta){
      if(item?.error||!Number.isSafeInteger(Number(item?.id))||!item?.company?.name)continue;
      const id='me_'+String(item.id);
      if(ids.has(id))continue;
      const preco=Number(item.custom_price??item.price);
      const dias=Number(item.custom_delivery_time??item.delivery_time);
      if(!Number.isFinite(preco)||preco<0||!Number.isFinite(dias)||dias<0)continue;
      const valor=Math.round(preco*100),prazoMax=Math.ceil(dias);
      if(!Number.isSafeInteger(valor)||valor<0||valor>2_000_000)continue;
      ids.add(id);
      opcoes.push({id, label:texto(item.company.name,65)+' — '+texto(item.name,65),
        valor,prazoMin:prazoMax,prazoMax,
        prazo:prazoMax+' '+(prazoMax===1?'dia útil':'dias úteis'),
        detalhe:'Cotação Melhor Envio; contratação e postagem não são automáticas.',
        transportadora:texto(item.company.name,65),servico:texto(item.name,65),
        gratis:valor===0,origem:'melhor-envio'});
    }
    opcoes.sort((a,b)=>a.valor-b.valor);
    if(!opcoes.length)return {ok:false,erro:'Nenhuma transportadora disponível para este pedido e CEP.'};
    return {ok:true,opcoes};
  }catch {
    // Não expor token, corpo da resposta ou URLs do provedor nos logs/erros.
    return {ok:false,erro:'A consulta de frete está temporariamente indisponível. Tente novamente.'};
  }finally {clearTimeout(timeout);}
}

/**
 * Integração opcional: enquanto não habilitada, mantém o frete fixo existente.
 * Para CEP da sede, SEMPRE preserva retirada e entrega local.
 * Quando habilitada mas indisponível, falha fechada (não cobra preço inventado).
 */
export async function calcularFreteIntegrado(params,{fetcher,token,contato,sandbox}={}) {
  const cfg=normalizeFreightConfig(params.config);
  const consultarExterno = Boolean(cfg.melhorEnvio?.ativo) &&
    normalizeCep(params.cep) !== normalizeCep(params.cepFarmacia);
  // Não bloquear o Melhor Envio por UF desativada no sistema antigo de frete fixo.
  // Mantemos validações de CEP, restrições, peso, volume e bloqueios explícitos.
  const base=calcularFrete({...params,permitirCotacaoExterna:consultarExterno});
  if(!base.disponivel)return base;
  if(!consultarExterno)return base;
  const tokenAtual = token ?? (await tokenOAuthMelhorEnvio(params.db, {fetcher}) || config.melhorEnvio?.token);
  const cotacao=await consultarMelhorEnvio({
    origem:params.cepFarmacia,destino:params.cep,
    items:params.items,token:tokenAtual,
    contato:contato??config.melhorEnvio?.contato,
    sandbox:sandbox??config.melhorEnvio?.sandbox,
    fetcher,
  });
  if(!cotacao.ok)return {...base,disponivel:false,opcoes:[],motivo:cotacao.erro};
  // Preservar frete grátis por cupom e política já configurada da farmácia.
  const fg=cfg.freteGratis;
  const gratis=Boolean(params.cupomFreteGratis)||
    Boolean(fg?.ativo&&params.subtotalCents>=Number(fg.valorMinimo||0)&&
      (fg.aplicaPara!=='estados'||(fg.estados||[]).includes(base.uf)));
  return {...base,disponivel:true,opcoes:cotacao.opcoes.map(o=>({
    ...o,valor:gratis?0:o.valor,gratis:gratis||o.gratis,
  })),motivo:'',fonte:'melhor-envio'};
}

export async function resolverFreteIntegrado(params,opts={}) {
  const calc=await calcularFreteIntegrado(params,opts);
  if(!calc.disponivel)return {ok:false,erro:calc.motivo||'Frete indisponível.'};
  const opcao=calc.opcoes.find(o=>o.id===params.opcaoId);
  if(!opcao)return {ok:false,erro:'A opção de frete selecionada não está disponível para este CEP.'};
  return {ok:true,opcao,valor:opcao.valor,
    prazoMin:opcao.prazoMin,prazoMax:opcao.prazoMax,detalhes:calc};
}
