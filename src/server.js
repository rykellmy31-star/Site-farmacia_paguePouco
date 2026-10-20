/** Servidor Node.js local. Cloudflare usa src/cloudflare/worker.js. */
import { config } from './config.js';
import { getStore } from './lib/store.js';
import { createApplication } from './app.js';

const db = await getStore(config.dataDir);
const app = createApplication(db);

/* ------------------------------------------------------------------ */
/* Inicialização                                                       */
/* ------------------------------------------------------------------ */
const server = await app.listen(config.port, config.host);
console.log('');
console.log('  ╔══════════════════════════════════════════════════════════╗');
console.log('  ║        FARMÁCIA PAGUE POUCO — loja virtual               ║');
console.log('  ╚══════════════════════════════════════════════════════════╝');
console.log(`   Site:      http://localhost:${config.port}/`);
console.log(`   Painel:    http://localhost:${config.port}/admin`);
console.log(`   Dados:     ${db.dataDir}`);
console.log(`   Ambiente:  ${config.isDev ? 'desenvolvimento' : 'produção'} | Node ${process.version}`);
console.log(`   Pagamento: ${config.payments.provider === 'mercadopago' && config.payments.mp.accessToken ? 'Mercado Pago' : 'provedor interno de testes'}`);
console.log('');

const encerrar = async (sinal) => {
  console.log(`\n[servidor] ${sinal} recebido. Salvando dados...`);
  try {
    server.close();
    await db.close();
    console.log('[servidor] Dados salvos. Até logo!');
  } catch (e) {
    console.error('[servidor] Erro ao salvar:', e.message);
  }
  process.exit(0);
};
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('unhandledRejection', (err) => logSystem(db, 'error', `Promise rejeitada: ${err?.message || err}`));
process.on('uncaughtException', (err) => logSystem(db, 'error', `Exceção não tratada: ${err?.message || err}`));

export { app, db, server };
