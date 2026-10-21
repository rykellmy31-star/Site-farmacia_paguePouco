import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import {
  addItem, setItemQuantity, normalizeCart, getCart, vincularCarrinhoAoCliente,
} from '../src/lib/cart.js';

class DB {
  constructor() { this.cols = new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection({ _commit() {} }, name));
    return this.cols.get(name);
  }
}
function iniciar() {
  const db = new DB();
  db.collection('products').insert({
    id: 'p', nome: 'Sabonete', slug: 'sabonete',
    ativo: true, precoCentavos: 1990, estoque: { quantidade: 10, reservado: 0 },
    sanitario: { classificacao: 'nao_aplicavel' },
  });
  db.collection('carts').insert({ id: 'c', clienteId: 'clienteA', itens: [],
    cupom: null, frete: null });
  return db;
}

test('adicionar produto recusa frações, quantidades negativas e valores não finitos', () => {
  const db = iniciar(), cart = db.collection('carts').get('c');
  for (const value of [1.5, -2, 0, 100, NaN, Infinity, 'invalid', '2.5']) {
    const r = addItem(db, cart, 'p', value);
    assert.equal(r.ok, false, 'quantidade ' + String(value));
    assert.equal(db.collection('carts').get('c').itens.length, 0);
  }
  assert.equal(addItem(db, cart, 'p', 2).ok, true);
  assert.equal(db.collection('carts').get('c').itens[0].quantidade, 2);
});

test('alterar quantidade rejeita frações/negativos, e zero remove item', () => {
  const db = iniciar();
  assert.equal(addItem(db, db.collection('carts').get('c'), 'p', 2).ok, true);
  for (const value of [-1, 2.1, NaN, Infinity, '', null, undefined, 100]) {
    const r = setItemQuantity(db, db.collection('carts').get('c'), 'p', value);
    assert.equal(r.ok, false, 'valor ' + String(value));
    assert.equal(db.collection('carts').get('c').itens[0].quantidade, 2);
  }
  assert.equal(setItemQuantity(db, db.collection('carts').get('c'), 'p', 0).ok, true);
  assert.equal(db.collection('carts').get('c').itens.length, 0);
});

test('normalização remove esgotados da cesta, nunca força quantidade 1 sem estoque', () => {
  const db = iniciar();
  assert.equal(addItem(db, db.collection('carts').get('c'), 'p', 2).ok, true);
  db.collection('products').update('p', { estoque: { quantidade: 2, reservado: 2 } });
  const result = normalizeCart(db, db.collection('carts').get('c'));
  assert.equal(result.cart.itens.length, 0);
  assert.ok(result.avisos.some(a => a.tipo === 'bloqueado' || a.tipo === 'estoque'));
});

test('cookie de outro cliente não reassocia dados pessoais da cesta', () => {
  const db = iniciar();
  assert.equal(addItem(db, db.collection('carts').get('c'), 'p', 2).ok, true);
  db.collection('carts').update('c', { frete: { endereco: { nome: 'Cliente A', rua: 'Privada' } } });
  const req = { cookies: { pp_cart: 'c' }, user: { id: 'clienteB' } };
  const safe = getCart(db, req);
  assert.notEqual(safe.id, 'c');
  assert.equal(req.setCartCookie, safe.id);
  assert.equal(safe.clienteId, 'clienteB');
  assert.deepEqual(safe.itens, []);
  assert.equal(safe.frete, null);
  assert.equal(db.collection('carts').get('c').clienteId, 'clienteA');
  assert.equal(db.collection('carts').get('c').itens[0].quantidade, 2);
  assert.equal(db.collection('carts').get('c').frete.endereco.rua, 'Privada');
});

test('cesta anônima pode ser herdada após cadastro sem perda de produtos', () => {
  const db = iniciar();
  db.collection('carts').update('c', { clienteId: null });
  assert.equal(addItem(db, db.collection('carts').get('c'), 'p', 2).ok, true);
  assert.equal(vincularCarrinhoAoCliente(db, 'c', 'clienteB'), 'c');
  assert.equal(db.collection('carts').get('c').clienteId, 'clienteB');
  assert.equal(db.collection('carts').get('c').itens[0].quantidade, 2);
});
