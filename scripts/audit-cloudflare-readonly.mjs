/**
 * Auditoria estritamente de leitura, restrita ao Worker de produção já publicado.
 * Jamais imprimir tokens, respostas da API, nomes de outros scripts ou valores
 * de variables/secrets. Não chama endpoints POST, PUT, PATCH ou DELETE.
 */
const WORKER = 'site-farmacia-paguepouco';
const ACCOUNT_FROM_DEPLOY = 'bd72cac5a83927b9fd935b34ad927dc7';
const token = process.env.CLOUDFLARE_AUDIT_TOKEN || '';
const declaredAccount = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const result = { worker: WORKER, method: 'GitHub Actions / API Cloudflare somente leitura' };
if (!declaredAccount) {
  result.status = 'SEM_CLOUDFLARE_ACCOUNT_ID_NESTE_REPOSITORIO';
  console.log('CLOUDFLARE_AUDIT=' + JSON.stringify(result));
  process.exit(0);
}
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
    const meta = settings.json?.result || {};
    const bindings = Array.isArray(meta.bindings) ? meta.bindings : [];
    const possui = (nome, tipo) => bindings.some(x =>
      x.name === nome && (!tipo || x.type === tipo));
    const segredo = (nome) => possui(nome, 'secret_text') || possui(nome, 'secret_key');
    const plain = (nome) => bindings.find(x => x.name === nome && x.type === 'plain_text');
    result.binding_LOJA = bindings.some(x => x.name === 'LOJA' && x.type === 'durable_object_namespace' &&
      x.class_name === 'LojaDurableObject');
    result.binding_ASSETS = possui('ASSETS', 'assets');
    result.bindings_prod = {
      MP_CREDENTIALS_KEY: segredo('MP_CREDENTIALS_KEY'),
      MP_ACCESS_TOKEN_alternativa: segredo('MP_ACCESS_TOKEN'),
      MP_WEBHOOK_SECRET_alternativa: segredo('MP_WEBHOOK_SECRET'),
      ADMIN_PASSWORD_bootstrap: segredo('ADMIN_PASSWORD'),
      PUBLIC_BASE_URL_configurada: !!plain('PUBLIC_BASE_URL'),
      PUBLIC_BASE_URL_esperada: String(plain('PUBLIC_BASE_URL')?.text || '').replace(/\\/$/, '') ===
        'https://site.farmaciapaguepouco.app',
      SESSION_SECRET: segredo('SESSION_SECRET'),
      EMAIL_SENDER: segredo('MAIL_API_KEY') || segredo('RESEND_API_KEY'),
    };
    result.runtime = {
      compatibilidade_definida: /^\\d{4}-\\d{2}-\\d{2}$/.test(String(meta.compatibility_date || '')),
      nodejs_compat: Array.isArray(meta.compatibility_flags) &&
        meta.compatibility_flags.includes('nodejs_compat'),
    };
    // Os metadados da API podem incluir valores sensíveis; NUNCA adicionar à saída.
  }
  const schedules = await request(prefix + '/' + WORKER + '/schedules');
  result.cron_triggers_http = schedules.status;
  if (schedules.status === 200) {
    result.cron_triggers_count = Array.isArray(schedules.json?.result?.schedules)
      ? schedules.json.result.schedules.length : null;
    result.durable_object_alarm_model = 'configurado_no_codigo_nao_auditavel_via_API_de_scripts';
  }
  const deployments = await request(prefix + '/' + WORKER + '/deployments');
  result.deployments_http = deployments.status;
  if (deployments.status === 200) {
    result.existe_deployment = Array.isArray(deployments.json?.result?.deployments)
      ? deployments.json.result.deployments.length > 0 : null;
  }
  result.backup_externo = 'nao_verificavel_com_este_token';
  result.pix_mp_integracao = 'credenciais_do_painel_nao_sao_verificadas_por_API_Workers';
}
console.log('CLOUDFLARE_AUDIT=' + JSON.stringify(result));
