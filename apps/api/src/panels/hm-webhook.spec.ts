import { createHash, createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { PanelConnection } from '@prisma/client';
import { encryptSecret } from '../common/crypto/secret.crypto';
import { PanelGatewayService } from './panel-gateway.service';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const API_KEY = 'hmp_test_key_123';

function gateway() {
  const config = { getOrThrow: () => KEY } as never;
  return new PanelGatewayService(config, {} as never, {} as never, {} as never);
}

function panel(type = 'hmpanel') {
  return { type, baseUrl: 'https://hm.example.com', credentialsEnc: encryptSecret(JSON.stringify({ apiToken: API_KEY }), KEY) } as PanelConnection;
}

/** What HMPanel's signWebhookBody(keyHash, body) produces. */
function hmSign(body: string) {
  const keyHash = createHash('sha256').update(API_KEY).digest('hex');
  return `sha256=${createHmac('sha256', keyHash).update(body).digest('hex')}`;
}

describe('verifyHmWebhook', () => {
  const body = JSON.stringify({ type: 'store.notify.action', payload: { ref: 'r1', action: 'approve' } });

  it('accepts what HMPanel signs with this connection key', () => {
    expect(gateway().verifyHmWebhook(panel(), Buffer.from(body), hmSign(body))).toBe(true);
  });

  it('refuses a changed body, a missing signature or a non-HMPanel connection', () => {
    expect(gateway().verifyHmWebhook(panel(), Buffer.from(body.replace('approve', 'reject')), hmSign(body))).toBe(false);
    expect(gateway().verifyHmWebhook(panel(), Buffer.from(body), undefined)).toBe(false);
    expect(gateway().verifyHmWebhook(panel('xui'), Buffer.from(body), hmSign(body))).toBe(false);
  });
});
