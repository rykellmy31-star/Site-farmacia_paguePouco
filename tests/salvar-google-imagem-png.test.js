import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  criarTicketGoogle,validarTicketGoogle,baixarFotoGoogleEscolhida,urlFotoGoogleSegura
} from '../src/lib/google-image-selection.js';
const ean='7891000100103',secret='segredo-longo-do-servidor';
const imagem={url:'https://cdn.fabricante.com.br/embalagem.png',
  pagina:'https://fabricante.com.br/produto/'+ean,titulo:'Foto produto'};
const credentials={ean,adminId:'admin-a',segredo:secret,agora:100000};
const ticket=()=>criarTicketGoogle(imagem,credentials);
const foto=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(80)]);
const resp=(status,bytes=foto,location=null)=>({
  status,ok:status===200,
  headers:{get:k=>k==='location'?location:k==='content-length'?String(bytes.length):null},
  arrayBuffer:async()=>bytes
});
test('token assinado vincula EAN e usuário e vence em 15 minutos',()=>{
 const t=ticket();
 assert.ok(t.length>50);
 assert.equal(validarTicketGoogle(t,credentials).url,imagem.url);
 assert.equal(validarTicketGoogle(t,{...credentials,ean:'7896006716112'}),null);
 assert.equal(validarTicketGoogle(t,{...credentials,adminId:'outro-admin'}),null);
 assert.equal(validarTicketGoogle(t,{...credentials,agora:100000+15*60*1000+1}),null);
 assert.equal(validarTicketGoogle(t.slice(0,-2)+'12',credentials),null);
 assert.doesNotMatch(t,/segredo-longo/);
});
test('bloqueia host interno, IP privado, credenciais, HTTP e porta customizada',()=>{
 for(const url of [
  'http://cdn.fabricante.com.br/produto.png',
  'https://127.0.0.1/a.jpg',
  'https://169.254.169.254/latest/meta-data/',
  'https://metadata.google.internal/a.jpg',
  'https://localhost/a.jpg',
  'https://site.local/a.jpg',
  'https://host.com:444/a.jpg',
  'https://usuario:senha@host.com/a.jpg',
  'https://[::1]/a.jpg',
 ])assert.equal(urlFotoGoogleSegura(url),'',url);
 assert.equal(urlFotoGoogleSegura('https://cdn.fabricante.com.br/a.jpg'),
   'https://cdn.fabricante.com.br/a.jpg');
 assert.equal(criarTicketGoogle({...imagem,url:'http://127.0.0.1/a.jpg'},credentials),'');
});
test('download usa URL assinada e valida bytes PNG sem usar miniatura',async()=>{
 const urls=[];
 const r=await baixarFotoGoogleEscolhida(imagem.url,{fetcher:async url=>{
  urls.push(url);return resp(200);
 }});
 assert.equal(r.ok,true);
 assert.equal(r.mime,'image/png');
 assert.deepEqual(urls,[imagem.url]);
});
test('não segue redirect para IP privado, HTML ou imagem muito grande',async()=>{
 const redirect=await baixarFotoGoogleEscolhida(imagem.url,{
   fetcher:async()=>resp(302,foto,'https://127.0.0.1/segredo.png')
 });
 assert.equal(redirect.ok,false);
 const html=await baixarFotoGoogleEscolhida(imagem.url,{
   fetcher:async()=>resp(200,Buffer.from('<html>erro</html>'))
 });
 assert.equal(html.ok,false);
 const grande=await baixarFotoGoogleEscolhida(imagem.url,{
   fetcher:async()=>({
    ok:true,status:200,headers:{get:key=>key==='content-length'?String(13*1024*1024):null},
    arrayBuffer:async()=>Buffer.alloc(1)
   })
 });
 assert.equal(grande.ok,false);
 assert.match(grande.motivo,/maior que 12 MB/);
});
test('salvamento selecionado mantém uma só imagem PNG e substitui somente com clique',()=>{
 const src=new URL('../',import.meta.url);
 const route=readFileSync(new URL('src/routes/admin.js',src),'utf8');
 const js=readFileSync(new URL('public/js/admin.js',src),'utf8');
 const view=readFileSync(new URL('src/views/admin/catalogo.js',src),'utf8');
 assert.match(route,/app\.get\('\/admin\/api\/produtos\/google-imagens\/arquivo'/);
 assert.match(route,/app\.post\('\/admin\/api\/produtos\/:id\/vincular-imagem-google'/);
 assert.match(route,/validarTicketGoogle/);
 assert.match(route,/m\.ext==='png'/);
 assert.match(route,/imagens:\[\{url,principal:true,ordem:1,legenda\}\]/);
 assert.match(js,/Salvar esta foto \(PNG\)/);
 assert.match(js,/enviarPNG\(ean,0,contextoBuscaImagemEAN\(\),proxy\)/);
 assert.match(js,/definirFotoGoogleFormulario/);
 assert.match(js,/galeria\?\.querySelectorAll\('\.item-midia\[data-tipo="image"\]'\)/);
 assert.match(view,/id="botaoGoogleImagensEAN"/);
 assert.doesNotMatch(route,/app\.post\('\/admin\/api\/produtos\/google-imagens\/lote'/);
});
