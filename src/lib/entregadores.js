
import { uid, nowISO } from './store.js';
import { hashPassword, verifyPassword } from './security.js';
import { pedidoPresencialPorCEP } from './pagamento-presencial.js';
import { atualizarStatusFinanceiro, atualizarStatusOperacional } from './orders.js';
import { validarRecebimentoPresencial } from './recebimento-presencial.js';
import { evolutionConfig, autorizouWhatsappPedidos, numeroWhatsapp, enfileirarEvolution } from './evolution-whatsapp.js';
import { getSetting } from './settings.js';

export const cpfDigitos=x=>String(x||'').replace(/\D/g,'');
export function cpfValido(v){
 const s=cpfDigitos(v);
 if(!/^\d{11}$/.test(s)||/^(\d)\1+$/.test(s))return false;
 for(let i=9;i<=10;i++){
  const sum=s.slice(0,i).split('').reduce((a,d,k)=>a+Number(d)*(i+1-k),0);
  const v=(sum*10)%11;
  if(Number(s[i])!==(v===10?0:v))return false;
 }
 return true;
}
export function novoEntregador(db,{nome,cpf,senha}={}){
 const n=String(nome||'').replace(/[\r\n\t]/g,' ').trim().slice(0,90);
 const doc=cpfDigitos(cpf);
 if(n.length<3||!cpfValido(doc)||String(senha||'').length<10)
   return {ok:false,erro:'Informe nome, CPF válido e senha de no mínimo 10 caracteres.'};
 if(db.collection('entregadores').findOne(e=>e.cpf===doc))
   return {ok:false,erro:'CPF já cadastrado.'};
 const entregador=db.collection('entregadores').insert({
   id:'ent_'+uid(),nome:n,cpf:doc,senhaHash:hashPassword(senha),
   ativo:true,criadoEm:nowISO(),atualizadoEm:nowISO(),
 });
 return {ok:true,entregador};
}
export function editarEntregador(db,id,{nome,senha,ativo}={}){
 const e=db.collection('entregadores').get(id);
 if(!e)return {ok:false,erro:'Entregador não encontrado.'};
 const patch={atualizadoEm:nowISO()};
 if(nome!==undefined){
   const n=String(nome).trim().slice(0,90);
   if(n.length<3)return {ok:false,erro:'Nome inválido.'};
   patch.nome=n;
 }
 if(senha){
   if(String(senha).length<10)return {ok:false,erro:'Senha deve ter no mínimo 10 caracteres.'};
   patch.senhaHash=hashPassword(senha);
 }
 if(ativo!==undefined)patch.ativo=ativo===true;
 const entregador=db.collection('entregadores').update(id,patch);
 if(senha||patch.ativo===false)for(const s of db.collection('sessions').all())
   if(s.type==='driver'&&s.userId===id)db.collection('sessions').remove(s.id);
 return {ok:true,entregador};
}
export function loginEntregador(db,cpf,senha){
 const doc=cpfDigitos(cpf);
 if(!cpfValido(doc))return null;
 const x=db.collection('entregadores').findOne(e=>e.cpf===doc);
 return x?.ativo===true&&verifyPassword(senha,x.senhaHash)?x:null;
}
export function entregaLocal(db,p){
 return !!p && p.freteOpcao?.id==='entrega_local' && !!p.pagamentoPresencial &&
   !p.pagamentoId && pedidoPresencialPorCEP(p.endereco?.cep,getSetting(db,'empresa')?.endereco?.cep) &&
   !['recusado','expirado','estornado','estorno_solicitado'].includes(p.statusFinanceiro);
}
function disponivel(db,p){
 return entregaLocal(db,p) &&
   ['em_separacao','preparando_envio'].includes(p.statusOperacional) &&
   (p.pedidoRecebidoEm || p.statusOperacional==='preparando_envio') &&
   !p.rotaEntregaId && ['aprovado','pendente'].includes(p.statusFinanceiro);
}
export function entregasDisponiveis(db){
 return db.collection('orders').all().filter(p=>disponivel(db,p))
   .sort((a,b)=>String(a.criadoEm).localeCompare(String(b.criadoEm)));
}
export function rotaAtiva(db,entregadorId){
 return db.collection('rotasEntregadores').findOne(r=>
   r.entregadorId===entregadorId&&r.status==='em_rota')||null;
}
export function proximaEntrega(rota){
 return (rota?.itens||[]).find(x=>!['entregue','nao_entregue'].includes(x.status))||null;
}
const primeiroNome=x=>String(x||'cliente').replace(/[\r\n*~_<>\x60]/g,' ')
 .trim().split(/\s+/)[0].slice(0,30)||'cliente';
