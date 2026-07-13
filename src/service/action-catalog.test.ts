import { describe, it, expect, vi } from 'vitest';
import { ActionCatalog, type CommandLike } from './action-catalog.ts';

const COMMANDS: CommandLike[] = [
  { id: 'aiditor:annotate-selection', name: 'Annotate selection' },
  { id: 'app:delete-file', name: 'Delete current file' },
  { id: 'editor:toggle-bold', name: 'Toggle bold' },
];

function make(exec = vi.fn()) {
  return new ActionCatalog(() => COMMANDS, exec, (id) => (id === 'editor:toggle-bold' ? '⌘B' : undefined));
}

describe('ActionCatalog', () => {
  it('parses source from the command id prefix', () => {
    const a = make().all();
    expect(a.find((x) => x.id === 'aiditor:annotate-selection')?.source).toBe('aiditor');
    expect(a.find((x) => x.id === 'app:delete-file')?.source).toBe('app');
  });

  it('flags destructive commands by name/id heuristic', () => {
    const a = make().all();
    expect(a.find((x) => x.id === 'app:delete-file')?.destructive).toBe(true);
    expect(a.find((x) => x.id === 'editor:toggle-bold')?.destructive).toBe(false);
  });

  it('match() returns only subsequence-matching actions', () => {
    const ids = make().match('annsel').map((a) => a.id);
    expect(ids).toContain('aiditor:annotate-selection');
    expect(ids).not.toContain('editor:toggle-bold');
  });

  it('run() executes the command by id', () => {
    const exec = vi.fn();
    make(exec).run('editor:toggle-bold');
    expect(exec).toHaveBeenCalledWith('editor:toggle-bold');
  });

  it('info() omits the run closure', () => {
    const info = make().info()[0];
    expect(info).not.toHaveProperty('run');
    expect(info).toHaveProperty('title');
  });

  it('caches all() until invalidate()', () => {
    const load = vi.fn(() => COMMANDS);
    const cat = new ActionCatalog(load, vi.fn());
    cat.all();
    cat.all();
    expect(load).toHaveBeenCalledTimes(1);
    cat.invalidate();
    cat.all();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
