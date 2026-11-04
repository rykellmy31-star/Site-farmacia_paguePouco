/**
 * Legenda de vigência do InovaFarma no painel. Apenas exibição.
 * O preço continua vindo de precoPromocaoInovaVigente, a fonte do checkout.
 * Nunca inferir dia da semana ou datas que não estejam na campanha gravada.
 */
import {diaLocalFarmacia,diaSemanaLocalFarmacia} from './inovafarma-promocoes-precos.js';
const NOMES={
  segunda:'segunda-feira',terca:'terça-feira',quarta:'quarta-feira',
  quinta:'quinta-feira',sexta:'sexta-feira',sabado:'sábado',domingo:'domingo'
};
const DATA=/^\d{4}-\d{2}-\d{2}$/;
const br=v=>{
  if(!DATA.test(String(v||'')))return null;
  const [ano,mes,dia]=v.split('-').map(Number);
  const data=new Date(Date.UTC(ano,mes-1,dia));
  if(data.getUTCFullYear()!==ano||data.getUTCMonth()!==mes-1||data.getUTCDate()!==dia)
    return null;
  return v.slice(8,10)+'/'+v.slice(5,7)+'/'+v.slice(0,4);
};
export function vigenciasPromocaoInova(produto,momento=new Date()){
  const hoje=diaLocalFarmacia(momento),dia=diaSemanaLocalFarmacia(hoje);
  const registros=Array.isArray(produto?.inovaPromocoes)?produto.inovaPromocoes:[];
  const validos=[];
  for(const r of registros){
    const inicio=br(r?.inicio),fim=br(r?.fim);
    if(!inicio||!fim||r.fim<r.inicio)continue;
    if(r.diaSemana&&!NOMES[r.diaSemana])continue;
    const nomeDia=NOMES[r.diaSemana]||null;
    const agendado=r.inicio>hoje;
    const encerrado=r.fim<hoje;
    const hojeVigente=!agendado&&!encerrado&&(!r.diaSemana||r.diaSemana===dia);
    const estado=encerrado?'Encerrada':agendado?'Programada':
      hojeVigente?'Vigente agora':'Programada para o dia da semana';
    const titulo=nomeDia?'Toda '+nomeDia:'De '+inicio+' até '+fim;
    const periodo=nomeDia?' · de '+inicio+' até '+fim:'';
    const texto=estado+': '+titulo+periodo;
    validos.push({texto,estado,ativo:hojeVigente,encerrado,
      ordenacao:encerrado?2:hojeVigente?0:1,inicio:r.inicio,fim:r.fim});
  }
  validos.sort((a,b)=>a.ordenacao-b.ordenacao||a.inicio.localeCompare(b.inicio));
  const visto=new Set();
  return validos.filter(x=>{
    if(visto.has(x.texto))return false;
    visto.add(x.texto);return true;
  }).slice(0,3);
}
