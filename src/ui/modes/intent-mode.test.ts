import { describe, it, expect, vi } from 'vitest';
import { IntentMode } from './intent-mode.ts';

describe('IntentMode', () => {
  it('is disabled when Exo is unavailable', async () => {
    const rows = await new IntentMode(() => false, vi.fn()).rows('do it');
    expect(rows[0]!.disabled).toBe(true);
    expect(rows[0]!.sub).toContain('not available');
  });

  it('is disabled with an empty query', async () => {
    const rows = await new IntentMode(() => true, vi.fn()).rows('  ');
    expect(rows[0]!.disabled).toBe(true);
  });

  it('previews and runs the intent', async () => {
    const ask = vi.fn();
    const rows = await new IntentMode(() => true, ask).rows('riassumi la nota');
    expect(rows[0]!.main).toBe('riassumi la nota');
    expect(rows[0]!.aux).toBe('→ Exo');
    await rows[0]!.run(false);
    expect(ask).toHaveBeenCalledWith('riassumi la nota');
  });
});
