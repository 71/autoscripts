import * as vsc from "vscode";

declare namespace global {
  /**
   * A reference to the `vscode` module.
   */
  export const vscode: typeof vsc;

  /**
   * Writes the given string to the file at the given path, relatively to the
   * current file.
   */
  export function output(filename: string, content: string): Promise<void>;

  /**
   * Writes the given object using JSON to the file at the given path,
   * relatively to the current file.
   */
  export function output(filename: string, json: any): Promise<void>;

  /**
   * Returns the body of the given function as a string.
   */
  export function getFunctionCode(f: (...args: readonly any[]) => any): string;
}
