import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectFileType, isAvif, saveUpload, UploadError } from '../src/lib/uploads.js';
import { config } from '../src/config.js';
import { MIME } from '../src/lib/http.js';
import { cartaoProduto } from '../src/views/partials.js';
import { origemImagemPermitida } from '../src/lib/ean-image-download.js';

const avif = Buffer.from('AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAJwAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAL21kYXQSAAoIGAA2iAhoNCAyGRiHh4YhhhhhhpAAAABIVM2GHJT7eFxAauA=', 'base64');

test('identifica AVIF verdadeiro pelo contêiner ISO-BMFF, não pela extensão', () => {
  assert.equal(isAvif(avif), true);
  assert.equal(detectFileType(avif)?.mime, 'image/avif');
  assert.equal(detectFileType(avif)?.ext, 'avif');
  const compatible = Buffer.alloc(24);
  compatible.writeUInt32BE(24, 0);
  compatible.write('ftyp', 4);
  compatible.write('mif1', 8);
  compatible.write('avif', 16);
  assert.equal(isAvif(compatible), true, 'marca AVIF compatível também é aceita');
  const mp4 = Buffer.from(compatible);
  mp4.write('isom', 8);
  mp4.write('mp41', 16);
  assert.equal(isAvif(mp4), false, 'não aceitar MP4 como foto');
  assert.equal(isAvif(Buffer.from('arquivo.avif')), false, 'não confiar no nome do arquivo');
  assert.equal(isAvif(avif.subarray(0, 6)), false, 'recusar arquivo truncado');
});

test('upload original AVIF persiste com MIME e URL corretos na Cloudflare', async () => {
  const oldCloud = config.isCloudflare;
  const oldOptimize = config.uploads.imageOptimize;
  const gravados = [];
  const registros = [];
  config.isCloudflare = true;
  config.uploads.imageOptimize = false;
  const db = {
    putFile: (caminho, bytes, mime) => gravados.push({ caminho, bytes, mime }),
    collection: () => ({ insert: item => { registros.push(item); return item; } }),
  };
  try {
    const result = await saveUpload(db, { filename:'produto.avif', contentType:'application/octet-stream', data: avif }, { kind:'image' });
    assert.equal(result.tipo, 'image');
    assert.equal(result.ext, 'avif');
    assert.equal(result.mime, 'image/avif');
    assert.match(result.url, /^\/uploads\/\d{4}\/\d{2}\/[A-Za-z0-9_-]+\.avif$/);
    assert.equal(gravados[0].mime, 'image/avif');
    assert.deepEqual(gravados[0].bytes, avif);
    assert.equal(registros[0].id, result.id);
    await assert.rejects(saveUpload(db, {filename:'video.avif', contentType:'image/avif',
      data: Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex') }, {kind:'image'}),
    err => err instanceof UploadError && err.status === 400);
  } finally {
    config.isCloudflare = oldCloud;
    config.uploads.imageOptimize = oldOptimize;
  }
});

test('cliente pode ver AVIF em cards e o painel oferece seleção do formato', () => {
  assert.equal(MIME['.avif'], 'image/avif');
  const html = cartaoProduto({
    id:'item-avif', slug:'item-avif', nome:'Produto com foto AVIF', ativo:true,
    precoCentavos:1290, imagens:[{url:'/uploads/2026/11/foto.avif',principal:true}],
    estoque:{quantidade:3,reservado:0},sanitario:{classificacao:'nao_aplicavel'},
  });
  assert.match(html, /<img src="\/uploads\/2026\/11\/foto\.avif"/);
  const view = readFileSync(new URL('../src/views/admin/catalogo.js', import.meta.url), 'utf8');
  assert.match(view, /Imagens \(JPG, PNG, WEBP, AVIF\) até 8 MB/);
  assert.match(view, /id="inputUpload"[^>]*accept="[^"]*image\/avif/);
  assert.match(view, /Formatos aceitos: JPG, PNG, WEBP, AVIF/);
  assert.equal(origemImagemPermitida('https://images.openbeautyfacts.org/images/products/123/front_pt.avif'), true);
  assert.equal(origemImagemPermitida('https://desconhecido.example/photo.avif'), false);
});
