import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parametros, validarArquivosBackup } from '../scripts/validate-cloudflare-backup.mjs';
import { ensaiarRestauracaoCloudflare } from '../src/lib/restore-rehearsal.js';

const manifestVazio={format:'pague-pouco-midia-manifest-v1',total:0,bytes:0,files:[]};
const snapshot=()=>({format:'pague-pouco-sqlite-export-v1',collections:{
  orders:[{id:'pedido-1',codigo:'PPTESTE',statusFinanceiro:'aprovado'}],
  inovaSecrets:[{id:'inovafarma',cifra:'SEGREDO_NAO_RESTAURAR'}],
  paymentSecrets:[{id:'mercadopago',cifra:'OUTRO_SEGREDO'}],
  sessions:[{id:'sessao-1',token:'TOKEN'}],
}});

test('CLI valida os arquivos exportados em isolamento sem abrir o Worker remoto',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pp-verify-cli-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=path.join(dir,'backup.json'),m=path.join(dir,'midias.json');
 await fs.writeFile(s,JSON.stringify(snapshot()));
 await fs.writeFile(m,JSON.stringify(manifestVazio));
 const opts=parametros(['--snapshot',s,'--manifest',m]);
 assert.equal(opts.mediaDir,undefined);
 const r=await validarArquivosBackup(opts);
 assert.equal(r.ok,true);
 assert.equal(r.isolado,true);
 assert.equal(r.producaoAlterada,false);
 assert.equal(r.documentosRestaurados,1);
 assert.equal(r.transitoriosDescartados,3);
 assert.equal(r.arquivos,0);
});
test('cofre InovaFarma nunca é reconstituído mesmo se incluído em backup malformado',async()=>{
 const r=await ensaiarRestauracaoCloudflare({
   snapshot:snapshot(),manifest:manifestVazio,
 });
 assert.equal(r.colecoes,1);
 assert.equal(r.documentosRestaurados,1);
 assert.equal(r.transitoriosDescartados,3);
});
test('CLI falha fechado sem manifesto, snapshot ou JSON válido',async t=>{
 assert.throws(()=>parametros(['--snapshot','copia.json']),/snapshot e o manifesto/);
 assert.throws(()=>parametros(['--snapshot','x','--manifest','y','--script','z']),/Uso:/);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pp-verify-broken-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=path.join(dir,'snapshot.json'),m=path.join(dir,'manifest.json');
 await fs.writeFile(s,'{{invalid json');
 await fs.writeFile(m,JSON.stringify(manifestVazio));
 await assert.rejects(validarArquivosBackup({snapshotFile:s,manifestFile:m}));
});
test('hash das mídias divergente impede considerar backup válido',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pp-verify-midia-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=path.join(dir,'backup.json'),m=path.join(dir,'manifest.json'),med=path.join(dir,'midias');
 const local='2026/10/arquivo.png';
 const data=Buffer.from('conteudo original');
 await fs.mkdir(path.join(med,'2026','10'),{recursive:true});
 await fs.writeFile(path.join(med,...local.split('/')),Buffer.from('conteudo alterado'));
 await fs.writeFile(s,JSON.stringify(snapshot()));
 await fs.writeFile(m,JSON.stringify({format:'pague-pouco-midia-manifest-v1',
   total:1,bytes:data.length,files:[{
    caminho:local,chave:Buffer.from(local).toString('base64url'),tamanho:data.length,
    sha256:crypto.createHash('sha256').update(data).digest('hex'),
   }],
 }));
 await assert.rejects(validarArquivosBackup({snapshotFile:s,manifestFile:m,mediaDir:med}),
   /arquivo alterado/);
});
