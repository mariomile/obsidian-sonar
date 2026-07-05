import { type App, FuzzySuggestModal } from 'obsidian';

/** A small fuzzy picker used by the folder/tag filter chips. */
export class FilterSuggest extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly items: string[],
    private readonly placeholder: string,
    private readonly onPick: (value: string) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): string[] {
    return this.items;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onPick(item);
  }
}
