autoscripts
===========

<details>
<summary><b>WIP</b></summary>

It basically hasn't been tested, the interface will probably change and the
extension hasn't been published. Please file an issue if you would like me to
publish this extension and/or if you have feature requests.

</details>

Autoscripts is a [VS Code](https://code.visualstudio.com) extension that takes
a list of globs, e.g.

```json
// (that's the default value)
"autoscripts.scripts": [
  "${command:autoscripts.getUserDirectory}/**/*.js",
]
```

And it executes those scripts when the configuration changes, or when their
contents change.

These scripts have access to a special [`context`](./context.d.ts) that can be
used to, for instance, output files.

In my case, I have a `settings.js` file in the [`Code/User`](
https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations)
directory which sets some configuration based on the environment and outputs
some keybindings.

```js
// Import the `path` module -- since the script is evaluated as a function, a
// regular `import from` statement does not work.
const path = await import("path");

// Update the global configuration based on some env variables.
await vscode.workspace
  .getConfiguration("terminal.external")
  .update("windowsExec", path.join(process.env.SCOOP, "shims/pwsh.exe"),
          vscode.ConfigurationTarget.Global);

// Define the keybindings.
await output("keybindings.json", [
  {
    key: "w",
    command: "dance.run",
    args: {
      code: getFunctionCode(async () => {
        const editor = vscode.window.activeTextEditor,
              prev = editor.selections;

        try {
          await dance.execute('.objects.performSelection', { object: 'word', action: 'select' });
        } catch (e) {
          if ((e?.message ?? '') !== 'no selections remaining') throw e;
        }

        if (editor.selections.every((x, i) => x.isEqual(prev[i]))) {
          await dance.execute(
            ['.search', { input: '\\w' }],
            ['.objects.performSelection', { object: 'word', action: 'select' }]);
        }
      }).trim().split("\n"),
    },
    when: "editorTextFocus && dance.mode == 'normal'",
  },
]);
```
