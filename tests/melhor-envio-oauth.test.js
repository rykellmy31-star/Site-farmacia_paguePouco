import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../src/config.js';
import {
  MELHOR_ENVIO_CALLBACK, iniciarOAuthMelhorEnvio, consumirEstadoOAuthMelhorEnvio,
  autorizarOAuthMelhorEnvio, estadoOAuthMelhorEnvio, tokenOAuthMelhorEnvio,
  desconectarOAuthMelhorEnvio,
} from '../src/lib/melhor-envio-oauth.js';

function mockDb() {
  const tables = new Map();
  return {collection(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    const table = tables.get(name);
    return {
      get(id) {return table.get(id) || null;},
      insert(doc) {table.set(doc.id, {...doc}); return doc;},
      update(id, patch) {if (!table.has(id)) return null;
        const next = {...table.get(id),...patch}; table.set(id,next); return next;},
      remove(id) {return table.delete(id);},
    };
  }};
}
const previous = {...config.melhorEnvio};
const setup = () => Object.assign(config.melhorEnvio, {
  token:'', contato:'paguepoucofarmacia@gmail.com', sandbox:false,
  clientId:'1234', clientSecret:'fake-client-secret-for-tests-only',
  credentialsKey:'uma-chave-de-teste-exclusiva-de-mais-de-32-caracteres',
});
const restore = () => Object.assign(config.melhorEnvio,previous);

test('rota fixa do domínio oficial, escopo mínimo e state de sessão de uso único',()=>{
  setup();
  try {
    const db=mockDb();
    const session={id:'admin-session-1'};
    db.collection('sessions').insert(session);
    const started=iniciarOAuthMelhorEnvio(db,session);
    assert.equal(started.ok,true);
    const url=new URL(started.url);
    assert.equal(url.origin,'https://melhorenvio.com.br');
    assert.equal(url.pathname,'/oauth/authorize');
    assert.equal(url.searchParams.get('scope'),'shipping-calculate');
    assert.equal(url.searchParams.get('redirect_uri'),MELHOR_ENVIO_CALLBACK);
    assert.equal(url.searchParams.get('client_id'),'1234');
    const state=url.searchParams.get('state');
    assert.equal(consumirEstadoOAuthMelhorEnvio(db,session,state),true);
    assert.equal(consumirEstadoOAuthMelhorEnvio(db,session,state),false,'state não pode ser usado novamente');
    assert.equal(consumirEstadoOAuthMelhorEnvio(db,session,'invalido'),false);
    assert.equal(iniciarOAuthMelhorEnvio(db,null).ok,false,'sem sessão administrativa falha');
  } finally {restore();}
});

test('troca código por token e armazena somente o cifrado AES-GCM',async()=>{
  setup();
  try {
    const db=mockDb();
    let chamadas=0;
    const fetcher=async (url,options)=>{
      chamadas++;
      assert.equal(url,'https://melhorenvio.com.br/oauth/token');
      assert.equal(options.method,'POST');
      const body=JSON.parse(options.body);
      assert.equal(body.grant_type,'authorization_code');
      assert.equal(body.redirect_uri,MELHOR_ENVIO_CALLBACK);
      assert.equal(body.code,'code-de-autorizacao');
      assert.equal(body.client_id,'1234');
      return {ok:true,json:async()=>({
        access_token:'token-provisório-com-mais-de-vinte-caracteres',
        refresh_token:'refresh-provisório-com-mais-de-vinte-caracteres',
        expires_in:2592000,
      })};
    };
    assert.equal((await autorizarOAuthMelhorEnvio(db,'code-de-autorizacao',{fetcher})).ok,true);
    assert.equal(chamadas,1);
    const doc=db.collection('shippingSecrets').get('melhor-envio-oauth');
    assert.equal(doc.versao,1);
    assert.ok(doc.cifra && doc.iv && doc.tag);
    assert.doesNotMatch(JSON.stringify(doc),/token-provisório|refresh-provisório/);
    assert.equal(estadoOAuthMelhorEnvio(db).conectado,true);
    assert.equal(await tokenOAuthMelhorEnvio(db,{fetcher}), 'token-provisório-com-mais-de-vinte-caracteres');
    assert.equal(chamadas,1,'token válido não precisa refresh');
    assert.equal(desconectarOAuthMelhorEnvio(db),true);
    assert.equal(estadoOAuthMelhorEnvio(db).conectado,false);
  } finally {restore();}
});

