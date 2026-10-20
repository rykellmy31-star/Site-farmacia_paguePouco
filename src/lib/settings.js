/**
 * settings.js — Configurações da loja (banco de dados, editáveis pelo painel).
 * Tudo que o lojista precisa mudar no dia a dia mora aqui, nunca no código.
 */
import { defaultFreightConfig } from './freight.js';
import { nowISO } from './store.js';

export const DEFAULT_SETTINGS = () => ({
  empresa: {
    nomeFantasia: 'Farmácia Pague Pouco',
    razaoSocial: '[PREENCHER] Razão social da empresa',
    cnpj: '[PREENCHER] 00.000.000/0000-00',
    inscricaoEstadual: '[PREENCHER]',
    telefone: '(73) 0000-0000',
    email: 'contato@paguepouco.com.br',
    endereco: {
      cep: '00000-000',
      logradouro: '[PREENCHER] Rua/Avenida',
      numero: '000',
      bairro: 'Centro',
      cidade: 'Itanhém',
      uf: 'BA',
      complemento: '',
    },
    farmaceuticoResponsavel: '[PREENCHER] Nome do farmacêutico responsável',
    crf: '[PREENCHER] CRF/UF',
    autorizacaoSanitaria: '[PREENCHER] Autorização de funcionamento / AFE',
    horarioAtendimento: 'Segunda a sábado, das 08h às 20h.',
    redes: { instagram: '', facebook: '', tiktok: '' },
  },
  tema: {
    corPrimaria: '#0f8b5f',
    corPrimariaEscura: '#0a6b48',
    corSecundaria: '#ff6a00',
    corTexto: '#1b2b26',
    corFundo: '#f5f7f6',
    logoUrl: '',
    logoAltura: 44,
    faviconUrl: '',
    barraTopoTexto: 'Entregamos para todo o Brasil • Dúvidas? Fale com nosso farmacêutico',
    barraTopoAtiva: true,
    mostrarConsultaCep: true,
  },
  whatsapp: {
    ativo: true,
    numero: '5573000000000', // DDI + DDD + número, somente dígitos
    mensagem: 'Olá! Estou acessando o site da Farmácia Pague Pouco e gostaria de tirar uma dúvida.',
    textoBotao: 'Dúvidas? Fale com a gente',
    posicao: 'direita', // direita | esquerda
    paginas: ['todas'], // ['todas'] ou lista de slugs/rotas
    horarios: [
      { dia: 'segunda', inicio: '08:00', fim: '20:00', ativo: true },
      { dia: 'terca', inicio: '08:00', fim: '20:00', ativo: true },
      { dia: 'quarta', inicio: '08:00', fim: '20:00', ativo: true },
      { dia: 'quinta', inicio: '08:00', fim: '20:00', ativo: true },
      { dia: 'sexta', inicio: '08:00', fim: '20:00', ativo: true },
      { dia: 'sabado', inicio: '08:00', fim: '18:00', ativo: true },
      { dia: 'domingo', inicio: '00:00', fim: '00:00', ativo: false },
    ],
    respeitarHorario: false,
    mensagemIndisponivel: 'Nosso atendimento está fora do horário. Deixe sua mensagem e responderemos em breve!',
    avisoCheckout: 'Este canal é exclusivo para DÚVIDAS. Para comprar, finalize o pedido pelo site.',
  },
  frete: defaultFreightConfig(),
  pagamentos: {
    provedor: 'internal',
    meios: { pix: true, credit_card: true, debit_card: false },
    parcelamentoMaximo: 6,
    parcelasSemJuros: 3,
    taxaJurosMes: 0,
    valorMinimoParcela: 500,
    descontoPixPercentual: 0,
    mensagemCheckout: '',
    ambienteTestes: true,
  },
  seo: {
    tituloPadrao: 'Farmácia Pague Pouco — Medicamentos, genéricos e muito mais',
    descricaoPadrao: 'A Farmácia Pague Pouco oferece medicamentos isentos de prescrição, dermocosméticos, vitaminas, higiene e beleza com os melhores preços e entrega para todo o Brasil.',
    palavrasChave: 'farmácia, medicamentos, genéricos, dermocosméticos, vitaminas, higiene, beleza',
    ogImage: '',
    googleAnalyticsId: '',
    googleTagManagerId: '',
    pixelFacebookId: '',
  },
  loja: {
    lojaAberta: true,
    mensagemLojaFechada: 'Estamos temporariamente fechados para manutenção. Volte em breve!',
    valorMinimoPedido: 0,
    exigirLoginParaComprar: true,
    idadeMinima: 18,
    avisoMedicamento: 'MEDICAMENTO ISENTO DE PRESCRIÇÃO. SE PERSISTIREM OS SINTOMAS, O MÉDICO DEVERÁ SER CONSULTADO.',
    avisoAutomedicacao: 'A automedicação pode trazer riscos à saúde. Leia a bula e, em dúvidas, consulte o farmacêutico.',
    mostrarAvisoSanitario: true,
  },
  rodape: {
    textoInstitucional: 'Farmácia Pague Pouco — CNPJ [PREENCHER]. Farmacêutico responsável: [PREENCHER] — CRF/UF [PREENCHER].',
    colunas: [
      { titulo: 'Institucional', links: [
        { texto: 'Quem Somos', url: '/pagina/quem-somos' },
        { texto: 'Nossas Lojas', url: '/pagina/nossas-lojas' },
        { texto: 'Atendimento Farmacêutico', url: '/pagina/atendimento-farmaceutico' },
        { texto: 'Trabalhe Conosco', url: '/pagina/fale-conosco' },
      ] },
      { titulo: 'Ajuda', links: [
        { texto: 'Como Comprar', url: '/pagina/como-comprar' },
        { texto: 'Formas de Pagamento', url: '/pagina/formas-de-pagamento' },
        { texto: 'Entregas e Fretes', url: '/pagina/entregas-e-fretes' },
        { texto: 'Trocas e Devoluções', url: '/pagina/trocas-e-devolucoes' },
        { texto: 'Perguntas Frequentes', url: '/pagina/perguntas-frequentes' },
      ] },
      { titulo: 'Legal', links: [
        { texto: 'Política de Privacidade', url: '/pagina/politica-de-privacidade' },
        { texto: 'Política de Cookies', url: '/pagina/politica-de-cookies' },
        { texto: 'Termos de Uso', url: '/pagina/termos-de-uso' },
        { texto: 'Informações Sanitárias', url: '/pagina/informacoes-sanitarias' },
      ] },
    ],
    formasPagamento: ['Pix', 'Cartão de crédito', 'Cartão de débito'],
  },
  home: {
    secoes: [
      { id: 'banners', tipo: 'banners', titulo: 'Banners', ativo: true, ordem: 1 },
      { id: 'categorias', tipo: 'categorias', titulo: 'Departamentos', ativo: true, ordem: 2 },
      { id: 'ofertas', tipo: 'ofertas', titulo: 'Ofertas do dia', ativo: true, ordem: 3, limite: 12 },
      { id: 'destaques', tipo: 'destaques', titulo: 'Produtos em destaque', ativo: true, ordem: 4, limite: 8 },
      { id: 'mais_vendidos', tipo: 'mais_vendidos', titulo: 'Mais vendidos', ativo: true, ordem: 5, limite: 8 },
      { id: 'novidades', tipo: 'novidades', titulo: 'Novidades', ativo: true, ordem: 6, limite: 8 },
      { id: 'vitrines', tipo: 'vitrines', titulo: 'Vitrines', ativo: true, ordem: 7 },
      { id: 'entregas', tipo: 'entregas', titulo: 'Informações sobre entregas', ativo: true, ordem: 8 },
      { id: 'institucional', tipo: 'institucional', titulo: 'Sobre a farmácia', ativo: true, ordem: 9 },
    ],
    entregaTitulo: 'Entregamos para todo o Brasil',
    entregaTexto: 'Frete fixo por estado, calculado automaticamente pelo seu CEP. Consulte o valor e o prazo antes de finalizar a compra.',
    institucionalTitulo: 'Farmácia Pague Pouco',
    institucionalTexto: 'Preços baixos todos os dias, atendimento farmacêutico e entrega para todo o país.',
  },
  cookies: {
    ativo: true,
    titulo: 'Usamos cookies',
    texto: 'Utilizamos cookies para melhorar sua experiência, personalizar conteúdo e analisar o tráfego. Você pode aceitar ou recusar.',
    textoBotaoAceitar: 'Aceitar',
    textoBotaoRecusar: 'Recusar',
    linkPolitica: '/pagina/politica-de-cookies',
  },
  lgpd: {
    consentimentoMarketing: true,
    textoConsentimento: 'Autorizo a Farmácia Pague Pouco a enviar ofertas e novidades por e-mail/WhatsApp. Posso revogar a qualquer momento.',
  },
});

