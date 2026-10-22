import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarLogsBuild, validarUuidBuild } from '../src/lib/cloudflare-build-diagnostics.js';

test('aceita somente UUID, nunca URLs nem caminhos arbitrarios', () => {
  assert.equal(validarUuidBuild('a76d5850-e225-43af-85c6-e7812fe5f45d'), true);
  for (const valor of ['', '../tokens', 'https://example.com', 'a76d5850']) {
    assert.equal(validarUuidBuild(valor), false);
  }
});
test('classifica o nome de Worker incorreto sem copiar segredo', () => {
  const segredo = 'SEGREDO_PRIVADO_NAO_PUBLICAR';
  const resultado = analisarLogsBuild([[12345, 'The name in your Wrangler configuration file (farmacia-pague-pouco) must match the name of your Worker. ' + segredo]]);
  assert.equal(resultado.categoria, 'NOME_WORKER_DIVERGENTE');
  assert.ok(!JSON.stringify(resultado).includes(segredo));
});
test('classifica entrypoint, token invalido e dependencias', () => {
  assert.equal(analisarLogsBuild([[1, 'Missing entry-point: a main entry-point is required']]).categoria, 'ENTRYPOINT_AUSENTE');
  assert.equal(analisarLogsBuild([[1, 'The build token selected for this build has been deleted or rolled']]).categoria, 'TOKEN_DE_BUILD_INVALIDO');
  assert.equal(analisarLogsBuild([[1, 'Cannot find module foo']]).categoria, 'DEPENDENCIA_OU_MODULO_AUSENTE');
});
test('nao imprime texto bruto nem quando categoria e desconhecida', () => {
  assert.deepEqual(analisarLogsBuild([[1, 'senha privada de cliente: 123456789']]), {
    categoria: 'CAUSA_NAO_CLASSIFICADA',
    proximo_passo: 'Abrir detalhes do build no painel Cloudflare autenticado.',
  });
  assert.equal(analisarLogsBuild('invalido').categoria, 'FORMATO_INESPERADO');
});
