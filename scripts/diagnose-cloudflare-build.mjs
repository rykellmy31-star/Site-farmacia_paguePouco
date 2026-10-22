/**
 * Diagnóstico seguro de Workers Builds: GET dos logs do UUID informado.
 * NUNCA imprimir linhas brutas (elas podem conter informação privada).
 * Não modifica Worker, Durable Object, pagamento, deploy ou configuração.
 */
import { analisarLogsBuild, validarUuidBuild } from '../src/lib/cloudflare-build-diagnostics.js';
const ACCOUNT_ID_ESPERADO = 'bd72cac5a83927b9fd935b34ad927dc7';
const uuid = (process.env.CLOUDFLARE_BUILD_UUID || '').trim();
const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = process.env.CLOUDFLARE_AUDIT_TOKEN || '';
const resultado = { metodo: 'GET somente leitura', destino: 'Workers Builds / logs', codigo: '' };
if (!validarUuidBuild(uuid)) resultado.codigo = 'UUID_INVALIDO_OU_AUSENTE';
else if (accountId !== ACCOUNT_ID_ESPERADO) resultado.codigo = 'CONTA_NAO_CONFIRMADA';
else if (!token) resultado.codigo = 'SEM_TOKEN_DE_LEITURA';
else {
  try {
    const resposta = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT_ID_ESPERADO +
      '/builds/builds/' + uuid + '/logs',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      },
    );
    resultado.http = resposta.status;
    if (resposta.status === 401) resultado.codigo = 'TOKEN_REJEITADO';
    else if (resposta.status === 403) resultado.codigo = 'PERMISSAO_WORKERS_CI_READ_AUSENTE';
    else if (resposta.status === 404) resultado.codigo = 'BUILD_NAO_ENCONTRADO';
    else if (!resposta.ok) resultado.codigo = 'FALHA_API_BUILDS';
    else {
      const corpo = await resposta.json();
      if (corpo?.success !== true || !Array.isArray(corpo?.result?.lines)) {
        resultado.codigo = 'RESPOSTA_INVALIDA';
      } else {
        resultado.codigo = 'LOGS_LIDOS_SEM_EXPOR_CONTEUDO';
        const analise = analisarLogsBuild(corpo.result.lines);
        resultado.categoria = analise.categoria;
        resultado.proximo_passo = analise.proximo_passo;
        resultado.logs_truncados = corpo.result.truncated === true;
      }
    }
  } catch {
    resultado.codigo = 'ERRO_DE_REDE_OU_TIMEOUT';
  }
}
console.log('CLOUDFLARE_BUILD_DIAGNOSTICO=' + JSON.stringify(resultado));
if (resultado.codigo !== 'LOGS_LIDOS_SEM_EXPOR_CONTEUDO') process.exitCode = 1;
