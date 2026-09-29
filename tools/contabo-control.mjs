import crypto from 'node:crypto';

const required = [
  'CONTABO_CLIENT_ID',
  'CONTABO_CLIENT_SECRET',
  'CONTABO_API_USER',
  'CONTABO_API_PASSWORD',
];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required secret: ${name}`);
  }
}

function parseCommand(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Issue body is empty.');
  let command;
  try {
    command = JSON.parse(text);
  } catch {
    throw new Error('Issue body must be valid JSON.');
  }

  const allowed = new Set([
    'list-instances',
    'get-instance',
    'start',
    'shutdown',
    'restart',
  ]);

  if (!allowed.has(command.action)) {
    throw new Error(`Unsupported action: ${command.action}`);
  }

  if (command.action !== 'list-instances') {
    const id = Number(command.instanceId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('instanceId must be a positive integer.');
    }
    command.instanceId = id;
  }

  return command;
}

async function token() {
  const body = new URLSearchParams({
    client_id: process.env.CONTABO_CLIENT_ID,
    client_secret: process.env.CONTABO_CLIENT_SECRET,
    username: process.env.CONTABO_API_USER,
    password: process.env.CONTABO_API_PASSWORD,
    grant_type: 'password',
  });

  const response = await fetch(
    'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Contabo authentication failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  if (!data.access_token) throw new Error('Contabo returned no access token.');
  return data.access_token;
}

async function api(accessToken, method, path) {
  const response = await fetch(`https://api.contabo.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-request-id': crypto.randomUUID(),
    },
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { raw: text.slice(0, 1000) }; }
  }

  if (!response.ok) {
    throw new Error(`Contabo API ${method} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  }

  return data;
}

const command = parseCommand(process.env.CONTABO_COMMAND);
const accessToken = await token();

let result;
switch (command.action) {
  case 'list-instances':
    result = await api(accessToken, 'GET', '/v1/compute/instances');
    break;
  case 'get-instance':
    result = await api(accessToken, 'GET', `/v1/compute/instances/${command.instanceId}`);
    break;
  case 'start':
  case 'shutdown':
  case 'restart':
    result = await api(
      accessToken,
      'POST',
      `/v1/compute/instances/${command.instanceId}/actions/${command.action}`,
    );
    break;
}

console.log('CONTABO_RESULT');
console.log(JSON.stringify({
  action: command.action,
  instanceId: command.instanceId ?? null,
  result,
}, null, 2));
