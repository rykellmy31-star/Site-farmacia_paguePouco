/** Homologação de produção apenas GET, sem login, pagamentos ou dados pessoais. */
import { verificarCloudflarePublico } from '../src/lib/cloudflare-public-smoke.js';
const resultado = await verificarCloudflarePublico();
console.log('CLOUDFLARE_SMOKE=' + JSON.stringify(resultado));
if (!resultado.aprovado) {
  console.error('Homologação pública reprovada; verificar estados HTTP reportados.');
  process.exitCode = 1;
}
