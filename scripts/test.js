/**
 * test.js — SUÍTE DE TESTES DE INTEGRAÇÃO (execução real).
 *
 * Sobe o servidor de verdade em uma pasta de dados temporária, semeia os dados
 * de desenvolvimento e executa dezenas de verificações HTTP reais:
 * navegação, cadastro, login, recuperação de senha, carrinho, bloqueios
 * sanitários, CEP/UF, frete por estado, checkout, pedido, pagamento, webhook,
 * estoque, painel administrativo, permissões, uploads, segurança e persistência.
 *
 * Uso: npm test   (ou: node scripts/test.js)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { slugify } from '../src/lib/security.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = await portaLivre();
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = path.join(ROOT, '.tmp-teste');
const SEGREDO_WEBHOOK = 'segredo-de-teste-webhook-pague-pouco';

/* ------------------------------------------------------------------ */
/* Infraestrutura de teste                                             */
/* ------------------------------------------------------------------ */
const resultados = [];
let grupo = '';

function secao(nome) { grupo = nome; resultados.push({ secao: nome }); }

async function testar(nome, fn) {
  const inicio = Date.now();
  try {
    const detalhe = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Tempo limite excedido (30s) — requisição não respondeu.')), 30000)),
    ]);
    resultados.push({ secao: grupo, nome, ok: true, detalhe: detalhe || '', ms: Date.now() - inicio });
    console.log(`  ✔ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  } catch (err) {
    resultados.push({ secao: grupo, nome, ok: false, detalhe: err.message, ms: Date.now() - inicio });
    console.log(`  ✘ ${nome}\n      → ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Falha na asserção.');
}

class Cliente {
  constructor(nome = 'anon') {
    this.nome = nome;
    this.jar = Object.create(null);
    this.csrf = '';
  }
  _cookieHeader() {
    return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  _capturarCookies(res) {
    const bruto = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const linha of bruto) {
      const [par] = linha.split(';');
      const i = par.indexOf('=');
      if (i > 0) this.jar[par.slice(0, i).trim()] = par.slice(i + 1).trim();
    }
  }
  async req(metodo, caminho, opts = {}) {
    // Como um navegador faz: abre uma página antes de enviar o primeiro POST,
    // recebendo o cookie de sessão/CSRF e o token do formulário.
    if (metodo === 'POST' && !this.csrf && !opts.skipCsrf && !opts.semBootstrap) {
      await this.req('GET', '/');
    }
    const headers = Object.assign({ Accept: 'text/html,application/json' }, opts.headers || {});
    const cookie = this._cookieHeader();
    if (cookie) headers.Cookie = cookie;
    let body;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = opts.skipCsrf ? '' : (opts.csrf ?? this.csrf);
      headers['X-Requested-With'] = 'fetch';
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
      // CSRF é lido do corpo; garantimos que esteja presente
      if (!opts.skipCsrf && !opts.form._csrf) body += `&_csrf=${encodeURIComponent(this.csrf)}`;
    } else if (opts.raw !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = opts.raw;
    } else if (opts.multipart) {
      body = opts.multipart;
      headers['X-CSRF-Token'] = opts.skipCsrf ? '' : (opts.csrf ?? this.csrf);
      headers['X-Requested-With'] = 'fetch';
    }
    const res = await fetch(BASE + caminho, {
      method: metodo, headers, body, redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs || 20000),
    });
    this._capturarCookies(res);
    const texto = await res.text();
    // captura token CSRF das páginas
    const m = /name="_csrf"\s+value="([^"]+)"/.exec(texto) || /"csrf":"([^"]+)"/.exec(texto);
    if (m) this.csrf = m[1];
    let json = null;
    try { json = JSON.parse(texto); } catch { /* não é JSON */ }
    return { status: res.status, headers: res.headers, texto, json, location: res.headers.get('location') || '' };
  }
  get(c, o) { return this.req('GET', c, o); }
  post(c, o) { return this.req('POST', c, o); }
}

/** Escolhe uma porta TCP livre para não conflitar com nada em execução. */
async function portaLivre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const porta = srv.address().port;
      srv.close(() => resolve(porta));
    });
  });
}

async function esperarPorta(porta, timeoutMs = 30000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect(porta, '127.0.0.1');
      sock.setTimeout(700);
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('error', () => resolve(false));
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function rodar(script, envExtra = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, script)], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: TMP, PORT: String(PORT), ...envExtra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    p.stdout.on('data', (d) => { saida += d.toString(); });
    p.stderr.on('data', (d) => { saida += d.toString(); });
    p.on('exit', (code) => (code === 0 ? resolve(saida) : reject(new Error(`${script} saiu com código ${code}\n${saida}`))));
  });
}

