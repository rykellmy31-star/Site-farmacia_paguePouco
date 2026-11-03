/**
 * Verificação pública REAL do esmalte problemático, sem simular a API.
 * Falhas devem bloquear publicação, não mascarar um 403/404 como sucesso.
 * Consulta somente endpoints de catálogo e mídia; não acessa painel/dados.
 */
import assert from 'node:assert/strict';
import { buscarDadosExternosEAN } from '../src/lib/enriquecimento-ean.js';
import { candidatosImagemEAN } from '../src/lib/ean-image-download.js';
const EAN='07894222042381';
const JSON_URL='https://www.dailus.com.br/products/esmalte-brigadeirao.js';
const OFFICIAL='https://www.dailus.com.br/products/esmalte-brigadeirao';
const timeout=ms=>AbortSignal.timeout(ms);
let checked=0;
function report(m){console.log('[Dailus real]',m)}
try{
  const json=await fetch(JSON_URL,{signal:timeout(12000),
    headers:{Accept:'application/json','User-Agent':'FarmaciaPaguePouco/1.0 (site.farmaciapaguepouco.app)'}});
  report('Resposta ficha fabricante HTTP '+json.status+' tipo '+(json.headers.get('content-type')||''));
  assert.equal(json.status,200,'A ficha oficial da Dailus deve responder HTTP 200 ao servidor');
  const data=await json.json();
  assert.equal(data.vendor,'DAILUS');
  assert.ok(data.variants?.some(v=>v.barcode==='7894222042381'));
  assert.equal(data.handle,'esmalte-brigadeirao');
  checked++;
  report('GTIN13 e fabricante conferidos na resposta real');
  const found=await buscarDadosExternosEAN(EAN,{force:true,somente:'imagem',
    nomeProduto:'Esmalte Dailus Choco Cherry Brigadeirão 8 ml',marcaProduto:'DAILUS'});
  report('Fontes consultadas '+found.consultadas.join(', '));
  const candidate=(found.imagensCandidatas||[]).find(x=>x.fonteEAN?.fonte==='Dailus (fabricante)');
  assert.ok(candidate,'Buscador real deve devolver candidato Dailus para '+EAN);
  assert.equal(candidate.fonteEAN?.urlAtribuicao,OFFICIAL);
  checked++;
  const urls=candidatosImagemEAN(candidate);
  assert.ok(urls.length>0,'Proxy deve permitir a foto oficial');
  const response=await fetch(urls[0],{signal:timeout(12000),redirect:'manual',
    headers:{Accept:'image/webp,image/png,image/jpeg','User-Agent':'FarmaciaPaguePouco/1.0 (site.farmaciapaguepouco.app)'}});
  report('Resposta foto CDN HTTP '+response.status+' tipo '+(response.headers.get('content-type')||''));
  assert.equal(response.status,200,'Foto oficial deve responder HTTP 200 sem parametros da URL');
  const bytes=new Uint8Array(await response.arrayBuffer());
  const isWebp=bytes.length>=12&&new TextDecoder().decode(bytes.subarray(0,4))==='RIFF'&&
    new TextDecoder().decode(bytes.subarray(8,12))==='WEBP';
  assert.ok(isWebp&&bytes.length>10000,'Imagem deve ser WebP real com conteudo relevante');
  checked++;
  report('SUCESSO: ficha real + EAN correto + busca real + CDN real ('+bytes.length+' bytes, '+checked+' checagens)');
}catch(e){console.error('[Dailus real] FALHA:',e.message);process.exitCode=1;}
