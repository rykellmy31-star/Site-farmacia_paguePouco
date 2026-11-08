/**
 * Teste online: consulta o catálogo PreçoMelhor e tenta baixar a imagem real
 * de duas fraldas Personal com GTIN14 do estoque (sem dados de cliente).
 * Não considera foto "encontrada" quando CDN responde 404 ou 200px.
 */
import assert from 'node:assert/strict';
import {buscarDadosExternosEAN} from '../src/lib/enriquecimento-ean.js';
import {buscarImagemDisponivel} from '../src/lib/ean-image-download.js';
function tamanhoWebp(b){
 const tipo=b.subarray(12,16).toString('ascii');
 if(tipo==='VP8 '&&b.length>30)return {w:b.readUInt16LE(26)&0x3fff,h:b.readUInt16LE(28)&0x3fff};
 if(tipo==='VP8X'&&b.length>30)return {w:1+b.readUIntLE(24,3),h:1+b.readUIntLE(27,3)};
 if(tipo==='VP8L'&&b.length>25){
   const a=b.readUInt32LE(21);
   return {w:1+(a&0x3fff),h:1+((a>>14)&0x3fff)};
 }
 return null;
}
let imagensReaisVerificadas=0;
for(const [ean,nome] of [
 ['17896110011209','FRALDA PERSONAL HIPER G 60 UNI'],
 ['17896110011193','FRALDA PERSONAL HIPER M 70 UNI'],
]){
 const r=await buscarDadosExternosEAN(ean,{somente:'imagem',force:true,
   nomeProduto:nome,marcaProduto:'PERSONAL',googleKey:'',googleCx:''});
 const origem=r.imagensCandidatas.find(x=>x.fonteEAN?.correspondencia==='gtin14-embalagem');
 if (!origem) {
   console.warn('[Personal real] Fonte externa temporariamente sem o GTIN '+ean+'; validação de outros EANs continua.');
   continue;
 }
 console.log('[Personal real] '+ean+' -> '+origem.fonteEAN.codigoNaFonte+
   ' URL '+new URL(origem.url).pathname+' fontes '+r.consultadas.join(', '));
 const arquivo=await buscarImagemDisponivel(origem,{timeoutMs:10000});
 assert.ok(arquivo.ok,'A mídia da fonte não foi baixada: '+ean+' '+arquivo.motivo);
 const dim=arquivo.mime==='image/webp'?tamanhoWebp(arquivo.bytes):null;
 console.log('[Personal real] mídia '+arquivo.mime+' '+arquivo.bytes.length+' bytes'+
   (dim?' '+dim.w+'x'+dim.h:' dimensões não inspecionadas'));
 assert.ok(dim&&dim.w>=600&&dim.h>=600,
   'Fonte possui foto de baixa resolução; não declarar sucesso automático para '+ean);
 imagensReaisVerificadas++;
}
assert.ok(imagensReaisVerificadas>=1,
  'Nenhuma mídia real de alta resolução das amostras Personal pôde ser verificada online.');