export function getSetting(db, key) {
  const doc = db.collection('settings').get(key);
  if (!doc) return null;
  const { id, ...rest } = doc;
  return rest;
}

export function getAllSettings(db) {
  const defaults = DEFAULT_SETTINGS();
  const out = {};
  for (const key of Object.keys(defaults)) {
    const stored = getSetting(db, key);
    out[key] = stored && Object.keys(stored).length ? { ...defaults[key], ...stored } : defaults[key];
  }
  return out;
}

export function setSetting(db, key, value, admin = null, req = null) {
  const existing = db.collection('settings').get(key);
  const payload = { ...value, atualizadoEm: nowISO(), atualizadoPor: admin?.id || null };
  if (existing) return db.collection('settings').update(key, payload);
  return db.collection('settings').insert({ id: key, ...payload });
}

/** Mescla profunda de um subconjunto de campos (usado pelos formulários do painel). */
export function patchSetting(db, key, patch, admin = null, req = null) {
  const current = getSetting(db, key) || DEFAULT_SETTINGS()[key] || {};
  const merged = deepMerge(current, patch);
  return setSetting(db, key, merged, admin, req);
}

function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target?.[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      out[k] = deepMerge(target[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Garante que todas as chaves existam na base (executado na migração/seed). */
export function ensureSettings(db) {
  const defaults = DEFAULT_SETTINGS();
  for (const [key, value] of Object.entries(defaults)) {
    if (!db.collection('settings').get(key)) {
      db.collection('settings').insert({ id: key, ...value });
    }
  }
}
