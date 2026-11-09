import { escapeHtml as e } from '../lib/security.js';
import { formatDateTime } from '../lib/format.js';
import { paginaAdmin, painel, tabelaAdmin } from './admin/layout.js';

const money=centavos=>'R$ '+((Number(centavos||0)/100).toFixed(2)).replace('.',',');
const txt=x=>e(x==null?'':String(x));
const formToken=csrf=>'<input type="hidden" name="_csrf" value="'+txt(csrf)+'">';
const endereco=p=>{
 const a=p.endereco||{};
 return [a.logradouro,a.numero,a.complemento,a.bairro,a.cidade].filter(Boolean).map(txt).join(' · ');
};
const resumoPedido=(p,numero='')=>
 '<strong>'+(numero?'#'+txt(numero)+' · ':'')+'Pedido '+txt(p.codigo)+'</strong>'+
 '<p class="texto-pequeno mb-1">'+txt(p.cliente?.nome||'Cliente')+'</p>'+
 '<p class="texto-pequeno mb-1">'+endereco(p)+'</p>'+
 '<p class="texto-pequeno mb-1"><strong>Total:</strong> '+money(p.totalCentavos)+
 ' · <strong>Pagamento:</strong> '+(p.statusFinanceiro==='aprovado'?'Recebido':'Receber na entrega')+'</p>';

