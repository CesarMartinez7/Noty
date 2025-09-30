# Notys Quickstart

This project is a Visual Studio Code extension that adds a custom sidebar using HTML. The extension is structured for easy development and testing.

## Folder Structure

- `package.json` — Extension manifest, defines commands and contributions.
- `src/extension.ts` — Main entry point. Handles activation and command registration.
- `src/sidebar.ts` — Implements the sidebar webview using HTML.
- `media/` — Static assets (CSS, images, JS) for the sidebar UI.
- `test/` — Contains automated tests for your extension.

## Getting Started

1. **Install dependencies**  
   Run `npm install` in the project root.

2. **Launch the extension**  
   Press `F5` in VS Code to open a new window with your extension loaded.

3. **Open the sidebar**  
   Use the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and type your extension's command to show the sidebar.

## Development Workflow

- Edit `src/extension.ts` and `src/sidebar.ts` to update extension logic or sidebar UI.
- Reload the extension window (`Ctrl+R` or `Cmd+R` on Mac) to see changes.
- Use breakpoints and the debug console for troubleshooting.

## Testing

- Open the debug view (`Ctrl+Shift+D` or `Cmd+Shift+D` on Mac).
- Select `Extension Tests` from the launch configuration dropdown.
- Press `F5` to run tests.
- Add or modify tests in `test/suite/extension.test.ts`.

## Resources

- [VS Code Extension API Reference](https://code.visualstudio.com/api)
- [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
