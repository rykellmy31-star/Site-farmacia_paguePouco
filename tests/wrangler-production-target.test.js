import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const text = readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
const config = JSON.parse(text);
test('Wrangler aponta para o Worker já existente, nunca cria nome paralelo',()=>{
 assert.equal(config.name,'site-farmacia-paguepouco');
 assert.equal(config.main,'src/cloudflare/worker.js');
});
test('binding e classe do banco persistente não foram alterados',()=>{
 assert.deepEqual(config.durable_objects.bindings,[{name:'LOJA',class_name:'LojaDurableObject'}]);
 assert.deepEqual(config.migrations,[{tag:'v1',new_sqlite_classes:['LojaDurableObject']}]);
 assert.equal(config.keep_vars,true);
});
test('não adiciona segredo em texto simples ao repositório',()=>{
 assert.equal(config.vars,undefined);
 assert.equal(config.observability,undefined);
});
