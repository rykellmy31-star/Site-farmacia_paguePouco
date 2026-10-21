import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adicionarEndereco, editarEndereco, excluirEndereco, normalizarPrincipal,
} from '../src/lib/customer-addresses.js';

const base = () => [
  { id: 'a', logradouro: 'Rua A', padrao: true },
  { id: 'b', logradouro: 'Rua B', padrao: false },
];
const principais = arr => arr.filter(e => e.padrao).map(e => e.id);

test('endereço inicial é principal mesmo sem marcar checkbox', () => {
  const r = adicionarEndereco([], { id: 'a', logradouro: 'Rua A', padrao: false });
  assert.equal(r.ok, true);
  assert.deepEqual(principais(r.enderecos), ['a']);
});

test('endereço secundário não altera principal; escolha explícita transfere principal', () => {
  const original = base();
  const novo = adicionarEndereco(original, { id: 'c', logradouro: 'Rua C', padrao: false });
  assert.deepEqual(principais(novo.enderecos), ['a']);
  const escolhe = editarEndereco(novo.enderecos, 'c', { logradouro: 'Rua C nova', padrao: true });
  assert.equal(escolhe.ok, true);
  assert.deepEqual(principais(escolhe.enderecos), ['c']);
  assert.equal(original[0].padrao, true, 'helpers não modificam documentos originais');
});

test('edição de identificador desconhecido não desmarca os demais endereços', () => {
  const original = base();
  const invalido = editarEndereco(original, 'end-forjado', { padrao: true });
  assert.equal(invalido.ok, false);
  assert.deepEqual(original, base());
  assert.deepEqual(principais(original), ['a']);
});

test('desmarcar único principal não deixa conta sem endereço principal', () => {
  const r = editarEndereco(base(), 'a', { padrao: false, logradouro: 'Rua A editada' });
  assert.equal(r.ok, true);
  assert.deepEqual(principais(r.enderecos), ['a']);
  assert.equal(r.enderecos[0].logradouro, 'Rua A editada');
});

test('excluir principal escolhe automaticamente outro endereço; excluir último zera lista', () => {
  const a = excluirEndereco(base(), 'a');
  assert.equal(a.ok, true);
  assert.deepEqual(principais(a.enderecos), ['b']);
  const b = excluirEndereco(a.enderecos, 'b');
  assert.equal(b.ok, true);
  assert.deepEqual(b.enderecos, []);
});

test('excluir identificador inexistente falha sem mutação', () => {
  const original = base();
  assert.equal(excluirEndereco(original, 'forjado').ok, false);
  assert.deepEqual(original, base());
});

test('normalização de cadastro legado com múltiplos principais escolhe exatamente um', () => {
  const a = normalizarPrincipal([
    { id: 'a', padrao: true }, { id: 'b', padrao: true }, { id: 'c', padrao: false },
  ]);
  assert.deepEqual(principais(a), ['a']);
  const b = normalizarPrincipal([{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual(principais(b), ['a']);
});
