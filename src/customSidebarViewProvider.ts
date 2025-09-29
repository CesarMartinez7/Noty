// @ts-nocheck
import * as vscode from "vscode";
import { createClient, User } from "@supabase/supabase-js";
// import * as path from 'path'; // No se necesita a menos que uses assets locales

// Función de utilidad para generar un valor único (Nonce) para CSP
function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// --- CONFIGURACIÓN DE SUPABASE (CREDENCIALES REALES) ---
const SUPABASE_URL = "https://fuqaeuyfjgpuaqozsojl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1cWFldXlmamdwdWFxb3pzb2psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkwMDMxNzQsImV4cCI6MjA3NDU3OTE3NH0.LHzVFfCV45Oh1XBDFCNoVzLHyUa96xI0PMFTxlyK_0o";

// -----------------------------------------------------------

// Definición de la estructura de una Nota TAL COMO DEBE VENIR DE SUPABASE
interface Note {
  id: number;
  title: string;
  content: string;
  created_at: string;
  user_id: string;
  // ✨ NUEVAS COLUMNAS
  color: string;
  is_secret: boolean;
}

export class CustomSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "vscodeSidebar.openview";

  private _view?: vscode.WebviewView;

  private _supabaseClient: any = null;
  private _isSupabaseReady: boolean = false;
  private _user: User | null = null;
  private _notes: Note[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext<unknown>,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    this._initializeSupabase();
    this._setWebviewMessageListener(webviewView.webview);

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);
  }

  private _initializeSupabase() {
    if (this._supabaseClient) return;

    try {
      this._supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      this._isSupabaseReady = true;

      this._setupSupabaseListener();
      this._setupAuthListener();
    } catch (e) {
      console.error(
        "[Supabase] Falló la inicialización del cliente de Supabase.",
        e
      );
      this._isSupabaseReady = false;
      this._postState();
    }
  }

  // --- Comunicación con el Webview ---
  private _postState() {
    if (this._view) {
      const payload = {
        isReady: this._isSupabaseReady,
        isAuthenticated: !!this._user,
        user: this._user,
        notes: this._notes,
      };
      this._view.webview.postMessage({
        command: "updateState",
        payload,
      });
    }
  }

  private _sendToastMessage(type: "error" | "success", message: string) {
    if (this._view) {
      this._view.webview.postMessage({
        command: "toast",
        payload: { type, message },
      });
    }
  }

  // --- AUTENTICACIÓN ---
  private _setupAuthListener() {
    if (!this._supabaseClient) return;
    this._supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        if (!this._user || this._user.id !== session.user.id) {
          this._user = session.user;
          this._fetchNotes();
        }
      } else {
        if (this._user) {
          this._user = null;
          this._notes = [];
          this._postState();
        }
      }
    });
    // Llamada inicial para verificar sesión
    this._supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        this._user = session.user;
        this._fetchNotes();
      } else {
        this._user = null;
        this._postState();
      }
    });
  }

  private async _signUp(email: string, password: string) {
    if (!this._supabaseClient) return;

    const { error } = await this._supabaseClient.auth.signUp({
      email,
      password,
    });

    if (error) {
      console.error("[Supabase Auth] Error al registrar:", error);
      this._sendToastMessage("error", error.message);
    } else {
      this._sendToastMessage(
        "success",
        "Registro exitoso. Revisa tu email para confirmar la cuenta."
      );
    }
  }

  private async _signIn(email: string, password: string) {
    if (!this._supabaseClient) return;

    const { data, error } = await this._supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("[Supabase Auth] Error al iniciar sesión:", error);
      this._sendToastMessage("error", error.message);
    } else if (data.user) {
      this._sendToastMessage("success", "Sesión iniciada correctamente.");
    }
  }

  private async _signOut() {
    if (!this._supabaseClient) return;

    const { error } = await this._supabaseClient.auth.signOut();

    if (error) {
      console.error("[Supabase Auth] Error al cerrar sesión:", error);
      this._sendToastMessage("error", error.message);
    } else {
      this._sendToastMessage("success", "Sesión cerrada correctamente.");
    }
  }

  // --- CONSULTAS ASÍNCRONAS PARA SUPABASE (CRUD) ---
  private async _fetchNotes() {
    if (!this._supabaseClient || !this._user) return;

    const { data, error } = await this._supabaseClient
      .from("notes")
      .select("id, title, content, created_at, user_id, color, is_secret")
      .eq("user_id", this._user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Supabase] Error al obtener notas:", error);
      this._sendToastMessage("error", "Error al cargar las notas.");
      this._notes = [];
    } else {
      this._notes = data || [];
    }
    this._postState();
  }

  private async _addNote(newTitle: string, newContent: string) {
    if (!this._supabaseClient || !this._user || newTitle.trim().length === 0) {
      this._sendToastMessage(
        "error",
        "El título de la nota no puede estar vacío."
      );
      return;
    }

    const { error } = await this._supabaseClient.from("notes").insert([
      {
        title: newTitle.trim(),
        content: newContent.trim(),
        user_id: this._user.id,
        color: "#38a169", // Color por defecto (un verde agradable)
        is_secret: false,
      },
    ]);

    if (error) {
      console.error("[Supabase] Error al añadir nota:", error);
      this._sendToastMessage("error", "Error al crear la nota.");
    } else {
      this._sendToastMessage("success", "Nota creada y sincronizada.");
      this._fetchNotes();
    }
  }

  private async _deleteNote(id: number) {
    if (!this._supabaseClient || !this._user || !id) return;

    const { error } = await this._supabaseClient
      .from("notes")
      .delete()
      .eq("id", id)
      .eq("user_id", this._user.id);

    if (error) {
      console.error("[Supabase] Error al borrar nota:", error);
      this._sendToastMessage("error", "Error al eliminar la nota.");
    } else {
      this._sendToastMessage("success", "Nota eliminada.");
      this._fetchNotes();
    }
  }

  // Función genérica para actualizar campos de texto
  private async _updateNote(
    id: number,
    field: "title" | "content",
    newValue: string
  ) {
    if (!this._supabaseClient || !this._user || !id) return;

    if (field === "title" && newValue.trim().length === 0) {
      this._sendToastMessage(
        "error",
        "El título no puede estar vacío. La nota no se actualizó."
      );
      this._fetchNotes();
      return;
    }

    const updateObject: { [key: string]: string } = {};
    updateObject[field] = newValue.trim();

    const { error } = await this._supabaseClient
      .from("notes")
      .update(updateObject)
      .eq("id", id)
      .eq("user_id", this._user.id);

    if (error) {
      console.error("[Supabase] Error al actualizar nota:", error);
      this._sendToastMessage("error", "Error al actualizar la nota.");
    } else {
      this._sendToastMessage(
        "success",
        `${field === "title" ? "Título" : "Contenido"} actualizado.`
      );
      this._fetchNotes();
    }
  }

  // ✨ FUNCIÓN: Actualizar el color
  private async _updateNoteColor(id: number, newColor: string) {
    if (!this._supabaseClient || !this._user || !id) return;

    const { error } = await this._supabaseClient
      .from("notes")
      .update({ color: newColor })
      .eq("id", id)
      .eq("user_id", this._user.id);

    if (error) {
      console.error("[Supabase] Error al actualizar color:", error);
      this._sendToastMessage("error", "Error al cambiar el color.");
    } else {
      this._fetchNotes();
    }
  }

  // ✨ FUNCIÓN: Alternar el estado secreto
  private async _toggleNoteSecret(id: number, isSecret: boolean) {
    if (!this._supabaseClient || !this._user || !id) return;

    const { error } = await this._supabaseClient
      .from("notes")
      .update({ is_secret: isSecret })
      .eq("id", id)
      .eq("user_id", this._user.id);

    if (error) {
      console.error("[Supabase] Error al cambiar estado secreto:", error);
      this._sendToastMessage("error", "Error al cambiar el estado secreto.");
    } else {
      this._sendToastMessage(
        "success",
        `Nota ${isSecret ? "ocultada" : "mostrada"}.`
      );
      this._fetchNotes();
    }
  }

  // --- REALTIME LISTENER ---
  private _setupSupabaseListener() {
    if (!this._supabaseClient) return;

    this._supabaseClient
      .channel("notes_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notes" },
        () => {
          if (this._user) {
            this._fetchNotes();
          }
        }
      )
      .subscribe();
  }

  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async (message) => {
      const { command, payload } = message;

      switch (command) {
        case "ready":
          this._postState();
          return;
        case "signIn":
          this._signIn(payload.email, payload.password);
          return;
        case "signUp":
          this._signUp(payload.email, payload.password);
          return;
        case "signOut":
          this._signOut();
          return;
        case "addNote":
          if (this._user) await this._addNote(payload.newTitle, payload.newContent);
          return;
        case "deleteNote":
          if (this._user) await this._deleteNote(parseInt(payload.id));
          return;
        case "updateNoteTitle":
          if (this._user)
            await this._updateNote(parseInt(payload.id), "title", payload.newValue);
          return;
        case "updateNoteContent":
          if (this._user)
            await this._updateNote(parseInt(payload.id), "content", payload.newValue);
          return;
        case "updateNoteColor":
          if (this._user)
            await this._updateNoteColor(parseInt(payload.id), payload.newColor);
          return;
        case "toggleNoteSecret":
          if (this._user)
            await this._toggleNoteSecret(parseInt(payload.id), payload.isSecret);
          return;
        case "reloadNotes":
          if (this._user) {
            this._fetchNotes();
            this._sendToastMessage("success", "Notas recargadas correctamente.");
          }
          return;
      }
    });
  }

  // --- Generación de HTML (Unificado y Dinámico) ---
  private getHtmlContent(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self' https://fuqaeuyfjgpuaqozsojl.supabase.co https://cdn.jsdelivr.net">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        
        <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script nonce="${nonce}" src="https://cdn.tailwindcss.com"></script>
        
        <link rel="stylesheet" href="https://unpkg.com/modern-css-reset/dist/reset.min.css" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        
        <style>
          /* Variables de color de VS Code y Setup */
          :root {
            --bg: var(--vscode-editor-background, #1e1e1e);
            --fg: var(--vscode-editor-foreground, #d4d4d4);
            --input-bg: var(--vscode-input-background, #3c3c3c);
            --input-border: var(--vscode-input-border, #454545);
            --button-bg: var(--vscode-button-background, #0e639c);
            --button-fg: var(--vscode-button-foreground, #ffffff);
            --focus-border: var(--vscode-focusBorder, #007acc);
            --card-bg: var(--vscode-editorWidget-background, #252526);
            --border-color: var(--vscode-editorGroupHeader-tabsBorder, #454545);
          }
          
          body {
            background-color: var(--bg);
            color: var(--fg);
            padding: 1rem;
            font-family: 'Inter', sans-serif;
            height: 100vh;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: var(--focus-border) var(--input-bg);
          }

          /* Estilos para inputs y textareas */
          .note-input, #auth-form input, #new-note-title, #new-note-content {
            background-color: var(--input-bg);
            border: 1px solid var(--input-border);
            color: var(--fg);
            padding: 0.5rem 0.75rem;
            border-radius: 6px;
            transition: border-color 0.2s, box-shadow 0.2s;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
          }
          .note-input:focus, #auth-form input:focus, #new-note-title:focus, #new-note-content:focus {
            outline: none;
            border-color: var(--focus-border);
            box-shadow: 0 0 0 2px var(--focus-border);
          }

          
          .note-card {
            background: var(--card-bg); /* ← Solo color sólido */
            border: 1px solid var(--border-color);
            border-radius: 10px;
            transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            overflow: hidden;
            border-top-left-radius: 0;
            border-top-right-radius: 0;
          }


          .note-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
          }

          /* Franja de color en la parte superior */
          .note-color-stripe {
            /* ✨ CAMBIO: Mayor altura (12px) */
            height: 32px; 
            background-color: var(--note-color, var(--focus-border));
            /* ✨ CAMBIO: Quitar el radio superior */
            border-radius: 0; 
            border-bottom: 1px solid var(--border-color); /* Para darle un mejor acabado */
          }

          /* Área de contenido de la nota */
          .note-content-area {
            padding: 0.75rem 1rem 1rem 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }

          /* Inputs de título y contenido */
          .note-title-input {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--fg);
            background: transparent;
            border: none;
            padding: 0;
          }
          .note-title-input:focus {
            outline: none;
            border-bottom: 1px solid var(--focus-border);
          }
          .note-textarea {
            font-size: 0.9rem;
            line-height: 1.4;
            color: var(--fg);
            background: transparent;
            border: none;
            resize: none;
            min-height: 60px;
          }
          .note-textarea:focus {
            outline: none;
            border-bottom: 1px solid var(--focus-border);
          }

          /* Input secreto */
          .secret-input {
            font-size: 1rem;
            color: var(--vscode-errorForeground);
            background: transparent;
            border: none;
            padding: 0;
            height: 60px;
            display: flex;
            align-items: center;
          }
          .secret-input::placeholder {
            color: var(--vscode-list-deemphasizedForeground);
            opacity: 0.6;
            font-size: 0.9rem;
          }

          /* Color picker */
          .color-picker {
            border: 1px solid var(--input-border);
            border-radius: 6px;
            cursor: pointer;
            background: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
          }
          .color-picker::-webkit-color-swatch {
            border: none;
            border-radius: 6-px;
          }
          .color-picker::-moz-color-swatch {
            border: none;
            border-radius: 6px;
          }

          /* Checkbox personalizado */
          .custom-checkbox {
            appearance: none;
            width: 16px;
            height: 16px;
            border: 1px solid var(--focus-border);
            border-radius: 4px;
            cursor: pointer;
            position: relative;
            transition: background-color 0.2s;
          }
          .custom-checkbox:checked {
            background-color: var(--focus-border);
          }
          .custom-checkbox:checked::after {
            content: '✓';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: var(--button-fg);
            font-size: 10px;
          }

          /* Botones de íconos */
          .icon-button {
            background: none;
            border: none;
            padding: 0.25rem;
            cursor: pointer;
            color: var(--fg);
            transition: color 0.2s;
          }
          .icon-button:hover {
            color: var(--focus-border);
          }
        </style>
      </head>
      <body>
        <div id="app-container" class="h-full"></div>
        <div id="toast-container" class="fixed bottom-4 left-1/2 transform -translate-x-1/2 space-y-2 z-50"></div>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const appContainer = document.getElementById('app-container');
          
          function showToast(type, message) {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = 'p-3 rounded-lg shadow-lg text-sm transition-all duration-300 opacity-0 transform translate-y-4 max-w-xs';
            toast.textContent = message;
            
            if (type === 'error') {
              toast.style.backgroundColor = 'var(--vscode-errorForeground, #f48771)';
              toast.style.color = 'var(--vscode-editor-background, #1e1e1e)';
            } else if (type === 'success') {
              toast.style.backgroundColor = 'var(--vscode-terminal-ansiGreen, #33ff33)';
              toast.style.color = 'var(--vscode-editor-background, #1e1e1e)';
            }

            container.appendChild(toast);
            setTimeout(() => {
              toast.style.opacity = '1';
              toast.style.transform = 'translateY(0)';
            }, 10);
            setTimeout(() => {
              toast.style.opacity = '0';
              toast.style.transform = 'translateY(20px)';
              setTimeout(() => {
                if (container.contains(toast)) {
                  container.removeChild(toast);
                }
              }, 300);
            }, 3500);
          }

          // --- HTML Y LÓGICA DE AUTENTICACIÓN ---
          function renderAuthHtml() {
            appContainer.innerHTML = \`
              <div class="flex flex-col items-center justify-center h-full p-6">
                <div class="w-full max-w-md bg-[var(--card-bg)] rounded-xl shadow-lg p-8">
                  <div class="flex items-center justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-activityBar-foreground)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 18a2 2 0 0 0-4 0m9-7l-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11m-3 0h20"/>
                      <circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/>
                    </svg>
                    <h1 class="text-2xl font-bold ml-2" style="color: var(--vscode-activityBar-foreground);">Notys</h1>
                  </div>
                  <p class="text-sm text-center mb-8 opacity-70" style="color: var(--vscode-list-deemphasizedForeground);">
                    Bloc de notas en la nube para VS Code
                  </p>
                  
                  <div id="auth-message-box" class="p-3 mb-6 w-full text-sm text-center rounded-lg hidden" style="background-color: var(--vscode-errorForeground); color: var(--vscode-editor-background);"></div>
                  
                  <form id="auth-form" class="space-y-4">
                    <input type="email" id="auth-email" placeholder="Correo electrónico" required 
                      class="note-input w-full" aria-label="Correo electrónico"/>
                    <input type="password" id="auth-password" placeholder="Contraseña" required 
                      class="note-input w-full" aria-label="Contraseña"/>
                    
                    <button type="submit" id="sign-in-btn" 
                      class="w-full p-3 rounded-lg font-semibold text-[var(--button-fg)] bg-[var(--button-bg)] hover:bg-opacity-90 transition shadow-md flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                        <polyline points="10 17 15 12 10 7"></polyline>
                        <line x1="15" y1="12" x2="3" y2="12"></line>
                      </svg>
                      Iniciar Sesión
                    </button>

                    <button type="button" id="sign-up-btn" 
                      class="w-full p-3 rounded-lg font-semibold bg-[var(--input-bg)] text-[var(--fg)] hover:bg-opacity-90 transition shadow-md flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="8.5" cy="7" r="4"></circle>
                        <line x1="20" y1="8" x2="20" y2="14"></line>
                        <line x1="23" y1="11" x2="17" y2="11"></line>
                      </svg>
                      Registrarse
                    </button>
                  </form>

                  <p class="text-xs text-center mt-6 opacity-60" style="color: var(--vscode-list-deemphasizedForeground);">
                    Powered by Supabase
                  </p>
                </div>
              </div>
            \`;

            const form = document.getElementById('auth-form');
            const emailInput = document.getElementById('auth-email');
            const passwordInput = document.getElementById('auth-password');
            const signUpBtn = document.getElementById('sign-up-btn');
            const msgBox = document.getElementById('auth-message-box');

            function showAuthMessage(type, message) {
              msgBox.textContent = message;
              msgBox.classList.remove('hidden');
              
              if (type === 'error') {
                msgBox.style.backgroundColor = 'var(--vscode-errorForeground)';
                msgBox.style.color = 'var(--vscode-editor-background)';
              } else if (type === 'success') {
                msgBox.style.backgroundColor = 'var(--vscode-terminal-ansiGreen)';
                msgBox.style.color = 'var(--vscode-editor-background)';
              }
              if (type === 'success') {
                setTimeout(() => msgBox.classList.add('hidden'), 3000);
              }
            }
            
            form.addEventListener('submit', (e) => {
              e.preventDefault();
              const email = emailInput.value;
              const password = passwordInput.value;
              
              if (e.submitter.id === 'sign-in-btn') {
                msgBox.classList.add('hidden');
                if (email && password) {
                  vscode.postMessage({ command: 'signIn', payload: { email, password } });
                } else {
                  showAuthMessage('error', 'Por favor, introduce email y contraseña.');
                }
              }
            });

            signUpBtn.addEventListener('click', () => {
              const email = emailInput.value;
              const password = passwordInput.value;
              msgBox.classList.add('hidden');

              if (email && password) {
                vscode.postMessage({ command: 'signUp', payload: { email, password } });
              } else {
                showAuthMessage('error', 'Por favor, introduce email y contraseña para registrarte.');
              }
            });
          }

          // --- HTML Y LÓGICA DE NOTAS ---
          function renderNotesHtml(user, notes) {
            const listHtml = notes.map(note => {
              const contentType = note.is_secret ? 'password' : 'textarea';
              const contentValue = note.is_secret ? '**********' : note.content;
              const contentClass = note.is_secret ? 'secret-input' : 'note-textarea';
              const placeholder = note.is_secret ? 'Contenido Secreto' : 'Escribe el contenido de tu nota aquí...';
              
              const contentInput = note.is_secret 
                ? \`<input type="password" data-id="\${note.id}" data-field="content" value="\${note.content}" readonly class="secret-input" placeholder="\${placeholder}" title="El contenido está oculto. Edita el secreto para verlo." aria-label="Contenido secreto de la nota \${note.title}"/>\`
                : \`<textarea data-id="\${note.id}" data-field="content" rows="4" class="\${contentClass}" placeholder="\${placeholder}" aria-label="Contenido de la nota \${note.title}">\${note.content}</textarea>\`;

              return \`
              <li class="note-card-container mb-4" data-id="\${note.id}" data-title="\${note.title.toLowerCase()}">
                <div class="note-card" style="--note-color: \${note.color || 'var(--focus-border)'};">
                  <div class="note-color-stripe"></div>
                  <div class="note-content-area">
                    <input type="text" data-id="\${note.id}" data-field="title" 
                      class="note-title-input" value="\${note.title}" placeholder="Título de la Nota" 
                      aria-label="Título de la nota \${note.title}"/>
                    \${contentInput}
                    <div class="flex justify-between items-center pt-2 border-t" style="border-color: var(--border-color);">
                      <div class="flex items-center gap-3">
                        <input type="color" data-id="\${note.id}" value="\${note.color}" class="color-picker" 
                          aria-label="Selector de color para la nota \${note.title}"/>
                        <label class="checkbox-label text-xs flex items-center gap-1 cursor-pointer" 
                          title="Ocultar contenido como secreto">
                          <input type="checkbox" data-id="\${note.id}" data-field="is_secret" \${note.is_secret ? 'checked' : ''} 
                            class="custom-checkbox" aria-label="Alternar secreto para la nota \${note.title}"/>
                          Secreto
                        </label>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-xs opacity-60" style="color: var(--vscode-list-deemphasizedForeground);">
                          \${new Date(note.created_at).toLocaleDateString()}
                        </span>
                        <button class="delete-btn icon-button" data-id="\${note.id}" title="Borrar Nota" 
                          aria-label="Eliminar nota \${note.title}">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
              \`;
            }).join('');

            appContainer.innerHTML = \`
              <div class="flex flex-col h-full">
                <div class="header-bar flex items-center justify-between mb-4 pb-3 border-b" style="border-color: var(--border-color); background-color: var(--bg);">
                  <div class="flex flex-col">
                    <h1 class="text-xl font-bold flex items-center gap-2" style="color: var(--vscode-activityBar-foreground);">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11.25 16.25h1.5L12 17zM16 14v.5"/>
                        <path d="M4.42 11.247A13.2 13.2 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.7 11.7 0 0 0-.493-3.309M8 14v.5"/>
                        <path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5c-1.931.722-3.576-.297-3.656-1c-.113-.994 1.177-6.53 4-7c1.923-.321 3.651.845 3.651 2.235A7.5 7.5 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277c2.823.47 4.113 6.006 4 7c-.08.703-1.725 1.722-3.656 1c-1.261-.472-1.855-1.45-2.239-2.5"/>
                      </svg>
                      Notys
                    </h1>
                    <span class="text-xs opacity-70 mt-1" style="color: var(--vscode-list-deemphasizedForeground);">
                      Hola, \${user?.email?.split('@')[0] || "usuario"}
                    </span>
                  </div>
                  <div class="flex gap-2">
                    <button id="reload-notes-btn" class="icon-button" title="Recargar Notas" aria-label="Recargar notas">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.5 2v6h-6"/><path d="M21.5 2c-2.4 2.8-5 5-9.5 5C7 7 4 5.2 2.5 2"/><path d="M2.5 22v-6h6"/><path d="M2.5 22c2.4-2.8 5-5 9.5-5C17 17 20 18.8 21.5 22"/>
                      </svg>
                    </button>
                    <button id="sign-out-btn" class="icon-button" title="Cerrar Sesión" aria-label="Cerrar sesión">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                        <polyline points="16 17 21 12 16 7"></polyline>
                        <line x1="21" y1="12" x2="9" y2="12"></line>
                      </svg>
                    </button>
                  </div>
                </div>

                <div id="search-container" class="mb-4">
                  <input type="text" id="search-input" placeholder="Buscar notas por título o contenido..." 
                    class="note-input w-full p-2 text-sm" aria-label="Buscar notas"/>
                </div>

                <div id="new-note-input-container" class="p-4 mb-6 rounded-lg shadow-inner bg-[var(--card-bg)]">
                  <input type="text" id="new-note-title" placeholder="Título de la nueva nota (obligatorio)" 
                    class="note-input w-full mb-3" aria-label="Título de la nueva nota"/>
                  <textarea id="new-note-content" placeholder="Contenido de la nueva nota (opcional)" 
                    class="note-input w-full mb-3 resize-y" rows="3" aria-label="Contenido de la nueva nota"></textarea>
                  <button id="add-note-btn"
                    class="w-full p-2 rounded-lg font-semibold text-[var(--button-fg)] bg-[var(--focus-border)] hover:bg-opacity-90 transition shadow-md flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Guardar Nota
                  </button>
                </div>
                
                <ul id="notes-list" class="flex-grow overflow-y-auto space-y-4 pt-2">
                  \${notes.length === 0 ? '<p class="text-center opacity-70 mt-10">No tienes notas todavía. ¡Crea la primera!</p>' : listHtml}
                </ul>
              </div>
            \`;

            // --- Lógica de Eventos para Notas ---
            
            // Cerrar Sesión
            document.getElementById('sign-out-btn').addEventListener('click', () => {
              vscode.postMessage({ command: 'signOut' });
            });

            // Recargar Notas
            document.getElementById('reload-notes-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'reloadNotes' });
            });


            // Añadir Nota
            document.getElementById('add-note-btn').addEventListener('click', () => {
              const newTitle = document.getElementById('new-note-title').value;
              const newContent = document.getElementById('new-note-content').value;
              vscode.postMessage({ command: 'addNote', payload: { newTitle, newContent } });
              // Limpiar campos
              document.getElementById('new-note-title').value = '';
              document.getElementById('new-note-content').value = '';
            });

            // Buscar Notas
            document.getElementById('search-input').addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                document.querySelectorAll('.note-card-container').forEach(item => {
                    const title = item.getAttribute('data-title');
                    // Comprobar también el contenido (aunque solo se indexa por título)
                    const content = item.querySelector('.note-textarea')?.value.toLowerCase() || '';
                    const isVisible = title.includes(query) || content.includes(query);
                    item.style.display = isVisible ? 'block' : 'none';
                });
            });


            // Eventos delegados para todas las notas
            document.getElementById('notes-list').addEventListener('change', (e) => {
                const target = e.target;
                const id = target.getAttribute('data-id');

                if (target.matches('.color-picker')) {
                    vscode.postMessage({ command: 'updateNoteColor', payload: { id, newColor: target.value } });
                } else if (target.matches('.custom-checkbox')) {
                    vscode.postMessage({ command: 'toggleNoteSecret', payload: { id, isSecret: target.checked } });
                }
            });

            document.getElementById('notes-list').addEventListener('blur', (e) => {
                const target = e.target;
                const id = target.getAttribute('data-id');
                const field = target.getAttribute('data-field');

                if (field && (target.matches('.note-title-input') || target.matches('.note-textarea'))) {
                    vscode.postMessage({ command: \`updateNote\${field === 'title' ? 'Title' : 'Content'}\`, payload: { id, newValue: target.value } });
                }
            }, true); 

            // Manejar clics de borrar de forma delegada en el contenedor principal
            document.getElementById('notes-list').addEventListener('click', (e) => {
                const target = e.target.closest('.delete-btn');
                if (target) {
                    const listItem = target.closest('.note-card-container');
                    const id = listItem.getAttribute('data-id');
                    if (confirm('¿Estás seguro de que quieres borrar esta nota?')) {
                        vscode.postMessage({ command: 'deleteNote', payload: { id } });
                    }
                }
            });


          }


          // --- MANEJADOR DE MENSAJES PRINCIPAL ---
          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
              case 'updateState':
                if (message.payload.isAuthenticated) {
                  renderNotesHtml(message.payload.user, message.payload.notes);
                } else {
                  renderAuthHtml();
                }
                break;
              case 'toast':
                showToast(message.payload.type, message.payload.message);
                break;
            }
          });

          // Notifica a la extensión que el webview está listo para recibir el estado inicial
          vscode.postMessage({ command: 'ready' });

        </script>
      </body>
      </html>`;
  }
}