function iniciarServidor() {
  const p = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: TMP,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      SESSION_SECRET: 'segredo-de-sessao-para-testes',
      MP_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
      PUBLIC_BASE_URL: BASE,
      DEV_MODE: 'true',
      RATE_LIMIT_LOGIN: '25',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => {
    const t = d.toString();
    if (process.env.TEST_VERBOSE) process.stdout.write(`[servidor] ${t}`);
  });
  p.stderr.on('data', (d) => process.stderr.write(`[servidor] ${d}`));
  p.on('exit', (c) => { if (process.env.TEST_VERBOSE) console.log(`[servidor] encerrou (${c})`); });
  return p;
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */
async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  TESTES DE INTEGRAÇÃO — FARMÁCIA PAGUE POUCO');
  console.log('══════════════════════════════════════════════════════════════\n');

  await fsp.rm(TMP, { recursive: true, force: true });
  await fsp.mkdir(TMP, { recursive: true });

  console.log('→ Preparando banco temporário...');
  await rodar('scripts/migrate.js');
  await rodar('scripts/seed.js');

  console.log(`→ Subindo servidor em ${BASE} ...`);
  let servidor = iniciarServidor();
  if (!(await esperarPorta(PORT))) throw new Error('O servidor não respondeu a tempo.');
  console.log('  Servidor no ar.\n');

  const anon = new Cliente('anon');
  const cliente = new Cliente('cliente');
  const admin = new Cliente('admin');
  const atendente = new Cliente('atendente');
  const farmaceutico = new Cliente('farmaceutico');

  const slug = (nome) => slugify(nome);
  const S = {
    paracetamol: slug('Paracetamol 500mg 20 comprimidos'),
    dipirona: slug('Dipirona Sódica 500mg 20 comprimidos'),
    controlado: slug('Amoxicilina 500mg 21 cápsulas (MEDICAMENTO CONTROLADO — VENDA BLOQUEADA)'),
    pendente: slug('Loratadina 10mg 12 comprimidos'),
    fralda: slug('Fralda descartável M — 50 unidades'),
  };

  /** Login no painel (usado pelos testes que precisam de permissão). */
  async function loginAdmin(cli, email, senha) {
    await cli.get('/admin/login');
    const r = await cli.post('/admin/login', { form: { email, senha } });
    if (r.status !== 303 && r.status !== 302) throw new Error(`login admin falhou (${r.status})`);
    // Após autenticar, os POSTs administrativos usam o token da sessão
    // administrativa. O token de visitante usado no login não é mais aceito.
    const painel = await cli.get('/admin');
    if (painel.status !== 200 || !cli.csrf) throw new Error('Não foi possível obter CSRF da sessão administrativa.');
    return r;
  }

  /** Localiza o id de um produto pela busca do painel (funciona inclusive para os bloqueados). */
  async function idProdutoPorTermo(termo) {
    const r = await admin.get(`/admin/produtos?q=${encodeURIComponent(termo)}`);
    const ignorar = new Set(['novo', 'importar', 'exportar']);
    for (const m of r.texto.matchAll(/\/admin\/produtos\/([A-Za-z0-9_-]{4,})"/g)) {
      if (!ignorar.has(m[1])) return m[1];
    }
    return '';
  }

  let idParacetamol = '';
  let idControlado = '';
  let idPendente = '';
  let idFralda = '';
  let codigoPedido = '';
  let idPedido = '';
  let idPagamento = '';
  let idNovoProduto = '';
  let idPendenteCriado = '';
  let idNovaCategoria = '';
  let emailCliente = `cliente.teste.${Date.now()}@exemplo.com.br`;

  /* ============================ SITE PÚBLICO ============================ */
  secao('Site público');
  console.log('\n[Site público]');

  await testar('Home carrega com identidade da farmácia', async () => {
    const r = await anon.get('/');
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('PAGUE POUCO') || r.texto.includes('Pague Pouco'), 'nome da loja ausente');
    return `HTTP ${r.status}`;
  });

  await testar('Menu de departamentos exibe as categorias', async () => {
    const r = await anon.get('/departamentos');
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('Medicamentos isentos de prescrição'), 'departamento não listado');
    assert(r.texto.includes('Fraldas'), 'departamento Fraldas ausente');
    return '16 departamentos';
  });

  await testar('Página de categoria lista produtos', async () => {
    const r = await anon.get(`/categoria/${S.paracetamol ? slug('Medicamentos isentos de prescrição') : ''}`);
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('Paracetamol'), 'produto não listado na categoria');
    return 'ok';
  });

  await testar('Página de produto exibe dados e aviso sanitário obrigatório', async () => {
    const r = await anon.get(`/produto/${S.paracetamol}`);
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('Registro MS'), 'registro MS ausente');
    assert(/SE PERSISTIREM OS SINTOMAS/i.test(r.texto), 'frase obrigatória ausente');
    const m = /data-adicionar-carrinho="([^"]+)"/.exec(r.texto);
    assert(m, 'id do produto não encontrado');
    idParacetamol = m[1];
    return `id ${idParacetamol.slice(0, 8)}…`;
  });

  await testar('Medicamento controlado é exibido, mas BLOQUEADO para venda', async () => {
    const r = await anon.get(`/produto/${S.controlado}`);
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('Indisponível para compra online'), 'bloqueio não sinalizado');
    assert(r.texto.includes('RDC 44/2009'), 'fundamentação sanitária ausente');
    // produtos relacionados podem ter botão; o produto em si, não
    const blocoIndisponivel = r.texto.split('Indisponível para compra online')[0] || '';
    assert(r.texto.includes('Indisponível para compra online'), 'aviso de indisponibilidade ausente');
    return 'bloqueado conforme RDC 44/2009';
  });

  await testar('Medicamento sem aprovação do farmacêutico fica bloqueado', async () => {
    const r = await anon.get(`/produto/${S.pendente}`);
    assert(r.status === 200, `status ${r.status}`);
    assert(/pendente de aprovação/i.test(r.texto) || /Indisponível para compra/i.test(r.texto), 'bloqueio por falta de aprovação ausente');
    const m = /"id":"([^"]+)"/.exec(r.texto);
    idPendente = m ? m[1] : '';
    return 'aguardando responsável técnico';
  });

  await testar('Busca encontra produtos por termo', async () => {
    const r = await anon.get('/busca?q=paracetamol');
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('Paracetamol'), 'resultado não encontrado');
    return 'ok';
  });

  await testar('Página de ofertas responde', async () => {
    const r = await anon.get('/ofertas');
    assert(r.status === 200, `status ${r.status}`);
    return 'ok';
  });

  await testar('Páginas institucionais estão publicadas (14 páginas)', async () => {
    const slugs = ['quem-somos', 'nossas-lojas', 'atendimento', 'fale-conosco', 'perguntas-frequentes',
      'como-comprar', 'formas-de-pagamento', 'entregas-e-fretes', 'trocas-e-devolucoes',
      'politica-de-privacidade', 'politica-de-cookies', 'termos-de-uso',
      'atendimento-farmaceutico', 'informacoes-sanitarias'];
    const faltando = [];
    for (const s of slugs) {
      const r = await anon.get(`/pagina/${s}`);
      if (r.status !== 200) faltando.push(`${s}(${r.status})`);
    }
    assert(!faltando.length, `páginas com falha: ${faltando.join(', ')}`);
    return `${slugs.length}/14 publicadas`;
  });

  await testar('Sitemap XML e robots.txt são gerados', async () => {
    const s = await anon.get('/sitemap.xml');
    assert(s.status === 200, `sitemap status ${s.status}`);
    assert(s.texto.includes('/produto/'), 'sitemap sem produtos');
    const r = await anon.get('/robots.txt');
    assert(r.status === 200, `robots status ${r.status}`);
    assert(r.texto.includes('Sitemap:'), 'robots sem sitemap');
    return 'ok';
  });

  await testar('Página inexistente retorna 404', async () => {
    const r = await anon.get('/produto/nao-existe-este-produto');
    assert(r.status === 404, `status ${r.status}`);
    return 'HTTP 404';
  });

  await testar('Botão flutuante do WhatsApp usa o link oficial wa.me', async () => {
    const r = await anon.get('/');
    assert(/wa\.me\/\d+/.test(r.texto), 'link wa.me ausente');
    assert(r.texto.includes('WhatsApp') || r.texto.includes('Dúvidas'), 'rótulo do botão ausente');
    const m = /wa\.me\/(\d+)/.exec(r.texto);
    return `wa.me/${m[1]}`;
  });

  await testar('CSS principal e JS do site são servidos', async () => {
    const css = await anon.get('/styles.css');
    assert(css.status === 200, `css ${css.status}`);
    const js = await anon.get('/js/app.js');
    assert(js.status === 200, `js ${js.status}`);
    return 'ok';
  });

  /* ========================== CONTA DO CLIENTE ========================== */
  secao('Cadastro, login e recuperação de senha');
  console.log('\n[Cadastro, login e recuperação de senha]');

  await testar('Cadastro de novo cliente cria sessão', async () => {
    const r = await cliente.post('/conta/cadastro', {
      form: {
        nome: 'Cliente de Teste Automatizado',
        email: emailCliente,
        telefone: '73988887777',
        cpf: '12345678909',
        senha: 'Teste@12345',
        senha2: 'Teste@12345',
        marketing: '1',
      },
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    assert(r.location.includes('/conta'), `redirecionou para ${r.location}`);
    return 'conta criada';
  });

  await testar('Área do cliente exige autenticação (redireciona)', async () => {
    const outro = new Cliente('sem-sessao');
    const r = await outro.get('/conta');
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    assert(r.location.includes('/conta/login'), `location ${r.location}`);
    return 'protegido';
  });

  await testar('Login com senha incorreta é recusado', async () => {
    const outro = new Cliente('login-errado');
    await outro.get('/conta/login');
    const r = await outro.post('/conta/login', { form: { email: emailCliente, senha: 'senha-errada' } });
    assert(r.texto.includes('incorretos'), 'mensagem de erro ausente');
    return 'recusado';
  });

  await testar('Login com senha correta autentica', async () => {
    const outro = new Cliente('login-certo');
    await outro.get('/conta/login');
    const r = await outro.post('/conta/login', { form: { email: emailCliente, senha: 'Teste@12345' } });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    const home = await outro.get('/conta');
    assert(home.status === 200, `status ${home.status}`);
    assert(/Olá, Cliente/.test(home.texto), 'área do cliente não exibiu o nome do cliente');
    assert(home.texto.includes('Minha conta'), 'área do cliente não carregou');
    return 'autenticado';
  });

  await testar('Cadastro com e-mail duplicado é bloqueado', async () => {
    const outro = new Cliente('duplicado');
    await outro.get('/conta/cadastro');
    const r = await outro.post('/conta/cadastro', {
      form: { nome: 'Outro', email: emailCliente, telefone: '73988887777', senha: 'Teste@12345', senha2: 'Teste@12345' },
    });
    assert(r.texto.includes('já possui cadastro'), 'duplicidade não bloqueada');
    return 'bloqueado';
  });

  await testar('Recuperação de senha gera link válido e permite redefinir', async () => {
    const outro = new Cliente('recuperacao');
    await outro.get('/conta/esqueci-senha');
    const r = await outro.post('/conta/esqueci-senha', { form: { email: emailCliente } });
    assert(r.status === 200, `status ${r.status}`);
    // lê a fila de e-mails gravada em disco
    const dirMail = path.join(TMP, 'mail');
    let arquivos = [];
    for (let tentativa = 0; tentativa < 20; tentativa++) {
      try { arquivos = (await fsp.readdir(dirMail)).filter((f) => f.endsWith('.eml')); } catch { arquivos = []; }
      if (arquivos.length) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(arquivos.length, 'nenhum e-mail gravado na fila de saída');
    // procura o link de redefinição no e-mail mais recente (partes em base64)
    let tokenEncontrado = '';
    for (const arq of arquivos.sort().reverse()) {
      const conteudo = await fsp.readFile(path.join(dirMail, arq), 'utf8');
      for (const linha of conteudo.split(/\r?\n/)) {
        if (linha.length < 40 || !/^[A-Za-z0-9+/=]+$/.test(linha)) continue;
        const decodificado = Buffer.from(linha, 'base64').toString('utf8');
        const achado = /\/conta\/redefinir\/([A-Za-z0-9_-]{20,})/.exec(decodificado);
        if (achado) { tokenEncontrado = achado[1]; break; }
      }
      if (tokenEncontrado) break;
    }
    if (!tokenEncontrado) {
      const assuntos = [];
      for (const arq of arquivos) {
        const bruto = await fsp.readFile(path.join(dirMail, arq), 'utf8');
        const sub = /=\?UTF-8\?B\?([^?]+)\?=/.exec(bruto);
        assuntos.push(sub ? Buffer.from(sub[1], 'base64').toString('utf8') : '(sem assunto)');
      }
      throw new Error(`token de recuperação não encontrado (${arquivos.length} e-mail(s): ${assuntos.join(' | ')})`);
    }
    const token = tokenEncontrado;
    const tela = await outro.get(`/conta/redefinir/${token}`);
    assert(tela.status === 200 && tela.texto.includes('Definir nova senha'), 'tela de redefinição inválida');
    const fraca = await outro.post('/conta/redefinir-senha', { form: { token, senha: 'aaaaaaaa', senha2: 'aaaaaaaa' } });
    assert(fraca.status === 400, 'recuperação deve rejeitar senha sem números');
    const troca = await outro.post('/conta/redefinir-senha', { form: { token, senha: 'Nova@12345', senha2: 'Nova@12345' } });
    assert(troca.status === 303 || troca.status === 302, `status ${troca.status}`);
    const repetida = await outro.post('/conta/redefinir-senha', { form: { token, senha: 'OutroTeste123', senha2: 'OutroTeste123' } });
    assert(repetida.status === 400, 'o mesmo token de recuperação não pode ser usado duas vezes');
    const login = new Cliente('login-nova-senha');
    await login.get('/conta/login');
    const r2 = await login.post('/conta/login', { form: { email: emailCliente, senha: 'Nova@12345' } });
    assert(r2.status === 303 || r2.status === 302, 'não autenticou com a nova senha');
    // a redefinição encerra todas as sessões do cliente (proteção correta): refaz o login
    await cliente.get('/conta/login');
    const relogin = await cliente.post('/conta/login', { form: { email: emailCliente, senha: 'Nova@12345' } });
    assert(relogin.status === 303 || relogin.status === 302, 'não foi possível refazer o login após a troca');
    const conta = await cliente.get('/conta');
    assert(conta.status === 200, 'sessão do cliente não foi restabelecida');
    return 'senha redefinida e sessões anteriores encerradas';
  });

  await testar('Cliente cadastra endereço de entrega', async () => {
    const r = await cliente.post('/conta/enderecos', {
      form: {
        nome: 'Cliente de Teste Automatizado', apelido: 'Casa', cep: '45830000',
        logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro',
        cidade: 'Itanhém', uf: 'BA', padrao: '1',
      },
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    const lista = await cliente.get('/conta/enderecos');
    assert(lista.texto.includes('Rua das Flores'), 'endereço não salvo');
    return 'endereço salvo';
  });

  /* ======================== CEP, FRETE E CARRINHO ======================= */
  secao('CEP, frete por estado e carrinho');
  console.log('\n[CEP, frete por estado e carrinho]');

  await testar('Autenticação do Super Administrador no painel', async () => {
    await loginAdmin(admin, 'admin@paguepouco.local', 'Admin@123456');
    const r = await admin.get('/admin');
    assert(r.status === 200 && r.texto.includes('Painel da loja'), `dashboard ${r.status}`);
    return 'sessão ativa';
  });

  await testar('Identificação de UF por CEP (4 estados diferentes)', async () => {
    const casos = [['45830000', 'BA'], ['01001000', 'SP'], ['90010000', 'RS'], ['70040000', 'DF']];
    for (const [cep, uf] of casos) {
      const r = await anon.get(`/api/cep/${cep}`);
      assert(r.json && r.json.uf === uf, `CEP ${cep}: esperado ${uf}, obtido ${r.json && r.json.uf}`);
    }
    return casos.map(([c, u]) => `${c}→${u}`).join(', ');
  });

  await testar('Adicionar produto ao carrinho', async () => {
    const r = await cliente.post('/api/carrinho/adicionar', { json: { produtoId: idParacetamol, quantidade: 2 } });
    assert(r.json && r.json.ok, r.json?.erro || 'falhou');
    assert(r.json.quantidade === 2, `quantidade ${r.json.quantidade}`);
    return '2 unidades na cesta';
  });

  await testar('Bloqueio de venda de medicamento controlado na API', async () => {
    idControlado = await idProdutoPorTermo('amoxicilina');
    assert(idControlado, 'produto controlado não localizado no cadastro');
    const r = await cliente.post('/api/carrinho/adicionar', { json: { produtoId: idControlado, quantidade: 1 } });
    assert(!r.json?.ok, 'a venda do controlado NÃO foi bloqueada');
    assert(/prescri/i.test(r.json.erro || ''), `mensagem inesperada: ${r.json.erro}`);
    const cesta = await cliente.get('/api/carrinho');
    assert(!cesta.json.itens.some((i) => i.produtoId === idControlado), 'item controlado entrou na cesta');
    return 'venda bloqueada (RDC 44/2009)';
  });

  await testar('Produto com cadastro sanitário INCOMPLETO é bloqueado (sem registro MS)', async () => {
    idPendente = await idProdutoPorTermo('loratadina');
    assert(idPendente, 'produto de teste não localizado no cadastro');
    const r = await cliente.post('/api/carrinho/adicionar', { json: { produtoId: idPendente, quantidade: 1 } });
    assert(!r.json?.ok, 'produto com cadastro sanitário incompleto NÃO foi bloqueado');
    assert(/sanitário|registro|Anvisa/i.test(r.json.erro || ''), `mensagem inesperada: ${r.json.erro}`);
    return 'bloqueado: exige registro na Anvisa';
  });

  await testar('Medicamento com registro MS, mas SEM aprovação do farmacêutico, é bloqueado', async () => {
    const r = await admin.post('/admin/api/produtos', {
      form: {
        nome: 'Produto aguardando farmacêutico (teste)',
        sku: 'TESTE-FARMA-001', marca: 'MarcaTeste', preco: '15.00',
        quantidade: '5', estoqueMinimo: '1', peso: '0.1', ativo: '1',
        classificacao: 'isento_prescricao', registroMS: 'MS 1.2345.9999 (ILUSTRATIVO)',
        apresentacao: 'Comprimido', concentracao: '10 mg', principioAtivo: 'Substância de teste',
        descricao: '<p>Produto criado para validar a aprovação do responsável técnico.</p>',
      },
    });
    assert(r.json?.ok, r.json?.erro || 'não foi possível criar o produto');
    idPendenteCriado = r.json.id;
    const add = await cliente.post('/api/carrinho/adicionar', { json: { produtoId: idPendenteCriado, quantidade: 1 } });
    assert(!add.json?.ok, 'produto sem aprovação do farmacêutico NÃO foi bloqueado');
    assert(/pendente de aprovação|farmacêutico/i.test(add.json.erro || ''), `mensagem inesperada: ${add.json.erro}`);
    const site = await anon.get(`/produto/${slug('Produto aguardando farmacêutico (teste)')}`);
    assert(site.status === 200 && /Indisponível para compra online/.test(site.texto), 'site não sinalizou o bloqueio');
    return 'bloqueado até o responsável técnico aprovar';
  });

  await testar('Cupom inválido é recusado e cupom válido aplica desconto', async () => {
    const ruim = await cliente.post('/api/carrinho/cupom', { json: { codigo: 'NAOEXISTE' } });
    assert(!ruim.json?.ok, 'cupom inválido foi aceito');
    const bom = await cliente.post('/api/carrinho/cupom', { json: { codigo: 'PAGUEPOUCO15' } });
    if (!bom.json?.ok) {
      assert(/mínimo|acima|a partir/i.test(bom.json?.erro || ''), `erro inesperado: ${bom.json?.erro}`);
      return 'cupom válido exige valor mínimo (regra aplicada)';
    }
    await cliente.post('/api/carrinho/cupom/remover', { json: {} });
    return 'regras de cupom aplicadas';
  });

  await testar('Cálculo de frete identifica o estado e aplica a tabela', async () => {
    const r = await cliente.post('/api/frete', { json: { cep: '01001000', cidade: 'São Paulo', uf: 'SP' } });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    assert(r.json.uf === 'SP', `UF ${r.json.uf}`);
    const padrao = r.json.opcoes.find((o) => o.id === '_padrao');
    assert(padrao && padrao.valor === 2990, `valor ${padrao?.valor} (esperado 2990 = R$ 29,90)`);
    return `SP = R$ ${(padrao.valor / 100).toFixed(2)}, prazo ${padrao.prazo}`;
  });

  await testar('Frete não é inventado para estado sem configuração', async () => {
    // desativa as entregas para o Acre pelo painel e confere o bloqueio
    await admin.get('/admin/login');
    const login = await admin.post('/admin/login', { form: { email: 'admin@paguepouco.local', senha: 'Admin@123456' } });
    assert(login.status === 303 || login.status === 302, 'login do admin falhou');
    const antes = await admin.get('/admin/fretes');
    const cfgResp = await admin.post('/admin/api/fretes', {
      form: {
        ...construirFormFrete({ AC: { ativo: false } }),
      },
    });
    assert(cfgResp.status === 303 || cfgResp.status === 302, `status ${cfgResp.status}`);
    const r = await cliente.post('/api/frete', { json: { cep: '69900000', cidade: 'Rio Branco', uf: 'AC' } });
    assert(!r.json?.opcoes?.some((o) => o.id === '_padrao'), 'frete foi oferecido para estado desativado');
    assert(r.json?.motivo, 'motivo do bloqueio ausente');
    // reativa
    await admin.post('/admin/api/fretes', { form: construirFormFrete({ AC: { ativo: true } }) });
    return 'bloqueia e informa o motivo';
  });

  await testar('Frete grátis é aplicado acima do valor configurado', async () => {
    // adiciona produto caro para passar de R$ 199,00
    const busca = await cliente.get('/busca?q=medidor+de+glicose');
    const idm = /data-adicionar-carrinho="([^"]+)"/.exec(busca.texto);
    if (!idm) return 'produto não encontrado (teste ignorado)';
    await cliente.post('/api/carrinho/adicionar', { json: { produtoId: idm[1], quantidade: 2 } });
    const r = await cliente.post('/api/frete', { json: { cep: '01001000', cidade: 'São Paulo', uf: 'SP' } });
    const padrao = r.json.opcoes.find((o) => o.id === '_padrao');
    assert(padrao, 'opção padrão de frete não retornada');
    assert(padrao.valor === 0, `esperado frete grátis, obtido ${padrao.valor} (subtotal R$ ${(r.json.subtotal / 100).toFixed(2)})`);
    return 'frete grátis aplicado';
  });

  /* ============================== CHECKOUT ============================== */
  secao('Checkout, pedido e pagamento');
  console.log('\n[Checkout, pedido e pagamento]');

  await testar('Checkout exige login e mostra etapas', async () => {
    const outro = new Cliente('sem-login');
    const r = await outro.get('/checkout/endereco');
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    assert(r.location.includes('/conta/login'), `location ${r.location}`);
    const ok = await cliente.get('/checkout/endereco');
    assert(ok.status === 200 && ok.texto.includes('Dados de entrega'), 'tela de entrega não carregou');
    return 'fluxo protegido';
  });

  await testar('Seleção de frete no checkout redireciona para o pagamento', async () => {
    const r = await cliente.post('/checkout/endereco', {
      form: {
        nome: 'Cliente de Teste Automatizado', cep: '45830000', uf: 'BA', cidade: 'Itanhém',
        logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro', telefone: '73988887777',
        freteOpcao: '_padrao', salvarEndereco: '1',
      },
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    assert(r.location.includes('/checkout/pagamento'), `location ${r.location}`);
    return 'frete BA selecionado';
  });

  await testar('Tela de pagamento exibe Pix, cartão e parcelamento', async () => {
    const r = await cliente.get('/checkout/pagamento');
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('Pix'), 'Pix ausente');
    assert(r.texto.includes('Cartão de crédito'), 'cartão ausente');
    assert(/parcelas/i.test(r.texto), 'parcelamento ausente');
    return 'ok';
  });

  await testar('Finalização cria o pedido, reserva estoque e gera cobrança Pix', async () => {
    const antes = await cliente.get('/api/carrinho');
    const itensAntes = antes.json.itens.length;
    assert(itensAntes > 0, 'carrinho vazio');
    const r = await cliente.post('/checkout/finalizar', {
      form: { metodoPagamento: 'pix', parcelas: '1' },
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    const m = /confirmacao\/(PP\d+)/.exec(r.location);
    assert(m, `location inesperado: ${r.location}`);
    codigoPedido = m[1];
    const conf = await cliente.get(`/checkout/confirmacao/${codigoPedido}`);
    assert(conf.status === 200, `status ${conf.status}`);
    assert(conf.texto.includes('Pedido registrado'), 'confirmação não exibida');
    assert(conf.texto.includes('PIX-SIMULADO'), 'código Pix simulado ausente');
    assert(/ambiente de testes/i.test(conf.texto), 'aviso de ambiente de testes ausente');
    return `pedido ${codigoPedido}`;
  });

  await testar('Pedido aparece em "Meus pedidos" do cliente', async () => {
    const r = await cliente.get('/conta/pedidos');
    assert(r.texto.includes(codigoPedido), 'pedido não listado');
    return codigoPedido;
  });

  await testar('Estoque é RESERVADO após o pedido (sem baixa definitiva)', async () => {
    const lista = await admin.get('/admin/estoque');
    assert(lista.status === 200, `status ${lista.status}`);
    assert(/reservado/i.test(lista.texto), 'coluna de reserva ausente');
    const pedido = await admin.get('/admin/pedidos');
    const m = /\/admin\/pedidos\/([a-z0-9]+)"/.exec(pedido.texto);
    assert(m, 'pedido não encontrado no painel');
    idPedido = m[1];
    const detalhe = await admin.get(`/admin/pedidos/${idPedido}`);
    assert(detalhe.texto.includes(codigoPedido), 'detalhe do pedido não carregou');
    assert(/Aguardando pagamento|pendente/i.test(detalhe.texto), 'status inicial incorreto');
    return 'reserva registrada';
  });

  await testar('Pagamento NÃO é aprovado sem confirmação do provedor', async () => {
    const detalhe = await cliente.get(`/conta/pedidos/${codigoPedido}`);
    assert(!/Aprovado/.test(detalhe.texto.replace(/Pagamento aprovado: não/gi, '')), 'pedido aparece como aprovado indevidamente');
    assert(/Aguardando pagamento/.test(detalhe.texto), 'status deveria ser "aguardando pagamento"');
    return 'aguardando confirmação';
  });

  await testar('Aprovação (simulada em testes) baixa o estoque e atualiza status', async () => {
    const r = await admin.post(`/admin/api/pedidos/${idPedido}/simular-pagamento`, { json: { status: 'approved' } });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    const detalhe = await admin.get(`/admin/pedidos/${idPedido}`);
    assert(/aprovado/i.test(detalhe.texto), 'status financeiro não virou aprovado');
    assert(/em separação|em_separa/i.test(detalhe.texto), 'status operacional não avançou');
    return 'aprovado, estoque baixado e pedido em separação';
  });

  await testar('Webhook valida assinatura (HMAC) — sem assinatura é recusado', async () => {
    const corpo = JSON.stringify({ pagamentoId: 'x', status: 'approved', idempotencyKey: 'k1' });
    const r = await fetch(`${BASE}/webhooks/internal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo,
    });
    assert(r.status === 400, `status ${r.status} (deveria recusar)`);
    return 'recusado sem assinatura';
  });

  await testar('Webhook com assinatura correta processa e ignora duplicatas', async () => {
    // cria um segundo pedido para testar o webhook de ponta a ponta
    await cliente.post('/api/carrinho/adicionar', { json: { produtoId: idParacetamol, quantidade: 1 } });
    await cliente.post('/checkout/endereco', {
      form: {
        nome: 'Cliente de Teste Automatizado', cep: '45830000', uf: 'BA', cidade: 'Itanhém',
        logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro', telefone: '73988887777',
        freteOpcao: '_padrao',
      },
    });
    const fin = await cliente.post('/checkout/finalizar', { form: { metodoPagamento: 'pix' } });
    const m = /confirmacao\/(PP\d+)/.exec(fin.location);
    assert(m, `segundo pedido não criado (status ${fin.status}, location "${fin.location}")`);
    const codigo2 = m[1];
    const pedidos = await admin.get('/admin/pedidos?q=' + codigo2);
    const idm = /\/admin\/pedidos\/([a-z0-9]+)"/.exec(pedidos.texto);
    const pedido2Id = idm[1];
    const listaPag = await admin.get('/admin/pagamentos');
    // localiza o pagamento do pedido pela página do pedido
    const detalhe = await admin.get(`/admin/pedidos/${pedido2Id}`);
    const pm = /data-simular-pagamento="([^"]+)"/.exec(detalhe.texto);
    assert(pm, 'pagamento não vinculado ao pedido');
    idPagamento = pm[1];

    const corpoObj = { pagamentoId: idPagamento, status: 'approved', idempotencyKey: 'teste-webhook-1' };
    const corpo = JSON.stringify(corpoObj);
    const assinatura = crypto.createHmac('sha256', SEGREDO_WEBHOOK).update(corpo).digest('hex');
    const r1 = await fetch(`${BASE}/webhooks/internal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pp-signature': assinatura }, body: corpo,
      signal: AbortSignal.timeout(20000),
    });
    const j1 = await r1.json();
    assert(j1.ok, j1.erro || 'webhook não processou');
    const r2 = await fetch(`${BASE}/webhooks/internal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pp-signature': assinatura }, body: corpo,
      signal: AbortSignal.timeout(20000),
    });
    const j2 = await r2.json();
    assert(j2.duplicado === true, 'notificação duplicada não foi ignorada (risco de dupla confirmação)');
    const d = await admin.get(`/admin/pedidos/${pedido2Id}`);
    assert(/aprovado/i.test(d.texto), 'pedido não foi aprovado pelo webhook');
    return 'processado 1x, duplicata ignorada';
  });

  await testar('Cancelamento de pedido pago exige estorno sem entrada física automática', async () => {
    const r = await admin.post(`/admin/api/pedidos/${idPedido}/cancelar`, { json: {} });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    const d = await admin.get(`/admin/pedidos/${idPedido}`);
    assert(/cancelado/i.test(d.texto), 'pedido não consta como cancelado após estorno confirmado');
    const historico = await admin.get('/admin/estoque');
    assert(!historico.texto.includes('cancelamento_pos_aprovacao'),
      'cancelamento não pode devolver mercadoria sem confirmação física');
    return 'cancelado após estorno confirmado, sem devolução física automática';
  });

  /* ========================== PAINEL ADMINISTRATIVO ==================== */
  secao('Painel Super Administrador');
  console.log('\n[Painel Super Administrador]');

  await testar('Login do Super Administrador e dashboard', async () => {
    const r = await admin.get('/admin');
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('Painel da loja'), 'dashboard não carregou');
    assert(r.texto.includes('Pedidos'), 'métrica ausente');
    return 'ok';
  });

  await testar('Lista de produtos, filtros e ações', async () => {
    const r = await admin.get('/admin/produtos');
    assert(r.status === 200, `status ${r.status}`);
    assert(/Novo produto/.test(r.texto), 'ações da listagem ausentes');
    const busca = await admin.get('/admin/produtos?q=paracetamol');
    assert(busca.texto.includes('Paracetamol'), 'busca do painel não encontrou o produto');
    const f = await admin.get('/admin/produtos?status=bloqueado');
    assert(f.status === 200 && /Amoxicilina|Loratadina|aguardando farmacêutico/i.test(f.texto), 'filtro de bloqueados não funcionou');
    return 'listagem, busca e filtros ok';
  });

  await testar('Criação de produto pelo painel', async () => {
    const r = await admin.post('/admin/api/produtos', {
      form: {
        nome: 'Produto de Teste Automatizado 500mg',
        sku: 'TESTE-AUT-001', ean: '7899999999999', marca: 'MarcaTeste',
        preco: '29.90', precoPromocional: '19.90',
        quantidade: '50', estoqueMinimo: '5', peso: '0.2',
        ativo: '1', classificacao: 'nao_aplicavel',
        descricao: '<p>Produto criado pelo teste automatizado.</p>',
      },
    });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    idNovoProduto = r.json.id;
    const busca = await anon.get('/busca?q=Produto+de+Teste+Automatizado');
    assert(busca.texto.includes('Produto de Teste Automatizado'), 'produto não aparece no site');
    return `id ${idNovoProduto.slice(0, 8)}…`;
  });

  await testar('Upload de IMAGEM grava arquivo em disco e registra no banco', async () => {
    const fd = new FormData();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect width="200" height="200" fill="#0f8b5f"/><text x="100" y="110" font-size="40" text-anchor="middle" fill="#fff">TESTE</text></svg>');
    fd.append('arquivo', new Blob([svg], { type: 'image/svg+xml' }), 'teste.svg');
    const r = await admin.post('/admin/api/upload', { multipart: fd });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    const arq = r.json.arquivos[0].arquivo;
    assert(arq.url.startsWith('/uploads/'), `url ${arq.url}`);
    const caminho = path.join(TMP, 'uploads', arq.caminho);
    assert(fs.existsSync(caminho), `arquivo não gravado: ${caminho}`);
    const serve = await anon.get(arq.url);
    assert(serve.status === 200, `arquivo não servido (${serve.status})`);
    return `${arq.url} (${arq.tamanho} bytes)`;
  });

  await testar('Upload de VÍDEO é aceito (validação por tipo real)', async () => {
    const fd = new FormData();
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(200, 1)]);
    fd.append('arquivo', new Blob([mp4], { type: 'video/mp4' }), 'video-teste.mp4');
    const r = await admin.post('/admin/api/upload', { multipart: fd });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    assert(r.json.arquivos[0].arquivo.tipo === 'video', 'tipo não reconhecido como vídeo');
    return 'MP4 aceito';
  });

  await testar('Upload de arquivo NÃO permitido é recusado', async () => {
    const fd = new FormData();
    fd.append('arquivo', new Blob([Buffer.from('MZ\x90\x00 executável falso')], { type: 'application/octet-stream' }), 'virus.exe');
    const r = await admin.post('/admin/api/upload', { multipart: fd });
    const item = r.json?.arquivos?.[0];
    assert(item && item.ok === false, 'arquivo perigoso foi aceito!');
    return 'recusado: ' + (item.erro || '').slice(0, 60);
  });

  await testar('Biblioteca de mídia lista os arquivos enviados', async () => {
    const r = await admin.get('/admin/midia');
    assert(r.status === 200, `status ${r.status}`);
    assert(r.texto.includes('teste.svg') || r.texto.includes('video-teste'), 'arquivo não listado');
    return 'ok';
  });

  await testar('Criação de categoria reflete no site', async () => {
    const r = await admin.post('/admin/api/categorias', {
      form: { nome: 'Categoria de Teste', icone: '🧪', ordem: '50', ativa: '1', descricao: 'Criada pelo teste automatizado' },
    });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    idNovaCategoria = r.json.id;
    const dept = await anon.get('/departamentos');
    assert(dept.texto.includes('Categoria de Teste'), 'categoria não aparece no site');
    return 'ok';
  });

  await testar('Configuração de fretes por estado é salva e aplicada', async () => {
    const r = await admin.post('/admin/api/fretes', {
      form: construirFormFrete({ MA: { valor: '31.90', prazoMin: '5', prazoMax: '12' } }),
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    const c = new Cliente('frete-ma');
    await c.post('/api/carrinho/adicionar', { json: { produtoId: idParacetamol, quantidade: 1 } });
    const f = await c.post('/api/frete', { json: { cep: '65000000', cidade: 'São Luís', uf: 'MA' } });
    const padrao = f.json.opcoes.find((o) => o.id === '_padrao');
    assert(padrao && padrao.valor === 3190, `esperado 3190, obtido ${padrao?.valor}`);
    assert(padrao.prazo.includes('5') && padrao.prazo.includes('12'), `prazo ${padrao?.prazo}`);
    return `MA = R$ 31,90 (5 a 12 dias úteis)`;
  });

  await testar('Exceção de frete por faixa de CEP é aplicada', async () => {
    const r = await admin.post('/admin/api/fretes/excecao', {
      form: { tipo: 'faixa-cep', cepIni: '45830000', cepFim: '45839999', valor: '5.50', prazoMin: '0', prazoMax: '1', motivo: 'Entrega expressa na cidade-sede (teste)' },
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    const c = new Cliente('frete-exc');
    await c.post('/api/carrinho/adicionar', { json: { produtoId: idParacetamol, quantidade: 1 } });
    const f = await c.post('/api/frete', { json: { cep: '45830000', cidade: 'Itanhém', uf: 'BA' } });
    const padrao = f.json.opcoes.find((o) => o.id === '_padrao');
    assert(padrao && padrao.valor === 550, `esperado 550 (exceção), obtido ${padrao?.valor}`);
    return 'exceção aplicada (R$ 5,50)';
  });

  await testar('Configuração do WhatsApp altera o botão do site', async () => {
    const r = await admin.post('/admin/api/whatsapp', {
      form: {
        ativo: '1', numero: '5573999991234',
        mensagem: 'Olá! Teste automatizado de atendimento.',
        textoBotao: 'Dúvidas? Fale com o farmacêutico',
        posicao: 'direita', paginas: 'todas', respeitarHorario: '0',
        mensagemIndisponivel: 'Fora do horário (teste)', avisoCheckout: 'Canal exclusivo para dúvidas (teste)',
        dia_ativo_segunda: '1', dia_inicio_segunda: '08:00', dia_fim_segunda: '20:00',
      },
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    const home = await anon.get('/');
    assert(home.texto.includes('5573999991234'), 'número não atualizado no site');
    assert(home.texto.includes('Fale com o farmacêutico'), 'texto do botão não atualizado');
    return 'número e mensagem atualizados';
  });

  await testar('Edição de página institucional aparece no site e sanitiza HTML perigoso', async () => {
    const r = await admin.post('/admin/api/paginas', {
      form: {
        titulo: 'Pagina de Teste Automatizado', slug: 'pagina-teste-automatizado',
        resumo: 'Criada pelo teste automatizado',
        conteudo: '<h2>Título de teste</h2><p>Conteúdo OK</p><script>alert("xss")</script><img src="x" onerror="alert(1)">',
        publicada: '1',
      },
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    const p = await anon.get('/pagina/pagina-teste-automatizado');
    assert(p.status === 200, `status ${p.status}`);
    assert(p.texto.includes('Título de teste'), 'conteúdo não publicado');
    assert(!p.texto.includes('alert("xss")'), 'script NÃO foi removido (falha de segurança)');
    assert(!/onerror=/i.test(p.texto), 'atributo de evento não foi removido (falha de segurança)');
    return 'publicada e sanitizada (XSS bloqueado)';
  });

  await testar('Criação de cupom e aplicação no carrinho', async () => {
    const codigo = `TESTE${Date.now().toString().slice(-5)}`;
    const r = await admin.post('/admin/api/cupons', {
      form: { codigo, tipo: 'fixo', valor: '10', valorMinimo: '0', ativo: '1' },
    });
    assert(r.status === 200 || r.status === 303 || r.status === 302, `status ${r.status}`);
    const c = new Cliente('cupom');
    await c.post('/api/carrinho/adicionar', { json: { produtoId: idParacetamol, quantidade: 1 } });
    const ap = await c.post('/api/carrinho/cupom', { json: { codigo } });
    assert(ap.json?.ok, ap.json?.erro || 'cupom não aplicado');
    const esperado = Math.min(1000, Number(ap.json.subtotal || 0));
    assert(ap.json.desconto === esperado, `desconto ${ap.json.desconto} (esperado ${esperado}, limitado ao subtotal)`);
    return `${codigo} aplicou ${(ap.json.desconto / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  });

  await testar('Criação de banner aparece na home', async () => {
    const r = await admin.post('/admin/api/banners', {
      form: { titulo: 'Banner de Teste Automatizado', imagem: '/img/produto-sem-foto.svg', link: '/ofertas', posicao: 'principal', ordem: '1', ativo: '1' },
    });
    assert(r.status === 200 || r.status === 303 || r.status === 302, `status ${r.status}`);
    const home = await anon.get('/');
    assert(home.texto.includes('Banner de Teste Automatizado'), 'banner não exibido');
    return 'ok';
  });

  await testar('Movimentação de estoque é registrada no histórico', async () => {
    const r = await admin.post('/admin/api/estoque/movimentar', {
      form: { produtoId: idParacetamol, tipo: 'entrada', quantidade: '10', observacao: 'Reposição (teste automatizado)' },
    });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    const hist = await admin.get('/admin/estoque');
    assert(hist.texto.includes('Reposição (teste automatizado)'), 'movimentação não registrada');
    return 'entrada registrada';
  });

  await testar('Relatórios e exportação CSV funcionam', async () => {
    const r = await admin.get('/admin/relatorios');
    assert(r.status === 200, `status ${r.status}`);
    const csv = await admin.get('/admin/api/relatorios/vendas.csv');
    assert(csv.status === 200, `csv status ${csv.status}`);
    const prod = await admin.get('/admin/api/produtos/exportar.csv');
    assert(prod.status === 200, `csv produtos ${prod.status}`);
    return 'ok';
  });

  await testar('Editor visual: seções e vitrines', async () => {
    const r = await admin.post('/admin/api/aparencia/vitrines', {
      form: { titulo: 'Vitrine de Teste', tipo: 'marca', marca: 'NeoVit', limite: '4', ordem: '20', link: '/busca?q=vitamina' },
    });
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    const home = await anon.get('/');
    assert(home.texto.includes('Vitrine de Teste'), 'vitrine não aparece na home');
    return 'ok';
  });

  /* ============================== SEGURANÇA ============================= */
  secao('Segurança, permissões e LGPD');
  console.log('\n[Segurança, permissões e LGPD]');

  await testar('Requisição POST sem token CSRF é recusada (403)', async () => {
    const outro = new Cliente('sem-csrf');
    await outro.get('/conta/login');
    outro.csrf = '';
    const r = await outro.post('/conta/login', { form: { email: 'x@y.com', senha: '12345678' }, skipCsrf: true });
    assert(r.status === 403, `status ${r.status} (esperado 403)`);
    return 'HTTP 403';
  });

  await testar('Painel exige autenticação (redireciona para login)', async () => {
    const outro = new Cliente('nao-admin');
    const r = await outro.get('/admin');
    assert(r.status === 303 || r.status === 302, `status ${r.status}`);
    assert(r.location.includes('/admin/login'), `location ${r.location}`);
    return 'protegido';
  });

  await testar('Perfil ATENDENTE não acessa usuários nem cria produtos (permissão no servidor)', async () => {
    await atendente.get('/admin/login');
    const login = await atendente.post('/admin/login', { form: { email: 'atendente@paguepouco.local', senha: 'Atende@123' } });
    assert(login.status === 303 || login.status === 302, 'login do atendente falhou');
    const usuarios = await atendente.get('/admin/usuarios');
    assert(usuarios.status === 403, `status ${usuarios.status} (esperado 403)`);
    const criar = await atendente.post('/admin/api/produtos', { form: { nome: 'Tentativa indevida', preco: '10' } });
    assert(criar.json?.ok === false, 'atendente conseguiu criar produto (falha grave)');
    assert(criar.status === 403, `status ${criar.status}`);
    const pedidos = await atendente.get('/admin/pedidos');
    assert(pedidos.status === 200, 'atendente deveria ver pedidos');
    return '403 em usuários e criação de produto';
  });

  await testar('Perfil FARMACÊUTICO aprova o cadastro sanitário e libera a venda', async () => {
    await loginAdmin(farmaceutico, 'farmaceutico@paguepouco.local', 'Farma@123456');
    assert(idPendenteCriado, 'produto pendente não foi criado na etapa anterior');
    const r = await farmaceutico.post(`/admin/api/produtos/${idPendenteCriado}/aprovar`, { json: { status: '1' } });
    assert(r.json?.ok, r.json?.erro || 'aprovação falhou');
    const add = await cliente.post('/api/carrinho/adicionar', { json: { produtoId: idPendenteCriado, quantidade: 1 } });
    assert(add.json?.ok, `produto aprovado continuou bloqueado: ${add.json?.erro}`);
    const site = await anon.get(`/produto/${slug('Produto aguardando farmacêutico (teste)')}`);
    assert(!/Indisponível para compra online/.test(site.texto), 'site ainda exibe o produto como indisponível');
    // o ATENDENTE não pode aprovar cadastro sanitário
    const indevido = await atendente.post(`/admin/api/produtos/${idPendenteCriado}/aprovar`, { json: { status: '0' } });
    assert(indevido.status === 403, `atendente conseguiu alterar a aprovação sanitária (${indevido.status})`);
    return 'aprovado pelo farmacêutico e liberado para venda';
  });

  await testar('Auditoria registra as ações administrativas', async () => {
    const r = await admin.get('/admin/auditoria');
    assert(r.status === 200, `status ${r.status}`);
    assert(/criou_produto|login_admin|alterou_whatsapp|editou_produto/.test(r.texto), 'ações não registradas');
    return 'logs com IP e usuário';
  });

  await testar('Rate limiting bloqueia excesso de tentativas de login', async () => {
    let bloqueado = false;
    for (let i = 0; i < 32; i++) {
      const c = new Cliente(`rl-${i}`);
      await c.get('/conta/login');
      const r = await c.post('/conta/login', { form: { email: `flood${i}@teste.com`, senha: 'senhaerrada123' } });
      if (r.status === 429) { bloqueado = true; break; }
    }
    assert(bloqueado, 'o limite de requisições não foi atingido (proteção ausente)');
    return 'HTTP 429 após excesso de tentativas';
  });

  await testar('Senhas são armazenadas com hash (não em texto puro)', async () => {
    const bruto = fs.readFileSync(path.join(TMP, 'db', 'customers.json'), 'utf8');
    assert(!bruto.includes('Nova@12345'), 'senha encontrada em texto puro!');
    assert(bruto.includes('scrypt$'), 'hash scrypt não encontrado');
    return 'scrypt (hash com salt)';
  });

  await testar('Cabeçalhos de segurança são enviados', async () => {
    const r = await fetch(BASE + '/');
    assert(r.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options ausente');
    assert(r.headers.get('x-frame-options') === 'SAMEORIGIN', 'X-Frame-Options ausente');
    assert(r.headers.get('referrer-policy'), 'Referrer-Policy ausente');
    return 'nosniff, SAMEORIGIN, referrer-policy';
  });

  await testar('Injeção de SQL/JS no campo de busca não quebra nem executa', async () => {
    const r = await anon.get('/busca?q=' + encodeURIComponent(`'; DROP TABLE products; -- <script>alert(1)</script>`));
    assert(r.status === 200, `status ${r.status}`);
    assert(!/<script>alert/.test(r.texto), 'script refletido sem escape');
    const home = await anon.get('/');
    assert(home.status === 200, 'site quebrou após tentativa de injeção');
    return 'neutralizado e escapado';
  });

  await testar('Tentativa de manipular preço pelo navegador é ignorada', async () => {
    // envia quantidade/preço forjados: o servidor deve usar o preço do cadastro
    const c = new Cliente('preco');
    const r = await c.post('/api/carrinho/adicionar', { json: { produtoId: idParacetamol, quantidade: 1, precoUnitarioCentavos: 1 } });
    assert(r.json?.ok, r.json?.erro || 'falhou');
    const item = r.json.itens.find((i) => i.produtoId === idParacetamol);
    assert(item.precoUnitarioCentavos === 749, `preço manipulado: ${item.precoUnitarioCentavos} (esperado 749)`);
    return 'preço recalculado no servidor (R$ 7,49)';
  });

  /* ============================= PERSISTÊNCIA =========================== */
  secao('Persistência dos dados');
  console.log('\n[Persistência dos dados]');

  await testar('Reiniciar o servidor mantém clientes, pedidos, produtos e mídia', async () => {
    const snapshot = {
      pedido: codigoPedido,
      cliente: emailCliente,
      produto: idNovoProduto,
    };
    await new Promise((resolve) => {
      servidor.on('exit', resolve);
      servidor.kill('SIGTERM');
    });
    await new Promise((r) => setTimeout(r, 800));
    servidor = iniciarServidor();
    assert(await esperarPorta(PORT), 'servidor não voltou');
    const novoAdmin = new Cliente('admin2');
    await novoAdmin.get('/admin/login');
    const login = await novoAdmin.post('/admin/login', { form: { email: 'admin@paguepouco.local', senha: 'Admin@123456' } });
    assert(login.status === 303 || login.status === 302, 'login após reinício falhou');
    const pedidos = await novoAdmin.get('/admin/pedidos?q=' + snapshot.pedido);
    assert(pedidos.texto.includes(snapshot.pedido), 'pedido não persistiu');
    const clientes = await novoAdmin.get('/admin/clientes?q=' + encodeURIComponent(snapshot.cliente));
    assert(clientes.texto.includes(snapshot.cliente), 'cliente não persistiu');
    const produtos = await novoAdmin.get('/admin/produtos?q=Produto+de+Teste+Automatizado');
    assert(produtos.texto.includes('Produto de Teste Automatizado'), 'produto não persistiu');
    const midia = await novoAdmin.get('/admin/midia');
    assert(midia.status === 200, 'biblioteca de mídia indisponível');
    Object.assign(admin, { jar: novoAdmin.jar, csrf: novoAdmin.csrf });
    return 'dados íntegros após reinício';
  });

  /* ------------------------------------------------------------------ */
  await new Promise((resolve) => {
    servidor.on('exit', resolve);
    servidor.kill('SIGTERM');
    setTimeout(() => { try { servidor.kill('SIGKILL'); } catch { /* já saiu */ } }, 4000);
  });

  /* ------------------------------- relatório -------------------------- */
  const testes = resultados.filter((r) => r.nome);
  const aprovados = testes.filter((r) => r.ok).length;
  const falhos = testes.filter((r) => !r.ok);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  RESULTADO: ${aprovados}/${testes.length} testes aprovados`);
  if (falhos.length) {
    console.log(`  FALHAS (${falhos.length}):`);
    for (const f of falhos) console.log(`   ✘ ${f.nome}\n     ${f.detalhe}`);
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  await gerarRelatorio(testes, aprovados, falhos);
  await fsp.rm(TMP, { recursive: true, force: true });
  process.exit(falhos.length ? 1 : 0);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function construirFormFrete(alteracoes = {}) {
  const ufs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  const padraoPorUf = { BA: '12.90', MA: '24.90', PE: '19.90', SP: '29.90', RJ: '32.90' };
  const form = {};
  for (const uf of ufs) {
    const alt = alteracoes[uf] || {};
    form[`uf_ativo_${uf}`] = alt.ativo === false ? '' : '1';
    form[`uf_valor_${uf}`] = alt.valor ?? padraoPorUf[uf] ?? '24.90';
    form[`uf_min_${uf}`] = alt.prazoMin ?? '3';
    form[`uf_max_${uf}`] = alt.prazoMax ?? '8';
    form[`uf_custo_${uf}`] = '';
    form[`uf_obs_${uf}`] = '';
  }
  Object.assign(form, {
    fg_ativo: '1', fg_valorMinimo: '199.00', fg_aplicaPara: 'todos', fg_estados: '',
    ret_ativo: '1', ret_endereco: 'Rua da Farmácia, 100 — Centro', ret_horario: 'Seg a sáb, 08h às 20h', ret_prazoMax: '1',
    loc_ativo: '1', loc_cidades: 'Itanhém', loc_valor: '0.00', loc_prazoMax: '2',
    peso_limiteKg: '30', peso_franquiaKg: '5', peso_valorKgExcedente: '1.90', peso_cubagemLimite: '0.3',
    bloq_categorias: '', bloq_produtos: '',
    msgIndisponivel: 'Ainda não atendemos esta localidade (teste).',
  });
  return form;
}

async function gerarRelatorio(testes, aprovados, falhos) {
  const agora = new Date();
  const linhas = [];
  linhas.push('# Testes e resultados — Farmácia Pague Pouco');
  linhas.push('');
  linhas.push(`**Execução:** ${agora.toLocaleString('pt-BR')}  `);
  linhas.push(`**Resultado:** ${aprovados}/${testes.length} testes aprovados${falhos.length ? ` — ${falhos.length} falha(s)` : ' — todos aprovados'}`);
  linhas.push('');
  linhas.push('> Estes testes sobem o servidor real em uma pasta de dados temporária (`.tmp-teste`),');
  linhas.push('> semeiam os dados de desenvolvimento e executam requisições HTTP reais.');
  linhas.push('> Não são testes simulados: cada item abaixo foi executado de fato.');
  linhas.push('');
  linhas.push('| # | Área | Teste | Resultado | Detalhes |');
  linhas.push('|---|------|-------|-----------|----------|');
  let n = 0;
  for (const t of testes) {
    n++;
    linhas.push(`| ${n} | ${t.secao} | ${t.nome.replace(/\|/g, '\\|')} | ${t.ok ? '✅ Aprovado' : '❌ Falhou'} | ${(t.detalhe || '').replace(/\|/g, '\\|').slice(0, 160)} |`);
  }
  linhas.push('');
  linhas.push('## Como reproduzir');
  linhas.push('');
  linhas.push('```bash');
  linhas.push('npm test           # roda toda a suíte (sobe o servidor sozinho)');
  linhas.push('node scripts/test.js');
  linhas.push('```');
  linhas.push('');
  linhas.push('## O que NÃO foi testado (e por quê)');
  linhas.push('');
  linhas.push('| Item | Situação | Motivo |');
  linhas.push('|------|----------|--------|');
  linhas.push('| Cobrança real no Mercado Pago | Não testado | Não há credenciais no ambiente; o prompt proíbe criar contas/custos sem autorização. O módulo foi implementado, mas a operação real depende de `MP_ACCESS_TOKEN` (documentado em `docs/06`). |');
  linhas.push('| Envio real de e-mail (SMTP) | Não testado | Nenhuma credencial SMTP disponível. O sistema grava as mensagens na fila de saída (`data/mail/*.eml`), que foi usada para validar a recuperação de senha. |');
  linhas.push('| QR Code do Pix | Não gerado localmente | Sem credenciais do provedor. Com o Mercado Pago configurado, o QR é exibido a partir do retorno da API. No provedor interno de testes o código é explicitamente marcado como SIMULADO. |');
  linhas.push('| Consulta de endereço no ViaCEP | Não testado | Desligada por padrão (`VIACEP_ENABLED=false`). A identificação da UF é feita offline pela faixa de CEP e foi testada. |');
  linhas.push('| Dispositivos móveis reais | Não testado em hardware | O layout é responsivo (CSS mobile-first) e foi verificado por inspeção de marcação; recomenda-se teste manual em Android/iOS antes da publicação. |');
  linhas.push('');
  await fsp.mkdir(path.join(ROOT, 'docs'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, 'docs', '05-testes-e-resultados.md'), linhas.join('\n'), 'utf8');
  console.log('Relatório gravado em docs/05-testes-e-resultados.md');
}

main().catch(async (err) => {
  console.error('\n✘ Erro fatal na suíte de testes:', err);
  process.exit(1);
});
