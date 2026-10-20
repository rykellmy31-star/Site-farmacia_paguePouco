/**
 * mailer.js — Envio de e-mails transacionais (recuperação de senha, pedidos).
 *
 * Situação REAL deste ambiente (registrada por honestidade técnica):
 *  - Não há credenciais SMTP e o prompt veda contratar/cadastrar serviços pagos.
 *  - Portanto, por padrão, os e-mails ficam na FILA DE SAÍDA:
 *      * gravados em disco (data/mail/*.eml)
 *      * listados no painel em Sistema → E-mails (fila de saída)
 *    Isso permite testar recuperação de senha e avisos de pedido de verdade,
 *    sem serviço pago e sem depender de terceiros.
 *  - Se SMTP_HOST/SMTP_USER/SMTP_PASS forem configurados em produção, o envio
 *    real é tentado (implementação SMTP com STARTTLS abaixo). Esse caminho
 *    NÃO foi executado/testado aqui por ausência de credenciais — ver
 *    docs/06-pendencias-bloqueios.md.
 */
import net from 'node:net';
import tls from 'node:tls';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logSystem } from './audit.js';

export function mailDir(db) {
  return db ? path.join(db.dataDir, 'mail') : path.join(config.dataDir, 'mail');
}

function buildMessage({ to, subject, html, text }) {
  const boundary = `----=_Part_${crypto.randomBytes(8).toString('hex')}`;
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const body = [
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    '',
    Buffer.from(text || html.replace(/<[^>]+>/g, ' '), 'utf8').toString('base64'),
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    `--${boundary}--`,
  ].join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

function smtpCommand(socket, cmd) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const text = chunk.toString();
      socket.removeListener('data', onData);
      resolve(text);
    };
    socket.once('data', onData);
    socket.once('error', reject);
    socket.write(cmd + '\r\n');
  });
}

async function smtpSendRaw(raw, to) {
  // Implementação mínima de cliente SMTP com STARTTLS (submissão porta 587).
  // ATENÇÃO: não executada/testada neste ambiente (sem credenciais disponíveis).
  return new Promise((resolve, reject) => {
    const socket = net.connect(config.mail.port, config.mail.host, async () => {
      try {
        let res = await waitData(socket);
        if (!res.startsWith('220')) throw new Error(`SMTP: saudação inválida (${res.trim()})`);
        res = await smtpCommand(socket, `EHLO ${config.mail.host}`);
        if (res.includes('STARTTLS')) {
          await smtpCommand(socket, 'STARTTLS');
          const secure = tls.connect({ socket, servername: config.mail.host });
          await new Promise((r) => secure.once('secureConnect', r));
          await waitData(secure);
          await smtpCommand(secure, `EHLO ${config.mail.host}`);
          await smtpCommand(secure, 'AUTH LOGIN');
          await smtpCommand(secure, Buffer.from(config.mail.user).toString('base64'));
          const authRes = await smtpCommand(secure, Buffer.from(config.mail.pass).toString('base64'));
          if (!authRes.startsWith('235')) throw new Error('SMTP: falha de autenticação');
          await smtpCommand(secure, `MAIL FROM:<${config.mail.from}>`);
          await smtpCommand(secure, `RCPT TO:<${to}>`);
          await smtpCommand(secure, 'DATA');
          secure.write(raw.replace(/\n\.\n/g, '\n..\n') + '\r\n.\r\n');
          await waitData(secure);
          await smtpCommand(secure, 'QUIT');
          secure.end();
          resolve(true);
          return;
        }
        throw new Error('SMTP: servidor não anuncia STARTTLS');
      } catch (err) {
        reject(err);
      } finally {
        try { socket.end(); } catch { /* noop */ }
      }
    });
    socket.once('error', reject);
    socket.setTimeout(20000, () => {
      socket.destroy();
      reject(new Error('SMTP: tempo limite excedido'));
    });
  });
}

function waitData(socket) {
  return new Promise((resolve, reject) => {
    socket.once('data', (c) => resolve(c.toString()));
    socket.once('error', reject);
  });
}

export async function sendMail(db, { to, subject, html, text, meta = {} }) {
  const raw = buildMessage({ to, subject, html, text });
  const record = {
    para: to,
    assunto: subject,
    html,
    texto: text || '',
    meta,
    criadoEm: new Date().toISOString(),
    status: 'fila',
    erro: null,
    arquivo: null,
  };

  if (!config.isCloudflare && config.mail.enabled && config.mail.host && config.mail.user) {
    try {
      await smtpSendRaw(raw, to);
      record.status = 'enviado';
      record.enviadoEm = new Date().toISOString();
    } catch (err) {
      record.status = 'erro';
      record.erro = err.message;
      logSystem(db, 'warn', `Falha ao enviar e-mail para ${to}: ${err.message}`);
    }
  }

  // Sempre guarda uma cópia na fila/arquivo (auditoria e modo desenvolvimento)
  if (config.isCloudflare) {
    record.raw = raw;
    record.arquivo = null;
  } else {
  const dir = mailDir(db);
  await fsp.mkdir(dir, { recursive: true });
  const fname = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.eml`;
  await fsp.writeFile(path.join(dir, fname), raw, 'utf8');
  record.arquivo = fname;
  }
  const saved = db.collection('mailOutbox').insert(record);
  return saved;
}

export function outbox(db, limit = 100) {
  return db.collection('mailOutbox')
    .all()
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
    .slice(0, limit);
}
