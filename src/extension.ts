import * as vscode from "vscode";
import axios from "axios";

/* --------------------------------------------------------------
   Secure API-key storage (Groq)
   -------------------------------------------------------------- */
const KEY_NAME = "groqApiKey";

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
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  status.text = "$(comment-discussion) Gen Comments";
  status.command = "codeCommentGenerator.generateComments";
  status.tooltip = "Generate AI comments for selected code";
  status.show();
  context.subscriptions.push(status);

  /* ---- Set Groq API key ---- */
  context.subscriptions.push(
    vscode.commands.registerCommand("codeCommentGenerator.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your Groq API key",
        password: true,
        placeHolder: "gsk_…",
        ignoreFocusOut: true,
      });
      if (!key) {
        vscode.window.showWarningMessage("Cancelled – no key saved.");
        return;
      }
      await setKey(context, key);
      vscode.window.showInformationMessage("Groq API key saved securely.");
    })
  );

  /* ---- Generate line-by-line comments ---- */
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
        const fullText = sel.isEmpty
          ? editor.document.getText()
          : editor.document.getText(sel);

        if (!fullText.trim()) {
          vscode.window.showWarningMessage("No code to comment.");
          return;
        }

        const apiKey = await getKey(context);
        if (!apiKey) {
          vscode.window.showErrorMessage(
            "Groq API key missing. Run **CodeCommentGenerator: Set Groq API Key** first."
          );
          return;
        }

        // Split into non-empty lines, preserve original line numbers
        const lines = fullText.split(/\r?\n/).filter(l => l.trim());
        const lineOffsets: number[] = []; // start offset of each line in the original range
        let offset = sel.start.line;
        let charOffset = sel.start.character;
        for (const line of fullText.split(/\r?\n/)) {
          if (line.trim()) { lineOffsets.push(offset); }
          offset++;
          if (offset > sel.end.line) { break; }
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Generating inline comments…",
            cancellable: true,
          },
          async (progress) => {
            const comments: { line: number; text: string }[] = [];

            // Batch request: send all lines at once to Groq
            try {
              progress.report({ increment: 0, message: "Sending to Groq…" });
              const resp = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                  model: "llama-3.3-70b-versatile",
                  temperature: 0.1,
                  max_tokens: 1500,
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are a concise inline-comment bot. " +
                        "For each line of code, return **exactly one short comment (1 line, <80 chars)** prefixed with '// ' (JS/TS) or '# ' (Python). " +
                        "Do **NOT** include function-level JSDoc, empty lines, or the original code. " +
                        "Separate comments with a single newline. " +
                        "Example input:\nfunc(a)\n  return a * 2\nExample output:\n// call func\n// double the value"
                    },
                    { role: "user", content: lines.join("\n") }
                  ],
                },
                {
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                  },
                  timeout: 45_000,
                }
              );

              const raw = resp.data.choices[0].message.content.trim();
              const commentLines = raw.split(/\r?\n/).filter((c: string) => c.trim());

              // Match comments to original lines (ignore mismatches gracefully)
              for (let i = 0; i < Math.min(lines.length, commentLines.length); i++) {
                const origLineNo = lineOffsets[i];
                const comment = commentLines[i].replace(/^\/\/\s?|^#\s?/, "").trim();
                if (comment) { comments.push({ line: origLineNo, text: `// ${comment}` }); }
              }
            } catch (err: any) {
              const msg =
                err.response?.data?.error?.message ||
                err.message ||
                "Network error";
              vscode.window.showErrorMessage(`Groq error: ${msg}`);
              return;
            }

            // Insert comments in reverse order to preserve positions
            progress.report({ increment: 50, message: "Inserting comments…" });
            await editor.edit((edit) => {
              for (let i = comments.length - 1; i >= 0; i--) {
                const { line, text } = comments[i];
                const pos = new vscode.Position(line, 0);
                edit.insert(pos, `${text}\n`);
              }
            });

            vscode.window.showInformationMessage("Inline comments added!");
          }
        );
      }
    )
  );
}

export function deactivate() { }