function baseEntregador({titulo,corpo,entregador=null}){
 return '<!DOCTYPE html><html lang="pt-BR"><head>'+
 '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1,maximum-scale=1">'+
 '<meta name="robots" content="noindex,nofollow">'+
 '<title>'+txt(titulo)+' — Entregas Farmácia Pague Pouco</title>'+
 '<link rel="stylesheet" href="/styles.css?v=entregador-20261109">'+
 '<style>body{background:#f7f7f7;color:#232323}.driver-wrap{max-width:720px;margin:auto;padding:14px 12px 30px}'+
 '.driver-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}'+
 '.driver-card{padding:14px;border:1px solid #ddd;background:#fff;border-radius:12px;margin:10px 0}'+
 '.driver-card h2{font-size:1.1rem;margin:0 0 8px}.driver-card label{display:block;margin:10px 0 4px}'+
 '.driver-opcao{display:flex;align-items:center;gap:10px;cursor:pointer;min-width:0}'+
 '.driver-opcao input{width:20px;height:20px;flex-shrink:0}'+
 '.driver-numero{display:inline-flex;min-width:34px;height:34px;align-items:center;justify-content:center;'+
 'border-radius:9px;background:#edf0f1;color:#222;font-weight:800}'+
 '.driver-opcao input:checked + .driver-numero{background:#8b0000;color:#fff}'+
 '.driver-full{width:100%;min-height:44px}.driver-alerta{padding:12px;border-radius:9px;'+
 'border:1px solid #eed39c;background:#fff7e4;margin:12px 0}'+
 '.driver-tag{font-size:.79rem;background:#f1f1f1;border-radius:6px;padding:3px 7px}'+
 '.driver-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:12px}'+
 '.driver-info{font-size:.85rem;color:#666;margin-top:6px}'+
 '@media(max-width:400px){.driver-wrap{padding:10px 9px}.driver-card{padding:11px}}'+
 '</style></head><body><main class="driver-wrap">'+
 '<header class="driver-header"><div><strong>🛵 Farmácia Pague Pouco</strong>'+
 '<div class="texto-pequeno">Painel do Entregador</div></div>'+
 (entregador?'<form method="post" action="/entregador/sair">'+
 formToken(entregador.csrf)+'<button type="submit" class="botao pequeno secundario">Sair</button></form>':'')+
 '</header>'+corpo+'</main>'+
 '<script src="/js/entregador.js?v=20261109" defer></script></body></html>';
}
export function telaLoginEntregador({csrf,erro=''}) {
 return baseEntregador({titulo:'Acesso do entregador',corpo:
 '<section class="driver-card"><h1 class="mt-0">Acessar minhas entregas</h1>'+
 (erro?'<div class="driver-alerta" role="alert">'+txt(erro)+'</div>':'')+
 '<form method="post" action="/entregador/login">'+formToken(csrf)+
 '<label for="cpf">CPF</label><input class="entrada" type="text" inputmode="numeric" '+
 'autocomplete="username" maxlength="14" id="cpf" name="cpf" required>'+
 '<label for="senha">Senha</label><input class="entrada" type="password" '+
 'autocomplete="current-password" id="senha" name="senha" required>'+
 '<button class="botao destaque driver-full mt-2" type="submit">Entrar</button>'+
 '</form><p class="driver-info">Seu acesso é criado pela administração da farmácia.</p></section>'});
}
function formularioPagamento(p,csrf,r){
 const escolhido=p.metodoPagamento||'pix';
 const opcoes=[['pix','Pix'],['credit_card','Cartão de crédito'],['debit_card','Cartão de débito'],['cash','Dinheiro']];
 return '<div class="driver-alerta"><strong>Pagamento ainda pendente</strong>'+
 '<p>Confirme somente se você recebeu o valor de verdade. O sistema não cobra o cartão aqui.</p>'+
 '<label>Forma efetivamente recebida</label><select class="entrada" name="metodoRecebido" data-driver-pagamento>'+
 opcoes.map(([v,t])=>'<option value="'+v+'" '+(v===escolhido?'selected':'')+'>'+t+'</option>').join('')+
 '</select><div data-driver-cartao '+(['credit_card','debit_card'].includes(escolhido)?'':'hidden')+'>'+
 '<label>Bandeira</label><select class="entrada" name="bandeira">'+
 '<option value="">Selecione</option>'+
 [['visa','Visa'],['mastercard','Mastercard'],['elo','Elo'],['amex','American Express'],['hipercard','Hipercard'],['outra','Outra']]
 .map(([v,t])=>'<option value="'+v+'">'+t+'</option>').join('')+'</select>'+
 '<label>Parcelas</label><select class="entrada" name="parcelas">'+
 Array.from({length:12},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'x</option>').join('')+
 '</select></div>'+
 '<label class="driver-opcao"><input type="checkbox" name="confirmouRecebimento" value="1" required> '+
 'Confirmo que recebi o valor integral de '+money(p.totalCentavos)+'</label></div>';
}
export function telaPainelEntregador({entregador,csrf,disponiveis=[],rota=null,db,erro=''}) {
 const cabeca='<div class="driver-card"><h1 class="mt-0">Olá, '+txt(entregador.nome.split(' ')[0])+'!</h1>'+
 '<p class="mb-0">Escolha os pedidos na ordem em que pretende entregar. Sem GPS.</p></div>'+
 (erro?'<div class="driver-alerta" role="alert">'+txt(erro)+'</div>':'');
 let corpo=cabeca;
 if(rota) {
  const atual=rota.itens.find(i=>!['entregue','nao_entregue'].includes(i.status));
  corpo+='<div class="driver-card"><h2>Rota em andamento · '+rota.itens.length+' pedidos</h2>'+
    '<p class="texto-pequeno">Entrega em atendimento: '+(atual?'#'+atual.numero:'nenhuma')+'</p></div>';
  for(const item of rota.itens) {
   const p=db.collection('orders').get(item.pedidoId);
   if(!p)continue;
   const ativa=atual?.pedidoId===item.pedidoId;
   corpo+='<div class="driver-card"><h2>'+txt(item.numero)+'ª entrega '+
     '<span class="driver-tag">'+txt(item.status.replace(/_/g,' '))+'</span></h2>'+
     resumoPedido(p)+
     (ativa?'<div class="driver-actions">'+
       (item.status==='indo'
         ? '<form method="post" action="/entregador/rotas/'+txt(rota.id)+'/'+txt(p.id)+'/cheguei">'+
           formToken(csrf)+'<button class="botao driver-full" type="submit">📍 Cheguei na entrega</button></form>'
         : item.status==='chegou'
           ? '<form method="post" action="/entregador/rotas/'+txt(rota.id)+'/'+txt(p.id)+'/conclui">'+
             formToken(csrf)+(p.statusFinanceiro==='pendente'?formularioPagamento(p,csrf,rota):'')+
             '<button class="botao destaque driver-full" type="submit">✅ Entrega concluída</button></form>'
           : '')+
       '<form method="post" action="/entregador/rotas/'+txt(rota.id)+'/'+txt(p.id)+'/problema">'+
       formToken(csrf)+'<button class="botao secundario driver-full" type="submit" '+
       'data-driver-confirmar-problema>Não consegui entregar</button></form>'+
       '</div>':'')+
     '</div>';
  }
  corpo+='<p class="driver-info">Após concluir uma entrega, a próxima é marcada automaticamente como a caminho.</p>';
 }else{
  corpo+='<section class="driver-card"><h2>Entregas disponíveis ('+disponiveis.length+')</h2>'+
   '<p class="driver-info">Somente entregas locais prontas, ainda não atribuídas a outro entregador.</p>';
  if(!disponiveis.length)corpo+='<p>Nenhuma entrega disponível no momento.</p>';
  else{
   corpo+='<form method="post" action="/entregador/rotas/iniciar" id="formCriarRota">'+formToken(csrf)+
    '<input type="hidden" name="pedidos" id="ordemEntregas" value="">';
   for(const p of disponiveis)corpo+='<label class="driver-opcao driver-card" '+
     'style="margin:8px 0" data-driver-opcao>'+
     '<input type="checkbox" data-driver-pedido="'+txt(p.id)+'">'+
     '<span class="driver-numero" data-driver-numero>—</span>'+
     '<span style="min-width:0">'+resumoPedido(p)+'</span></label>';
   corpo+='<button type="submit" class="botao destaque driver-full" id="sairComEntregas" disabled>'+
     '🛵 Sair com entregas (0)</button></form>';
  }
  corpo+='</section>';
 }
 return baseEntregador({titulo:'Minhas entregas',corpo,entregador:{...entregador,csrf}});
}
export function telaAdminEntregadores(ctx,{entregadores,rotas,disponiveis,erro=''}) {
 const senha='Senha de no mínimo 10 caracteres.';
 const body='<h1 class="mt-0">🛵 Entregadores e rotas</h1>'+
 (erro?'<div class="alerta aviso">'+txt(erro)+'</div>':'')+
 '<div class="cartoes"><div class="cartao-metrica"><div class="rotulo-metrica">Entregas disponíveis</div>'+
 '<div class="valor-metrica">'+disponiveis.length+'</div></div>'+
 '<div class="cartao-metrica"><div class="rotulo-metrica">Rotas ativas</div>'+
 '<div class="valor-metrica">'+rotas.filter(r=>r.status==='em_rota').length+'</div></div></div>'+
 painel({titulo:'Cadastrar entregador',corpo:
  '<form method="post" action="/admin/entregadores/criar">'+formToken(ctx.csrf)+
  '<div class="grade-form duas-colunas"><div class="campo"><label>Nome</label>'+
  '<input class="entrada" name="nome" required maxlength="90"></div>'+
  '<div class="campo"><label>CPF</label><input class="entrada" name="cpf" required '+
  'inputmode="numeric" maxlength="14"></div>'+
  '<div class="campo"><label>Senha inicial</label><input class="entrada" type="password" '+
  'name="senha" minlength="10" required></div></div>'+
  '<p class="texto-pequeno">'+senha+'</p><button class="botao" type="submit">Cadastrar</button></form>',
 })+
 painel({titulo:'Entregadores cadastrados · acesso /entregador',
  corpo:entregadores.length?entregadores.map(x=>
    '<div class="driver-card" style="padding:12px;border:1px solid #ddd;border-radius:10px;margin:10px 0">'+
    '<strong>'+txt(x.nome)+'</strong> · CPF ***.***.***-'+txt(x.cpf.slice(-2))+
    ' · '+(x.ativo?'Ativo':'Inativo')+
    '<form method="post" action="/admin/entregadores/'+txt(x.id)+'/editar">'+
    formToken(ctx.csrf)+
    '<div class="grade-form duas-colunas"><div class="campo"><label>Nome</label>'+
    '<input class="entrada" name="nome" value="'+txt(x.nome)+'" required></div>'+
    '<div class="campo"><label>Redefinir senha (opcional)</label>'+
    '<input class="entrada" type="password" name="senha" minlength="10" placeholder="Deixar em branco para manter"></div></div>'+
    '<label class="check"><input type="checkbox" name="ativo" value="1" '+(x.ativo?'checked':'')+
    '> Acesso ativo</label><button class="botao pequeno" type="submit">Salvar entregador</button></form></div>'
  ).join(''):'<p>Cadastre o primeiro entregador para começar.</p>'})+
 painel({titulo:'Últimas rotas',semPadding:true,corpo:tabelaAdmin({
  colunas:['Entregador','Iniciada','Pedidos / situação','Progresso','Situação'],
  linhas:rotas.map(r=>'<tr><td>'+txt(r.nomeEntregador)+'</td><td>'+txt(formatDateTime(r.iniciadaEm))+
   '</td><td>'+r.itens.map(item=>{
     const p=ctx.db.collection('orders').get(item.pedidoId);
     return '<div class="texto-pequeno">#'+txt(item.numero)+' · '+txt(p?.codigo||'Pedido')+
       ' — '+txt(item.status.replace(/_/g,' '))+'</div>';
   }).join('')+'</td><td>'+r.itens.filter(i=>i.status==='entregue').length+'/'+r.itens.length+
   ' entregas concluídas</td><td>'+txt(r.status)+
   (r.itens.some(x=>x.status==='nao_entregue')?' · Com pendências':'')+'</td></tr>'),
  vazio:'Nenhuma rota iniciada.',
 })})+
 '<p class="texto-pequeno texto-suave">Somente pedidos com entrega local e conferidos como recebidos pela equipe ou preparados para envio entram no painel.'+
 ' Pagamentos na entrega exigem confirmação de recebimento antes de marcar como entregues.</p>';
 return paginaAdmin(ctx,{titulo:'Entregadores e rotas',ativo:'entregadores',conteudo:body});
}