test('tokens próximos de expirar são renovados antes da cotação e permanecem cifrados',async()=>{
  setup();
  try {
    const db=mockDb();
    let count=0;
    const fetcher=async(url,options)=>{
      count++;
      const body=JSON.parse(options.body);
      assert.equal(url,'https://melhorenvio.com.br/oauth/token');
      if (count===1) {
        assert.equal(body.grant_type,'authorization_code');
        return {ok:true,json:async()=>({access_token:'expired-pretend-access-token-000',
          refresh_token:'first-refresh-token-with-sufficient-length',expires_in:5})};
      }
      assert.equal(body.grant_type,'refresh_token');
      assert.equal(body.refresh_token,'first-refresh-token-with-sufficient-length');
      return {ok:true,json:async()=>({access_token:'renewed-access-token-with-length-000',
        refresh_token:'new-refresh-token-with-sufficient-length',expires_in:2592000})};
    };
    assert.equal((await autorizarOAuthMelhorEnvio(db,'oauth-code',{fetcher})).ok,true);
    const token=await tokenOAuthMelhorEnvio(db,{fetcher});
    assert.equal(token,'renewed-access-token-with-length-000');
    assert.equal(await tokenOAuthMelhorEnvio(db,{fetcher}),token);
    assert.equal(count,2);
  } finally {restore();}
});

test('não autorizar sem chave, secret ou state, e não vazar em erro',async()=>{
  setup();
  try {
    const db=mockDb(), sess={id:'sess'};
    db.collection('sessions').insert(sess);
    config.melhorEnvio.credentialsKey='';
    assert.equal(iniciarOAuthMelhorEnvio(db,sess).ok,false);
    assert.equal(estadoOAuthMelhorEnvio(db).cofrePreparado,false);
    assert.equal(await tokenOAuthMelhorEnvio(db),'');
    config.melhorEnvio.credentialsKey=previous.credentialsKey || 'outra-chave-valida-de-pelo-menos-trinta-e-dois-caracteres';
    assert.equal((await autorizarOAuthMelhorEnvio(db,'',{fetcher:()=>{throw Error('never')}})).ok,false);
  } finally {restore();}
});

test('painel, callback, checkout e proteção do segredo estão ligados',()=>{
  const root=new URL('../',import.meta.url);
  const routes=readFileSync(new URL('src/routes/admin.js',root),'utf8');
  const view=readFileSync(new URL('src/views/admin/config.js',root),'utf8');
  const freight=readFileSync(new URL('src/lib/melhor-envio.js',root),'utf8');
  const checkout=readFileSync(new URL('src/routes/checkout.js',root),'utf8');
  const api=readFileSync(new URL('src/routes/api.js',root),'utf8');
  assert.match(routes,/app\.get\('\/admin\/melhor-envio\/callback'/);
  assert.match(routes,/consumirEstadoOAuthMelhorEnvio/);
  assert.match(routes,/guard\(req, res, 'fretes\.editar'\)/);
  assert.match(view,/href="\/admin\/melhor-envio\/conectar"/);
  assert.match(view,/MELHOR_ENVIO_CALLBACK/);
  assert.match(freight,/tokenOAuthMelhorEnvio\(params\.db/);
  assert.match(checkout,/resolverFreteIntegrado\(\{\s*db, config:/);
  assert.match(api,/calcularFreteIntegrado\(\{\s*db, config:/);
});
