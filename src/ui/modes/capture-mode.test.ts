import { describe, it, expect, vi } from 'vitest';
import { CaptureMode } from './capture-mode.ts';

function build() {
  const commit = vi.fn(async () => {});
  const onDone = vi.fn();
  return { mode: new CaptureMode(commit, () => 0, onDone), commit, onDone };
}

describe('CaptureMode', () => {
  it('is disabled with an empty query', async () => {
    const rows = await build().mode.rows('   ');
    expect(rows[0]!.disabled).toBe(true);
  });

  it('previews a bullet capture target', async () => {
    const rows = await build().mode.rows('an idea');
    expect(rows[0]!.main).toBe('an idea');
    expect(rows[0]!.sub).toContain('🌱 Capture');
    expect(rows[0]!.disabled).toBeFalsy();
  });

  it('previews a task target when the line is a checkbox', async () => {
    const rows = await build().mode.rows('[ ] do the thing');
    expect(rows[0]!.sub).toContain('Task');
  });

  it('run() commits the text then finishes', async () => {
    const { mode, commit, onDone } = build();
    const rows = await mode.rows('note this');
    await rows[0]!.run(false);
    expect(commit).toHaveBeenCalledWith('note this');
    expect(onDone).toHaveBeenCalled();
  });
});
