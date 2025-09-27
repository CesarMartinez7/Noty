import * as vscode from "vscode";
import { createClient, User } from "@supabase/supabase-js"; // Importación real (añadida 'User' para tipado)

// --- CONFIGURACIÓN DE SUPABASE (CREDENCIALES REALES) ---
// Usamos tus credenciales reales y mantenemos los nombres de las constantes para el CSP.
const SUPABASE_URL = "https://fuqaeuyfjgpuaqozsojl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1cWFldXlmamdwdWFxb3pzb2psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkwMDMxNzQsImV4cCI6MjA3NDU3OTE3NH0.LHzVFfCV45Oh1XBDFCNoVzLHyUa96xI0PMFTxlyK_0o";

// -----------------------------------------------------------

// Definición de la estructura de una Nota tal como viene de Supabase
interface Note {
  id: number;
  content: string;
  created_at: string;
}

export class CustomSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "vscodeSidebar.openview";

  private _view?: vscode.WebviewView;

  // 👉 Servicios de Supabase
  private _supabaseClient: any = null;
  private _isSupabaseReady: boolean = false;
  // Estado para el usuario autenticado
  private _user: User | null = null;

  // Estado para las notas de Supabase
  private _notes: Note[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext<unknown>,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // 1. Inicializa Supabase y establece los Listeners
    this._initializeSupabase();

    // 2. Configura el listener para los mensajes del Webview (frontend)
    this._setWebviewMessageListener(webviewView.webview);

    // 3. Renderiza el HTML inicial
    webviewView.webview.html = this.getHtmlContent(webviewView.webview);
  }

  // Método para inicializar el cliente de Supabase y listeners
  private _initializeSupabase() {
    if (this._supabaseClient) return; // Evita doble inicialización

    try {
      this._supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      this._isSupabaseReady = true;

      // Configura el listener de tiempo real para las notas
      this._setupSupabaseListener();

      // Configura el listener de autenticación
      this._setupAuthListener();
    } catch (e) {
      console.error(
        "[Supabase] Falló la inicialización del cliente de Supabase.",
        e
      );
      this._isSupabaseReady = false;
      this._updateHtml();
    }
  }

  // --- FEEDBACK AL USUARIO (NUEVO) ---

  /** Envía un mensaje temporal al Webview para mostrar un 'Toast' */
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

    // Listener para cambios de estado de autenticación (login, logout, token refresh)
    this._supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        this._user = session.user;
        console.log(`[Supabase Auth] Usuario autenticado: ${this._user.email}`);
        this._fetchNotes();
      } else {
        this._user = null;
        this._notes = [];
        console.log("[Supabase Auth] Usuario cerró sesión.");
        this._updateHtml();
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

    const { error } = await this._supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("[Supabase Auth] Error al iniciar sesión:", error);
      this._sendToastMessage("error", error.message);
    }
    // _setupAuthListener manejará la actualización si es exitoso.
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
    // _setupAuthListener manejará la limpieza del estado.
  }

  // --- CONSULTAS ASÍNCRONAS PARA SUPABASE (CRUD) ---

  // Obtener todas las notas (SELECT).
  private async _fetchNotes() {
    if (!this._supabaseClient || !this._user) return;

    // Se asume que el RLS en Supabase filtra por user_id = auth.uid()
    const { data, error } = await this._supabaseClient
      .from("notes")
      .select("id, content, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Supabase] Error al obtener notas:", error);
      this._sendToastMessage("error", "Error al cargar las notas.");
      return;
    }

    this._notes = data || [];
    this._updateHtml(); // Re-renderiza la interfaz
  }

  // Crear (Añadir) - INSERT
  private async _addNote(newNote: string) {
    if (!this._supabaseClient || !this._user || newNote.trim().length === 0)
      return;

    const { error } = await this._supabaseClient
      .from("notes")
      .insert([{ content: newNote.trim() }]);

    if (error) {
      console.error("[Supabase] Error al añadir nota:", error);
      this._sendToastMessage("error", "Error al crear la nota.");
    } else {
      // ✅ FIX: Llamar a fetchNotes() para asegurar la sincronización inmediata
      this._fetchNotes();
      this._sendToastMessage("success", "Nota creada y sincronizada.");
    }
  }

  // Borrar - DELETE
  private async _deleteNote(id: number) {
    if (!this._supabaseClient || !this._user || !id) return;

    const { error } = await this._supabaseClient
      .from("notes")
      .delete()
      .eq("id", id); // Condición WHERE

    if (error) {
      console.error("[Supabase] Error al borrar nota:", error);
      this._sendToastMessage("error", "Error al eliminar la nota.");
    } else {
      // ✅ FIX: Llamar a fetchNotes() para asegurar la sincronización inmediata
      this._fetchNotes();
      this._sendToastMessage("success", "Nota eliminada.");
    }
  }

  // Actualizar (Cambiar por input) - UPDATE
  private async _updateNote(id: number, newValue: string) {
    if (!this._supabaseClient || !this._user || !id) return;

    if (newValue.trim().length > 0) {
      const { error } = await this._supabaseClient
        .from("notes")
        .update({ content: newValue.trim() })
        .eq("id", id); // Condición WHERE

      if (error) {
        console.error("[Supabase] Error al actualizar nota:", error);
        this._sendToastMessage("error", "Error al actualizar la nota.");
      } else {
        // ✅ FIX: Llamar a fetchNotes() para asegurar la sincronización inmediata
        this._fetchNotes();
        this._sendToastMessage("success", "Nota actualizada.");
      }
    } else {
      // Si el input se vacía, eliminamos la nota
      this._deleteNote(id);
    }
  }

  // --- REALTIME LISTENER ---
  private _setupSupabaseListener() {
    if (!this._supabaseClient) return;

    // Suscripción al canal de cambios de la tabla 'notes'
    // Este listener permanece para recibir cambios de OTROS clientes/dispositivos
    this._supabaseClient
      .channel("notes_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notes" },
        () => {
          // Si estamos autenticados, volvemos a obtener las notas (esto es lo que garantiza la sincronización)
          if (this._user) {
            this._fetchNotes();
          }
        }
      )
      .subscribe();
  }

  // Método para re-renderizar la vista cuando el estado cambia
  private _updateHtml() {
    if (this._view) {
      this._view.webview.html = this.getHtmlContent(this._view.webview);
    }
  }

  // Listener para recibir comandos (Auth y CRUD) desde el Webview
  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async (message) => {
      const { command, payload } = message;

      switch (command) {
        // Comandos de autenticación
        case "signIn":
          this._signIn(payload.email, payload.password);
          return;
        case "signUp":
          this._signUp(payload.email, payload.password);
          return;
        case "signOut":
          this._signOut();
          return;

        // Comandos de notas (solo si hay usuario autenticado)
        case "addNote":
          if (this._user) this._addNote(payload.newNote);
          return;
        case "deleteNote":
          if (this._user) this._deleteNote(parseInt(payload.id));
          return;
        case "updateNote":
          if (this._user)
            this._updateNote(parseInt(payload.id), payload.newValue);
          return;
      }
    });
  }

  // --- GENERACIÓN DE HTML POR ESTADO ---

  private _getAuthHtml(nonce: string): string {
    return `
      <div class="flex flex-col items-center justify-center h-full p-4">
          <div class="w-full max-w-sm">
            <h1 class="text-2xl font-bold mb-8 text-center" style="color: var(--vscode-activityBar-foreground);">Supabase Notes App</h1>
            
            <div id="auth-message-box" class="p-3 mb-4 w-full text-sm text-center rounded-lg shadow-md hidden transition duration-300" style="background-color: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border);"></div>
            
            <form id="auth-form" class="w-full space-y-4">
                <input type="email" id="auth-email" placeholder="Email" required 
                    class="note-input w-full" />
                <input type="password" id="auth-password" placeholder="Contraseña" required 
                    class="note-input w-full" />
                
                <button type="submit" id="sign-in-btn" 
                    class="w-full p-3 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out hover:opacity-90"
                    style="background-color: var(--vscode-button-background);">
                    Iniciar Sesión
                </button>
                <button type="button" id="sign-up-btn" 
                    class="w-full p-3 font-semibold rounded-lg shadow-md transition duration-150 ease-in-out"
                    style="background-color: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground);">
                    Registrarse
                </button>
            </form>
          </div>
      </div>
      
      <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
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
              // Ocultar después de un tiempo si es éxito
              if (type === 'success') {
                  setTimeout(() => msgBox.classList.add('hidden'), 3000);
              }
          }
          
          window.addEventListener('message', event => {
              const message = event.data;
              if (message.command === 'toast') {
                  // Muestra el toast en el contexto de autenticación
                  showAuthMessage(message.payload.type, message.payload.message);
              }
          });

          // Iniciar Sesión (Form Submit)
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

          // Registrarse (Sign Up)
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
      </script>
    `;
  }

  private _getNotesHtml(nonce: string): string {
    const arrayList = this._notes;

    // Renderiza lista en HTML con botón de borrar y inputs editables
    const listHtml = arrayList
      .map(
        (note) => `
      <li class="list-item flex items-center justify-between p-3 mb-2 rounded-lg transition duration-100 shadow-sm hover:shadow-md">
        <!-- Usamos data-id para almacenar el ID de Supabase -->
        <input type="text" value="${note.content}" data-id="${note.id}" 
            class="note-input flex-grow text-sm focus:border-opacity-100 p-0 m-0 border-none" />
        <button class="delete-btn ml-3 p-1 rounded-full hover:opacity-75" data-id="${note.id}" title="Borrar Nota">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash-2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </li>`
      )
      .join("");

    return `
        <div class="flex flex-col h-full relative">
            <div class="header-bar flex items-center justify-between p-2 mb-4 border-b pb-4 sticky top-0" style="border-color: var(--vscode-editorGroupHeader-tabsBorder); background-color: var(--bg); z-index: 10;">
                <div class="flex flex-col">
                    <h1 class="text-xl font-bold" style="color: var(--vscode-activityBar-foreground);">Mis Notas</h1>
                    <span class="text-xs opacity-70 italic" style="color: var(--vscode-list-deemphasizedForeground);">Bienvenido: ${
                      this._user?.email || "N/A"
                    }</span>
                </div>
                <button id="sign-out-btn" class="p-2 rounded-lg text-xs font-semibold hover:opacity-80 shadow-md" 
                    style="background-color: var(--vscode-statusBarItem-warningBackground); color: var(--vscode-statusBarItem-warningForeground);">
                    Salir
                </button>
            </div>

            <div id="add-note-container" class="flex p-3 mb-6 rounded-lg shadow-xl" style="background-color: var(--vscode-input-background);">
                <input type="text" id="new-note-input" placeholder="Añadir nueva nota..." 
                    class="note-input flex-grow p-2 mr-3 text-base" />
                <button id="add-note-btn" class="text-white p-3 rounded-lg font-bold transition duration-150 ease-in-out hover:opacity-90 shadow-lg" 
                    style="background-color: var(--vscode-button-background);">
                    +
                </button>
            </div>

            <h2 class="text-sm font-semibold uppercase mb-3 opacity-70">Lista de Notas (${
              arrayList.length
            }):</h2>
            
            ${
              arrayList.length === 0
                ? '<p class="text-sm opacity-50 p-2">No hay notas. Crea una para empezar.</p>'
                : ""
            }
            <ol class="list-none p-0 m-0 space-y-2">
              ${listHtml}
            </ol>
            
            <!-- Contenedor para Toast Notifications -->
            <div id="toast-container" class="fixed bottom-4 left-1/2 transform -translate-x-1/2 space-y-2 z-50">
                <!-- Toasts go here -->
            </div>
        </div>

        <!-- JavaScript para manejar la interacción y la comunicación con la extensión -->
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();

            // Global Toast Logic: Muestra mensajes temporales de sincronización/estado
            function showToast(type, message) {
                const container = document.getElementById('toast-container');
                if (!container) return;

                const toast = document.createElement('div');
                toast.className = 'p-3 rounded-lg shadow-xl text-sm transition-all duration-300 opacity-0 transform translate-y-2';
                toast.textContent = message;
                
                // Estilos de VS Code para éxito/error
                if (type === 'error') {
                    toast.style.backgroundColor = 'var(--vscode-errorForeground)';
                    toast.style.color = 'var(--vscode-editor-background)';
                } else if (type === 'success') {
                    // Color de estado para éxito (usando un color de VS Code que indica acción/éxito)
                    toast.style.backgroundColor = 'var(--vscode-statusBarItem-remoteBackground)';
                    toast.style.color = 'var(--vscode-statusBarItem-remoteForeground)';
                }

                container.appendChild(toast);

                // Mostrar el toast
                setTimeout(() => {
                    toast.style.opacity = '1';
                    toast.style.transform = 'translateY(0)';
                }, 10); // Pequeño delay para asegurar la transición

                // Ocultar y remover después de 3 segundos
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

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'toast') {
                    showToast(message.payload.type, message.payload.message);
                }
            });


            // 4. Salir (Sign Out)
            document.getElementById('sign-out-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'signOut' });
            });

            // 1. Añadir Nota
            document.getElementById('add-note-btn').addEventListener('click', () => {
                const input = document.getElementById('new-note-input');
                const newNote = input.value;
                if (newNote.trim()) {
                    vscode.postMessage({
                        command: 'addNote',
                        payload: { newNote: newNote }
                    });
                    input.value = '';
                }
            });

            // 2. Borrar Nota / 3. Actualizar Nota (usando delegación de eventos)
            document.querySelector('ol').addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.delete-btn');
                if (deleteBtn) {
                    const id = deleteBtn.dataset.id;
                    vscode.postMessage({
                        command: 'deleteNote',
                        payload: { id: id }
                    });
                }
            });

            // Evento 'change' para manejar la actualización (cambiar por el input)
            document.querySelector('ol').addEventListener('change', (e) => {
                const input = e.target.closest('.note-input');
                if (input) {
                    const id = input.dataset.id;
                    const newValue = input.value;

                    vscode.postMessage({
                        command: 'updateNote',
                        payload: { id: id, newValue: newValue }
                    });
                }
            });
        </script>
    `;
  }

  private getHtmlContent(webview: vscode.Webview): string {
    // Definiciones de URI para recursos locales
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "reset.css")
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "vscode.css")
    );
    const stylesheetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "main.css")
    );

    const nonce = getNonce();

    // Estado de carga inicial (antes de que Supabase esté listo)
    if (!this._isSupabaseReady) {
      return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                    :root { --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground); }
                    body { background-color: var(--bg); color: var(--fg); padding: 1rem; font-family: sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; }
                </style>
            </head>
            <body>
                <p>Inicializando conexión a Supabase...</p>
            </body>
            </html>`;
    }

    // Contenido principal: Notas si está logueado, sino, formulario de autenticación
    const contentHtml = this._user
      ? this._getNotesHtml(nonce)
      : this._getAuthHtml(nonce);

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
        webview.cspSource
      } 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; connect-src 'self' ${
      SUPABASE_URL.replace("https://", "").split("/")[0]
    }">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      
      <!-- Incluimos el cliente de Supabase desde CDN -->
      <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
      <!-- Incluimos Tailwind CSS para estilos modernos -->
      <script nonce="${nonce}" src="https://cdn.tailwindcss.com"></script>

      <link rel="stylesheet" href="https://unpkg.com/modern-css-reset/dist/reset.min.css" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
      
      <!-- Estilos para adaptar Tailwind y que se vea bien en el tema de VS Code -->
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
        }
        body {
            background-color: var(--bg);
            color: var(--fg);
            padding: 1rem;
            font-family: 'Inter', sans-serif; /* Usamos Inter */
            height: 100vh;
            overflow-y: auto; /* Permitir scroll si hay muchas notas */
        }
        
        /* Estilos de input compartidos y mejorados */
        .note-input, #auth-form input {
            background-color: var(--input-bg);
            border: 1px solid var(--input-border);
            color: var(--fg);
            padding: 0.75rem; 
            border-radius: 6px; 
            transition: border-color 0.2s, box-shadow 0.2s;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
            opacity: 0.9;
        }
        .note-input:focus, #auth-form input:focus {
            outline: none;
            border-color: var(--focus-border);
            box-shadow: 0 0 0 1px var(--focus-border);
            opacity: 1;
        }
        
        /* Estilos de la lista de notas */
        .list-item {
            background-color: var(--list-hover-bg);
            border: 1px solid var(--input-border);
            transition: background-color 0.1s, transform 0.1s;
        }
        .list-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            transform: translateY(-1px);
        }
        .delete-btn {
            color: var(--error-fg);
            cursor: pointer;
            transition: color 0.2s;
        }
      </style>
    </head>
    <body>

    ${contentHtml}

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
