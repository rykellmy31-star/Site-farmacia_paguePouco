/**
 * seed.js — Dados iniciais de DESENVOLVIMENTO (ilustrativos).
 *
 * IMPORTANTE (transparência):
 *  - Marcas, registros sanitários e textos são ILUSTRATIVOS e devem ser
 *    substituídos pelos dados reais da Farmácia Pague Pouco pelo painel.
 *  - Nenhum conteúdo foi copiado de outro site.
 *  - Medicamentos controlados são cadastrados APENAS para demonstrar o bloqueio
 *    de venda (RDC 44/2009). Eles não podem ser comprados.
 *  - Senhas abaixo são de desenvolvimento e DEVEM ser trocadas no primeiro acesso.
 */
import path from 'node:path';
import fs from 'node:fs';
import { getStore, uid, nowISO } from '../src/lib/store.js';
import { hashPassword } from '../src/lib/security.js';
import { ensureSettings, setSetting } from '../src/lib/settings.js';
import { defaultFreightConfig } from '../src/lib/freight.js';
import { slugify } from '../src/lib/security.js';
import { config } from '../src/config.js';

const ROOT = config.root;
const forcar = process.argv.includes('--force');

/* ------------------------------------------------------------------ */
/* Imagens ilustrativas (SVG gerado localmente — sem fotos de terceiros) */
/* ------------------------------------------------------------------ */
function corDeFundo(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) % 360;
  return `hsl(${h}, 38%, 92%)`;
}

function svgProduto(nome, marca) {
  const cor = corDeFundo(nome);
  const inicial = (marca || nome).replace(/[^A-Za-zÀ-ÿ ]/g, '').trim().charAt(0).toUpperCase() || 'P';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="${nome}">
  <rect width="400" height="400" fill="${cor}"/>
  <circle cx="200" cy="170" r="86" fill="#ffffff" opacity="0.85"/>
  <text x="200" y="196" font-family="system-ui, sans-serif" font-size="86" font-weight="700" text-anchor="middle" fill="#0a6b48">${inicial}</text>
  <text x="200" y="312" font-family="system-ui, sans-serif" font-size="19" font-weight="600" text-anchor="middle" fill="#1b2b26">${String(marca || 'Pague Pouco').slice(0, 22)}</text>
  <text x="200" y="340" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle" fill="#5b6b64">Imagem ilustrativa</text>
</svg>`;
}

function svgBanner(titulo, subtitulo, cor1, cor2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="1200" height="420" role="img" aria-label="${titulo}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${cor1}"/><stop offset="100%" stop-color="${cor2}"/>
  </linearGradient></defs>
  <rect width="1200" height="420" fill="url(#g)"/>
  <g fill="rgba(255,255,255,.14)">
    <circle cx="1050" cy="80" r="120"/><circle cx="980" cy="330" r="70"/><circle cx="120" cy="360" r="90"/>
  </g>
  <text x="70" y="180" font-family="system-ui, sans-serif" font-size="72" font-weight="800" fill="#ffffff">${titulo}</text>
  <text x="70" y="240" font-family="system-ui, sans-serif" font-size="30" fill="#fff1f1">${subtitulo}</text>
  <rect x="70" y="290" rx="34" height="62" width="290" fill="#ffffff"/>
  <text x="215" y="330" font-family="system-ui, sans-serif" font-size="26" font-weight="700" fill="${cor2}" text-anchor="middle">Confira as ofertas</text>
</svg>`;
}

function garantirImagens(db, produtos) {
  const dir = path.join(config.uploadsDir, 'seed');
  fs.mkdirSync(dir, { recursive: true });
  const midia = db.collection('midia');
  const imagens = {};
  for (const p of produtos) {
    const nomeArquivo = `${slugify(p.nome).slice(0, 40)}.svg`;
    const rel = path.posix.join('seed', nomeArquivo);
    const abs = path.join(dir, nomeArquivo);
    fs.writeFileSync(abs, svgProduto(p.nome, p.marca), 'utf8');
    const jaExiste = midia.findOne((m) => m.caminho === rel);
    const rec = jaExiste || midia.insert({
      nome: `${p.nome} (ilustrativa)`,
      tipo: 'image', mime: 'image/svg+xml', ext: 'svg',
      caminho: rel, url: `/uploads/${rel}`, tamanho: fs.statSync(abs).size,
      largura: 400, altura: 400, criadoEm: nowISO(), autorTipo: 'sistema', legenda: 'Imagem ilustrativa gerada no ambiente de desenvolvimento',
    });
    imagens[p.nome] = rec.url;
  }
  return imagens;
}

