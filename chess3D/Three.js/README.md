# Atelier Chess

A browser-based 3D chess game. Sign in with Google, choose an easy, medium, or hard computer opponent, and play a complete game locally in the browser. Three.js renders the board and animated pieces; `chess.js` validates legal moves and powers the computer opponent.

## Google OAuth setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project.
2. Configure the OAuth consent screen and create an **OAuth client ID** with application type **Web application**.
3. Add the origin you use to open the app to **Authorized JavaScript origins**. For local development, add `http://localhost:5173`. Add your production HTTPS origin when deploying.
4. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` to the web client ID ending in `.apps.googleusercontent.com`.
5. Run `npm install` and `npm run dev`.

There is no Firebase project, database, server, or API secret to configure. Google Identity Services obtains a short-lived OAuth access token in the browser and uses it to fetch the signed-in Google profile. The app keeps the profile and game state in memory only; signing out or reloading clears the current game. The OAuth client ID is public configuration, not a secret.

## Play

Sign in with Google, select a computer strength, and start a game. You play white; the computer plays black. Click a piece to highlight its legal moves, then click a highlighted square. The computer searches legal positions locally and automatically replies. Pawns promote to queens.

## Build and deploy

Run `npm run build` to type-check and create `dist/`. Deploy that static output to an HTTPS web host and add the deployed origin to the Google OAuth client's authorized JavaScript origins. The computer opponent runs locally in the browser; no game data is sent to a game server.
