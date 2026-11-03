import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inventarioFabricantesFotos} from '../src/lib/fabricantes-fontes.js';

test('inventário fabricantes funciona com dados de produtos e marca distinta',()=>{
 const rows=[
  {fabricante:'Dailus',marca:'Choco Cherry',ean:'07894222042381',imagens:[]},
  {fabricante:' dailus ',marca:'Dailus',ean:'7894222042381',imagens:[{url:'/uploads/a.png'}]},
  {fabricante:'EMS',marca:'Marca própria',ean:'7894222042381',imagens:[]},
  {fabricante:'',marca:'Colorama',ean:'7894222042381',imagens:[]},
  {fabricante:'',marca:'',ean:'inválido',imagens:[]},
  {fabricante:'Rascunho',marca:'Rascunho',imagens:[],inovaArquivado:{em:'2026-11-01'}},
 ];
 const d=inventarioFabricantesFotos(rows);
 assert.equal(d.total,5);
 assert.equal(d.semFoto,4);
 assert.equal(d.comEan,4);
 assert.equal(d.semFabricante,2);
 assert.equal(d.quantidadeFabricantes,4);
 assert.equal(d.fabricantes.filter(x=>x.integracaoOficial).length,1);
 assert.equal(d.fabricantes.find(x=>x.fabricante.toLowerCase()==='dailus').produtos,2);
 assert.equal(d.fabricantes.find(x=>x.fabricante==='EMS').semFoto,1);
 assert.equal(d.fabricantes.find(x=>x.fabricante==='Colorama').tipoOrigem,'marca');
 assert.equal(d.fabricantes.find(x=>x.fabricante==='Não informado').tipoOrigem,'não informado');
 assert.equal(d.fabricantes.some(x=>x.fabricante==='Rascunho'),false);
});

test('relatório não muta dados e reconhece fonte oficial só onde conectada',()=>{
 const p={fabricante:'EMS',marca:'Genérico',ean:'7894222042381',imagens:[]};
 const original=JSON.stringify(p);
 const d=inventarioFabricantesFotos([p]);
 assert.equal(JSON.stringify(p),original);
 assert.equal(d.fabricantes[0].integracaoOficial,false);
 assert.ok(d.fontesGenericas.includes('Open Beauty Facts'));
 const vazio=inventarioFabricantesFotos([]);
 assert.equal(vazio.quantidadeFabricantes,0);
 assert.deepEqual(vazio.fabricantes,[]);
});

test('inventário vem do banco protegido e está linkado na lista de produtos',()=>{
 const root=new URL('../',import.meta.url);
 const routes=readFileSync(new URL('src/routes/admin.js',root),'utf8');
 const view=readFileSync(new URL('src/views/admin/catalogo.js',root),'utf8');
 assert.match(routes,/app\.get\('\/admin\/produtos\/fontes-de-imagens'/);
 assert.match(routes,/if\(!guard\(req,res,'produtos\.ver'\)\)return/);
 assert.match(routes,/inventarioFabricantesFotos\(db\.collection\('products'\)\.all\(\)\)/);
 assert.match(view,/e\(grupo\.fabricante\)/);
 assert.match(view,/e\(grupo\.marcas\.join/);
 assert.match(view,/href="\/admin\/produtos\/fontes-de-imagens"/);
});

test('buscador de fotos leva fabricante real do cadastro para verificação do SKU',()=>{
 const root=new URL('../',import.meta.url);
 const admin=readFileSync(new URL('src/routes/admin.js',root),'utf8');
 const js=readFileSync(new URL('public/js/admin.js',root),'utf8');
 const en=readFileSync(new URL('src/lib/enriquecimento-ean.js',root),'utf8');
 assert.match(admin,/fabricanteProduto:String\(cadastrado\.fabricante\|\|''\)/);
 assert.match(admin,/fabricanteProduto:cleanText\(entrada\?\.fabricante,100\)/);
 assert.match(admin,/fabricante:req\.query\.get\('fabricante'\)/);
 assert.match(js,/fabricante:String\(formEAN\?\.querySelector\('\[name="fabricante"\]'\)/);
 assert.match(js,/fabricante:contexto\.fabricante\|\|''/);
 assert.match(en,/fabricanteProduto=''/);
 assert.match(en,/String\(fabricanteProduto\|\|''\)/);
});