function garantirBanners(db) {
  const dir = path.join(config.uploadsDir, 'banners');
  fs.mkdirSync(dir, { recursive: true });
  const definicoes = [
    { arquivo: 'banner-principal-1.svg', titulo: 'Ofertas do dia', subtitulo: 'Até 60% de desconto em produtos selecionados', cor1: '#8b0000', cor2: '#8b0000', link: '/ofertas', ordem: 1 },
    { arquivo: 'banner-principal-2.svg', titulo: 'Cuidados com a saúde', subtitulo: 'Vitaminas, suplementos e dermocosméticos', cor1: '#8b0000', cor2: '#8b0000', link: '/busca?q=vitamina', ordem: 2 },
    { arquivo: 'banner-principal-3.svg', titulo: 'Entregamos para todo o Brasil', subtitulo: 'Frete fixo por estado — consulte pelo CEP', cor1: '#8b0000', cor2: '#8b0000', link: '/cep', ordem: 3 },
  ];
  const bannersCol = db.collection('banners');
  if (!forcar && bannersCol.count()) return;
  for (const d of definicoes) {
    const rel = path.posix.join('banners', d.arquivo);
    const abs = path.join(dir, d.arquivo);
    fs.writeFileSync(abs, svgBanner(d.titulo, d.subtitulo, d.cor1, d.cor2), 'utf8');
    const existente = bannersCol.findOne((b) => b.imagem === `/uploads/${rel}`);
    if (existente) continue;
    bannersCol.insert({
      titulo: d.titulo, imagem: `/uploads/${rel}`, imagemMobile: '', link: d.link,
      posicao: 'principal', ordem: d.ordem, ativo: true,
      inicio: null, fim: null, criadoEm: nowISO(),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Categorias                                                          */
/* ------------------------------------------------------------------ */
const CATEGORIAS = [
  { nome: 'Medicamentos isentos de prescrição', icone: '💊', destaque: true, ordem: 1, subs: ['Gripe e resfriado', 'Dor e febre', 'Alergia', 'Garganta e tosse', 'Gastro', 'Genéricos'] },
  { nome: 'Saúde e bem-estar', icone: '🩺', destaque: true, ordem: 2, subs: ['Aparelhos de pressão', 'Termômetros', 'Testes rápidos', 'Inaladores', 'Soro e curativos'] },
  { nome: 'Higiene pessoal', icone: '🧼', destaque: true, ordem: 3, subs: ['Sabonetes', 'Desodorantes', 'Higiene bucal', 'Papel higiênico', 'Higiene íntima'] },
  { nome: 'Beleza', icone: '💅', destaque: false, ordem: 4, subs: ['Cabelos', 'Maquiagem', 'Unhas', 'Cuidados com o corpo'] },
  { nome: 'Dermocosméticos', icone: '✨', destaque: true, ordem: 5, subs: ['Hidratantes', 'Anti-idade', 'Cuidados faciais', 'Cuidados com acne'] },
  { nome: 'Vitaminas e suplementos', icone: '🍊', destaque: true, ordem: 6, subs: ['Vitaminas', 'Minerais', 'Proteínas', 'Ômega 3', 'Fibras'] },
  { nome: 'Mamãe e bebê', icone: '🍼', destaque: true, ordem: 7, subs: ['Fórmulas infantis', 'Chupetas e mamadeiras', 'Cuidados com a mamãe', 'Alimentação infantil'] },
  { nome: 'Fraldas', icone: '👶', destaque: true, ordem: 8, subs: ['Fraldas descartáveis', 'Lenços umedecidos', 'Fraldas geriátricas'] },
  { nome: 'Primeiros socorros', icone: '🩹', destaque: false, ordem: 9, subs: ['Curativos', 'Ataduras', 'Antissépticos', 'Kits de primeiros socorros'] },
  { nome: 'Aparelhos de saúde', icone: '⚕️', destaque: false, ordem: 10, subs: ['Medidores de glicose', 'Pressão arterial', 'Nebulizadores', 'Oxímetros'] },
  { nome: 'Produtos hospitalares permitidos', icone: '🏥', destaque: false, ordem: 11, subs: ['Luvas', 'Máscaras', 'Seringas sem agulha', 'Álcool 70%'] },
  { nome: 'Cuidados masculinos', icone: '🧔', destaque: false, ordem: 12, subs: ['Barbear', 'Cuidados com a barba', 'Shampoo masculino'] },
  { nome: 'Cuidados femininos', icone: '🌸', destaque: false, ordem: 13, subs: ['Absorventes', 'Depilação', 'Higiene íntima'] },
  { nome: 'Proteção solar', icone: '☀️', destaque: true, ordem: 14, subs: ['Protetor facial', 'Protetor corporal', 'Pós-sol', 'Infantil'] },
  { nome: 'Conveniência', icone: '🛒', destaque: false, ordem: 15, subs: ['Bebidas', 'Doces e chocolates', 'Utilidades'] },
  { nome: 'Ofertas e promoções', icone: '🏷️', destaque: true, ordem: 16, subs: [] },
];

/* ------------------------------------------------------------------ */
/* Produtos (ilustrativos)                                             */
/* ------------------------------------------------------------------ */
const PRODUTOS = [
  // --- Medicamentos isentos de prescrição (MIP) ---
  {
    nome: 'Paracetamol 500mg 20 comprimidos', marca: 'FarmaVida', cat: 'Medicamentos isentos de prescrição', sub: 'Dor e febre',
    preco: 12.90, promo: 7.49, estoque: 240, peso: 0.05,
    sanitario: { classificacao: 'generico', registroMS: 'MS 1.2345.6789 (ILUSTRATIVO — substituir pelo registro real)', apresentacao: 'Comprimido', concentracao: '500 mg', principioAtivo: 'Paracetamol', fabricante: 'FarmaVida Indústria Farmacêutica', aprovadoFarmaceutico: true, aprovadoPor: 'Farmacêutico responsável (cadastro de demonstração)', aprovadoEm: nowISO() },
    descricao: '<p>Analgésico e antitérmico indicado para o alívio temporário de dores leves a moderadas e da febre. Medicamento genérico isento de prescrição.</p><p><strong>Modo de usar:</strong> seguir rigorosamente a bula. Não exceder a dose recomendada.</p>',
  },
  {
    nome: 'Dipirona Sódica 500mg 20 comprimidos', marca: 'FarmaVida', cat: 'Medicamentos isentos de prescrição', sub: 'Dor e febre',
    preco: 11.50, promo: 6.99, estoque: 180, peso: 0.05,
    sanitario: { classificacao: 'generico', registroMS: 'MS 1.2345.6790 (ILUSTRATIVO — substituir pelo registro real)', apresentacao: 'Comprimido', concentracao: '500 mg', principioAtivo: 'Dipirona sódica', fabricante: 'FarmaVida Indústria Farmacêutica', aprovadoFarmaceutico: true, aprovadoPor: 'Farmacêutico responsável (cadastro de demonstração)', aprovadoEm: nowISO() },
    descricao: '<p>Analgésico e antitérmico de uso comum. Medicamento isento de prescrição.</p>',
  },
  {
    nome: 'Paracetamol + Clorfeniramina + Fenilefrina 400mg + 4mg + 4mg — 20 cápsulas', marca: 'FarmaVida', cat: 'Medicamentos isentos de prescrição', sub: 'Gripe e resfriado',
    preco: 24.90, promo: 0, estoque: 60, peso: 0.08,
    sanitario: { classificacao: 'isento_prescricao', registroMS: 'MS 1.2345.6791 (ILUSTRATIVO — substituir pelo registro real)', apresentacao: 'Cápsula', concentracao: '400 mg + 4 mg + 4 mg', principioAtivo: 'Paracetamol + maleato de clorfeniramina + cloridrato de fenilefrina', fabricante: 'FarmaVida Indústria Farmacêutica', aprovadoFarmaceutico: true, aprovadoPor: 'Farmacêutico responsável (cadastro de demonstração)', aprovadoEm: nowISO(), restricaoAdvertencia: 'Não dirigir ou operar máquinas durante o uso (causa sonolência).' },
    descricao: '<p>Indicado para o alívio dos sintomas de gripe e resfriado, como dor de cabeça, febre, coriza e congestão nasal.</p>',
  },
  {
    nome: 'Loratadina 10mg 12 comprimidos', marca: 'BioNatus', cat: 'Medicamentos isentos de prescrição', sub: 'Alergia',
    preco: 19.90, promo: 12.90, estoque: 90, peso: 0.04,
    sanitario: { classificacao: 'generico', registroMS: '', apresentacao: 'Comprimido', concentracao: '10 mg', principioAtivo: 'Loratadina', fabricante: 'BioNatus', aprovadoFarmaceutico: false },
    descricao: '<p>Antialérgico de uso adulto. <strong>Cadastro pendente de aprovação pelo farmacêutico responsável.</strong></p>',
  },
  {
    nome: 'Xarope expectorante adulto 120mL', marca: 'BioNatus', cat: 'Medicamentos isentos de prescrição', sub: 'Garganta e tosse',
    preco: 32.90, promo: 24.90, estoque: 45, peso: 0.16,
    sanitario: { classificacao: 'isento_prescricao', registroMS: '', apresentacao: 'Xarope', concentracao: '120 mL', principioAtivo: 'Guaifenesina', fabricante: 'BioNatus', aprovadoFarmaceutico: false },
    descricao: '<p>Xarope expectorante para auxiliar na fluidificação do muco. <strong>Cadastro pendente de aprovação pelo farmacêutico responsável.</strong></p>',
  },
  {
    nome: 'Amoxicilina 500mg 21 cápsulas (MEDICAMENTO CONTROLADO — VENDA BLOQUEADA)', marca: 'FarmaVida', cat: 'Medicamentos isentos de prescrição', sub: 'Genéricos',
    preco: 39.90, promo: 0, estoque: 30, peso: 0.07,
    sanitario: { classificacao: 'controlado', controlado: true, requerReceita: true, registroMS: 'MS 1.0000.0000 (ILUSTRATIVO)', apresentacao: 'Cápsula', concentracao: '500 mg', principioAtivo: 'Amoxicilina', fabricante: 'FarmaVida', aprovadoFarmaceutico: false },
    descricao: '<p><strong>Antibiótico — venda sob prescrição médica com retenção de receita (RDC 44/2009).</strong> Este item está cadastrado apenas para demonstrar o bloqueio automático de venda online: não é possível comprá-lo pelo site.</p>',
  },

  // --- Saúde e bem-estar ---
  { nome: 'Termômetro digital infravermelho', marca: 'PrimeCare', cat: 'Saúde e bem-estar', sub: 'Termômetros', preco: 129.90, promo: 89.90, estoque: 40, peso: 0.25, descricao: '<p>Leitura rápida em 1 segundo. Memória para 32 medições e alarme de febre.</p>', caracteristicas: { 'Tipo': 'Infravermelho sem contato', 'Memória': '32 leituras', 'Garantia': '12 meses' } },
  { nome: 'Aparelho de pressão arterial de braço digital', marca: 'PrimeCare', cat: 'Saúde e bem-estar', sub: 'Aparelhos de pressão', preco: 249.90, promo: 189.90, estoque: 25, peso: 0.6, descricao: '<p>Medição automática com visor de fácil leitura e memória para 2 usuários.</p>' },
  { nome: 'Soro fisiológico 0,9% 500mL', marca: 'PrimeCare', cat: 'Saúde e bem-estar', sub: 'Soro e curativos', preco: 9.90, promo: 6.49, estoque: 150, peso: 0.55, sanitario: { classificacao: 'correlato', registroMS: 'MS 1.2345.6792 (ILUSTRATIVO)', apresentacao: 'Solução estéril 500 mL', aprovadoFarmaceutico: true, aprovadoPor: 'Farmacêutico responsável (cadastro de demonstração)' }, descricao: '<p>Solução estéril de cloreto de sódio a 0,9% para lavagem e higiene.</p>' },
  { nome: 'Teste rápido de gravidez', marca: 'PrimeCare', cat: 'Saúde e bem-estar', sub: 'Testes rápidos', preco: 14.90, promo: 8.99, estoque: 80, peso: 0.03, descricao: '<p>Teste imunocromatográfico de uso único, com resultado em 5 minutos.</p>' },

  // --- Higiene pessoal ---
  { nome: 'Sabonete líquido hidratante 250mL', marca: 'HigieneTotal', cat: 'Higiene pessoal', sub: 'Sabonetes', preco: 15.90, promo: 9.90, estoque: 120, peso: 0.28, descricao: '<p>Limpeza suave com agentes hidratantes. Dermatologicamente testado.</p>' },
  { nome: 'Desodorante antitranspirante aerossol 150mL', marca: 'HigieneTotal', cat: 'Higiene pessoal', sub: 'Desodorantes', preco: 24.90, promo: 16.99, estoque: 200, peso: 0.15, descricao: '<p>Proteção por até 48 horas. Uso diário.</p>', sanitario: { classificacao: 'cosmético' } },
  { nome: 'Creme dental com flúor 90g', marca: 'HigieneTotal', cat: 'Higiene pessoal', sub: 'Higiene bucal', preco: 8.90, promo: 5.49, estoque: 300, peso: 0.12, descricao: '<p>Proteção anticáries e hálito fresco.</p>' },
  { nome: 'Escova de dentes macia', marca: 'HigieneTotal', cat: 'Higiene pessoal', sub: 'Higiene bucal', preco: 12.50, promo: 7.90, estoque: 160, peso: 0.05, descricao: '<p>Cerdas macias e cabo anatômico.</p>' },
  { nome: 'Papel higiênico folha dupla — 12 rolos', marca: 'HigieneTotal', cat: 'Higiene pessoal', sub: 'Papel higiênico', preco: 39.90, promo: 29.90, estoque: 70, peso: 1.8, descricao: '<p>Folha dupla, macio e resistente. Pacote com 12 rolos.</p>' },

  // --- Dermocosméticos / Beleza ---
  { nome: 'Hidratante corporal ureia 10% 400mL', marca: 'DermaVie', cat: 'Dermocosméticos', sub: 'Hidratantes', preco: 59.90, promo: 42.90, estoque: 60, peso: 0.45, descricao: '<p>Hidratação intensa para peles secas e ressecadas.</p>', sanitario: { classificacao: 'cosmético' } },
  { nome: 'Protetor solar FPS 60 toque seco 120mL', marca: 'VitaSolar', cat: 'Proteção solar', sub: 'Protetor facial', preco: 79.90, promo: 59.90, estoque: 85, peso: 0.16, descricao: '<p>Proteção UVA/UVB com toque seco e rápida absorção.</p>', sanitario: { classificacao: 'cosmético' } },
  { nome: 'Protetor solar infantil FPS 60 120mL', marca: 'VitaSolar', cat: 'Proteção solar', sub: 'Infantil', preco: 89.90, promo: 69.90, estoque: 40, peso: 0.16, descricao: '<p>Fórmula própria para a pele delicada das crianças.</p>' },
  { nome: 'Gel de limpeza facial para pele acneica 150g', marca: 'DermaVie', cat: 'Dermocosméticos', sub: 'Cuidados com acne', preco: 49.90, promo: 35.90, estoque: 55, peso: 0.18, descricao: '<p>Limpa profundamente e controla a oleosidade sem ressecar.</p>' },
  { nome: 'Shampoo hidratante 350mL', marca: 'DermaVie', cat: 'Beleza', sub: 'Cabelos', preco: 34.90, promo: 22.90, estoque: 100, peso: 0.38, descricao: '<p>Limpeza suave com agentes hidratantes para uso diário.</p>' },
  { nome: 'Condicionador nutritivo 350mL', marca: 'DermaVie', cat: 'Beleza', sub: 'Cabelos', preco: 36.90, promo: 24.90, estoque: 90, peso: 0.38, descricao: '<p>Desembaraça e repõe nutrientes dos fios.</p>' },

  // --- Vitaminas e suplementos ---
  { nome: 'Vitamina C 1g efervescente 30 comprimidos', marca: 'NeoVit', cat: 'Vitaminas e suplementos', sub: 'Vitaminas', preco: 39.90, promo: 24.90, estoque: 110, peso: 0.22, descricao: '<p>Suplemento vitamínico de vitamina C. Sabor laranja.</p>', sanitario: { classificacao: 'suplemento' } },
  { nome: 'Vitamina D3 2000UI 60 cápsulas', marca: 'NeoVit', cat: 'Vitaminas e suplementos', sub: 'Vitaminas', preco: 59.90, promo: 39.90, estoque: 75, peso: 0.09, descricao: '<p>Suplemento de vitamina D3. Não contém glúten.</p>' },
  { nome: 'Ômega 3 1000mg 60 cápsulas', marca: 'NeoVit', cat: 'Vitaminas e suplementos', sub: 'Ômega 3', preco: 89.90, promo: 64.90, estoque: 45, peso: 0.15, descricao: '<p>Óleo de peixe rico em EPA e DHA.</p>' },
  { nome: 'Whey protein concentrado 900g', marca: 'NeoVit', cat: 'Vitaminas e suplementos', sub: 'Proteínas', preco: 189.90, promo: 149.90, estoque: 30, peso: 1.0, descricao: '<p>Proteína concentrada do soro do leite. Sabor baunilha.</p>' },

  // --- Mamãe e bebê / Fraldas ---
  { nome: 'Fralda descartável M — 50 unidades', marca: 'BebêConforto', cat: 'Fraldas', sub: 'Fraldas descartáveis', preco: 69.90, promo: 52.90, estoque: 95, peso: 1.6, descricao: '<p>Cobertura respirável e canal anti-vazamento.</p>' },
  { nome: 'Fralda descartável G — 50 unidades', marca: 'BebêConforto', cat: 'Fraldas', sub: 'Fraldas descartáveis', preco: 72.90, promo: 55.90, estoque: 88, peso: 1.7, descricao: '<p>Cobertura respirável e canal anti-vazamento.</p>' },
  { nome: 'Lenços umedecidos 100 unidades', marca: 'BebêConforto', cat: 'Fraldas', sub: 'Lenços umedecidos', preco: 24.90, promo: 16.90, estoque: 130, peso: 0.4, descricao: '<p>Fórmula suave, sem álcool, dermatologicamente testada.</p>' },
  { nome: 'Mamadeira 240mL com bico anticólica', marca: 'BebêConforto', cat: 'Mamãe e bebê', sub: 'Chupetas e mamadeiras', preco: 49.90, promo: 34.90, estoque: 40, peso: 0.12, descricao: '<p>Bico de silicone com sistema anticólica. Livre de BPA.</p>' },

  // --- Primeiros socorros / Hospitalares ---
  { nome: 'Curativo adesivo resistente à água — 20 unidades', marca: 'PrimeCare', cat: 'Primeiros socorros', sub: 'Curativos', preco: 12.90, promo: 7.90, estoque: 140, peso: 0.05, descricao: '<p>Protege pequenos ferimentos. Resistente à água.</p>' },
  { nome: 'Álcool 70% 500mL', marca: 'PrimeCare', cat: 'Produtos hospitalares permitidos', sub: 'Álcool 70%', preco: 11.90, promo: 7.49, estoque: 200, peso: 0.52, descricao: '<p>Antisséptico para higiene de superfícies e pele íntegra.</p>' },
  { nome: 'Máscara descartável tripla — 50 unidades', marca: 'PrimeCare', cat: 'Produtos hospitalares permitidos', sub: 'Máscaras', preco: 39.90, promo: 27.90, estoque: 60, peso: 0.3, descricao: '<p>Máscara de proteção tripla com clipe nasal.</p>' },
  { nome: 'Kit de primeiros socorros doméstico', marca: 'PrimeCare', cat: 'Primeiros socorros', sub: 'Kits de primeiros socorros', preco: 89.90, promo: 69.90, estoque: 22, peso: 0.9, descricao: '<p>Kit completo com curativos, ataduras, tesoura e antisséptico.</p>' },

  // --- Aparelhos ---
  { nome: 'Oxímetro de dedo portátil', marca: 'PrimeCare', cat: 'Aparelhos de saúde', sub: 'Oxímetros', preco: 149.90, promo: 99.90, estoque: 28, peso: 0.12, descricao: '<p>Medição de saturação de oxigênio e frequência cardíaca.</p>' },
  { nome: 'Medidor de glicose com 50 tiras', marca: 'PrimeCare', cat: 'Aparelhos de saúde', sub: 'Medidores de glicose', preco: 199.90, promo: 159.90, estoque: 18, peso: 0.35, descricao: '<p>Kit com monitor, tiras e lancetas. Uso doméstico.</p>' },

  // --- Cuidados masculinos / femininos ---
  { nome: 'Espuma de barbear sensitive 200mL', marca: 'HigieneTotal', cat: 'Cuidados masculinos', sub: 'Barbear', preco: 22.90, promo: 15.90, estoque: 70, peso: 0.22, descricao: '<p>Espuma para barbear para peles sensíveis.</p>' },
  { nome: 'Absorvente noturno com abas — 24 unidades', marca: 'HigieneTotal', cat: 'Cuidados femininos', sub: 'Absorventes', preco: 21.90, promo: 14.90, estoque: 110, peso: 0.2, descricao: '<p>Alta absorção e proteção por até 8 horas.</p>' },

  // --- Conveniência ---
  { nome: 'Água mineral sem gás 500mL', marca: 'Pague Pouco', cat: 'Conveniência', sub: 'Bebidas', preco: 3.50, promo: 2.49, estoque: 400, peso: 0.52, descricao: '<p>Água mineral natural. Garrafa de 500 mL.</p>' },
  { nome: 'Chocolate ao leite 90g', marca: 'Pague Pouco', cat: 'Conveniência', sub: 'Doces e chocolates', preco: 8.90, promo: 5.90, estoque: 150, peso: 0.1, descricao: '<p>Chocolate ao leite. Contém leite e derivados de soja.</p>' },
];

/* ------------------------------------------------------------------ */
/* Páginas institucionais                                              */
/* ------------------------------------------------------------------ */
const PAGINAS = [
  {
    slug: 'quem-somos', titulo: 'Quem Somos',
    resumo: 'Conheça a história e os valores da Farmácia Pague Pouco.',
    conteudo: `<p>A <strong>Farmácia Pague Pouco</strong> nasceu com a missão de oferecer medicamentos e produtos de saúde, beleza e bem-estar com preços justos e atendimento responsável.</p>
    <h2>Nossos valores</h2>
    <ul>
      <li><strong>Preço justo todos os dias</strong> — negociação constante com fornecedores para repassar descontos.</li>
      <li><strong>Responsabilidade sanitária</strong> — atuação dentro das normas da Anvisa, com farmacêutico responsável.</li>
      <li><strong>Atendimento humano</strong> — tiramos dúvidas antes, durante e depois da compra.</li>
    </ul>
    <h2>Atuação online</h2>
    <p>Nossa loja virtual comercializa medicamentos <strong>isentos de prescrição</strong> e demais produtos permitidos. Medicamentos sujeitos a prescrição médica não são vendidos pelo site, em respeito à legislação sanitária vigente (RDC 44/2009 e normas posteriores).</p>
    <p><em>[REVISAR] Este texto é um modelo inicial e deve ser revisado e aprovado pela empresa antes da publicação.</em></p>`,
  },
  {
    slug: 'nossas-lojas', titulo: 'Nossas Lojas',
    resumo: 'Endereço, horários e contato da nossa loja física.',
    conteudo: `<h2>Loja sede</h2>
    <p><strong>Farmácia Pague Pouco</strong><br>
    [PREENCHER] Endereço completo, número, bairro<br>
    [PREENCHER] Cidade/UF — CEP [PREENCHER]</p>
    <h2>Horário de atendimento</h2>
    <p>[PREENCHER] Segunda a sábado, das 08h às 20h.</p>
    <h2>Telefone e WhatsApp</h2>
    <p>Telefone: [PREENCHER]<br>
    WhatsApp (dúvidas): o botão do site direciona ao número oficial cadastrado pela farmácia.</p>
    <p><em>[REVISAR] Preencha os dados reais no painel em Configurações → Empresa.</em></p>`,
  },
  {
    slug: 'atendimento', titulo: 'Atendimento',
    resumo: 'Canais de atendimento da Farmácia Pague Pouco.',
    conteudo: `<h2>Canais disponíveis</h2>
    <ul>
      <li><strong>WhatsApp</strong> — botão flutuante no site, exclusivo para dúvidas. Compras e pagamentos são feitos apenas pelo site.</li>
      <li><strong>Telefone</strong> — [PREENCHER].</li>
      <li><strong>E-mail</strong> — [PREENCHER].</li>
      <li><strong>Fale Conosco</strong> — formulário disponível na página institucional.</li>
    </ul>
    <h2>Horário</h2>
    <p>[PREENCHER] Configurável no painel em Configurações → WhatsApp de Atendimento.</p>`,
  },
  {
    slug: 'fale-conosco', titulo: 'Fale Conosco',
    resumo: 'Envie sua mensagem para a Farmácia Pague Pouco.',
    conteudo: `<p>Para dúvidas sobre produtos, pedidos ou entregas, fale com a nossa equipe.</p>
    <h2>Canais de contato</h2>
    <p><strong>WhatsApp (dúvidas):</strong> utilize o botão verde no canto da tela.<br>
    <strong>E-mail:</strong> [PREENCHER]<br>
    <strong>Telefone:</strong> [PREENCHER]</p>
    <h2>Prazos de resposta</h2>
    <p>Respondemos em até 1 dia útil. Mensagens fora do horário de atendimento são respondidas no próximo dia útil.</p>`,
  },
  {
    slug: 'perguntas-frequentes', titulo: 'Perguntas Frequentes',
    resumo: 'Tire suas dúvidas sobre compras, entregas, pagamentos e trocas.',
    conteudo: `<h2>Como calculamos o frete?</h2>
    <p>Trabalhamos com <strong>frete fixo por estado</strong>. Ao informar seu CEP, identificamos a UF e aplicamos o valor cadastrado pela farmácia para aquele estado. Você também pode escolher retirada na loja, quando disponível.</p>
    <h2>Quais formas de pagamento vocês aceitam?</h2>
    <p>Pix, cartão de crédito e cartão de débito, conforme disponibilidade configurada pela farmácia. Parcelamento conforme as regras exibidas no checkout.</p>
    <h2>Vocês vendem medicamentos controlados?</h2>
    <p>Não. Pela loja virtual comercializamos apenas medicamentos isentos de prescrição e demais produtos permitidos, respeitando a RDC 44/2009.</p>
    <h2>Como acompanho meu pedido?</h2>
    <p>Acesse <strong>Minha conta → Meus pedidos</strong>. Sempre que houver movimentação, o status é atualizado e, havendo código de rastreio, ele aparece na tela do pedido.</p>
    <h2>Posso trocar ou devolver um produto?</h2>
    <p>Sim, conforme a política de trocas e devoluções e o Código de Defesa do Consumidor. Medicamentos não podem ser devolvidos após o consumo ou violação da embalagem, salvo defeito.</p>`,
  },
  {
    slug: 'como-comprar', titulo: 'Como Comprar',
    resumo: 'Passo a passo para comprar na loja virtual da Farmácia Pague Pouco.',
    conteudo: `<h2>Passo a passo</h2>
    <ol>
      <li>Escolha os produtos e clique em <strong>Adicionar à cesta</strong>.</li>
      <li>Confira os itens no carrinho (ícone da cesta no topo).</li>
      <li>Clique em <strong>Finalizar compra</strong>.</li>
      <li>Faça login ou crie sua conta.</li>
      <li>Informe o endereço e o CEP para calcular o frete.</li>
      <li>Escolha a forma de entrega e o pagamento.</li>
      <li>Conclua o pagamento e aguarde a confirmação.</li>
      <li>Acompanhe o status em <strong>Meus pedidos</strong>.</li>
    </ol>
    <h2>Dica</h2>
    <p>Compras são finalizadas exclusivamente pelo site. O WhatsApp serve apenas para tirar dúvidas — ele não é canal de venda.</p>`,
  },
  {
    slug: 'formas-de-pagamento', titulo: 'Formas de Pagamento',
    resumo: 'Pix, cartão de crédito, cartão de débito e parcelamento.',
    conteudo: `<h2>Meios disponíveis</h2>
    <ul>
      <li><strong>Pix</strong> — pagamento com QR Code e código "copia e cola". A confirmação é automática após a compensação.</li>
      <li><strong>Cartão de crédito</strong> — parcelamento conforme condições exibidas no checkout.</li>
      <li><strong>Cartão de débito</strong> — quando habilitado pela farmácia no provedor de pagamento.</li>
    </ul>
    <h2>Segurança</h2>
    <p>Os dados de pagamento são processados pelo provedor de pagamento configurado pela farmácia. A Farmácia Pague Pouco não armazena números completos de cartão.</p>
    <p><strong>Atenção:</strong> nenhum pagamento deve ser feito fora do site. Desconfie de pedidos de transferência ou pagamento por mensagem.</p>`,
  },
  {
    slug: 'entregas-e-fretes', titulo: 'Entregas e Fretes',
    resumo: 'Frete fixo por estado, prazos, retirada na loja e restrições.',
    conteudo: `<h2>Frete fixo por estado</h2>
    <p>Não utilizamos cotação automática dos Correios. Cada estado brasileiro e o Distrito Federal possuem um valor de frete definido pela própria farmácia no painel administrativo, além de prazo estimado e possibilidade de frete grátis por valor mínimo.</p>
    <h2>Como o valor é aplicado</h2>
    <ol>
      <li>Você informa o CEP.</li>
      <li>O sistema identifica a UF (unidade federativa) a partir das faixas de CEP.</li>
      <li>Consultamos a tabela de fretes cadastrada.</li>
      <li>Apresentamos o valor e o prazo estimado antes de você finalizar.</li>
    </ol>
    <h2>Importante</h2>
    <p>O valor cobrado é o <strong>valor comercial do frete</strong> e pode não corresponder ao custo real de postagem junto à transportadora ou aos Correios.</p>
    <h2>Retirada na farmácia</h2>
    <p>Quando ativada, permite retirar o pedido na loja, sem custo de frete.</p>
    <h2>Restrições</h2>
    <p>Produtos com restrição de transporte (por exemplo, aerossóis e determinados produtos hospitalares) podem ter o envio bloqueado conforme a configuração da farmácia e a legislação aplicável.</p>`,
  },
  {
    slug: 'trocas-e-devolucoes', titulo: 'Trocas e Devoluções',
    resumo: 'Política de trocas, devoluções e direito de arrependimento.',
    conteudo: `<h2>Direito de arrependimento</h2>
    <p>Em compras realizadas pela internet, você pode desistir da compra em até <strong>7 (sete) dias corridos</strong> a partir do recebimento do produto, conforme o art. 49 do Código de Defesa do Consumidor.</p>
    <h2>Produtos com defeito</h2>
    <p>Produtos com defeito podem ser trocados ou devolvidos, com reembolso integral, incluindo o frete, conforme avaliação.</p>
    <h2>Medicamentos</h2>
    <p>Por razões sanitárias, medicamentos não podem ser devolvidos após abertos, consumidos ou com embalagem violada, salvo em caso de defeito, divergência ou problema de transporte.</p>
    <h2>Como solicitar</h2>
    <p>Entre em contato pelos canais de atendimento informando o número do pedido. O reembolso é feito pelo mesmo meio de pagamento utilizado na compra.</p>
    <p><em>[REVISAR] Texto sujeito à revisão jurídica antes da publicação.</em></p>`,
  },
  {
    slug: 'politica-de-privacidade', titulo: 'Política de Privacidade',
    resumo: 'Como tratamos seus dados pessoais (LGPD).',
    conteudo: `<h2>Dados que coletamos</h2>
    <p>Coletamos os dados necessários para processar seu pedido: nome, CPF, e-mail, telefone, endereço de entrega e dados de pagamento processados pelo provedor contratado.</p>
    <h2>Finalidades</h2>
    <ul>
      <li>Processar pedidos, pagamentos e entregas.</li>
      <li>Cumprir obrigações legais e fiscais.</li>
      <li>Atendimento ao cliente.</li>
      <li>Envio de comunicações de marketing, <strong>mediante consentimento</strong>, que pode ser revogado a qualquer momento.</li>
    </ul>
    <h2>Seus direitos (LGPD)</h2>
    <ul>
      <li>Confirmar a existência de tratamento e acessar seus dados.</li>
      <li>Corrigir dados incompletos ou desatualizados.</li>
      <li>Solicitar anonimização, bloqueio ou eliminação de dados desnecessários.</li>
      <li>Revogar consentimentos e se opor a tratamentos.</li>
    </ul>
    <h2>Contato</h2>
    <p>[PREENCHER] Canal de atendimento para exercício de direitos (enviar e-mail ou WhatsApp).</p>
    <p><em>[REVISAR] Texto deve ser revisado por profissional jurídico antes da publicação.</em></p>`,
  },
  {
    slug: 'politica-de-cookies', titulo: 'Política de Cookies',
    resumo: 'Quais cookies usamos e como gerenciar suas preferências.',
    conteudo: `<h2>O que são cookies</h2>
    <p>Pequenos arquivos armazenados no seu navegador para lembrar preferências e melhorar a navegação.</p>
    <h2>Cookies que utilizamos</h2>
    <ul>
      <li><strong>Essenciais</strong> — manutenção de sessão, carrinho e segurança (não podem ser desativados).</li>
      <li><strong>Preferências</strong> — lembram CEP, consentimento de cookies e dados de navegação.</li>
      <li><strong>Estatísticos e marketing</strong> — somente quando você autoriza (ex.: Google Analytics).</li>
    </ul>
    <h2>Como gerenciar</h2>
    <p>Você pode aceitar ou recusar cookies não essenciais pela barra exibida no site e também nas configurações do seu navegador.</p>`,
  },
  {
    slug: 'termos-de-uso', titulo: 'Termos de Uso',
    resumo: 'Condições de uso da loja virtual da Farmácia Pague Pouco.',
    conteudo: `<h2>Aceitação</h2>
    <p>Ao navegar e comprar neste site, você concorda com estes termos.</p>
    <h2>Cadastro e conta</h2>
    <p>Você é responsável pela veracidade dos dados informados e pela guarda da sua senha.</p>
    <h2>Preços e disponibilidade</h2>
    <p>Preços, promoções e disponibilidade podem ser alterados. O pedido é confirmado somente após a aprovação do pagamento.</p>
    <h2>Produtos e informações sanitárias</h2>
    <p>As informações dos produtos são de caráter informativo, não substituem a bula nem a orientação profissional. Medicamentos sujeitos a prescrição não são vendidos por este site.</p>
    <h2>Propriedade intelectual</h2>
    <p>Marcas, textos e imagens do site pertencem aos seus respectivos titulares.</p>
    <p><em>[REVISAR] Texto deve passar por revisão jurídica antes da publicação.</em></p>`,
  },
  {
    slug: 'atendimento-farmaceutico', titulo: 'Atendimento Farmacêutico',
    resumo: 'Farmacêutico responsável e orientações sobre uso de medicamentos.',
    conteudo: `<h2>Responsabilidade técnica</h2>
    <p><strong>Farmacêutico responsável:</strong> [PREENCHER] — CRF/UF [PREENCHER].</p>
    <p>Os cadastros de medicamentos passam por revisão do responsável técnico antes de serem disponibilizados para venda.</p>
    <h2>Orientações importantes</h2>
    <ul>
      <li>Leia a bula antes de usar qualquer medicamento.</li>
      <li>Não se automedique por períodos prolongados sem orientação.</li>
      <li>Se os sintomas persistirem, procure um médico.</li>
      <li>Informe sempre outros medicamentos em uso para evitar interações.</li>
    </ul>
    <p><em>[REVISAR] Conteúdo informativo sujeito à validação do farmacêutico responsável.</em></p>`,
  },
  {
    slug: 'informacoes-sanitarias', titulo: 'Informações Sanitárias',
    resumo: 'Regras aplicáveis à venda online de medicamentos e produtos para a saúde.',
    conteudo: `<h2>Base legal</h2>
    <p>A comercialização de medicamentos pela internet no Brasil observa, entre outras normas, a <strong>RDC nº 44/2009</strong> (Boas Práticas Farmacêuticas), a <strong>RDC nº 471/2021</strong> e demais atos da Anvisa, além das normas sanitárias estaduais e municipais.</p>
    <h2>O que vendemos online</h2>
    <ul>
      <li>Medicamentos <strong>isentos de prescrição</strong> (MIPs), com cadastro sanitário completo e aprovação do farmacêutico responsável.</li>
      <li>Cosméticos, dermocosméticos, suplementos, produtos de higiene, correlatos e demais produtos permitidos.</li>
    </ul>
    <h2>O que NÃO vendemos online</h2>
    <ul>
      <li>Medicamentos sujeitos a controle especial ou prescrição médica.</li>
      <li>Produtos sem registro válido na Anvisa, quando exigível.</li>
      <li>Produtos não aprovados pelo responsável técnico.</li>
    </ul>
    <h2>Dados do estabelecimento</h2>
    <p>Razão social: [PREENCHER] — CNPJ [PREENCHER].<br>
    Autorização de funcionamento/AFE: [PREENCHER].<br>
    Farmacêutico responsável: [PREENCHER] — CRF/UF [PREENCHER].</p>
    <p><em>[REVISAR] Texto informativo. A publicação comercial depende da verificação das licenças sanitárias, do estabelecimento autorizado, da responsabilidade farmacêutica e das regras de transporte vigentes.</em></p>`,
  },
];

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */
async function main() {
  const db = await getStore(config.dataDir);
  console.log('→ Banco em', db.dataDir);

  if (forcar) {
    console.log('  --force: recriando dados de desenvolvimento...');
    for (const c of ['products', 'categories', 'customers', 'orders', 'payments', 'coupons', 'pages', 'banners', 'showcases', 'stockMovements']) {
      db.collection(c).clear();
    }
  }

  ensureSettings(db);

  // ---- Categorias
  const cats = db.collection('categories');
  if (!cats.count()) {
    for (const c of CATEGORIAS) {
      const pai = cats.insert({
        nome: c.nome, slug: slugify(c.nome), icone: c.icone, paiId: null,
        descricao: `${c.nome} na Farmácia Pague Pouco.`,
        ativa: true, destaque: !!c.destaque, ordem: c.ordem, criadoEm: nowISO(),
      });
      for (const [i, sub] of c.subs.entries()) {
        cats.insert({
          nome: sub, slug: slugify(sub), icone: '', paiId: pai.id,
          descricao: `${sub} — ${c.nome}.`, ativa: true, destaque: false, ordem: i + 1, criadoEm: nowISO(),
        });
      }
    }
    console.log(`  ${cats.count()} categorias criadas.`);
  }

  // ---- Produtos
  const prods = db.collection('products');
  if (!prods.count()) {
    const imagens = garantirImagens(db, PRODUTOS);
    for (const [i, def] of PRODUTOS.entries()) {
      const pai = cats.findOne((c) => c.nome === def.cat);
      const sub = pai ? cats.findOne((c) => c.paiId === pai.id && c.nome === def.sub) : null;
      prods.insert({
        nome: def.nome,
        slug: slugify(def.nome),
        codigoInterno: `PP-${String(1000 + i)}`,
        sku: `SKU${String(10000 + i)}`,
        ean: `789${String(1000000000 + i).slice(0, 9)}`,
        marca: def.marca,
        fabricante: def.sanitario?.fabricante || def.marca,
        categoriaId: pai?.id || null,
        subcategoriaId: sub?.id || null,
        descricao: def.descricao || `<p>${def.nome} — ${def.marca}.</p>`,
        caracteristicas: def.caracteristicas || { Marca: def.marca, 'Código interno': `PP-${String(1000 + i)}` },
        precoCentavos: Math.round(def.preco * 100),
        precoPromocionalCentavos: def.promo ? Math.round(def.promo * 100) : 0,
        estoque: { quantidade: def.estoque, minimo: Math.max(5, Math.round(def.estoque * 0.1)), reservado: 0 },
        peso: def.peso || 0.3,
        dimensoes: { largura: 12, altura: 12, comprimento: 18 },
        imagens: [{ url: imagens[def.nome], principal: true, ordem: 1, legenda: 'Imagem ilustrativa' }],
        videos: [],
        ativo: true,
        destaque: i % 5 === 0,
        novidade: i % 7 === 0,
        vendas: Math.floor(Math.random() * 40),
        sanitario: { classificacao: 'nao_aplicavel', requerReceita: false, registroMS: '', apresentacao: '', concentracao: '', principioAtivo: '', fabricante: def.marca, bulaUrl: '', aprovadoFarmaceutico: false, aprovadoPor: '', aprovadoEm: null, restricaoTransporte: false, restricaoAdvertencia: '', controlado: false, tarja: '', ...(def.sanitario || {}) },
        relacionados: [],
        criadoEm: nowISO(),
        atualizadoEm: nowISO(),
      });
    }
    console.log(`  ${prods.count()} produtos criados (ilustrativos).`);
  }

  // ---- Banners
  garantirBanners(db);

  // ---- Vitrines personalizadas
  const vitrines = db.collection('showcases');
  if (!vitrines.count()) {
    const catDerm = cats.findOne((c) => c.nome === 'Dermocosméticos');
    vitrines.insert({ titulo: 'Dermocosméticos em destaque', tipo: 'categoria', categoriaId: catDerm?.id || null, categoriaSlug: catDerm?.slug || '', limite: 8, ativa: true, ordem: 1, rolagem: true, link: catDerm ? `/categoria/${catDerm.slug}` : '' });
    vitrines.insert({ titulo: 'Vitaminas e suplementos', tipo: 'marca', marca: 'NeoVit', limite: 8, ativa: true, ordem: 2, rolagem: true, link: '/busca?q=vitamina' });
    vitrines.insert({ titulo: 'Mais vendidos da semana', tipo: 'dinamica', origem: 'mais_vendidos', limite: 8, ativa: true, ordem: 3, rolagem: true, link: '/ofertas' });
  }

  // ---- Cupons
  const cupons = db.collection('coupons');
  if (!cupons.count()) {
    cupons.insert({ codigo: 'BEMVINDO10', tipo: 'percentual', valor: 10, ativo: true, validoDe: null, validoAte: null, usoMaximo: 1000, usos: 0, valorMinimo: 5000, categoriasPermitidas: [], primeiroPedido: true, descricao: '10% na primeira compra (mínimo R$ 50).' });
    cupons.insert({ codigo: 'PAGUEPOUCO15', tipo: 'fixo', valor: 15, ativo: true, validoDe: null, validoAte: null, usoMaximo: 500, usos: 0, valorMinimo: 10000, categoriasPermitidas: [], primeiroPedido: false, descricao: 'R$ 15 de desconto acima de R$ 100.' });
    cupons.insert({ codigo: 'FRETEGRATIS', tipo: 'frete_gratis', valor: 0, ativo: true, validoDe: null, validoAte: null, usoMaximo: null, usos: 0, valorMinimo: 8000, categoriasPermitidas: [], primeiroPedido: false, descricao: 'Frete grátis acima de R$ 80.' });
  }

  // ---- Páginas institucionais
  const paginas = db.collection('pages');
  for (const p of PAGINAS) {
    if (!paginas.findOne((x) => x.slug === p.slug)) {
      paginas.insert({ ...p, publicada: true, criadoEm: nowISO(), atualizadoEm: nowISO() });
    }
  }

  // ---- Usuários administrativos (DESENVOLVIMENTO)
  const admins = db.collection('admins');
  const usuariosDev = [
    { nome: 'Super Administrador', email: 'admin@paguepouco.local', senha: 'Admin@123456', role: 'super_admin' },
    { nome: 'Administrador', email: 'adm@paguepouco.local', senha: 'Adm@123456', role: 'admin' },
    { nome: 'Gerente da Loja', email: 'gerente@paguepouco.local', senha: 'Gerente@123', role: 'gerente' },
    { nome: 'Farmacêutico Responsável', email: 'farmaceutico@paguepouco.local', senha: 'Farma@123456', role: 'farmaceutico', crf: '[PREENCHER]' },
    { nome: 'Atendente', email: 'atendente@paguepouco.local', senha: 'Atende@123', role: 'atendente' },
    { nome: 'Operador de Pedidos', email: 'pedidos@paguepouco.local', senha: 'Pedidos@123', role: 'operador_pedidos' },
  ];
  for (const u of usuariosDev) {
    if (!admins.findOne((a) => a.email === u.email)) {
      admins.insert({
        nome: u.nome, email: u.email, senhaHash: hashPassword(u.senha), role: u.role,
        ativo: true, crf: u.crf || '', criadoEm: nowISO(), ultimoAcesso: null,
        deveTrocarSenha: true,
      });
    }
  }

  // ---- Cliente de demonstração
  const clientes = db.collection('customers');
  if (!clientes.findOne((c) => c.email === 'cliente@teste.local')) {
    clientes.insert({
      nome: 'Cliente de Teste', email: 'cliente@teste.local', senhaHash: hashPassword('Cliente@123'),
      cpf: '00000000000', telefone: '73999990000', dataNascimento: '1990-01-01',
      ativo: true, emailConfirmado: true, marketing: false, criadoEm: nowISO(),
      enderecos: [], favoritos: [], ultimoAcesso: null,
    });
  }

  // ---- Configuração de fretes padrão (26 estados + DF)
  const freteCfg = db.collection('settings').get('frete');
  if (!freteCfg) setSetting(db, 'frete', defaultFreightConfig());

  await db.flush();
  await db.close();

  console.log('\n✔ Dados iniciais prontos.');
  console.log('  Acesse o painel em /admin — usuário: admin@paguepouco.local  senha: Admin@123456 (DESENVOLVIMENTO)');
}

main().catch((err) => {
  console.error('Falha no seed:', err);
  process.exit(1);
});
