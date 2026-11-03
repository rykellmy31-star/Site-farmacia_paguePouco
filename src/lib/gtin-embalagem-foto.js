/**
 * GTIN-14 de embalagem logística: indicador 1..8 + 12 primeiros
 * dígitos do GTIN-13 + dígito verificador diferente.
 * A relação técnica NÃO prova identidade de fotos: validar nome,
 * marca, tamanho e unidades antes de mostrar a mídia do GTIN-13.
 */
import {eanValido,normalizarEAN} from './busca-medidas-ean.js';
export function gtinVarejoDaEmbalagem(codigo){
  const s=normalizarEAN(codigo);
  if(!/^[1-8]\d{13}$/.test(s)||!eanValido(s))return '';
  const corpo=s.slice(1,-1);
  const soma=[...corpo].reverse().reduce((sum,x,i)=>
    sum+Number(x)*(i%2===0?3:1),0);
  const ean=corpo+((10-soma%10)%10);
  return eanValido(ean)?ean:'';
}
const comparavel=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
function tamanhoFralda(s){
  const c=' '+comparavel(s)+' ';
  const tokens=c.trim().split(' ').map(t=>t.replace(/^(XXG|XG|EG|G|M|P)(\d{1,3})$/,'$1'));
  if(tokens.includes('XXG')||tokens.includes('XGG')||tokens.includes('EXTRAEXTRAGRANDE'))return 'XXG';
  if(tokens.includes('XG')||tokens.includes('EG')||tokens.includes('EXTRAGRANDE'))return 'XG';
  if(tokens.includes('G')||tokens.includes('GRANDE'))return 'G';
  if(tokens.includes('M')||tokens.includes('MEDIO'))return 'M';
  if(tokens.includes('P')||tokens.includes('PEQUENO'))return 'P';
  if(tokens.includes('RN'))return 'RN';
  return '';
}
function quantidadesFralda(s){
  const t=comparavel(s);
  const qs=new Set();
  const regexes=[
    /\b(?:LEVE|C|COM|CONTEM|PACOTE|HIPER|JUMBO|MEGA)\s*(\d{1,3})\b/g,
    /\b(\d{1,3})\s*(?:UNIDADES|UNIDADE|UNID|UNDS|UND|UN|FRALDAS)\b/g,
    /\b(?:RN|XXG|XG|EG|G|M|P)\s*(\d{1,3})\b/g,
  ];
  for(const re of regexes)for(const m of t.matchAll(re)){
    const n=Number(m[1]);if(n>=4&&n<=150)qs.add(n);
  }
  for(const m of t.matchAll(/\b(?:XXG|XG|EG|G|M|P)(\d{1,3})\b/g)){
    const n=Number(m[1]);if(n>=4&&n<=150)qs.add(n);
  }
  return [...qs];
}
/**
 * Só comparar fraldas, não remédios: embalagem agrupada pode
 * conter quantidade de caixas diferente da unidade de varejo.
 * Nome da fonte deve confirmar a mesma linha, marca, tamanho e
 * quantidade do pacote (não somente o produto genérico).
 */
export function mesmaFraldaDeEmbalagem({nomeProduto='',marcaProduto='',produtoFonte}={}){
  if(!produtoFonte)return false;
  const original=comparavel(nomeProduto+' '+marcaProduto);
  const fonte=comparavel(produtoFonte.product_name||'');
  const marca=comparavel(produtoFonte.brand||produtoFonte.brand_name||'');
  if(!original.includes('FRALDA')||!/\b(?:FRALDA|FRD|FR)\b/.test(fonte))return false;
  // Confiança conservadora: fabricante da fralda Personal, que aparece
  // em vários GTIN14 do CSV, e catálogo valida marca de varejo.
  if(!(/\bPERSONAL\b/.test(original)&&/\bPERSONAL\b/.test(marca+' '+fonte)))return false;
  const tam=tamanhoFralda(original),tamFonte=tamanhoFralda(fonte);
  if(!tam||!tamFonte||tam!==tamFonte)return false;
  const originalQ=quantidadesFralda(nomeProduto),fonteQ=quantidadesFralda(fonte);
  if(!originalQ.length||!fonteQ.length||
    !originalQ.some(x=>fonteQ.includes(x)))return false;
  // Uma fralda Pants não pode receber foto da fralda de fita.
  if(/\bPANTS\b/.test(original)!==/\bPANTS\b/.test(fonte))return false;
  return true;
}
