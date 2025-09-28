// @ts-nocheck
import * as vscode from "vscode";
import { createClient, User } from "@supabase/supabase-js";

// --- CONFIGURACIÓN DE SUPABASE (CREDENCIALES REALES) ---
const SUPABASE_URL = "https://fuqaeuyfjgpuaqozsojl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1cWFldXlmamdwdWFxb3pzb2psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkwMDMxNzQsImV4cCI6MjA3NDU3OTE3NH0.LHzVFfCV45Oh1XBDFCNoVzLHyUa96xI0PMFTxlyK_0o";

// -----------------------------------------------------------

// Definición de la estructura de una Nota tal como viene de Supabase
interface Note {
  id: number;
  title: string;
  content: string;
  created_at: string;
  user_id: string;
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

  // --- Comunicación con el Webview (NUEVO) ---
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
        if (!this._user) { // Previene bucles de re-autenticación
          this._user = session.user;
          this._fetchNotes();
        }
      } else {
        if (this._user) { // Previene bucles de cierre de sesión
          this._user = null;
          this._notes = [];
          this._postState();
        }
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
      this._user = data.user;
      this._sendToastMessage("success", "Sesión iniciada correctamente.");
      this._fetchNotes();
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
      .select("id, title, content, created_at, user_id")
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
      },
    ]);

    if (error) {
      console.error("[Supabase] Error al añadir nota:", error);
      this._sendToastMessage("error", "Error al crear la nota.");
    } else {
      this._sendToastMessage("success", "Nota creada y sincronizada.");
    }
  }

  private async _deleteNote(id: number) {
    if (!this._supabaseClient || !this._user || !id) return;

    const { error } = await this._supabaseClient
      .from("notes")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[Supabase] Error al borrar nota:", error);
      this._sendToastMessage("error", "Error al eliminar la nota.");
    } else {
      this._sendToastMessage("success", "Nota eliminada.");
    }
  }

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
      .eq("id", id);

    if (error) {
      console.error("[Supabase] Error al actualizar nota:", error);
      this._sendToastMessage("error", "Error al actualizar la nota.");
    } else {
      this._sendToastMessage(
        "success",
        `${field === "title" ? "Título" : "Contenido"} actualizado.`
      );
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
          if (this._user) this._addNote(payload.newTitle, payload.newContent);
          return;
        case "deleteNote":
          if (this._user) this._deleteNote(parseInt(payload.id));
          return;
        case "updateNoteTitle":
          if (this._user)
            this._updateNote(parseInt(payload.id), "title", payload.newValue);
          return;
        case "updateNoteContent":
          if (this._user)
            this._updateNote(parseInt(payload.id), "content", payload.newValue);
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
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
          webview.cspSource
        } 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self' https://fuqaeuyfjgpuaqozsojl.supabase.co">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        
        <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script nonce="${nonce}" src="https://cdn.tailwindcss.com"></script>
        
        <link rel="stylesheet" href="https://unpkg.com/modern-css-reset/dist/reset.min.css" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
        
        <style>
          /* Variables de color de VS Code */
          :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --input-bg: var(--vscode-input-background);
            --input-border: var(--vscode-input-border);
            --button-bg: var(--vscode-button-background);
            --button-hover-bg: var(--vscode-button-hoverBackground);
            --error-fg: var(--vscode-errorForeground);
            --list-hover-bg: var(--vscode-list-hoverBackground);
            --focus-border: var(--vscode-focusBorder);
            --accent-color: var(--vscode-terminal-ansiBrightYellow);
          }
          body {
            background-color: var(--bg);
            color: var(--fg);
            padding: 1rem;
            font-family: 'Inter', sans-serif; 
            height: 100vh;
            overflow-y: auto; 
          }
          
          /* Estilos de input compartidos y mejorados */
          .note-input, #auth-form input, #new-note-title, #new-note-content {
            background-color: var(--input-bg);
            border: 1px solid var(--input-border);
            color: var(--fg);
            padding: 0.45rem; 
            border-radius: 6px; 
            transition: border-color 0.2s, box-shadow 0.2s;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
            opacity: 0.9;
          }
          .note-input:focus, #auth-form input:focus, #new-note-title:focus, #new-note-content:focus {
            outline: none;
            border-color: var(--focus-border);
            box-shadow: 0 0 0 1px var(--focus-border);
            opacity: 1;
          }
          
          /* Estilos para la tarjeta de nota */
          .note-card-container {
            list-style: none;
          }
          .note-card {
            background-color: var(--vscode-editorGutter-background);
            transform: none;
            border-color: var(--focus-border);
            transition: border-color 0.2s, box-shadow 0.2s;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
            min-height: 120px;
          }
          .note-card:hover {
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
            border-color: var(--focus-border);
          }

          /* Input del Título dentro de la nota */
          .note-title-input {
            width: 100%;
            background-color: transparent !important;
            color: var(--vscode-activityBar-foreground);
            border-bottom: 1px solid transparent !important;
            padding: 0;
            margin: 0;
          }
          .note-title-input:focus {
            outline: none;
            border-color: var(--focus-border) !important; 
          }

          /* Textarea del Contenido dentro de la nota */
          .note-textarea {
            width: 100%;
            background-color: transparent;
            color: var(--fg);
            border: none;
            padding: 0;
            line-height: 1.4;
            opacity: 0.9;
            min-height: 70px;
          }
          .note-textarea:focus {
            outline: none;
            box-shadow: none !important;
          }
          
          .delete-btn {
            color: var(--error-fg);
            cursor: pointer;
            transition: color 0.2s;
            background-color: transparent;
            border: none;
          }

          .icon-button {
            background-color: transparent;
            color: var(--vscode-list-deemphasizedForeground);
            border: none;
            cursor: pointer;
            padding: 8px;
            border-radius: 4px;
            transition: background-color 0.2s, color 0.2s;
          }
        </style>
      </head>
      <body>
        <div id="app-container" class="h-full">
          </div>
        <div id="toast-container" class="fixed bottom-4 left-1/2 transform -translate-x-1/2 space-y-2 z-50"></div>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const appContainer = document.getElementById('app-container');
          
          function showToast(type, message) {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = 'p-3 rounded-lg shadow-xl text-sm transition-all duration-300 opacity-0 transform translate-y-2';
            toast.textContent = message;
            
            if (type === 'error') {
              toast.style.backgroundColor = 'var(--vscode-errorForeground)';
              toast.style.color = 'var(--vscode-editor-background)';
            } else if (type === 'success') {
              toast.style.backgroundColor = 'var(--vscode-statusBarItem-remoteBackground)';
              toast.style.color = 'var(--vscode-statusBarItem-remoteForeground)';
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
                if(container.contains(toast)) {
                  container.removeChild(toast);
                }
              }, 300);
            }, 3000);
          }

          function renderAuthHtml() {
            appContainer.innerHTML = \`
              <div class="flex flex-col items-center justify-center h-full p-4 backdrop-blur-4xl bg-gradient-to-r to-transparent">
                  <div class="w-full max-w-sm">
                      <h1 class="text-2xl font-bold mb-2 text-center flex items-center justify-center space-x-2" 
                          style="color: var(--vscode-activityBar-foreground);">
                          <span role="img" aria-label="lock"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M14 18a2 2 0 0 0-4 0m9-7l-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11m-3 0h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/></g></svg></span>
                          <span>Notys</span>
                      </h1>
                      <p class="font-light text-xs text-center mb-8" >Tu block de notas seguro</p>
                      
                      <div id="auth-message-box" class="p-3 mb-4 w-full text-sm text-center rounded-lg shadow-md hidden transition duration-300" style="background-color: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border);"></div>
                      
                      <form id="auth-form" class="w-full space-y-4">
                          <input type="email" id="auth-email" placeholder="Email" required 
                              class="note-input w-full" />
                          <input type="password" id="auth-password" placeholder="Contraseña" required 
                              class="note-input w-full" />
                          
                          <button type="submit" id="sign-in-btn" 
                              class="w-full p-3 text-white font-bold rounded-lg shadow-lg flex items-center justify-center space-x-2 
                                      transition duration-150 ease-in-out hover:opacity-95"
                              style="background-image: linear-gradient(to right, var(--vscode-button-background), var(--vscode-terminal-ansiBrightBlue)); 
                                      color: var(--vscode-button-foreground);">
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-log-in"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
                              <span>Iniciar Sesión</span>
                          </button>

                          <button type="button" id="sign-up-btn" 
                              class="w-full p-3 font-semibold rounded-lg shadow-md flex items-center justify-center space-x-2
                                      transition duration-150 ease-in-out hover:opacity-90 mt-2"
                              style="background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground);">
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-user-plus"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                              <span>Registrarse</span>
                          </button>
                      </form>

                      <p class="text-xs text-center mt-6 opacity-60" style="color: var(--vscode-list-deemphasizedForeground);">
                          Power by Supabase - @CesarMartinez7
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
                msgBox.style.backgroundColor = '#4CAF50';
                msgBox.style.color = 'white';
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

          function renderNotesHtml(user, notes) {
            const listHtml = notes.map(note => \`
              <li class="note-card-container" data-title="\${note.title.toLowerCase()}">
                <div class="note-card flex flex-col p-4 rounded-lg shadow-xl border border-opacity-80 transition duration-200 mb-2">
                  <input type="text" data-id="\${note.id}" data-field="title" 
                    class="note-title-input text-lg font-semibold mb-2 p-0 border-none bg-transparent focus:ring-0 focus:border-b-2" 
                    value="\${note.title}" placeholder="Título de la Nota"
                    style="border-color: var(--vscode-focusBorder);"
                  />
                  <textarea data-id="\${note.id}" data-field="content" rows="4" 
                    class="note-textarea flex-grow text-sm p-0 m-0 border-none resize-none bg-transparent focus:ring-0" 
                    placeholder="Escribe el contenido de tu nota aquí..."
                    >\${note.content}</textarea>
                  <div class="flex justify-between items-center mt-3">
                    <span class="text-xs opacity-60 italic" style="color: var(--vscode-list-deemphasizedForeground);">
                      Creada: \${new Date(note.created_at).toLocaleDateString()}
                    </span>
                    <button class="delete-btn p-1 rounded-full hover:opacity-75" data-id="\${note.id}" title="Borrar Nota">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash-2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  </div>
                </div>
              </li>
            \`).join('');

            appContainer.innerHTML = \`
              <div class="flex flex-col h-full relative">
                <div class="header-bar flex items-center justify-between p-2 mb-4 pb-4 sticky top-0" style="border-color: var(--vscode-editorGroupHeader-tabsBorder); background-color: var(--bg); z-index: 10;">
                  <div class="flex flex-col">
                    <h1 class="text-xl font-bold" style="color: var(--vscode-activityBar-foreground);">Notys <span role="img" aria-label="pin"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11.25 16.25h1.5L12 17zM16 14v.5"/><path d="M4.42 11.247A13.2 13.2 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.7 11.7 0 0 0-.493-3.309M8 14v.5"/><path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5c-1.931.722-3.576-.297-3.656-1c-.113-.994 1.177-6.53 4-7c1.923-.321 3.651.845 3.651 2.235A7.5 7.5 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277c2.823.47 4.113 6.006 4 7c-.08.703-1.725 1.722-3.656 1c-1.261-.472-1.855-1.45-2.239-2.5"/></g></svg></span></h1>
                    <span class="text-xs opacity-70 italic" style="color: var(--vscode-list-deemphasizedForeground);">
                      Bienvenido: \${user?.email || "N/A"}
                    </span>
                  </div>
                  <button id="sign-out-btn" class="icon-button" title="Cerrar Sesión">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-log-out"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                  </button>
                </div>

                <div id="search-container" class="mb-4">
                  <input type="text" id="search-input" placeholder="Buscar notas por título..." 
                    class="note-input w-full p-2 text-sm" />
                </div>

                <div id="new-note-input-container" class="p-3 mb-6 rounded-lg shadow-inner flex flex-col space-y-3" style="background-color: var(--vscode-input-background);">
                  <input type="text" id="new-note-title" placeholder="Título de la nueva nota (obligatorio)" 
                    class="note-input p-2 text-base font-semibold" />
                  <div class="flex">
                    <textarea id="new-note-content" placeholder="Contenido..." 
                      class="note-input flex-grow p-2 mr-3 text-sm resize-none" rows="2"></textarea>
                    <button id="add-note-btn" class="text-white p-3 rounded-lg font-bold transition duration-150 ease-in-out hover:opacity-90 shadow-lg" 
                      style="background-color: var(--vscode-button-background); width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="feather feather-plus"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                  </div>
                </div>

                <h2 class="text-sm font-semibold uppercase mb-3 opacity-80" style="color: var(--vscode-list-deemphasizedForeground);">
                  Tus Notas (<span id="note-count">\${notes.length}</span>):
                </h2>
                
                \${notes.length === 0 ? '<p class="text-sm opacity-50 p-2">¡Comienza a crear notas!</p>' : ""}
                
                <ol id="notes-grid" class="list-none flex-grow overflow-y-auto ">
                  \${listHtml}
                </ol>
              </div>
            \`;

            const notesGrid = document.getElementById('notes-grid');
            const searchInput = document.getElementById('search-input');
            const noteCountSpan = document.getElementById('note-count');

            document.getElementById('add-note-btn').addEventListener('click', () => {
              const titleInput = document.getElementById('new-note-title');
              const contentInput = document.getElementById('new-note-content');
              const newTitle = titleInput.value;
              const newContent = contentInput.value;
              
              if (newTitle.trim()) {
                vscode.postMessage({
                  command: 'addNote',
                  payload: { newTitle: newTitle, newContent: newContent }
                });
                titleInput.value = '';
                contentInput.value = '';
              } else {
                showToast('error', 'El título es obligatorio.');
              }
            });
            
            notesGrid.addEventListener('click', (e) => {
              const deleteBtn = e.target.closest('.delete-btn');
              if (deleteBtn) {
                const id = deleteBtn.dataset.id;
                vscode.postMessage({
                  command: 'deleteNote',
                  payload: { id: id }
                });
              }
            });

            notesGrid.addEventListener('blur', (e) => {
              const inputOrTextarea = e.target.closest('.note-title-input, .note-textarea');
              if (inputOrTextarea) {
                const id = inputOrTextarea.dataset.id;
                const field = inputOrTextarea.dataset.field;
                const newValue = inputOrTextarea.value;
                let command = '';
                
                if(field === 'title') {
                  command = 'updateNoteTitle';
                } else if (field === 'content') {
                  command = 'updateNoteContent';
                }

                if (command) {
                  vscode.postMessage({
                    command: command,
                    payload: { id: id, newValue: newValue }
                  });
                }
              }
            }, true);

            searchInput.addEventListener('keyup', () => {
              const query = searchInput.value.toLowerCase().trim();
              const noteCards = notesGrid.getElementsByClassName('note-card-container');
              let visibleCount = 0;

              for (let i = 0; i < noteCards.length; i++) {
                const card = noteCards[i];
                const noteTitle = card.getAttribute('data-title') || '';
                
                if (noteTitle.includes(query) || query === '') {
                  card.style.display = 'block';
                  visibleCount++;
                } else {
                  card.style.display = 'none';
                }
              }
              
              noteCountSpan.textContent = visibleCount;
            });

            document.getElementById('sign-out-btn').addEventListener('click', () => {
              vscode.postMessage({ command: 'signOut' });
            });
          }

          window.addEventListener('message', event => {
            const message = event.data;
            switch(message.command) {
              case 'updateState':
                const payload = message.payload;
                if (!payload.isReady) {
                  appContainer.innerHTML = \`<p>Inicializando conexión a Supabase...</p>\`;
                } else if (payload.isAuthenticated) {
                  renderNotesHtml(payload.user, payload.notes);
                } else {
                  renderAuthHtml();
                }
                break;
              case 'toast':
                showToast(message.payload.type, message.payload.message);
                break;
            }
          });
          
          vscode.postMessage({ command: 'ready' });

        </script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}