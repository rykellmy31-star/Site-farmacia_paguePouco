import test from 'node:test';
import assert from 'node:assert/strict';
import { carrosselBanners } from '../src/views/public.js';

const arte = '/uploads/2026/11/j_6PKKik1OGs.png';
const fundo = '/img/fundo-banner-vermelho.svg';
const quarta = {
  id: 'quarta-bebe', titulo: 'QUARTA DO BEBÊ 👶',
  imagem: arte, imagemMobile: fundo, link: '/categoria/fraldas',
  posicao: 'principal', ordem: 4, ativo: true, diaSemana: 'quarta',
};

test('Quarta do Bebê: placeholder vermelho no campo mobile não substitui arte real', () => {
  const html = carrosselBanners([quarta]);
  assert.match(html, /<img src="\/uploads\/2026\/11\/j_6PKKik1OGs\.png"/);
  assert.match(html, /alt="QUARTA DO BEBÊ 👶"/);
  assert.doesNotMatch(html, /<source media="\(max-width: 640px\)" srcset="\/img\/fundo-banner-vermelho\.svg"/);
  assert.doesNotMatch(html, /<source/);
});

test('imagem mobile personalizada continua tendo prioridade no celular', () => {
  const html = carrosselBanners([{ ...quarta, imagemMobile: '/uploads/2026/11/quarta-mobile.png' }]);
  assert.match(html, /<source media="\(max-width: 640px\)" srcset="\/uploads\/2026\/11\/quarta-mobile\.png"/);
  assert.match(html, /<img src="\/uploads\/2026\/11\/j_6PKKik1OGs\.png"/);
});

test('sem imagem mobile, mostrar arte principal para desktop e celular', () => {
  const html = carrosselBanners([{ ...quarta, imagemMobile: '' }]);
  assert.doesNotMatch(html, /<source/);
  assert.match(html, /<img src="\/uploads\/2026\/11\/j_6PKKik1OGs\.png"/);
});

test('banner intencionalmente com fundo padrão continua exibindo texto sobre ele', () => {
  const html = carrosselBanners([{
    ...quarta, imagem: fundo, imagemMobile: fundo,
    titulo: 'Ofertas', descricao: 'Promoção especial',
  }]);
  assert.match(html, /<source media="\(max-width: 640px\)" srcset="\/img\/fundo-banner-vermelho\.svg"/);
  assert.match(html, /banner-texto-sobreposto/);
  assert.match(html, /Promoção especial/);
});

test('corrigir somente o banner com imagem mobile de fundo padrão', () => {
  const html = carrosselBanners([
    {...quarta, titulo:'BLACK FARMA', imagemMobile:'', imagem:'/uploads/black.png'},
    {...quarta, titulo:'QUARTA DO BEBÊ'},
    {...quarta, titulo:'QUINTA DO ESMALTE', imagemMobile:'/uploads/esmalte-mobile.png'}
  ]);
  assert.equal((html.match(/<source/g) || []).length, 1);
  assert.equal((html.match(/<img src=/g) || []).length, 3);
  assert.match(html, /data-carrossel-ir="2"/);
});
