// Where the Lunch Uncle backend lives.
// Running locally (npm start) the app and API share an origin, so use ''.
// On GitHub Pages there is no backend, so call the deployed one on Render.
// Leave RENDER_URL empty to keep the Pages site in demo mode.
const RENDER_URL = '';

window.LUNCH_UNCLE_API = location.hostname.endsWith('github.io') ? RENDER_URL : '';
