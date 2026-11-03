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
  let alvoAtual=null,aberturaId=0,trocandoCamera=false;
  let camerasDisponiveis=[],lendoFoto=false,fotoSolicitada=false,ultimaCamera='';
  const estilos=`
    #leitorCodigoDialog{max-width:min(94vw,510px);width:calc(100% - 24px);
      max-height:94dvh;overflow:auto;border:0;border-radius:14px;padding:18px;
      color:#15252b;background:white;box-shadow:0 15px 55px #0006}
    #leitorCodigoDialog::backdrop{background:#000b}
    #leitorCodigoDialog .leitor-cabecalho{display:flex;align-items:center;
      justify-content:space-between;gap:10px}
    #leitorCodigoDialog .leitor-cabecalho h2{font-size:1.12rem;margin:0}
    #leitorCodigoDialog #leitorCodigoArea{width:100%;min-height:200px;
      overflow:hidden;border-radius:10px;margin:10px 0 6px;background:#161c22}
    #leitorCodigoDialog #leitorCodigoArea video{
      display:block!important;width:100%!important;height:auto!important;
      max-height:50dvh;object-fit:contain;border-radius:8px}
    #leitorCodigoDialog .leitor-camera-label{
      display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.9rem;
      margin:10px 0;color:#293d4b}
    #leitorCodigoDialog #leitorCodigoCamera{min-height:42px;max-width:100%;
      flex:1;min-width:175px}
    #leitorCodigoDialog .leitor-dica{font-size:.88rem;line-height:1.4;
      color:#314851;margin:8px 0}
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
      <p class="leitor-dica" id="leitorCodigoDica">
        Mantenha as barras ocupando pelo menos metade da largura da imagem, sem cortar as pontas.
        Se o vídeo não focar, use “Fotografar código” para tirar uma foto nítida.
      </p>
      <label class="leitor-camera-label" for="leitorCodigoCamera" id="leitorCameraControle" hidden>
        Câmera <select id="leitorCodigoCamera" aria-label="Escolher câmera traseira"></select>
      </label>
      <div id="leitorCodigoArea"></div>
      <div class="leitor-acoes">
        <button class="botao secundario" type="button" id="leitorEscolherFoto">
          📷 Fotografar código com mais nitidez
        </button>
        <button class="botao secundario" type="button" id="leitorGaleriaFoto">
          🖼️ Escolher foto da galeria
        </button>
        <input type="file" class="leitor-foto-input" accept="image/*"
          capture="environment" id="leitorFotoArquivo" aria-label="Fotografar código de barras">
        <input type="file" class="leitor-foto-input" accept="image/*"
          id="leitorGaleriaArquivo" aria-label="Escolher foto da galeria">
        <span class="texto-pequeno">EAN-8, EAN-13, GTIN-14 e UPC.</span>
      </div>`;
    document.body.append(modal);
    el('fecharLeitorCodigo').addEventListener('click',()=>modal.close());
    modal.addEventListener('cancel',event=>{event.preventDefault();modal.close();});
    modal.addEventListener('close',()=>{void encerrar();});
    el('leitorEscolherFoto').addEventListener('click',()=>{
      fotoSolicitada=true;el('leitorFotoArquivo').click();
    });
    el('leitorCodigoCamera').addEventListener('change',ev=>{
      void trocarCamera(ev.target.value);
    });

    el('leitorGaleriaFoto').addEventListener('click',()=>{
      fotoSolicitada=true;el('leitorGaleriaArquivo').click();
    });
    for(const input of [el('leitorFotoArquivo'),el('leitorGaleriaArquivo')]){
      input.addEventListener('change',async ev=>{
        const arquivo=ev.target.files?.[0];fotoSolicitada=false;
        // iPhone: não esvaziar o file input antes de ler o arquivo.
        if(!arquivo||finalizando||lendoFoto)return;
        try{await analisarFoto(arquivo);}
        finally{input.value='';}
      });
    }
    return modal;
  }

  async function lerFotoNativa(arquivo){
    // Quando disponível, o detector do navegador analisa a FOTO original,
    // antes de qualquer redução feita pelo leitor de vídeo.
    if(!window.BarcodeDetector||!window.createImageBitmap)return '';
    let bitmap;
    try{
      const formats=['ean_13','ean_8','upc_a','upc_e','code_128','itf'];
      const suportados=await window.BarcodeDetector.getSupportedFormats();
      const permitidos=formats.filter(x=>suportados.includes(x));
      if(!permitidos.length)return '';
      bitmap=await window.createImageBitmap(arquivo);
      const detector=new window.BarcodeDetector({formats:permitidos});
      const resultados=await detector.detect(bitmap);
      return resultados.map(x=>x.rawValue).find(validoEAN)||'';
    }catch{return ''}
    finally{bitmap?.close?.();}
  }
  async function analisarFoto(arquivo){
    if(lendoFoto||!modal?.open)return;
    lendoFoto=true;
    const pedido=aberturaId;
    const cameraAnterior=el('leitorCodigoCamera')?.value||ultimaCamera;
    status('Analisando a foto em alta resolução...');
    try{
      // Primeiro, tentar a foto original no detector nativo (quando houver).
      const codigoNativo=await lerFotoNativa(arquivo);
      if(!modal?.open||pedido!==aberturaId)return;
      if(codigoNativo){await receber(codigoNativo);return;}

      // html5-qrcode não aceita scanFile simultaneamente ao vídeo.
      // Parar e LIMPAR a área evita deixar no iPhone uma imagem congelada.
      const antigo=scanner;
      if(antigo?.getState?.()===2)await antigo.stop();
      if(!modal?.open||pedido!==aberturaId)return;
      if(!antigo){
        await carregarBiblioteca();
        if(!modal?.open||pedido!==aberturaId)return;
      }
      const leitor=antigo||new window.Html5Qrcode('leitorCodigoArea',{verbose:false});
      try{
        const codigo=await leitor.scanFile(arquivo,false);
        if(modal.open&&pedido===aberturaId)await receber(codigo);
      }finally{
        // Limpa canvas e recursos ANTES de reiniciar a câmera.
        try{leitor.clear();}catch{}
        if(scanner===leitor)scanner=null;
      }
    }catch{
      if(modal.open)status('Não foi possível ler esse código na foto. Vou reabrir a câmera para tentar de novo.');
    }finally{
      // Em qualquer falha, a câmera volta a funcionar. Antes, o botão
      // deixava o vídeo parado e o usuário não conseguia fazer nova leitura.
      if(modal?.open&&pedido===aberturaId&&!finalizando){
        try{
          if(scanner&&scanner.getState?.()===2)await scanner.stop();
          try{scanner?.clear();}catch{}
          scanner=null;
          await iniciarCamera(cameraAnterior,pedido);
          if(modal.open)status('Câmera reativada. Aproxime até as barras ocuparem pelo menos metade da largura da imagem.');
        }catch{
          if(modal.open)status('Foto não reconhecida. Tente novamente com mais luz ou abra o leitor de novo.');
        }
      }
      lendoFoto=false;
    }
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
    const antigo=scanner;scanner=null;abrindo=false;aberturaId++;
    lendoFoto=false;fotoSolicitada=false;
    if(!antigo)return;
    try{if(antigo.getState()===2)await antigo.stop();}catch{}
    try{antigo.clear();}catch{}
  }
  async function receber(raw){
    if(finalizando||!modal?.open)return;
    const code=String(raw||'').trim();
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
    // Não desbloquear enquanto callbacks de frames antigos ainda chegam.
  }
  // Escolher a câmera traseira principal, em vez da ultra-wide/macro.
  // Em iPhones multi-câmera, a ultra-wide pode alternar foco e distorcer barras.
  function escolherCamera(cameras){
    const tras=cameras.filter(c=>/back|rear|traseir|environment|wide|externa/i.test(c.label||''));
    const opcoes=tras.length?tras:cameras;
    const comuns=opcoes.filter(c=>!/ultra|macro|tele|0\.5x|0,5x|front|frontal/i.test(c.label||''));
    const prioridade=comuns.find(c=>/wide|principal|main|1x|traseir|back/i.test(c.label||''));
    return (prioridade||comuns[0]||opcoes[0])?.id||'';
  }
  function atualizarCameras(cameras,selecionada){
    const select=el('leitorCodigoCamera');
    const label=el('leitorCameraControle');
    if(!select||!label)return;
    select.replaceChildren();
    for(let i=0;i<cameras.length;i++){
      const camera=cameras[i];const option=document.createElement('option');
      option.value=camera.id;
      option.textContent=camera.label||('Câmera '+(i+1));
      select.append(option);
    }
    select.value=selecionada;
    label.hidden=cameras.length<=1;
  }
  function configuracaoVideo(deviceId){
    // Não forçar aspecto 16:9 nem qrbox de 260×130: o leitor varre
    // a imagem inteira, sem cortar o EAN nas extremidades.
    const constraints={
      width:{ideal:1280},height:{ideal:720},
      frameRate:{ideal:24,max:30},
    };
    if(deviceId)constraints.deviceId={exact:deviceId};
    else constraints.facingMode={ideal:'environment'};
    return constraints;
  }
  async function iniciarCamera(idCamera='',pedido=aberturaId){
    const fmt=window.Html5QrcodeSupportedFormats||{};
    const types=[fmt.EAN_13,fmt.EAN_8,fmt.UPC_A,fmt.UPC_E,fmt.ITF,fmt.CODE_128]
      .filter(x=>x!==undefined);
    scanner=new window.Html5Qrcode('leitorCodigoArea',{
      formatsToSupport:types,verbose:false,
      experimentalFeatures:{useBarCodeDetectorIfSupported:true},
    });
    const iniciado=scanner;
    const onSuccess=async code=>{await receber(code);};
    const config={fps:8,disableFlip:true,videoConstraints:configuracaoVideo(idCamera)};
    try{
      await iniciado.start(idCamera||{facingMode:'environment'},config,onSuccess,()=>{});
    }catch(error){
      // Safari de certos aparelhos rejeita restrições de resolução: tentar
      // uma única vez sem resoluções forçadas, preservando a câmera.
      if(!modal?.open||pedido!==aberturaId)throw error;
      await iniciado.start(idCamera||{facingMode:'environment'},
        {fps:7,disableFlip:true},onSuccess,()=>{});
    }
    if(!modal?.open||pedido!==aberturaId||scanner!==iniciado){
      try{if(iniciado.getState()===2)await iniciado.stop();}catch{}
      try{iniciado.clear();}catch{}
      return;
    }
    ultimaCamera=idCamera||ultimaCamera;
    status('Câmera pronta. Aproxime para as barras ocuparem pelo menos metade da largura da tela, sem cortar as extremidades.');
  }
  async function trocarCamera(id){
    if(!modal?.open||trocandoCamera||abrindo||!id)return;
    trocandoCamera=true;
    status('Trocando para a câmera selecionada...');
    try{
      await encerrar();
      if(modal.open)await iniciarCamera(id,aberturaId);
    }catch{
      status('Não foi possível abrir essa câmera. Selecione outra ou use uma foto.');
    }finally{trocandoCamera=false;}
  }
  async function abrir(botao){
    if(abrindo||trocandoCamera||lendoFoto||modal?.open)return;
    alvoAtual=botao;finalizando=false;
    criarModal();
    const pedido=++aberturaId;
    modal.showModal();
    if(!window.isSecureContext){
      status('A câmera exige HTTPS. Você ainda pode digitar o EAN normalmente.');
      return;
    }
    if(!navigator.mediaDevices?.getUserMedia){
      status('Câmera indisponível neste navegador. Tente ler por uma foto.');
      return;
    }
    abrindo=true;
    status('Preparando câmera traseira para ler as barras...');
    try{
      await carregarBiblioteca();
      if(!modal.open||pedido!==aberturaId)return;
      try{camerasDisponiveis=await window.Html5Qrcode.getCameras();}
      catch{camerasDisponiveis=[];}
      if(!modal.open||pedido!==aberturaId)return;
      const id=escolherCamera(camerasDisponiveis);
      atualizarCameras(camerasDisponiveis,id);
      await iniciarCamera(id,pedido);
    }catch{
      if(modal.open&&pedido===aberturaId){
        status('Não consegui estabilizar a câmera. Tente outra câmera ou “Ler de uma foto”.');
        if(!scanner&&typeof window.Html5Qrcode==='function')
          scanner=new window.Html5Qrcode('leitorCodigoArea',{verbose:false});
      }
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
    if(document.hidden&&modal?.open&&!fotoSolicitada&&!lendoFoto)modal.close();
  });
  window.addEventListener('pagehide',()=>{if(modal?.open)modal.close();});
})();
