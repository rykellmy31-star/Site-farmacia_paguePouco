/** Sincronização assistida por arquivo CSV, sem depender da API privada do ERP.
 * O Windows envia lotes autenticados, que são estagiados. Só depois de TODOS
 * os lotes íntegros terem chegado, cada bloco é aplicado atomicamente.
 * Nenhum EAN é inventado e nenhuma aprovação sanitária é concedida. */
import crypto from 'node:crypto';
import {nowISO} from './store.js';
import {slugUnicoProduto} from './catalog.js';
import {inovaAtiva} from './inovafarma-stock.js';

const LIMITE=200, MIN_PRODUTOS=3000, MAX_PRODUTOS=12000;
const HASH=/^[a-f0-9]{64}$/;
const CODIGO=/^\d{1,20}$/;
const EAN=/^\d{8,14}$/;
const MINIMO_TOKEN=32;
const configCol='inovaRoboConfiguracao', jobsCol='inovaRoboExecucoes',
  batchesCol='inovaRoboBlocos';
const err=(erro,status=400)=>({ok:false,erro,status});
const hashToken=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
const validoInteiro=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;

export function configurarRoboInova(db,{desativar=false}={}) {
  const token=desativar?'':crypto.randomBytes(48).toString('base64url');
  const agora=nowISO();
  const col=db.collection(configCol),atual=col.get('principal');
  const obj={id:'principal',ativo:!desativar,tokenHash:token?hashToken(token):'',
    alteradoEm:agora,ultimaExecucao:atual?.ultimaExecucao||null};
  if(atual)col.update('principal',obj);
  else col.insert(obj);
  return {ativo:!desativar,token,alteradoEm:agora};
}
export function roboInovaAtivo(db) {
  const cfg=db.collection(configCol).get('principal');
  return !!cfg?.ativo && !!cfg?.tokenHash && !inovaAtiva();
}
export function autenticarRoboInova(db,auth) {
  const cfg=db.collection(configCol).get('principal');
  const token=/^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(String(auth||''))?.[1]||'';
  if(!cfg?.ativo||!cfg.tokenHash||token.length<MINIMO_TOKEN||inovaAtiva())return false;
  const recebido=Buffer.from(hashToken(token),'hex');
  const esperado=Buffer.from(cfg.tokenHash,'hex');
  return recebido.length===esperado.length&&crypto.timingSafeEqual(recebido,esperado);
}
export function consultarRoboInova(db){
  const cfg=db.collection(configCol).get('principal');
  const ult=cfg?.ultimaExecucao?db.collection(jobsCol).get(cfg.ultimaExecucao):null;
  return {ativo:!!cfg?.ativo,habilitado:roboInovaAtivo(db),ultimo:ult?{
    status:ult.status,geradoEm:ult.geradoEm,iniciadoEm:ult.iniciadoEm,
    concluidoEm:ult.concluidoEm||null,recebidos:ult.recebidos||0,
    total:ult.total,aplicados:ult.aplicados||0,
    atualizados:ult.atualizados||0,semAlteracao:ult.semAlteracao||0,
    novosInativos:ult.novosInativos||0,pendentes:ult.pendentes||0,
    detalhes:(ult.detalhes||[]).slice(-25),
  }:null};
}
function validarLote(form){
  if(!form||!HASH.test(form.arquivoHash||''))return err('Assinatura do arquivo inválida.');
  const gerado=Date.parse(form.geradoEm||'');
  const total=form.total, bloco=form.bloco, blocos=form.blocos;
  if(!Number.isFinite(gerado)||gerado>Date.now()+5*60*1000||
     gerado<Date.now()-90*24*60*60*1000||
     !Number.isSafeInteger(total)||total<MIN_PRODUTOS||total>MAX_PRODUTOS||
     !Number.isSafeInteger(blocos)||blocos!==Math.ceil(total/LIMITE)||
     !Number.isSafeInteger(bloco)||bloco<0||bloco>=blocos||
     !Array.isArray(form.itens)||form.itens.length!==
       Math.min(LIMITE,total-bloco*LIMITE))return err('Relatório incompleto, data inválida ou lote fora dos limites.',409);
  const ids=new Set();
  for(const i of form.itens){
    const nome=String(i?.nome||'').trim();
    if(!CODIGO.test(i?.codigoInterno||'')||ids.has(i.codigoInterno)||
      !nome||nome.length>220||/[<>\x00-\x1f]/.test(nome)||
      !validoInteiro(i.quantidade)||!Number.isSafeInteger(i.precoCentavos)||
      i.precoCentavos<=0||i.precoCentavos>100000000||
      typeof i.ean!=='string'||i.ean.length>25||
      typeof i.marca!=='string'||i.marca.length>80||
      /[<>\x00-\x1f]/.test(i.marca))return err('Código, preço, saldo ou descrição inválidos no bloco.',422);
    ids.add(i.codigoInterno);
  }
  return {ok:true,gerado};
}
function transacionar(db,fn){
  if(typeof db.storage?.transactionSync==='function')return db.storage.transactionSync(fn);
  return fn();
}
export function receberBlocoRoboInova(db,form) {
  if(inovaAtiva())return err('Conector oficial ativo: duas fontes não podem controlar o estoque.',409);
  const validacao=validarLote(form);
  if(!validacao.ok)return validacao;
  const col=db.collection(jobsCol),cfg=db.collection(configCol).get('principal');
  const hash=form.arquivoHash,antigo=col.get(hash);
  if(antigo?.status==='concluido')return {ok:true,concluido:true};
  if(antigo&& (antigo.total!==form.total||antigo.blocos!==form.blocos||
    antigo.geradoEm!==form.geradoEm||antigo.status==='erro'))
    return err('Identificador do arquivo reutilizado com dados diferentes.',409);
  if(cfg?.ultimaExecucao && cfg.ultimaExecucao!==hash){
    const anterior=col.get(cfg.ultimaExecucao);
    if(anterior?.status!=='concluido')return err('Outro arquivo ainda está em processamento.',409);
    if(Date.parse(form.geradoEm)<=Date.parse(anterior.geradoEm))
      return err('Relatório antigo: exporte uma posição mais recente.',409);
  }
  const id=hash+':'+form.bloco;
  const existing=db.collection(batchesCol).get(id);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(form.itens)).digest('hex');
  if(existing)return existing.fingerprint===fingerprint?
    {ok:true,duplicado:true,recebidos:antigo?.recebidos||0}:
    err('Bloco alterado após envio: será necessário investigar a exportação.',409);
  const agora=nowISO();
  try{
    return transacionar(db,()=>{
      if(!antigo) {
        col.insert({id:hash,arquivoHash:hash,geradoEm:form.geradoEm,
          total:form.total,blocos:form.blocos,recebidos:0,aplicados:0,
          status:'recebendo',iniciadoEm:agora,atualizados:0,
          semAlteracao:0,novosInativos:0,pendentes:0,detalhes:[]});
        db.collection(configCol).update('principal',{ultimaExecucao:hash});
      }
      db.collection(batchesCol).insert({id,hash,bloco:form.bloco,items:form.itens,
        fingerprint,aplicadoEm:null});
      const proximo=col.update(hash,{recebidos:(antigo?.recebidos||0)+form.itens.length});
      return {ok:true,recebidos:proximo.recebidos,total:form.total};
    });
  }catch{
    db.collections?.delete(jobsCol);db.collections?.delete(batchesCol);
    db.collections?.delete(configCol);
    return err('Falha ao registrar lote de forma segura.',500);
  }
}
function validarTodosBlocos(db,job){
  let soma=0;const codigos=new Set();
  for(let i=0;i<job.blocos;i++){
    const lote=db.collection(batchesCol).get(job.id+':'+i);
    if(!lote)return err('Aguardando todos os blocos da exportação.',409);
    soma+=lote.items.length;
    for(const item of lote.items){
      if(codigos.has(item.codigoInterno))
        return err('Código interno duplicado no relatório completo. Nenhum bloco será aplicado.',409);
      codigos.add(item.codigoInterno);
    }
  }
  return soma===job.total?{ok:true}:err('Arquivo incompleto; não aplicar saldo parcial.',409);
}
const detalhe=(it,motivo)=>({codigoInterno:it.codigoInterno,motivo});
function criarNovoInativo(db,it,agora){
  // Novo SKU nunca é ativado para venda até aprovação comercial/sanitária.
  return db.collection('products').insert({
    nome:it.nome,slug:slugUnicoProduto(db,it.nome),ean:EAN.test(it.ean)?it.ean:'',
    codigoInterno:it.codigoInterno,sku:'',marca:it.marca,fabricante:'',
    categoriaId:null,subcategoriaId:null,descricao:'',caracteristicas:{},
    imagens:[],videos:[],precoCentavos:it.precoCentavos,
    precoPromocionalCentavos:0,ativo:false,destaque:false,peso:0,
    sanitario:{classificacao:'nao_aplicavel',requerReceita:true,
      controlado:false,registroMS:'',aprovadoFarmaceutico:false},
    estoque:{quantidade:it.quantidade,reservado:0,quarentena:0,minimo:5},
    vendas:0,relacionados:[],
    inovaCatalogo:{codigoInterno:it.codigoInterno,
      revisaoSanitariaPendente:true,origem:'robo_csv_automatico',importadoEm:agora},
    criadoEm:agora,atualizadoEm:agora,
  });
}
function aplicarProduto(db,it,agora,indicadores) {
  const produtos=db.collection('products');
  const todos=produtos.all();
  const porCodigo=todos.filter(p=>String(p.codigoInterno||'')===it.codigoInterno&&!p.inovaArquivado?.em);
  const eanValido=EAN.test(it.ean);
  const porEan=eanValido?todos.filter(p=>String(p.ean||'')===it.ean&&!p.inovaArquivado?.em):[];
  if(porCodigo.length>1||porEan.length>1) {indicadores.pendentes++;return detalhe(it,'identificacao_duplicada');}
  if(porCodigo.length&&porEan.length&&porCodigo[0].id!==porEan[0].id){
    indicadores.pendentes++;return detalhe(it,'ean_pertence_a_outro_codigo');
  }
  const p=porCodigo[0]||porEan[0]||null;
  if(!p){
    criarNovoInativo(db,it,agora);
    indicadores.novosInativos++;
    return !eanValido?detalhe(it,'novo_inativo_sem_ean'):null;
  }
  if(p.inovaArquivado?.em){indicadores.pendentes++;return detalhe(it,'produto_arquivado');}
  if(porEan.length&&!porCodigo.length&&p.codigoInterno&&String(p.codigoInterno)!==it.codigoInterno){
    indicadores.pendentes++;return detalhe(it,'codigo_interno_divergente');
  }
  const estoque=p.estoque||{};
  const comprometido=Number(estoque.reservado||0)+Number(estoque.quarentena||0)+
    Number(estoque.inovaPendente||0);
  if(!Number.isSafeInteger(comprometido)||comprometido<0||
     it.quantidade<comprometido) {
    indicadores.pendentes++;return detalhe(it,'saldo_menor_que_reservas_ou_quarentena');
  }
  const alterou=Number(estoque.quantidade||0)!==it.quantidade||
    Number(p.precoCentavos||0)!==it.precoCentavos;
  if(!alterou){indicadores.semAlteracao++;return null;}
  // Não alterar título/imagem/EAN existente/categorias/promoções/ativação.
  produtos.update(p.id,{estoque:{...estoque,quantidade:it.quantidade},
    precoCentavos:it.precoCentavos,atualizadoEm:agora});
  // Auditoria compacta; nunca registrar preço de custo, CPF ou nomes de clientes.
  db.collection('stockMovements').insert({produtoId:p.id,tipo:'ajuste',
    quantidade:it.quantidade,saldoAntes:Number(estoque.quantidade||0),
    saldoDepois:it.quantidade,origem:'robo_csv_automatico',
    observacao:'Posição de estoque exportada pelo operador; lote SHA-256 validado.',
    criadoEm:agora});
  indicadores.atualizados++;
  return null;
}
export function aplicarBlocoRoboInova(db,{arquivoHash,bloco}={}) {
  if(inovaAtiva())return err('Conector oficial ligado: rotina CSV indisponível.',409);
  const job=db.collection(jobsCol).get(arquivoHash);
  if(!job||!Number.isSafeInteger(bloco)||bloco<0||bloco>=job.blocos)
    return err('Lote de sincronização não encontrado.',404);
  const lote=db.collection(batchesCol).get(arquivoHash+':'+bloco);
  if(!lote)return err('Bloco ainda não recebido.',409);
  if(lote.aplicadoEm)return {ok:true,duplicado:true,status:job.status};
  const completo=validarTodosBlocos(db,job);
  if(!completo.ok)return completo;
  // A aplicação é sequencial e reentrante. Não pode pular blocos.
  if(bloco>0&&!db.collection(batchesCol).get(arquivoHash+':'+(bloco-1))?.aplicadoEm)
    return err('Aplique o bloco anterior primeiro.',409);
  const ind={atualizados:0,semAlteracao:0,novosInativos:0,pendentes:0};
  const detalhes=[];const agora=nowISO();
  try{
    return transacionar(db,()=>{
      for(const it of lote.items){
        const item=aplicarProduto(db,it,agora,ind);
        if(item&&detalhes.length<50)detalhes.push(item);
      }
      db.collection(batchesCol).update(lote.id,{aplicadoEm:agora});
      const terminou=bloco===job.blocos-1;
      const estado=db.collection(jobsCol).update(job.id,{
        aplicados:job.aplicados+lote.items.length,
        atualizados:job.atualizados+ind.atualizados,
        semAlteracao:job.semAlteracao+ind.semAlteracao,
        novosInativos:job.novosInativos+ind.novosInativos,
        pendentes:job.pendentes+ind.pendentes,
        detalhes:[...(job.detalhes||[]),...detalhes].slice(-80),
        status:terminou?'concluido':'aplicando',
        concluidoEm:terminou?agora:null,
      });
      return {ok:true,status:estado.status,aplicados:estado.aplicados,
        total:job.total,pendentes:estado.pendentes,novosInativos:estado.novosInativos,
        atualizados:estado.atualizados};
    });
  }catch{
    for(const name of ['products','stockMovements',batchesCol,jobsCol])db.collections?.delete(name);
    return err('Erro na gravação: bloco não confirmado; repetir envio de forma segura.',500);
  }
}
