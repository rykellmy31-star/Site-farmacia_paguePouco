/** Pareamento uma vez pelo Superadmin e transferência automática de lotes CSV. */
import {paginaAdmin} from '../views/admin/layout.js';
import {escapeHtml as e, csrfToken} from '../lib/security.js';
import {getAllSettings} from '../lib/settings.js';
import {can} from '../lib/permissions.js';
import {logAdmin} from '../lib/audit.js';
import {
 configurarRoboInova,consultarRoboInova,autenticarRoboInova,
 receberBlocoRoboInova,aplicarBlocoRoboInova,
} from '../lib/inovafarma-robo-sync.js';

const protegerAdmin=(req,res)=>{
  if(!req.adminUser)return res.redirect('/admin/login?next=%2Fadmin%2Frobo-inovafarma'),false;
  if(req.adminUser.role!=='super_admin'||!can(req.adminUser,'produtos.editar')){
    res.html('<h1>403 — Somente o Superadmin pode configurar o robô.</h1>',403);
    return false;
  }
  return true;
};
export function registrarRotasRoboInova(app,db) {
  const html=(req,{token='',mensagem=''}={})=>{
    const estado=consultarRoboInova(db);
    const ultimo=estado.ultimo;
    const aviso=!estado.ativo?'Desativado — nenhum computador tem acesso ainda':
      'Pareado — o computador poderá enviar automaticamente os relatórios de estoque.';
    const ctx={db,req,adminUser:req.adminUser,settings:getAllSettings(db),
      csrf:csrfToken(req)};
    return paginaAdmin(ctx,{titulo:'Robô de Estoque InovaFarma',ativo:'robo_inova',
      conteudo:`<h1>Robô de Estoque InovaFarma</h1>
        <div class="alerta info"><strong>${e(aviso)}</strong>
          <p>O trabalho diário será somente exportar o CSV de Posição de Estoque
          para a pasta monitorada pelo Windows. O robô enviará os lotes e
          atualizará automaticamente estoques e preços de venda dos produtos
          identificados com segurança. Não acessa a base privada do ERP.</p>
          <p>Não inventa EANs nem publica novos medicamentos. Produtos
          inéditos entram inativos e os casos ambíguos são separados para revisão.
          Nenhum produto ausente da exportação é apagado ou zerado.</p>
        </div>
        ${token?`<div class="alerta aviso"><strong>Copie agora a chave de pareamento.</strong>
          Será exibida somente nesta página. Não compartilhe a chave.
          <textarea readonly rows="3" style="width:100%;max-width:650px"
          id="chaveRobo">${e(token)}</textarea>
          <button class="botao pequeno" type="button" onclick="navigator.clipboard.writeText(document.getElementById('chaveRobo').value)">Copiar chave</button></div>`:''}
        ${mensagem?`<p class="alerta sucesso">${e(mensagem)}</p>`:''}
        <section class="painel"><h2>Conectar computador (apenas uma vez)</h2>
          <p>1. Faça o backup dos dados no menu Sistema e backups.<br>
          2. Clique em <strong>Gerar chave para o robô</strong>.<br>
          3. Copie a chave e cole no inicializador do robô Windows.<br>
          4. Depois, basta exportar o CSV do InovaFarma para
          <code>C:\\InovaExportacoes</code>.</p>
          <form method="post" action="/admin/robo-inovafarma/parear">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <label><input type="checkbox" name="backup" value="1" required>
              Tenho um backup recente e autorizado da loja.</label>
            <p class="texto-pequeno">Gerar uma chave nova invalida imediatamente a antiga.</p>
            <button class="botao" type="submit">Gerar chave para o robô</button>
          </form>
          <form method="post" action="/admin/robo-inovafarma/desativar">
            <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
            <p><button class="botao secundario" type="submit">Revogar acesso do computador</button></p>
          </form>
        </section>
        <section class="painel"><h2>Último relatório automático</h2>
          ${ultimo?`<p><strong>Status:</strong> ${e(ultimo.status)};
          <strong>Recebidos:</strong> ${ultimo.recebidos}/${ultimo.total};
          <strong>Atualizados:</strong> ${ultimo.atualizados};
          <strong>Sem alteração:</strong> ${ultimo.semAlteracao};
          <strong>Novos inativos:</strong> ${ultimo.novosInativos};
          <strong>Pendências:</strong> ${ultimo.pendentes}.</p>
          <p>Relatório exportado em: ${e(ultimo.geradoEm)};
          processamento: ${e(ultimo.concluidoEm||ultimo.iniciadoEm)}</p>
          ${ultimo.detalhes?.length?`<h3>Conferências necessárias</h3><ul>${ultimo.detalhes.map(x=>
            `<li>Código ${e(x.codigoInterno)}: ${e(x.motivo)}</li>`).join('')}</ul>`:''}
          `:'<p>Nenhum relatório sincronizado por este robô.</p>'}
        </section>`});
  };
  app.get('/admin/robo-inovafarma',(req,res)=>{
    if(!protegerAdmin(req,res))return;
    res.set('Cache-Control','no-store');
    res.html(html(req));
  });
  app.post('/admin/robo-inovafarma/parear',(req,res)=>{
    if(!protegerAdmin(req,res))return;
    if(req.body.backup!=='1')return void res.html('Confirme o backup antes de habilitar o robô.',400);
    const r=configurarRoboInova(db);
    logAdmin(db,req.adminUser,'pareou_robo_csv_inova','integracao','principal',{},req);
    res.set('Cache-Control','no-store');
    res.html(html(req,{token:r.token,mensagem:'Chave criada. Configure o computador uma única vez.'}));
  });
  app.post('/admin/robo-inovafarma/desativar',(req,res)=>{
    if(!protegerAdmin(req,res))return;
    configurarRoboInova(db,{desativar:true});
    logAdmin(db,req.adminUser,'revogou_robo_csv_inova','integracao','principal',{},req);
    res.set('Cache-Control','no-store');
    res.html(html(req,{mensagem:'Acesso remoto revogado. O robô não poderá enviar arquivos.'}));
  });
  const auth=(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!autenticarRoboInova(db,req.headers.authorization)){
      res.json({ok:false,erro:'Robô não pareado ou chave revogada.'},401);
      return false;
    }
    return true;
  };
  app.post('/webhooks/robo-inovafarma/lote',{maxBodyBytes:160*1024},(req,res)=>{
    if(!auth(req,res))return;
    const r=receberBlocoRoboInova(db,req.body);
    return void res.json(r,r.ok?200:r.status||400);
  });
  app.post('/webhooks/robo-inovafarma/aplicar',{maxBodyBytes:16*1024},(req,res)=>{
    if(!auth(req,res))return;
    const r=aplicarBlocoRoboInova(db,req.body);
    return void res.json(r,r.ok?200:r.status||400);
  });
}
