/**
 * migrate.js — Cria/atualiza a estrutura de dados (executado automaticamente no boot).
 * Idempotente: pode ser rodado quantas vezes quiser.
 */
import { getStore } from '../src/lib/store.js';
import { ensureSettings, getSetting, setSetting } from '../src/lib/settings.js';
import { normalizeFreightConfig } from '../src/lib/freight.js';
import { config } from '../src/config.js';

const COLECOES = [
  'admins', 'customers', 'sessions', 'passwordTokens', 'carts', 'products', 'categories',
  'orders', 'payments', 'webhookEvents', 'coupons', 'pages', 'banners', 'showcases',
  'midia', 'stockMovements', 'settings', 'counters', 'auditLogs', 'systemLogs', 'mailOutbox',
];

const db = await getStore(config.dataDir);

console.log('→ Executando migrações em', db.dataDir);

// garante que todas as coleções existam (cria o arquivo vazio se necessário)
for (const nome of COLECOES) {
  db.collection(nome);
}

// configurações padrão
ensureSettings(db);

// normaliza a configuração de fretes (novos campos entram automaticamente)
const frete = getSetting(db, 'frete');
setSetting(db, 'frete', normalizeFreightConfig(frete));

// contador de pedidos
if (!db.collection('counters').get('pedido')) {
  db.collection('counters').insert({ id: 'pedido', ano: new Date().getFullYear(), sequencia: 1 });
}

// normaliza produtos antigos (campos novos)
let ajustados = 0;
db.collection('products').updateMany(
  (p) => !p.sanitario || !p.estoque || p.precoCentavos == null,
  (p) => {
    ajustados++;
    return {
      estoque: { quantidade: p.estoque?.quantidade ?? 0, minimo: p.estoque?.minimo ?? 5, reservado: p.estoque?.reservado ?? 0 },
      sanitario: { classificacao: 'nao_aplicavel', requerReceita: false, controlado: false, registroMS: '', apresentacao: '', concentracao: '', principioAtivo: '', bulaUrl: '', aprovadoFarmaceutico: false, restricaoTransporte: false, ...(p.sanitario || {}) },
      precoCentavos: p.precoCentavos ?? 0,
      precoPromocionalCentavos: p.precoPromocionalCentavos ?? 0,
      imagens: p.imagens || [],
      videos: p.videos || [],
      caracteristicas: p.caracteristicas || {},
      ativo: p.ativo !== false,
    };
  }
);

await db.flush();
const resumo = COLECOES.map((c) => `${c}: ${db.collection(c).count()}`).join('\n  ');
console.log(`  Coleções prontas:\n  ${resumo}`);
if (ajustados) console.log(`  ${ajustados} produto(s) normalizado(s).`);
await db.close();
console.log('✔ Migrações concluídas.');
