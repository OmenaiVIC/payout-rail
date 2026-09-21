export class NullRecipientRegistry {
  async check({ address, application, disbursement }) {
    return {
      eligible: false,
      reason: 'no recipient registry configured',
      details: { source: 'null' },
    };
  }
}

export class PermissiveRegistry {
  async check({ address, application, disbursement }) {
    return {
      eligible: true,
      reason: null,
      details: { source: 'permissive', address, application },
    };
  }
}

export function createRecipientRegistry(mode) {
  return String(mode || 'null').toLowerCase() === 'permissive'
    ? new PermissiveRegistry()
    : new NullRecipientRegistry();
}