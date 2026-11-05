import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const start = source.indexOf('  /* ---------------------------- carrossel --------------------------- */');
const end = source.indexOf('  /* ------------------------ busca com sugestões --------------------- */', start);
assert.ok(start >= 0 && end > start, 'lógica do carrossel deve existir');
const codigoCarrossel = source.slice(start, end);

function ambiente({ autoplay = true, reduzirMovimento = false, slides = 3 } = {}) {
  let agora = 0, contador = 0;
  const tarefas = new Map();
  const pendente = () => [...tarefas.values()].sort((a, b) => a.quando - b.quando || a.id - b.id);
  const eventos = () => {
    const mapa = new Map();
    return {
      addEventListener(nome, fn) {
        if (!mapa.has(nome)) mapa.set(nome, []);
        mapa.get(nome).push(fn);
      },
      emitir(nome) { for (const fn of mapa.get(nome) || []) fn(); },
    };
  };
  const setTimeout = (callback, ms) => {
    const id = ++contador;
    tarefas.set(id, { id, quando: agora + ms, callback });
    return id;
  };
  const clearTimeout = id => tarefas.delete(id);
  const avancar = ms => {
    const destino = agora + ms;
    while (pendente().length && pendente()[0].quando <= destino) {
      const tarefa = pendente()[0];
      tarefas.delete(tarefa.id);
      agora = tarefa.quando;
      tarefa.callback();
    }
    agora = destino;
  };
  const botoes = Array.from({ length: slides }, () => {
    const objeto = eventos();
    const classes = new Set();
    objeto.classList = {
      toggle(classe, ativa) {
        if (ativa) classes.add(classe);
        else classes.delete(classe);
      },
      contains: classe => classes.has(classe),
    };
    return objeto;
  });
  const trilha = eventos();
  trilha.children = Array.from({ length: slides }, (_, indice) => ({ offsetLeft: indice * 100 }));
  trilha.scrollLeft = 0;
  trilha.clientWidth = 100;
  trilha.scrollTo = ({ left }) => {
    trilha.scrollLeft = left;
    trilha.emitir('scroll');
  };
  const proximo = eventos();
  const anterior = eventos();
  const carrossel = { dataset: { autoplay: autoplay ? 'true' : 'false' } };
  const documento = eventos();
  documento.visibilityState = 'visible';
  const consulta = (seletor, no) => ({
    '[data-trilha]': trilha,
    '[data-carrossel-proximo]': proximo,
    '[data-carrossel-anterior]': anterior,
  })[seletor] || null;
  const consultas = (seletor, no) => {
    if (seletor === '[data-carrossel]') return [carrossel];
    if (seletor === '[data-carrossel-ir]') return botoes;
    return [];
  };
  const contexto = {
    document: documento,
    window: { matchMedia: () => ({ matches: reduzirMovimento }) },
    $: consulta, $$: consultas, setTimeout, clearTimeout,
  };
  vm.runInNewContext(codigoCarrossel + '\niniciarCarrosseis();', contexto);
  return {
    avancar,
    proximo: () => proximo.emitir('click'),
    anterior: () => anterior.emitir('click'),
    ponto: indice => botoes[indice].emitir('click'),
    arrastar: () => trilha.emitir('pointerdown'),
    esconder: () => { documento.visibilityState = 'hidden'; documento.emitir('visibilitychange'); },
    mostrar: () => { documento.visibilityState = 'visible'; documento.emitir('visibilitychange'); },
    reiniciar: () => vm.runInNewContext(codigoCarrossel + '\niniciarCarrosseis();', contexto),
    indice: () => trilha.scrollLeft / 100,
    timers: () => tarefas.size,
    destacado: () => botoes.findIndex(p => p.classList.contains('ativo')),
  };
}

test('rotação automática permanece em cada banner por quatro segundos', () => {
  const c = ambiente();
  c.avancar(3999);
  assert.equal(c.indice(), 0);
  c.avancar(1);
  assert.equal(c.indice(), 1);
  c.avancar(3999);
  assert.equal(c.indice(), 1);
  c.avancar(1);
  assert.equal(c.indice(), 2);
  c.avancar(4000);
  assert.equal(c.indice(), 0);
});

test('seta manual cancela avanço iminente e mantém banner por dez segundos completos', () => {
  const c = ambiente();
  c.avancar(3900);
  c.proximo();
  assert.equal(c.indice(), 1);
  assert.equal(c.destacado(), 1);
  c.avancar(100);
  assert.equal(c.indice(), 1, 'timer automático antigo não pode disparar após o clique');
  c.avancar(9899);
  assert.equal(c.indice(), 1);
  c.avancar(1);
  assert.equal(c.indice(), 2);
  c.avancar(3999);
  assert.equal(c.indice(), 2);
  c.avancar(1);
  assert.equal(c.indice(), 0);
});

test('seta voltar, pontos e novos cliques reiniciam a pausa inteira', () => {
  const c = ambiente();
  c.anterior();
  assert.equal(c.indice(), 2);
  c.avancar(8000);
  c.ponto(1);
  assert.equal(c.indice(), 1);
  c.avancar(8000);
  c.proximo();
  assert.equal(c.indice(), 2);
  c.avancar(9999);
  assert.equal(c.indice(), 2);
  c.avancar(1);
  assert.equal(c.indice(), 0);
});

test('arrastar carrossel também suspende avanço automático por dez segundos', () => {
  const c = ambiente();
  c.avancar(3950);
  c.arrastar();
  c.avancar(9950);
  assert.equal(c.indice(), 0);
  c.avancar(50);
  assert.equal(c.indice(), 1);
});

test('aba oculta interrompe contador e volta sem avanço instantâneo', () => {
  const c = ambiente();
  c.avancar(3000);
  c.esconder();
  assert.equal(c.timers(), 0);
  c.avancar(10000);
  assert.equal(c.indice(), 0);
  c.mostrar();
  c.avancar(3999);
  assert.equal(c.indice(), 0);
  c.avancar(1);
  assert.equal(c.indice(), 1);
});

test('carrossel com autoplay desativado ou preferência por reduzir movimento não avança', () => {
  for (const config of [{ autoplay: false }, { reduzirMovimento: true }, { slides: 1 }]) {
    const c = ambiente(config);
    assert.equal(c.timers(), 0);
    c.avancar(20000);
    assert.equal(c.indice(), 0);
  }
});

test('inicialização repetida não cria dois temporizadores no mesmo carrossel', () => {
  const c = ambiente();
  c.reiniciar();
  assert.equal(c.timers(), 1);
  c.avancar(4000);
  assert.equal(c.indice(), 1);
  assert.equal(c.timers(), 1);
});

test('o HTML referencia nova versão do JavaScript para evitar cache de navegador', () => {
  const html = readFileSync(new URL('../src/views/layout.js', import.meta.url), 'utf8');
  assert.match(html, /app\.js\?v=carrossel-pausa-4s-10s-20261104/);
  assert.doesNotMatch(codigoCarrossel, /setInterval\s*\(/);
});
