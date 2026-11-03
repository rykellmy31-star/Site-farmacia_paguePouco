/**
 * Scanner de EAN/GTIN no painel da farmácia, acionado somente por clique.
 * html5-qrcode 2.3.8 está hospedado localmente: funciona no Safari/iOS
 * e Android sem depender de CDNs terceirizadas ou de BarcodeDetector.
 * A leitura permanece no aparelho; nenhuma imagem/vídeo vai ao servidor.
 */
(function(){
  'use strict';
  if(!document.querySelector('[data-leitor-codigo]'))return;
  let scanner=null,abrindo=false,finalizando=false,modal=null;
  let alvoAtual=null,resultadoFechado=false;
  const estilos=`
    #leitorCodigoDialog{max-width:min(94vw,510px);width:calc(100% - 24px);
      max-height:94dvh;overflow:auto;border:0;border-radius:14px;padding:18px;
      color:#15252b;background:white;box-shadow:0 15px 55px #0006}
    #leitorCodigoDialog::backdrop{background:#000b}
    #leitorCodigoDialog .leitor-cabecalho{display:flex;align-items:center;
      justify-content:space-between;gap:10px}
    #leitorCodigoDialog .leitor-cabecalho h2{font-size:1.12rem;margin:0}
    #leitorCodigoDialog #leitorCodigoArea{width:100%;min-height:210px;
      overflow:hidden;border-radius:10px;margin:14px 0 6px}
    #leitorCodigoDialog #leitorCodigoArea video{max-width:100%;border-radius:8px}
    #leitorCodigoDialog .leitor-acoes{display:flex;gap:9px;flex-wrap:wrap;
      align-items:center;margin-top:12px}
    #leitorCodigoDialog button{min-height:42px;touch-action:manipulation}
    #leitorCodigoDialog .leitor-status{font-size:.93rem;margin:8px 0;
      line-height:1.4}
    .leitor-foto-input{display:none}
    .botao-leitor-codigo{white-space:nowrap;min-height:40px}
  `;
  const style=document.createElement('style');style.textContent=estilos;
  document.head.appendChild(style);
  function el(id){return document.getElementById(id);}
  function validoEAN(c){
    if(!/^(?:\d{8}|\d{12,14})$/.test(c))return false;
    let soma=0,mult=3;
    for(let i=c.length-2;i>=0;i--){soma+=Number(c[i])*mult;mult=4-mult;}
    return (10-soma%10)%10===Number(c.at(-1));
  }
  function status(msg){const p=el('leitorCodigoStatus');if(p)p.textContent=msg;}
  function criarModal(){
    if(modal)return modal;
    modal=document.createElement('dialog');modal.id='leitorCodigoDialog';
    modal.setAttribute('aria-labelledby','leitorCodigoTitulo');
    modal.innerHTML=`
      <div class="leitor-cabecalho">
        <h2 id="leitorCodigoTitulo">📷 Ler código de barras</h2>
        <button type="button" class="botao secundario" id="fecharLeitorCodigo"
          aria-label="Fechar câmera">✕ Fechar</button>
      </div>
      <p class="leitor-status" id="leitorCodigoStatus" role="status"
        aria-live="polite">Aponte a câmera traseira para o código de barras do produto.</p>
      <div id="leitorCodigoArea"></div>
      <div class="leitor-acoes">
        <button class="botao secundario" type="button" id="leitorEscolherFoto">
          🖼️ Ler de uma foto
        </button>
        <input type="file" class="leitor-foto-input" accept="image/*"
          capture="environment" id="leitorFotoArquivo" aria-label="Fotografar código de barras">
        <span class="texto-pequeno">EAN-8, EAN-13, GTIN-14 e UPC.</span>
      </div>`;
    document.body.append(modal);
    el('fecharLeitorCodigo').addEventListener('click',()=>modal.close());
    modal.addEventListener('cancel',event=>{event.preventDefault();modal.close();});
    modal.addEventListener('close',()=>{void encerrar();});
    el('leitorEscolherFoto').addEventListener('click',()=>el('leitorFotoArquivo').click());
    el('leitorFotoArquivo').addEventListener('change',async ev=>{
      const arquivo=ev.target.files?.[0];ev.target.value='';
      if(!arquivo||!scanner||finalizando)return;
      status('Analisando o código da foto...');
      try{
        // Parar stream antes de scanFile: a biblioteca não suporta ambos ao mesmo tempo.
        if(scanner.getState()===2)await scanner.stop();
        const codigo=await scanner.scanFile(arquivo,true);
        await receber(codigo);
      }catch(err){
        status('Não consegui ler essa foto. Tente outra mais nítida, com boa luz.');
      }
    });
    return modal;
  }
  async function carregarBiblioteca(){
    if(typeof window.Html5Qrcode==='function')return;
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='/js/vendor/html5-qrcode.min.js';
      script.async=true;
      script.onload=()=>typeof window.Html5Qrcode==='function'
        ?resolve():reject(Error('O leitor não foi carregado.'));
      script.onerror=()=>reject(Error('Biblioteca de leitura indisponível.'));
      document.head.append(script);
    });
  }
  async function encerrar(){
    const antigo=scanner;scanner=null;abrindo=false;
    if(!antigo)return;
    try{if(antigo.getState()===2)await antigo.stop();}catch{}
    try{antigo.clear();}catch{}
  }
  async function receber(raw){
    if(finalizando||!modal?.open)return;
    const code=String(raw||'').replace(/\D/g,'');
    if(!validoEAN(code)){
      status('Código detectado, mas com dígito verificador inválido. Aponte de novo.');
      return;
    }
    const destino=document.querySelector(alvoAtual?.dataset?.leitorCodigo||'');
    if(!destino){status('Não encontrei o campo de destino.');return;}
    finalizando=true;
    destino.value=code;
    destino.dispatchEvent(new Event('input',{bubbles:true}));
    destino.dispatchEvent(new Event('change',{bubbles:true}));
    const busca=destino.closest('form')?.matches('form[action="/admin/produtos"]');
    modal.close();
    destino.focus({preventScroll:true});
    if(busca){destino.closest('form').requestSubmit?.();}
    finalizando=false;
  }
  async function abrir(botao){
    if(abrindo)return;
    alvoAtual=botao;
    criarModal();
    if(!window.isSecureContext){
      modal.showModal();status('A câmera exige acesso HTTPS. Você pode digitar o EAN normalmente.');
      return;
    }
    if(!navigator.mediaDevices?.getUserMedia){
      modal.showModal();status('Câmera indisponível neste navegador. Tente ler por uma foto.');
      return;
    }
    abrindo=true;
    modal.showModal();
    status('Solicitando permissão para usar a câmera...');
    try{
      await carregarBiblioteca();
      if(!modal.open)return;
      const fmt=window.Html5QrcodeSupportedFormats;
      const types=[fmt.EAN_13,fmt.EAN_8,fmt.UPC_A,fmt.ITF,fmt.CODE_128]
        .filter(x=>x!==undefined);
      scanner=new window.Html5Qrcode('leitorCodigoArea',
        {formatsToSupport:types,verbose:false});
      const iniciado=scanner;
      await iniciado.start({facingMode:'environment'},
        {fps:10,qrbox:{width:260,height:130},aspectRatio:1.777},
        async code=>{await receber(code);},
        ()=>{});
      if(!modal.open||scanner!==iniciado){
        try{if(iniciado.getState()===2)await iniciado.stop();}catch{}
        try{iniciado.clear();}catch{}
        return;
      }
      status('Aponte a câmera para as barras e mantenha o aparelho firme.');
    }catch(err){
      status('Não foi possível abrir a câmera. Verifique a permissão ou use “Ler de uma foto”.');
      // Permite o fallback scanFile mesmo sem stream de vídeo.
      if(!scanner&&typeof window.Html5Qrcode==='function')
        scanner=new window.Html5Qrcode('leitorCodigoArea',{verbose:false});
    }finally{abrindo=false;}
  }
  document.addEventListener('click',event=>{
    const btn=event.target.closest('[data-leitor-codigo]');
    if(!btn||btn.disabled)return;
    event.preventDefault();
    void abrir(btn);
  });
  // Não manter câmera ativa quando a página vai para segundo plano.
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&modal?.open)modal.close();
  });
  window.addEventListener('pagehide',()=>{if(modal?.open)modal.close();});
})();