const mensagem=(pedido,item,tipo)=>{
 const nome=primeiroNome(pedido.cliente?.nome);
 if(tipo==='rota')return '🛵 Olá, '+nome+'! Seu pedido da Farmácia Pague Pouco saiu para entrega.\n'+
   (item.numero>1?'Há '+(item.numero-1)+' entrega(s) antes da sua. Avisaremos quando chegar sua vez.':
   'Você é a primeira entrega da rota!')+'\n❤️ Farmácia Pague Pouco.';
 if(tipo==='indo')return '🛵 Olá, '+nome+'! O entregador da Farmácia Pague Pouco está indo para seu endereço. Fique atento! ❤️';
 if(tipo==='chegou')return '📍 Olá, '+nome+'! Nosso entregador chegou ao seu endereço com o pedido.';
 return '✅ Seu pedido foi entregue! Obrigado por comprar na Farmácia Pague Pouco. ❤️';
};
export function avisoRota(db,rota,pedidoId,tipo){
 const item=rota?.itens?.find(i=>i.pedidoId===pedidoId);
 const p=db.collection('orders').get(pedidoId);
 const cliente=p?.clienteId?db.collection('customers').get(p.clienteId):null;
 const cfg=evolutionConfig(db);
 if(!item||!entregaLocal(db,p)||!['rota','indo','chegou','entregue'].includes(tipo)||
   !cfg.ativo||!cfg.avisarCliente||!cfg.instancia||p.receberWhatsappPedido!==true||
   !autorizouWhatsappPedidos(cliente)||numeroWhatsapp(cliente.telefone)!==numeroWhatsapp(p.cliente?.telefone))
   return {ok:false,motivo:'sem_autorizacao_ou_configuracao'};
 const col=db.collection('evolutionWhatsappOutbox');
 const id='evo:rota:'+rota.id+':'+pedidoId+':'+tipo;
 if(col.get(id))return {ok:true,duplicado:true};
 col.insert({id,tipo:'entrega_rota_'+tipo,rotaId:rota.id,pedidoId,clienteId:cliente.id,
   numero:numeroWhatsapp(cliente.telefone),texto:mensagem(p,item,tipo),
   status:'fila',tentativas:0,criadoEm:nowISO()});
 return {ok:true,enfileirado:true};
}
export function iniciarRota(db,entregadorId,lista){
 const e=db.collection('entregadores').get(entregadorId);
 if(!e||e.ativo!==true)return {ok:false,erro:'Entregador inativo.'};
 if(rotaAtiva(db,entregadorId))return {ok:false,erro:'Finalize a rota atual primeiro.'};
 const ids=(Array.isArray(lista)?lista:[]).map(String);
 if(!ids.length||ids.length>20||new Set(ids).size!==ids.length)
   return {ok:false,erro:'Selecione de 1 a 20 entregas sem repetir pedidos.'};
 const pedidos=ids.map(id=>db.collection('orders').get(id));
 if(pedidos.some(p=>!disponivel(db,p)))
   return {ok:false,erro:'Uma entrega não está pronta ou já foi assumida.'};
 const agora=nowISO();
 const rota=db.collection('rotasEntregadores').insert({
   id:'rota_'+uid(),entregadorId,status:'em_rota',iniciadaEm:agora,
   itens:ids.map((pedidoId,i)=>({pedidoId,numero:i+1,status:i===0?'indo':'aguardando',
     iniciouEm:i===0?agora:null,chegouEm:null,entregueEm:null})),
 });
 for(const p of pedidos){
   db.collection('orders').update(p.id,{rotaEntregaId:rota.id,entregadorId,
     statusEntregaLocal:'em_rota',atualizadoEm:agora});
   const atualizado=atualizarStatusOperacional(db,p.id,'saiu_para_entrega',{
     por:'entregador:'+entregadorId,obs:'Entrega incluída na rota '+rota.id,
   });
   if(!atualizado.ok)throw Error('Rota inconsistente: status operacional recusado');
   avisoRota(db,rota,p.id,'rota');
   // Primeiro destino recebe o aviso individual antes do envio em massa
   // aos demais clientes, sem esperar o processamento de toda a fila.
   if(p.id===ids[0])avisoRota(db,rota,p.id,'indo');
 }
 return {ok:true,rota};
}
export function atualizarEntrega(db,{entregadorId,rotaId,pedidoId,acao,recebimento={}}){
 const e=db.collection('entregadores').get(entregadorId);
 const rota=db.collection('rotasEntregadores').get(rotaId);
 if(!e?.ativo||!rota||rota.entregadorId!==entregadorId||rota.status!=='em_rota')
   return {ok:false,erro:'Rota encerrada ou acesso não autorizado.'};
 const primeiro=proximaEntrega(rota);
 if(!primeiro||primeiro.pedidoId!==pedidoId)
   return {ok:false,erro:'Respeite a sequência das entregas.'};
 const p=db.collection('orders').get(pedidoId);
 if(!p||p.rotaEntregaId!==rota.id||!entregaLocal(db,p)||
   p.statusOperacional!=='saiu_para_entrega')
   return {ok:false,erro:'Pedido alterado. Solicite conferência administrativa.'};
 const agora=nowISO(),itens=rota.itens.map(x=>({...x}));
 const item=itens.find(x=>x.pedidoId===pedidoId);
 if(acao==='cheguei'){
   if(item.status!=='indo')return {ok:false,erro:'Esta entrega não está a caminho.'};
   item.status='chegou';item.chegouEm=agora;
   db.collection('rotasEntregadores').update(rota.id,{itens,atualizadaEm:agora});
   db.collection('orders').update(p.id,{statusEntregaLocal:'chegou',
     entregadorChegouEm:agora,atualizadoEm:agora});
   avisoRota(db,rota,p.id,'chegou');
   return {ok:true,rota:db.collection('rotasEntregadores').get(rota.id)};
 }
 if(!['conclui','problema'].includes(acao))
   return {ok:false,erro:'Ação não permitida.'};
 if(acao==='conclui'){
   if(item.status!=='chegou')return {ok:false,erro:'Marque Cheguei antes de concluir.'};
   if(p.statusFinanceiro==='pendente'){
     const v=validarRecebimentoPresencial(recebimento);
     if(!v.ok)return {ok:false,erro:v.erro};
     const r=atualizarStatusFinanceiro(db,p.id,'aprovado',{
       por:'Entregador '+e.nome,obs:'Pagamento recebido presencialmente na entrega.',
     });
     if(!r.ok)return {ok:false,erro:r.erro};
     db.collection('orders').update(p.id,{pagamentoPresencial:{
       ...p.pagamentoPresencial,status:'recebido',confirmadoEm:agora,
       confirmadoPor:'Entregador '+e.nome,recebimento:v.recebimento,
     }});
     const pago=db.collection('orders').get(p.id);
     enfileirarEvolution(db,pago,'cliente_pago');
     enfileirarEvolution(db,pago,'responsavel_pago');
   }else if(p.statusFinanceiro!=='aprovado'){
     return {ok:false,erro:'Pagamento depende de conferência da farmácia.'};
   }
   const concluido=atualizarStatusOperacional(db,p.id,'entregue',{
     por:'Entregador '+e.nome,obs:'Entrega concluída via painel do entregador.',
   });
   if(!concluido.ok)return {ok:false,erro:concluido.erro};
   item.status='entregue';item.entregueEm=agora;
   db.collection('orders').update(p.id,{statusEntregaLocal:'entregue',
     entregadorEntregouEm:agora,atualizadoEm:agora});
 }else{
   if(!['indo','chegou'].includes(item.status))
     return {ok:false,erro:'Entrega não está em andamento.'};
   item.status='nao_entregue';item.problemaEm=agora;
   db.collection('orders').update(p.id,{
     statusEntregaLocal:'pendencia_entrega',entregaPendenciaEm:agora,atualizadoEm:agora,
   });
 }
 const proximo=itens.find(x=>x.status==='aguardando');
 if(proximo){proximo.status='indo';proximo.iniciouEm=agora;}
 const acabou=itens.every(x=>['entregue','nao_entregue'].includes(x.status));
 db.collection('rotasEntregadores').update(rota.id,{
   itens,atualizadaEm:agora,...(acabou?{status:'concluida',encerradaEm:agora}:{}),
 });
 if(acao==='conclui')avisoRota(db,rota,p.id,'entregue');
 if(proximo){
   db.collection('orders').update(proximo.pedidoId,{
     statusEntregaLocal:'indo',atualizadoEm:agora,
   });
   avisoRota(db,rota,proximo.pedidoId,'indo');
 }
 return {ok:true,rota:db.collection('rotasEntregadores').get(rota.id)};
}
export function resumoRotas(db){
 return db.collection('rotasEntregadores').all()
   .sort((a,b)=>String(b.iniciadaEm).localeCompare(String(a.iniciadaEm)))
   .slice(0,30).map(r=>({
     ...r,nomeEntregador:db.collection('entregadores').get(r.entregadorId)?.nome||'Inativo',
   }));
}
