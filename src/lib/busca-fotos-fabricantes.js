/**
 * Pesquisa complementar por nome e fabricante em catálogos abertos.
 * Não converte simples coincidências em EAN igual: divergências são
 * sugestões de revisão humana, jamais fotos automáticas em massa.
 */
const GENERICOS=new Set(['DIVERSOS','OUTROS','NAO INFORMADO','SEM FABRICANTE',
  'MERCADO LIVRE','VARIOS','BRINQUEDO','NAO SE APLICA']);
export function normalizarNomeCatalogo(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase()
    .replace(/(\d)\s+(MG|ML|G|KG|UI|MCG)\b/g,'$1$2')
    .replace(/\b(COMPRIMIDOS?|COMPR?|CPRS?|CP|CPS)\b/g,'CPR')
    .replace(/\b(CAPSULAS?|CAPS?)\b/g,'CAP')
    .replace(/\b(UNIDADES?|UNIDS?|UND|UNI)\b/g,'UN')
    .replace(/\b(CAIXA|CX|PACOTE|PCT)\b/g,'')
    .replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
export function consultaFabricante(nome,fabricante){
  const n=normalizarNomeCatalogo(nome),f=normalizarNomeCatalogo(fabricante);
  if(n.length<10||n.length>150||f.length<3||f.length>80||
    GENERICOS.has(f)||n.split(' ').length<2)return null;
  return {nome:n,fabricante:f,termo:(nome+' '+fabricante).trim().slice(0,150)};
}
export function mesmoProdutoDoFabricante(produto,referencia){
  if(!referencia||!produto)return false;
  const nome=normalizarNomeCatalogo(produto.product_name_pt||produto.product_name);
  const fabricante=normalizarNomeCatalogo([
    produto.manufacturers,produto.brands,produto.manufacturing_places
  ].filter(Boolean).join(' '));
  const ref=normalizarNomeCatalogo(referencia.nome);
  if(!nome||!fabricante)return false;
  if(!(' '+fabricante+' ').includes(' '+referencia.fabricante+' '))return false;
  // O catálogo pode incluir o nome do próprio fabricante no título.
  const retirar=s=>(' '+s+' ').replace(' '+referencia.fabricante+' ',' ')
    .trim().replace(/\s+/g,' ');
  const a=retirar(nome),b=retirar(ref);
  if(a!==b||a.length<10)return false;
  // Não usar foto de apresentação que informa outra quantidade.
  const quantidade=normalizarNomeCatalogo(produto.quantity||'');
  const valores=(a.match(/\b\d+(?:MG|ML|G|KG|UN|CPR|CAP)\b/g)||[]);
  if(quantidade&&/\d/.test(quantidade)&&valores.length){
    const quantidadeApresentacao=(quantidade.match(/\b\d+(?:MG|ML|G|KG|UN|CPR|CAP)\b/g)||[]);
    if(quantidadeApresentacao.length&&
       !quantidadeApresentacao.every(x=>valores.includes(x)))return false;
  }
  return true;
}
