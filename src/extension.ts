// @ts-nocheck

// The module 'vscode' contains the VS Code extensibility API
import * as vscode from "vscode";
import { CustomSidebarViewProvider } from "./customSidebarViewProvider";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Solo se ejecutará una vez cuando tu extensión se active.
  console.log('Felicidades, tu extensión "Notys" está activa!');

  // Registra la vista de la barra lateral.
  // Es la parte más importante para que tu extensión funcione.
  const provider = new CustomSidebarViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CustomSidebarViewProvider.viewType,
      provider
    )
  );

  // Puedes dejar este comando si lo tienes en el package.json
  // pero su implementación es opcional si solo se usa para activar la extensión.
  context.subscriptions.push(
    vscode.commands.registerCommand("vscodeSidebar.menu.view", () => {
      vscode.window.showInformationMessage("Notys: ¡Menú/Título de la extensión clickeado!");
    })
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}