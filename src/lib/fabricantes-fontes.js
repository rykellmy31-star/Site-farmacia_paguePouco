/**
 * Inventário somente leitura das marcas e fabricantes já cadastrados.
 * Executado dentro da sessão admin da loja, diretamente no banco local
 * do Durable Object: nenhum produto, cliente ou credencial é exportado.
 */
import {eanValido} from './busca-medidas-ean.js';

function nomeLimpo(valor){
  return String(valor||'').normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,130);
}
export function inventarioFabricantesFotos(produtos){
  const grupos=new Map();
  let total=0,semFoto=0,semFabricante=0,comEan=0;
  for(const p of (Array.isArray(produtos)?produtos:[])){
    if(!p||p.inovaArquivado?.em)continue;
    total++;
    const fabricante=nomeLimpo(p.fabricante);
    const marca=nomeLimpo(p.marca);
    const identificacao=fabricante||marca||'Não informado';
    const chave=identificacao.toLocaleLowerCase('pt-BR');
    const foto=Array.isArray(p.imagens)&&p.imagens.some(i=>i?.url);
    const ean=eanValido(p.ean);
    if(!foto)semFoto++;
    if(!fabricante)semFabricante++;
    if(ean)comEan++;
    let grupo=grupos.get(chave);
    if(!grupo){
      grupo={fabricante:identificacao,tipoOrigem:fabricante?'fabricante':marca?'marca':'não informado',
        produtos:0,semFoto:0,eanValidos:0,marcas:new Set(),integracaoOficial:false};
      grupos.set(chave,grupo);
    }
    grupo.produtos++;
    if(!foto)grupo.semFoto++;
    if(ean)grupo.eanValidos++;
    if(marca)grupo.marcas.add(marca);
    // Dailus é uma origem integrada, mas isso NÃO garante foto para todo SKU.
    grupo.integracaoOficial=grupo.integracaoOficial||
      /\bDAILUS\b/i.test(fabricante)||/\bDAILUS\b/i.test(marca);
  }
  const fabricantes=[...grupos.values()]
    .map(g=>({...g,marcas:[...g.marcas].sort((a,b)=>a.localeCompare(b,'pt-BR')).slice(0,5)}))
    .sort((a,b)=>b.semFoto-a.semFoto||a.fabricante.localeCompare(b.fabricante,'pt-BR'));
  return {total,semFoto,semFabricante,comEan,quantidadeFabricantes:fabricantes.length,
    fontesGenericas:['Open Food Facts','Open Beauty Facts','Open Products Facts',
      'Open Pet Food Facts','PreçoMelhor','Wikimedia Commons','Openverse (Flickr)'],
    fabricantes};
}
