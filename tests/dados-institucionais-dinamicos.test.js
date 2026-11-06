import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preencherDadosPagina, textoInstitucionalDinamico, campoCadastrado } from '../src/lib/dados-institucionais.js';
import { paginaConteudo } from '../src/views/public.js';
import { paginaPublica } from '../src/views/layout.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';

const paginas = JSON.parse(readFileSync(new URL('../data/db/pages.json', import.meta.url), 'utf8'));
const achar = slug => {
  const pagina = paginas.find(p => p.slug === slug);
  assert.ok(pagina, 'página ' + slug + ' deve existir');
  return pagina;
};
const empresa = {
  nomeFantasia: 'Farmácia Exemplo Atualizada',
  razaoSocial: 'Exemplo Farma LTDA',
  cnpj: '12.345.678/0001-90',
  telefone: '(73) 98765-4321',
  email: 'contato@farmacia.exemplo',
  farmaceuticoResponsavel: 'Dra. Maria Silva',
  crf: '12345/BA',
  autorizacaoSanitaria: 'AFE 123456',
  horarioAtendimento: 'Segunda a sábado, das 07h às 19h.',
  endereco: { logradouro:'Avenida Testes', numero:'214', bairro:'Centro', cidade:'Itanhém', uf:'BA', cep:'45970-000' },
};
const ctx = e => ({
  db: { collection() { return { all: () => [], get: () => null }; } },
  settings: { ...DEFAULT_SETTINGS(), empresa: e },
  arvore: [], req: { pathname: '/', query: new URLSearchParams() },
});

test('todas as páginas institucionais substituem dados cadastrais da empresa salva', () => {
  const esperados = new Map([
    ['nossas-lojas',['Avenida Testes, 214','Itanhém/BA — CEP 45970-000','07h às 19h','(73) 98765-4321']],
    ['atendimento',['(73) 98765-4321','contato@farmacia.exemplo','07h às 19h']],
    ['fale-conosco',['contato@farmacia.exemplo','(73) 98765-4321']],
    ['politica-de-privacidade',['contato@farmacia.exemplo','(73) 98765-4321']],
    ['atendimento-farmaceutico',['Dra. Maria Silva','CRF/UF 12345/BA']],
    ['informacoes-sanitarias',['Exemplo Farma LTDA','12.345.678/0001-90','AFE 123456','Dra. Maria Silva','CRF/UF 12345/BA']],
  ]);
  for (const [slug, partes] of esperados) {
    const html = preencherDadosPagina(achar(slug).conteudo, slug, empresa);
    for (const parte of partes) assert.ok(html.includes(parte), slug + ': faltando ' + parte);
    assert.doesNotMatch(html, /\[PREENCHER\]/, slug + ' deixou campos antigos visíveis');
  }
});

test('mudança em Configurações gerais aparece na próxima renderização sem alterar a página salva', () => {
  const pagina = achar('atendimento-farmaceutico');
  const original = pagina.conteudo;
  const antes = paginaConteudo(ctx(empresa), { pagina });
  const novoFarmaceutico = { ...empresa, farmaceuticoResponsavel:'Dr. João Pereira', crf:'CRF/BA 98765' };
  const depois = paginaConteudo(ctx(novoFarmaceutico), { pagina });
  assert.match(antes, /Dra\. Maria Silva/);
  assert.match(depois, /Dr\. João Pereira/);
  assert.match(depois, /CRF\/BA 98765/);
  assert.doesNotMatch(depois, /Dra\. Maria Silva/);
  assert.equal(pagina.conteudo, original, 'não altera HTML original nem banco');
});

test('rodapé exibe dados reais e nunca repete [PREENCHER] em textos antigos', () => {
  const settings = DEFAULT_SETTINGS();
  settings.empresa = empresa;
  const html = paginaPublica(ctx(empresa), { conteudo:'Página pública' });
  assert.match(html, /Exemplo Farma LTDA/);
  assert.match(html, /CNPJ 12\.345\.678\/0001-90/);
  assert.match(html, /Dra\. Maria Silva/);
  assert.match(html, /Avenida Testes, 214/);
  assert.match(html, /CRF\/UF 12345\/BA/);
  assert.doesNotMatch(html, /\[PREENCHER\]/);
  const texto = textoInstitucionalDinamico(DEFAULT_SETTINGS().rodape.textoInstitucional, empresa);
  assert.match(texto, /Farmácia Exemplo Atualizada — CNPJ/);
});

test('dados não cadastrados não são inventados e revisão legal não é apagada', () => {
  assert.equal(campoCadastrado('[PREENCHER] Nome'), '');
  const vazio = { ...empresa, farmaceuticoResponsavel:'[PREENCHER]', crf:'[PREENCHER]' };
  const html = preencherDadosPagina(achar('atendimento-farmaceutico').conteudo, 'atendimento-farmaceutico', vazio);
  assert.match(html, /não informado|Não informado/);
  assert.doesNotMatch(html, /\[PREENCHER\]/);
  assert.match(html, /\[REVISAR\]/, 'aviso de validação farmacêutica deve permanecer');
});

test('suporta marcadores de novas páginas e faz escape de dados perigosos', () => {
  const html = preencherDadosPagina('<p>{{empresa.telefone}} — {{empresa.email}}</p>',
    'nova-pagina', { ...empresa, telefone:'<script>alert(1)</script>', email:'ok@example.com' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /ok@example.com/);
});
