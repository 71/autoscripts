import * as crypto from "crypto";
import * as fs     from "fs";
import * as glob   from "glob";
import * as path   from "path";
import * as vscode from "vscode";

const extensionName = "autoscripts",
      scriptsHashes = new Map<string, string>(),
      scriptsWatchers = new Map<string, [number, fs.FSWatcher]>(),
      AsyncFunction = async function () {}.constructor as FunctionConstructor;
let generation = 0;

function createScriptContext(uri: vscode.Uri) {
  return Object.freeze({
    vscode,

    output(filename: string, content: any) {
      if (typeof content !== "string") {
        content = JSON.stringify(content, undefined, "  ");
      }
      if (!path.isAbsolute(filename)) {
        filename = path.join(uri.fsPath, "..", filename);
      }

      return new Promise<void>((resolve, reject) => {
        fs.writeFile(filename, content, "utf-8", (err) => err ? reject(err) : resolve());
      });
    },

    getFunctionCode(f: (...args: any[]) => any) {
      let str = f.toString();

      if (str[str.length - 1] !== "}") {
        return str.replace(/^.+=> */, "");  // This is a lambda, just return its body.
      }

      str = str
        .slice(0, str.length - 1)               // Remove last '}'.
        .replace(/^.+\)[\s]*(=>[\s]*)?{/, "");  // Remove until first '{' (accounting for patterns).

      if (str[0] === "\n") {
        str = str.slice(1);
      }

      // De-indent string.
      const lines = str.split("\n"),
            indents = lines
              .map((line) => (/^[\s]*[\S]/.exec(line)?.[0].length ?? 0) - 1)
              .filter((i) => i > 0);

      if (indents.length === 0) {
        return str;
      }

      const minIndent = indents.reduce((min, curr) => Math.min(min, curr));

      return lines.map((line) => line.slice(minIndent)).join("\n");
    },
  });
}

function runScript(uri: vscode.Uri, content: string) {
  try {
    const context = createScriptContext(uri),
          func = new AsyncFunction("context", ...Object.keys(context), content);

    return func(context, ...Object.values(context)) as Promise<unknown>;
  } catch (e) {
    return Promise.reject(new Error(`cannot run file ${uri}: ${e}`));
  }
}

function compareHashAndRunScript(uri: vscode.Uri, content: string) {
  const contentHash = crypto.createHash("sha1").update(content).digest("hex");

  if (scriptsHashes.get(uri.fsPath) === contentHash) {
    // If script was already in the cache, we don't need to reload it.
    return Promise.resolve();
  }

  scriptsHashes.set(uri.fsPath, contentHash);

  return runScript(uri, content);
}

function watchFileForChanges(uri: vscode.Uri) {
  const watcher = fs.watch(uri.fsPath, "utf-8");

  watcher.addListener("change", () => readAndRunScriptAtUri(uri));
  watcher.addListener("close", () => scriptsWatchers.delete(uri.fsPath));
  watcher.addListener("error", () => watcher.close());

  return watcher;
}

function readAndRunScriptAtUri(uri: vscode.Uri) {
  return vscode.workspace.fs.readFile(uri).then((data) => {
    const content = (data as Buffer).toString("utf-8");

    return compareHashAndRunScript(uri, content);
  });
}

function runScriptAtUri(uri: vscode.Uri) {
  const watcherPair = scriptsWatchers.get(uri.fsPath);

  if (watcherPair === undefined) {
    scriptsWatchers.set(uri.fsPath, [generation, watchFileForChanges(uri)]);
  } else {
    watcherPair[0] = generation;
  }

  return readAndRunScriptAtUri(uri);
}

function transformGlob(glob: string) {
  const tasks = [] as Thenable<string>[];

  for (;;) {
    const match = /\${([^:}]+):([^}]+)}/.exec(glob);

    if (match === null) {
      if (glob.length > 0) {
        tasks.push(Promise.resolve(glob));
      }
      break;
    }

    if (match.index > 0) {
      tasks.push(Promise.resolve(glob.slice(0, match.index)));
    }

    const [text, key, value] = match;

    if (key === "env") {
      tasks.push(Promise.resolve(process.env[value] ?? ""));
    } else if (key === "command") {
      tasks.push(vscode.commands.executeCommand(value).then((v) => `${v}`));
    } else {
      tasks.push(Promise.resolve(text));
    }

    glob = glob.slice(match.index + text.length);
  }

  return Promise.all(tasks).then((parts) => parts.join(""));
}

function findFiles(path: string) {
  return new Promise<readonly vscode.Uri[]>((resolve, reject) => {
    glob(path, (err, matches) => err ? reject(err) : resolve(matches.map(vscode.Uri.file)));
  });
}

function runScriptsFromGlobs(globs: readonly string[]) {
  const promises = [] as Thenable<unknown[]>[];

  if (!Array.isArray(globs)) {
    return Promise.resolve();
  }

  for (const glob of globs) {
    if (typeof glob !== "string") {
      continue;
    }

    const promise = transformGlob(glob)
      .then((glob) => findFiles(glob))
      .then((uris) => Promise.all(uris.map(runScriptAtUri)));

    promises.push(promise);
  }

  return Promise.all(promises).then(() => {});
}

function runAllScripts() {
  const configuration = vscode.workspace.getConfiguration(extensionName),
        scriptsConfig = configuration.inspect<readonly string[]>("scripts");

  if (scriptsConfig === undefined) {
    return Promise.resolve();
  }

  const promises = [] as Thenable<void>[];

  if (scriptsConfig.globalValue !== undefined) {
    promises.push(runScriptsFromGlobs(scriptsConfig.globalValue));
  }

  if (scriptsConfig.workspaceFolderValue !== undefined) {
    promises.push(runScriptsFromGlobs(scriptsConfig.workspaceFolderValue));
  }

  if (scriptsConfig.workspaceValue !== undefined) {
    promises.push(runScriptsFromGlobs(scriptsConfig.workspaceValue));
  }

  if (promises.length === 0 && scriptsConfig.defaultValue !== undefined) {
    promises.push(runScriptsFromGlobs(scriptsConfig.defaultValue));
  }

  return Promise.all(promises).then(() => {});
}

function runAllScriptsAndStopWatchingPreviousScripts() {
  generation++;

  return runAllScripts().then(() => {
    const toRemove = [] as string[];

    for (const [path, [gen, watcher]] of scriptsWatchers) {
      if (gen < generation) {
        watcher.close();
        toRemove.push(path);
      }
    }

    for (const path of toRemove) {
      scriptsWatchers.delete(path);
    }
  });
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(`${extensionName}.getUserDirectory`, () => {
      const extensionStoragePath = context.globalStorageUri.fsPath,
            extensionsStoragePath = path.dirname(extensionStoragePath),
            userDirectoryPath = path.dirname(extensionsStoragePath);

      if (path.basename(userDirectoryPath) !== "User") {
        throw new Error("cannot determine user directory");
      }

      return userDirectoryPath;
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(extensionName)) {
        runAllScriptsAndStopWatchingPreviousScripts();
      }
    }),
  );

  runAllScriptsAndStopWatchingPreviousScripts();
}

export function deactivate() {
  scriptsHashes.clear();

  scriptsWatchers.forEach(([_, watcher]) => watcher.close());
  scriptsWatchers.clear();
}
