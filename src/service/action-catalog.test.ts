import { describe, it, expect, vi } from 'vitest';
import { ActionCatalog, isDestructive, type CommandLike } from './action-catalog.ts';

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

  describe('isDestructive', () => {
    it('always flags strong data-destroying verbs', () => {
      expect(isDestructive('Delete current file app:delete-file')).toBe(true);
      expect(isDestructive('Move file to trash app:trash-file')).toBe(true);
      expect(isDestructive('Wipe workspace x:wipe')).toBe(true);
      expect(isDestructive('Purge cache x:purge-cache')).toBe(true);
      expect(isDestructive('Overwrite daily note x:overwrite')).toBe(true);
    });

    it('flags weak verbs only when paired with a data noun', () => {
      expect(isDestructive('Clear search history search:clear-history')).toBe(true);
      expect(isDestructive('Remove all attachments x:remove-attachments')).toBe(true);
      expect(isDestructive('Reset vault settings x:reset-vault')).toBe(true);
    });

    it('does not flag weak verbs on transient UI state', () => {
      expect(isDestructive('Clear formatting editor:clear-formatting')).toBe(false);
      expect(isDestructive('Reset zoom window:reset-zoom')).toBe(false);
      expect(isDestructive('Remove active filter x:remove-filter')).toBe(false);
      expect(isDestructive('Clear selection editor:clear-selection')).toBe(false);
    });

    it('requires word boundaries, not substrings', () => {
      expect(isDestructive('Undelete note x:undelete')).toBe(false);
      expect(isDestructive('Nuclear theme toggle x:nuclear')).toBe(false);
    });
  });

  it('match() returns only subsequence-matching actions', () => {
    const ids = make().match('annsel').map((a) => a.id);
    expect(ids).toContain('aiditor:annotate-selection');
    expect(ids).not.toContain('editor:toggle-bold');
  });

  it('run() executes the command by id and reports it ran', () => {
    const exec = vi.fn();
    const result = make(exec).run('editor:toggle-bold');
    expect(exec).toHaveBeenCalledWith('editor:toggle-bold');
    expect(result).toEqual({ ok: true, destructive: false });
  });

  it('run() reports a destructive action as such', () => {
    expect(make().run('app:delete-file')).toEqual({ ok: true, destructive: true });
  });

  it('run() returns ok:false for an unknown id without executing', () => {
    const exec = vi.fn();
    expect(make(exec).run('nope:missing')).toEqual({ ok: false, destructive: false });
    expect(exec).not.toHaveBeenCalled();
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
