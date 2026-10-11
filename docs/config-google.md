# Configurar Google (Drive Picker y YouTube) para Mis ofertas

Esto es lo que hay que configurar para que funcionen «Elegir desde mi Drive» y la lectura de casos de éxito desde YouTube.
Sin esta configuración la app sigue funcionando:
- el botón de Drive no aparece;
- un enlace de YouTube muestra «La lectura de YouTube todavía no está activada»;
- las hojas compartidas «Cualquier persona con el enlace» se leen igual, sin nada de esto.

`<app>` = el dominio de producción, por ejemplo `https://closer.tudominio.com`.

## 1. Google Cloud (mismo proyecto del login con Google)

1. **APIs** (APIs y servicios → Biblioteca): habilita
   - Google Picker API
   - Google Drive API
   - YouTube Data API v3
2. **Pantalla de consentimiento de OAuth** (APIs y servicios → Pantalla de consentimiento):
   - Agrega el permiso `https://www.googleapis.com/auth/drive.file`. Solo deja abrir los archivos que la persona elige en el Picker, nunca todo su Drive.
   - No agregues `drive` ni `drive.readonly`.
   - La app pide `drive.file` aparte del login, solo cuando la persona pulsa «Conectar mi Drive», y guarda ese token cifrado.
3. **Cliente de OAuth** (Credenciales → el cliente web que ya usa el login):
   - URI de redirección autorizada: `<app>/api/drive/callback`. Si el login ya usa `<app>/api/auth/callback/google`, deja las dos.
   - Orígenes de JavaScript autorizados: `<app>`.
   - De aquí salen `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Si ya están en Vercel, no cambian.
4. **Clave de API para el Picker** (Credenciales → Crear credenciales → Clave de API):
   - Restricción de aplicación: «Sitios web (referentes HTTP)» con `<app>/*` y `https://docs.google.com/*`.
   - Restricción de API: solo «Google Picker API».
   - Esta clave va al navegador. Por eso está restringida al dominio.
5. **App ID del Picker = número del proyecto** (Configuración de IAM y administración → «Número del proyecto», solo dígitos, no el ID con letras).
6. **Clave de API para YouTube** (otra clave, solo para el servidor):
   - Restricción de API: solo «YouTube Data API v3».
   - Sin restricción por IP: Vercel no tiene IP fija. No la pongas en ninguna variable `NEXT_PUBLIC_`.
   - La app solo usa `playlistItems.list`, `videos.list` y `channels.list` (título y descripción), nunca `search.list` ni subtítulos.

## 2. Vercel (Settings → Environment Variables, entorno Production)

| Variable | Valor | Nota |
|---|---|---|
| `GOOGLE_CLIENT_ID` | el del cliente OAuth (paso 3) | ya existe si el login con Google funciona |
| `GOOGLE_CLIENT_SECRET` | el del cliente OAuth (paso 3) | ya existe si el login con Google funciona |
| `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | la clave del paso 4 | pública, restringida al dominio |
| `NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER` | el número del paso 5 | solo dígitos |
| `YOUTUBE_API_KEY` | la clave del paso 6 | secreta, solo servidor |
| `NEXTAUTH_URL` | `<app>` | con ella se arma `<app>/api/drive/callback` |
| `AUTH_SECRET` o `NEXTAUTH_SECRET` | ya existe | cifra el token de Drive |
| `GEMINI_API_KEY` | ya existe | ordena los casos que no traen columnas claras |
| `GEMINI_CASES_MODEL` | opcional | por defecto `gemini-3.6-flash` |
| `CACHE_LOG` | opcional, `1` | escribe en el log los aciertos de caché (en Preview ya se escriben) |

Las variables `NEXT_PUBLIC_…` se leen al compilar: después de agregarlas hay que volver a desplegar.

## 3. Previews

En un preview la URL cambia en cada despliegue, y Google solo acepta redirecciones registradas.
Prueba «Conectar mi Drive» en el dominio de producción o en un alias fijo de preview que agregues en el paso 3 (con `NEXTAUTH_URL` apuntando a ese alias).
YouTube y las hojas compartidas por enlace funcionan en cualquier preview.
