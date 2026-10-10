/**
 * Timeline Command History (Undo / Redo Engine)
 * Implements the GoF Command & Memento Pattern for reversible non-linear editing operations.
 */

export interface TimelineCommand {
  id: string;
  description: string;
  execute: () => void;
  undo: () => void;
}

export class TimelineCommandHistory {
  private undoStack: TimelineCommand[] = [];
  private redoStack: TimelineCommand[] = [];
  private maxDepth = 60;

  /**
   * Pushes a new command that was already executed or executes it now.
   */
  public record(command: TimelineCommand) {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = []; // New actions invalidate redo stack
  }

  /**
   * Executes a command and pushes it to history.
   */
  public execute(command: TimelineCommand) {
    command.execute();
    this.record(command);
  }

  /**
   * Reverts the most recent timeline command.
   */
  public undo(): string | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    return cmd.description;
  }

  /**
   * Re-applies the most recently undone timeline command.
   */
  public redo(): string | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.execute();
    this.undoStack.push(cmd);
    return cmd.description;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoLabel(): string | null {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].description;
  }

  public getRedoLabel(): string | null {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].description;
  }

  public clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

export const commandHistory = new TimelineCommandHistory();
