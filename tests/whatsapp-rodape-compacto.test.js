import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paginaPublica } from '../src/views/layout.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';

const settings = DEFAULT_SETTINGS();
settings.whatsapp.ativo = true;
settings.whatsapp.numero = '5573999999999';
const db = { collection() { return { all: () => [], get: () => null }; } };
const ctx = { settings, db, arvore: [], req: { pathname: '/' }, csrf: 'teste' };

test('rodapé mostra botão compacto Falar no WhatsApp, com ícone e link preservado', () => {
  const html = paginaPublica(ctx, { conteudo: 'Home' });
  assert.match(html, /<a class="rodape-whatsapp-link" href="https:\/\/wa\.me\/5573999999999\?text=/);
  assert.match(html, /aria-label="Falar no WhatsApp"/);
  assert.match(html, /<span class="rodape-whatsapp-icone" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span><span>Falar no WhatsApp<\/span>/);
  assert.doesNotMatch(html, /WhatsApp \(dúvidas\)/);
  assert.match(html, /class="whatsapp-flutuante/);
});

test('se WhatsApp estiver desativado, não mostrar contato no rodapé', () => {
  const offline = { ...ctx, settings: { ...settings, whatsapp: { ...settings.whatsapp, ativo: false } } };
  const html = paginaPublica(offline, { conteudo: 'Home' });
  assert.doesNotMatch(html, /class="rodape-whatsapp-link"/);
});

test('ícone do rodapé tem largura e altura de 20px e botão cabe no celular', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.rodape \.rodape-whatsapp-icone svg\s*\{[^}]*width: 20px !important;[^}]*height: 20px !important;/);
  assert.match(css, /\.rodape \.rodape-whatsapp-link\s*\{[^}]*max-width: 100%/);
  assert.match(css, /@media\(max-width: 640px\)\s*\{\s*\.rodape \.rodape-whatsapp-link/);
  const html = paginaPublica(ctx, { conteudo: 'Home' });
  assert.match(html, /styles\.css\?v=[a-z0-9-]+/i);
});


test('botão flutuante mantém verde e texto branco mesmo com CSS global vermelho',()=>{
  const html=paginaPublica(ctx,{conteudo:'Home'});
  assert.match(html,/class="botao-whatsapp whatsapp-pulso-suave"/);
  assert.match(html,/--whatsapp-botao-fundo:#25d366;--whatsapp-botao-texto:#ffffff/);
  assert.match(html,/aria-label="Tirar dúvidas pelo WhatsApp" data-whatsapp-link/);
  assert.match(html,/https:\/\/wa\.me\/5573999999999\?text=/);
  const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(css,/body \.whatsapp-flutuante \.botao-whatsapp/);
  assert.match(css,/background: var\(--whatsapp-botao-fundo, #25d366\) !important/);
  assert.match(css,/color: var\(--whatsapp-botao-texto, #ffffff\) !important/);
  assert.match(css,/@keyframes whatsapp-respirar-suave/);
  assert.match(css,/scale\(1\.02\)/);
  assert.match(css,/3\.2s ease-in-out infinite/);
  assert.match(css,/prefers-reduced-motion: reduce/);
});

test('cores e pulsação são configuráveis, sem permitir injeção de estilo',()=>{
  const custom={...settings,whatsapp:{...settings.whatsapp,botaoCorFundo:'#076a35',
    botaoCorTexto:'#fefefe',pulsacaoSuave:false, textoBotao:'Atendimento'}};
  const html=paginaPublica({...ctx,settings:custom},{conteudo:'Home'});
  assert.match(html,/class="botao-whatsapp" href=/);
  assert.doesNotMatch(html,/class="botao-whatsapp whatsapp-pulso-suave"/);
  assert.match(html,/--whatsapp-botao-fundo:#076a35;--whatsapp-botao-texto:#fefefe/);
  assert.match(html,/Atendimento/);
  const malformed={...settings,whatsapp:{...settings.whatsapp,
    botaoCorFundo:'#000; background: url(evil)',botaoCorTexto:'red;'}};
  const safe=paginaPublica({...ctx,settings:malformed},{conteudo:'Home'});
  assert.match(safe,/--whatsapp-botao-fundo:#25d366;--whatsapp-botao-texto:#ffffff/);
  assert.doesNotMatch(safe,/background: url\(evil\)/);
});

test('admin oferece cores, opção de pulsação e prévia editável do WhatsApp',async()=>{
  const {telaWhatsApp}=await import('../src/views/admin/config.js');
  const adminCtx={...ctx,csrf:'teste',adminUser:{id:'adm',nome:'Admin',role:'super_admin'}};
  const html=telaWhatsApp(adminCtx,{whatsapp:settings.whatsapp,linkExemplo:''});
  for (const name of ['botaoCorFundo','botaoCorTexto','pulsacaoSuave','textoBotao']) {
    assert.match(html,new RegExp('name="'+name+'"'));
  }
  assert.match(html,/id="previewBotaoWhatsApp"/);
  const route=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(route,/pulsacaoSuave: req\.body\.pulsacaoSuave === '1'/);
  assert.match(route,/Escolha cores válidas para o botão do WhatsApp/);
  const js=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
  assert.match(js,/atualizarPreviaWhatsApp/);
});
