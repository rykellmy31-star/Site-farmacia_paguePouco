import test from 'node:test';
import assert from 'node:assert/strict';
import {vigenciasPromocaoInova} from '../src/lib/rotulos-vigencia-inova.js';
import {precoPromocaoInovaVigente} from '../src/lib/inovafarma-promocoes-precos.js';
import {telaProdutos} from '../src/views/admin/catalogo.js';
const data=new Date('2026-11-03T16:00:00Z'); // terça-feira Bahia
const preco=2000;
const produto={id:'p',nome:'Sabonete',sku:'1',slug:'sabonete',
  categoriaId:'s',imagens:[],precoCentavos:preco,estoque:{quantidade:5,minimo:1},ativo:false,
  inovaPromocoes:[{nome:'TERÇA DO SABONETE',inicio:'2026-11-01',fim:'2026-11-30',
   diaSemana:'terca',precoVendaCentavos:2000,precoPromocionalCentavos:1500}]
};
test('mostra dia semanal real e início/fim do arquivo Inova',()=>{
 const t=vigenciasPromocaoInova(produto,data);
 assert.equal(t.length,1);
 assert.match(t[0].texto,/Toda terça-feira/);
 assert.match(t[0].texto,/01\/11\/2026/);
 assert.match(t[0].texto,/30\/11\/2026/);
 assert.match(t[0].estado,/Vigente agora/);
});
test('campanha em período fixo exibe de/até; não inventa dia semanal',()=>{
 const p={...produto,inovaPromocoes:[{inicio:'2026-11-05',fim:'2026-11-12',
   diaSemana:null,precoVendaCentavos:2000,precoPromocionalCentavos:1600}]};
 const x=vigenciasPromocaoInova(p,data);
 assert.match(x[0].texto,/Programada: De 05\/11\/2026 até 12\/11\/2026/);
 assert.doesNotMatch(x[0].texto,/terça/);
});
test('campanha semanal não aplica desconto fora do dia da semana',()=>{
 const qua=new Date('2026-11-04T16:00:00Z');
 assert.equal(precoPromocaoInovaVigente(produto,qua),null);
 assert.equal(precoPromocaoInovaVigente(produto,data),1500);
 assert.match(vigenciasPromocaoInova(produto,qua)[0].texto,/Programada para o dia da semana/);
});
test('campanhas vencidas recebem legenda Encerrada; registros inválidos são ocultados',()=>{
 const p={...produto,inovaPromocoes:[{
  ...produto.inovaPromocoes[0],inicio:'2026-10-01',fim:'2026-10-31'
 },{inicio:'2026-11-99',fim:'2026-11-99',diaSemana:'quinta'}]};
 const rotulos=vigenciasPromocaoInova(p,data);
 assert.equal(rotulos.length,1);
 assert.match(rotulos[0].texto,/Encerrada: Toda terça-feira/);
});
test('na listagem aparecem datas e dias sem alterar HTML de preços ou cadastro',()=>{
 const cats={get:id=>id==='s'?{nome:'Sabonetes'}:null};
 const ctx={db:{collection:n=>n==='categories'?cats:null},
  adminUser:{role:'super_admin',id:'super1'},csrf:'TOKEN_TESTE',
  settings:{empresa:{nomeFantasia:'Farmácia exemplo'},tema:{}},
  req:{pathname:'/admin/produtos',query:new URLSearchParams()}};
 const html=telaProdutos(ctx,{produtos:[produto],total:1,pagina:1,porPagina:25,
  busca:'',categorias:[{id:'s',nome:'Sabonetes'}],filtros:{categoria:'',status:''}});
 assert.match(html,/Toda terça-feira/);
 assert.match(html,/01\/11\/2026/);
 assert.match(html,/Organizar categorias sem classificação/);
});
