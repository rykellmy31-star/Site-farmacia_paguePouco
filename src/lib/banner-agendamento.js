/**
 * Agendamento e ordenação de banners da vitrine pública.
 * Apenas controla a exibição dos banners: não interfere nas promoções/robô Inova.
 */
const DIAS = [
  ['domingo', 'Domingo'], ['segunda', 'Segunda-feira'], ['terca', 'Terça-feira'],
  ['quarta', 'Quarta-feira'], ['quinta', 'Quinta-feira'], ['sexta', 'Sexta-feira'],
  ['sabado', 'Sábado'],
];
const NOMES = new Map(DIAS);
const DATA_LOCAL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export const DIAS_BANNER = [
  { valor: 'todos', texto: 'Todos os dias' },
  ...DIAS.map(([valor, texto]) => ({ valor, texto: (valor === 'sabado' || valor === 'domingo' ? 'Todo ' : 'Toda ') + texto.toLowerCase() })),
];

function dataValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(valor + 'T12:00:00.000Z');
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

/** Valida horário/dia antes de gravar, sem afetar nenhum banner existente. */
export function validarAgendamentoBanner(dados = {}) {
  const dia = String(dados.diaSemana ?? 'todos');
  if (dia !== 'todos' && !NOMES.has(dia)) {
    return { ok: false, erro: 'Escolha um dia da semana válido para o banner.' };
  }
  const inicio = String(dados.inicio ?? '').trim();
  const fim = String(dados.fim ?? '').trim();
  if ((inicio && !dataValida(inicio)) || (fim && !dataValida(fim))) {
    return { ok: false, erro: 'Informe datas válidas no formato dia/mês/ano.' };
  }
  if (inicio && fim && inicio > fim) {
    return { ok: false, erro: 'A data final deve ser igual ou posterior à inicial.' };
  }
  return { ok: true, diaSemana: dia === 'todos' ? null : dia, inicio: inicio || null, fim: fim || null };
}

export function dataHojeBanner(referencia = new Date()) {
  const partes = DATA_LOCAL.formatToParts(referencia);
  const campo = nome => partes.find(parte => parte.type === nome)?.value;
  return campo('year') + '-' + campo('month') + '-' + campo('day');
}

export function bannerDeveAparecer(banner, referencia = new Date()) {
  if (!banner || banner.ativo === false) return false;
  const hoje = dataHojeBanner(referencia);
  if (banner.inicio && hoje < banner.inicio) return false;
  if (banner.fim && hoje > banner.fim) return false;
  if (!banner.diaSemana) return true; // Banners antigos aparecem todos os dias.
  if (!NOMES.has(banner.diaSemana)) return false; // Programação desconhecida não vaza à home.
  const [ano, mes, dia] = hoje.split('-').map(Number);
  return DIAS[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()][0] === banner.diaSemana;
}

export function descricaoAgendamentoBanner(banner) {
  const dia = NOMES.has(banner?.diaSemana) ?
    (['sabado', 'domingo'].includes(banner.diaSemana) ? 'Todo ' : 'Toda ') + NOMES.get(banner.diaSemana).toLowerCase() :
    'Todos os dias';
  const formatar = data => data ? data.slice(8, 10) + '/' + data.slice(5, 7) + '/' + data.slice(0, 4) : '';
  if (banner?.inicio && banner?.fim) return dia + ' · ' + formatar(banner.inicio) + ' até ' + formatar(banner.fim);
  if (banner?.inicio) return dia + ' · a partir de ' + formatar(banner.inicio);
  if (banner?.fim) return dia + ' · até ' + formatar(banner.fim);
  return dia;
}

export function ordenarBanners(lista) {
  return lista.slice().sort((a, b) => (Number(a.ordem) || 99) - (Number(b.ordem) || 99) ||
    String(a.createdAt || a.criadoEm || '').localeCompare(String(b.createdAt || b.criadoEm || '')) ||
    String(a.id).localeCompare(String(b.id)));
}

/** Move uma posição dentro do mesmo carrossel/faixa; não troca imagens nem ativação. */
export function moverBanner(db, id, direcao) {
  if (direcao !== 'cima' && direcao !== 'baixo') {
    return { ok: false, status: 400, erro: 'Movimento inválido.' };
  }
  const col = db.collection('banners');
  const banner = col.get(id);
  if (!banner) return { ok: false, status: 404, erro: 'Banner não encontrado.' };
  const lista = ordenarBanners(col.all().filter(b =>
    (b.posicao || 'principal') === (banner.posicao || 'principal')));
  const atual = lista.findIndex(b => b.id === banner.id);
  const destino = atual + (direcao === 'cima' ? -1 : 1);
  if (destino < 0 || destino >= lista.length) {
    return { ok: true, alterado: false };
  }
  [lista[atual], lista[destino]] = [lista[destino], lista[atual]];
  const gravar = () => lista.forEach((b, indice) => {
    if (b.ordem !== indice + 1) col.update(b.id, { ordem: indice + 1 });
  });
  if (typeof db.storage?.transactionSync === 'function') db.storage.transactionSync(gravar);
  else gravar();
  return { ok: true, alterado: true, ordem: destino + 1 };
}
