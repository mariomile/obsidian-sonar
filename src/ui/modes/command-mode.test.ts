import { describe, it, expect, vi } from 'vitest';
import { CommandMode } from './command-mode.ts';
import { ActionCatalog, type CommandLike } from '../../service/action-catalog.ts';

const CMDS: CommandLike[] = [
  { id: 'a:save', name: 'Save' },
  { id: 'b:save', name: 'Save' },
  { id: 'x:toggle-bold', name: 'Toggle bold' },
];

function build(boosts: Record<string, number> = {}) {
  const exec = vi.fn();
  const catalog = new ActionCatalog(() => CMDS, exec);
  const frecency = {
    actionBoost: (id: string) => boosts[id] ?? 1,
    bumpAction: vi.fn(),
  };
  const onRun = vi.fn();
  return { mode: new CommandMode(catalog, frecency, () => 0, onRun), exec, frecency, onRun };
}

describe('CommandMode', () => {
  it('maps a matching action to an OmniRow', async () => {
    const { mode } = build();
    const rows = await mode.rows('bold');
    expect(rows[0]!.main).toBe('Toggle bold');
    expect(rows[0]!.key).toBe('x:toggle-bold');
  });

  it('breaks equal-score ties by action frecency', async () => {
    const { mode } = build({ 'b:save': 5 }); // both "Save" score equally on "save"
    const rows = await mode.rows('save');
    expect(rows.map((r) => r.key).slice(0, 2)).toEqual(['b:save', 'a:save']);
  });

  it('run() bumps frecency, executes, then closes', async () => {
    const { mode, exec, frecency, onRun } = build();
    const rows = await mode.rows('bold');
    await rows[0]!.run(false);
    expect(frecency.bumpAction).toHaveBeenCalledWith('x:toggle-bold', 0);
    expect(exec).toHaveBeenCalledWith('x:toggle-bold');
    expect(onRun).toHaveBeenCalled();
  });

  it('shows a disabled hint when there are no matches', async () => {
    const { mode } = build();
    const rows = await mode.rows('zzzzz');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.disabled).toBe(true);
  });
});
