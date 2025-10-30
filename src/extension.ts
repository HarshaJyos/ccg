import * as vscode from "vscode";
import axios from "axios";

/* --------------------------------------------------------------
   Secure API-key storage (encrypted)
   -------------------------------------------------------------- */
const KEY_NAME = "grokApiKey";

async function getKey(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  return await ctx.secrets.get(KEY_NAME);
}
async function setKey(ctx: vscode.ExtensionContext, key: string): Promise<void> {
  await ctx.secrets.store(KEY_NAME, key.trim());
}

/* --------------------------------------------------------------
   Activation
   -------------------------------------------------------------- */
export function activate(context: vscode.ExtensionContext) {
  /* ---- status-bar button (appears immediately) ---- */
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  status.text = "$(comment-discussion) Gen Comments";
  status.command = "codeCommentGenerator.generateComments";
  status.tooltip = "Generate AI comments for selected code";
  status.show();
  context.subscriptions.push(status);

  /* ---- 1. Set API key (run once) ---- */
  context.subscriptions.push(
    vscode.commands.registerCommand("codeCommentGenerator.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your Grok API key",
        password: true,
        placeHolder: "xai-…",
        ignoreFocusOut: true,          // prevents host kill
      });
      if (!key) {
        vscode.window.showWarningMessage("Cancelled – no key saved.");
        return;
      }
      await setKey(context, key);
      vscode.window.showInformationMessage("Grok API key saved securely.");
    })
  );

  /* ---- 2. Generate comments ---- */
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codeCommentGenerator.generateComments",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("Open a file first.");
          return;
        }

        const sel = editor.selection;
        const code = sel.isEmpty
          ? editor.document.getText()
          : editor.document.getText(sel);

        if (!code.trim()) {
          vscode.window.showWarningMessage("No code to comment.");
          return;
        }

        const apiKey = await getKey(context);
        if (!apiKey) {
          vscode.window.showErrorMessage(
            "API key missing. Run **CodeCommentGenerator: Set Grok API Key** first."
          );
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Generating comments…",
            cancellable: false,
          },
          async () => {
            try {
              const resp = await axios.post(
                "https://api.x.ai/v1/chat/completions",
                {
                  model: "grok-beta",
                  temperature: 0.3,
                  max_tokens: 1200,
                  messages: [
                    {
                      role: "system",
                      content:
                        "Return ONLY a comment block (JSDoc for JS/TS, docstring for Python, etc.). No code.",
                    },
                    { role: "user", content: code },
                  ],
                },
                {
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                  },
                  timeout: 30_000,
                }
              );

              const comment = resp.data.choices[0].message.content.trim();
              await editor.edit((e) => e.insert(sel.start, `${comment}\n`));
              vscode.window.showInformationMessage("Comments added!");
            } catch (err: any) {
              const msg =
                err.response?.data?.error?.message ||
                err.message ||
                "Network error";
              vscode.window.showErrorMessage(`Grok error: ${msg}`);
            }
          }
        );
      }
    )
  );
}

export function deactivate() {}
