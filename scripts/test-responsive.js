/**
 * Teste visual de largura responsiva com Chromium via DevTools (CDP) sem deps.
 * Não acessa produção nem realiza pagamentos. Node 22 + Chrome headless.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { paginaPublica } from '../src/views/layout.js';
import { paginaAdmin } from '../src/views/admin/layout.js';
import { produtoPage } from '../src/views/public.js';
import { cartaoProduto } from '../src/views/partials.js';
import { telaVendedores } from '../src/views/admin/sellers.js';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/opt/google/chrome/chrome'].find(s => s && fs.existsSync(s));
assert(chrome, 'Chrome/Chromium ausente; instalar para testar responsividade real.');

const settings = { empresa: {nomeFantasia:'Farmácia Pague Pouco'},
  tema: {logoUrl:'/img/logo-pague-pouco.png',logoAltura:58}, seo:{}, whatsapp:{}, cookies:{} };
const db = {collection:()=>({all:()=>[]})};
const product = { id:'produto-cesta-teste', slug:'produto-cesta-teste',
  nome:'Absorvente noturno com abas — 24 unidades', ativo:true,
  marca:'Higiene Total', imagens:[], precoCentavos:1990,
  precoPromocionalCentavos:190, estoque:{quantidade:5,reservado:0},
  sanitario:{classificacao:'nao_aplicavel'}, descricao:'Produto de teste visual.' };
const cards = Array.from({length:8}, () => cartaoProduto(product)).join('');
const conteudo = '<div class="container"><h1>Buscar produtos</h1><p>36 produtos encontrados</p>' +
  '<form class="filtros"><div class="linha centro entre" style="flex-wrap:wrap;gap:10px">' +
  '<div class="linha centro ordenacao-campo" style="gap:8px">' +
  '<label class="rotulo mb-0">Ordenar por</label>' +
  '<select class="entrada" style="width:auto;min-width:170px"><option>Mais relevantes</option></select>' +
  '</div></div></form><div class="vitrine">'+cards+'</div>' +
  '<div class="checkout-grade"><div class="cartao"><h3>' +
  '<svg viewBox="0 0 24 24"><path d="M4 10V4h16v16H4z"/></svg> Como você quer pagar?</h3></div>' +
  '<aside class="resumo-pedido">Resumo do pedido</aside></div></div>';
const storefront = paginaPublica({db,settings,req:{pathname:'/busca'},arvore:[
  {id:'1',slug:'medicamentos',nome:'Medicamentos isentos de prescrição',filhas:[]},
  {id:'2',slug:'higiene',nome:'Higiene pessoal',filhas:[]}
],termoBusca:'paracetamol',cartCount:1,csrf:'teste'}, {titulo:'Busca',conteudo});
const productDetail = produtoPage({db,settings,req:{pathname:'/produto/produto-cesta-teste'},
  arvore:[],cartCount:1,csrf:'teste'}, {produto:product,categoria:null,relacionados:[],
  configLoja:{}});
const linhas = ('<tr><td>Pedido exemplo</td><td>Produto com descrição completa</td>' +
  '<td>R$ 19,90</td><td>Em análise</td></tr>').repeat(8);
const adminPage = paginaAdmin({db,settings,req:{query:new URLSearchParams()},
  adminUser:{id:'1',role:'super_admin',nome:'Admin'},csrf:'teste'},
{titulo:'Pedidos',ativo:'pedidos',conteudo:'<h1>Pedidos</h1><div class="painel"><div class="corpo">' +
  '<div class="tabela-rolagem"><table class="tabela-admin"><thead><tr><th>Pedido</th>' +
  '<th>Descrição</th><th>Total</th><th>Estado</th></tr></thead><tbody>' + linhas +
  '</tbody></table></div></div></div>'});

const sellerAdmin = telaVendedores({
  db, settings, req:{query:new URLSearchParams()},csrf:'teste',
  adminUser:{id:'1',role:'super_admin',nome:'Admin'},
  permissoes:{podeEditarVendedores:true},
}, {vendedores:[{id:'v1',nome:'Vendedor de Teste',codigoInova:'00125',ativo:true}],
  metricas:new Map([['v1',{pedidos:1,totalCentavos:1990}]])});

const servidor = http.createServer(async(req,res)=>{
  const rota=new URL(req.url,'http://localhost').pathname;
  if(rota==='/styles.css'){
    res.writeHead(200,{'Content-Type':'text/css'});
    res.end(await fsp.readFile(path.join(raiz,'public/styles.css')));return;
  }
  if(rota.startsWith('/img/')){
    const nome=rota.slice(5);
    if(!['logo-pague-pouco.png','produto-sem-foto.svg'].includes(nome)){
      res.writeHead(404);res.end();return;
    }
    res.writeHead(200,{'Content-Type':nome.endsWith('.svg')?'image/svg+xml':'image/png'});
    res.end(await fsp.readFile(path.join(raiz,'public/img',nome)));return;
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(rota==='/admin'?adminPage:rota==='/produto-teste'?productDetail:
    rota==='/vendedores-teste'?sellerAdmin:storefront);
});

const expression='(() => {' +
  'const get=s=>document.querySelector(s);' +
  'const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};' +
  'const lista=get(".sugestoes");' +
  'if(lista){lista.innerHTML="<a href=/busca><span>Ver todos os resultados para medicamentos</span></a>";lista.classList.add("visivel");}' +
  'const visible=e=>!!e&&getComputedStyle(e).display!=="none";' +
  'return JSON.stringify({ready:document.readyState,window:innerWidth,client:document.documentElement.clientWidth,' +
  'scroll:document.documentElement.scrollWidth,search:rect(get(".busca")),suggestion:rect(lista),' +
  'mobileNav:visible(get(".menu-mobile")),desktopNav:visible(get(".menu-departamentos")),' +
  'sort:rect(get(".ordenacao-campo select")),icon:rect(get(".cartao h3 svg")),' +
  'table:rect(get(".tabela-rolagem")),sellerForm:rect(get("#vendedorCodigo")),' +
  'buy:rect(get(".compra-produto .botao-adicionar-cesta")),' +
  'buyIcon:rect(get(".compra-produto .icone-cesta svg")),catalogBuy:rect(get(".produto .acoes .botao-adicionar-cesta")),' +
  'catalogIcon:rect(get(".produto .acoes .icone-cesta svg"))});})()';

const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'pague-pouco-cdp-'));
let proc, socket;
try{
  await new Promise(resolve=>servidor.listen(0,'127.0.0.1',resolve));
  proc=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],
    {stdio:'ignore'});
  let port;
  for(let i=0;i<120;i++){
    try {port=Number((await fsp.readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}
    catch{await delay(100);}
  }
  assert(port,'Chrome não iniciou DevTools');
  const lista=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=lista.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
  assert(page,'Não foi possível obter uma aba Chromium');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',reject,{once:true});
  });
  let id=0; const pending=new Map();
  socket.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(!pending.has(msg.id))return;
    const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);
    if(msg.error)reject(Error(JSON.stringify(msg.error)));else resolve(msg.result);
  });
  const cd=(method,params={})=>new Promise((resolve,reject)=>{
    const seq=++id;pending.set(seq,{resolve,reject});
    socket.send(JSON.stringify({id:seq,method,params}));
  });
  await cd('Page.enable');await cd('Runtime.enable');
  const host='http://127.0.0.1:'+servidor.address().port;
  for(const area of ['publica','produto','admin','vendedores']){
    for(const width of [320,375,390,430,768,1024,1440]){
      await cd('Emulation.setDeviceMetricsOverride',{
        width,height:880,deviceScaleFactor:1,mobile:width<768});
      await cd('Page.navigate',{url:host+(area==='admin'?'/admin':area==='produto'?'/produto-teste':
        area==='vendedores'?'/vendedores-teste':'/')});
      let value;
      for(let k=0;k<40;k++){
        await delay(80);
        const result=await cd('Runtime.evaluate',{expression,returnByValue:true});
        if(result.result?.value){
          value=JSON.parse(result.result.value);
          if(value.ready==='complete')break;
        }
      }
      const label=area+' '+width+'px';
      assert(value&&value.ready==='complete',label+': não carregou');
      assert(value.scroll<=value.client+2,label+': overflow horizontal '+JSON.stringify(value));
      if(area==='publica'){
        assert(value.search&&value.suggestion,label+': faltam componentes');
        assert(value.catalogBuy&&value.catalogIcon,label+': botão dos cartões ausente');
        assert(value.catalogIcon.width>=15&&value.catalogIcon.width<=19,
          label+': ícone do catálogo ficou gigante '+JSON.stringify(value));
        if(width>=768)assert(value.catalogBuy.width<=220,
          label+': botão de catálogo muito largo '+JSON.stringify(value));
        assert(value.suggestion.width>=value.search.width-2,label+': sugestão estreita');
        assert(value.icon&&value.icon.width<=26,label+': SVG de pagamento gigante');
        if(width<768){
          assert(value.search.width>=width-30,label+': busca comprimida '+JSON.stringify(value));
          assert(value.mobileNav&&!value.desktopNav,label+': navegação mobile incorreta');
          assert(value.sort&&value.sort.width>=width-90&&value.sort.left>=0&&value.sort.right<=value.client+2,
            label+': ordenação cortada '+JSON.stringify(value));
        }else{
          assert(!value.mobileNav&&value.desktopNav,label+': navegação desktop incorreta');
          assert(value.search.width>=150,label+': busca estreita no desktop');
        }
      }else if(area==='produto'){
        assert(value.buy&&value.buyIcon,label+': CTA do produto ausente');
        assert(value.buyIcon.width>=15&&value.buyIcon.width<=19&&value.buyIcon.height<=19,
          label+': carrinho gigante '+JSON.stringify(value));
        if(width>=768) {
          assert(value.buy.width<220,label+': botão de desktop ocupa largura excessiva '+JSON.stringify(value));
        } else {
          // Mobile mantém o botão largo para facilitar o toque, sem recorte.
          assert(value.buy.width<=value.client+2 && value.buy.left>=0,
            label+': botão mobile ultrapassa a tela '+JSON.stringify(value));
        }
      }else if(area==='vendedores'){
        assert(value.table&&value.table.width>100,label+': tabela de vendedores indisponível');
        assert(value.sellerForm&&value.sellerForm.width>=90&&value.sellerForm.left>=0&&
          value.sellerForm.right<=value.client+2,label+': formulário vendedor cortado '+JSON.stringify(value));
      }else{
        assert(value.table&&value.table.width>100,label+': tabela administrativa indisponível');
      }
      console.log('✓ '+label+' sem corte horizontal');
    }
  }
  console.log('LAYOUT RESPONSIVO: 28/28 viewports aprovadas — catálogo, produto, painel e vendedores');
}finally{
  try{socket?.close();}catch{}
  if(proc)proc.kill('SIGKILL');
  await new Promise(resolve=>servidor.close(resolve));
  await fsp.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
