/**
 * Auditoria estritamente de leitura, restrita ao Worker de produção já publicado.
 * Jamais imprimir tokens, respostas da API, nomes de outros scripts ou valores
 * de variables/secrets. Não chama endpoints POST, PUT, PATCH ou DELETE.
 */
const WORKER = 'site-farmacia-paguepouco';
const ACCOUNT_FROM_DEPLOY = 'bd72cac5a83927b9fd935b34ad927dc7';
const token = process.env.CLOUDFLARE_AUDIT_TOKEN ||
  process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';
const declaredAccount = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const result = { worker: WORKER, method: 'GitHub Actions / API Cloudflare somente leitura' };
if (declaredAccount && declaredAccount !== ACCOUNT_FROM_DEPLOY) {
  result.status = 'CONTA_DIFERENTE_DA_DEPLOY';
  result.details = 'O Account ID cadastrado no repositório não corresponde ao Worker Builds publicado.';
  console.log('CLOUDFLARE_AUDIT=' + JSON.stringify(result));
  process.exit(0);
}
if (!token) {
  result.status = 'SEM_TOKEN_NESTE_REPOSITORIO';
  console.log('CLOUDFLARE_AUDIT=' + JSON.stringify(result));
  process.exit(0);
}
const request = async (path) => {
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
    // Jamais retornar bodies no log; eles podem conter configurações privadas.
    let json = null;
    if (response.ok) json = await response.json();
    return { status: response.status, json };
  } catch {
    return { status: 'NETWORK_ERROR', json: null };
  }
};
const prefix = '/accounts/' + ACCOUNT_FROM_DEPLOY + '/workers/scripts';
const scripts = await request(prefix);
result.scripts_http = scripts.status;
if (scripts.status === 200 && Array.isArray(scripts.json?.result)) {
  result.worker_found = scripts.json.result.some(x => x.id === WORKER);
  result.status = result.worker_found ? 'ACESSO_LEITURA_CONFIRMADO' : 'TOKEN_VALIDO_WORKER_NAO_ENCONTRADO';
} else {
  result.status = scripts.status === 401 ? 'TOKEN_REJEITADO'
    : scripts.status === 403 ? 'PERMISSAO_INSUFICIENTE'
    : 'FALHA_CONSULTA_WORKERS';
}
if (result.worker_found) {
  const settings = await request(prefix + '/' + WORKER + '/settings');
  result.worker_settings_http = settings.status;
  if (settings.status === 200) {
    const bindings = settings.json?.result?.bindings || [];
    result.binding_LOJA = bindings.some(x => x.name === 'LOJA' && x.type === 'durable_object_namespace');
    result.binding_ASSETS = bindings.some(x => x.name === 'ASSETS');
  }
}
console.log('CLOUDFLARE_AUDIT=' + JSON.stringify(result));
