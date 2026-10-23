import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CloudStore } from '../src/cloudflare/store.js';

test('PITR consulta bookmarks sem devolve-los ao administrador',async()=>{
  const store=Object.create(CloudStore.prototype);
  let chamadas=0;
  store.storage={
    async getCurrentBookmark(){chamadas++;return 'PRIVATE_CURRENT_BOOKMARK';},
    async getBookmarkForTime(time){chamadas++;assert(Number.isFinite(time));return 'PRIVATE_EARLIER_BOOKMARK';},
  };
  const r=await store.verificarRecuperacaoPitr();
  assert.deepEqual(r,{disponivel:true,status:'BOOKMARKS_DE_24_HORAS_CONFIRMADOS'});
  assert.equal(chamadas,2);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|BOOKMARK$/);
});
test('PITR falha fechado quando API nao esta disponivel ou historico falha',async()=>{
  const store=Object.create(CloudStore.prototype);
  store.storage={};
  assert.deepEqual(await store.verificarRecuperacaoPitr(),{
    disponivel:false,status:'INDISPONIVEL_NESTE_AMBIENTE',
  });
  store.storage={getCurrentBookmark:async()=>{throw Error('PRIVATE_BOOKMARK');},
    getBookmarkForTime:async()=>''};
  assert.deepEqual(await store.verificarRecuperacaoPitr(),{
    disponivel:false,status:'NAO_CONFIRMADO',
  });
});
test('rota PITR exige permissao sistema e nunca aciona restauracao remota',()=>{
  const route=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const start=route.indexOf("app.get('/admin/api/sistema/recuperacao-pitr'");
  assert(start>=0);
  const block=route.slice(start,route.indexOf("app.post('/admin/api/sistema/backup'",start));
  assert.match(block,/guardApi\(req, res, 'sistema\.\*'\)/);
  assert.match(block,/Cache-Control', 'no-store'/);
  assert.match(block,/verificarRecuperacaoPitr\(\)/);
  assert.doesNotMatch(block,/onNextSessionRestoreBookmark|abort\(|exportData\(|fetch\(/);
  assert.match(block,/restauracaoRealValidada: false/);
});
