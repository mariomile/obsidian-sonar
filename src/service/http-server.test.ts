import { describe, expect, it } from 'vitest';
import {
  createBearerToken,
  hasValidBearer,
  isAllowedLoopbackHost,
} from './http-server.ts';

describe('Sonar HTTP API host validation', () => {
  it('accepts only the loopback hostnames for the configured port', () => {
    expect(isAllowedLoopbackHost('127.0.0.1:51361', 51361)).toBe(true);
    expect(isAllowedLoopbackHost('localhost:51361', 51361)).toBe(true);
  });

  it('rejects DNS-rebinding and malformed hosts', () => {
    expect(isAllowedLoopbackHost('attacker.example:51361', 51361)).toBe(false);
    expect(isAllowedLoopbackHost('localhost.attacker.example:51361', 51361)).toBe(false);
    expect(isAllowedLoopbackHost('127.0.0.1:9999', 51361)).toBe(false);
    expect(isAllowedLoopbackHost(undefined, 51361)).toBe(false);
  });
});

describe('Sonar HTTP API bearer authentication', () => {
  it('accepts only the generated token', () => {
    const { token, hash } = createBearerToken();
    expect(hasValidBearer(`Bearer ${token}`, hash)).toBe(true);
    expect(hasValidBearer('Bearer wrong', hash)).toBe(false);
    expect(hasValidBearer(undefined, hash)).toBe(false);
  });
});
