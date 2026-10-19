/** Replaces the given secrets and anything shaped like a Distr token, a JWT or a target secret with [REDACTED]. */
export function redact(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.replaceAll(secret, '[REDACTED]');
  }
  return redacted
    .replace(/(targetSecret=)[^&"\s]+/g, '$1[REDACTED]')
    .replace(/(DISTR_TARGET_SECRET[=:] *)\S+/g, '$1[REDACTED]')
    .replace(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g, '[REDACTED]')
    .replace(/distr-[0-9A-Za-z]{22}_[0-9A-Za-z]{49}/g, '[REDACTED]')
    .replace(/distr-[0-9a-f]{32}/g, '[REDACTED]');
}
