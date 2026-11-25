// Public settings for Round TUIT. Nothing secret goes in this file: the repository is public.
// The Firebase web config is public by design. Access is controlled by sign-in and firestore.rules.
// While apiKey is empty the app keeps everything on the phone and shows no sharing. See docs/SETUP-SHARING.md.
window.ROUND_TUIT_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyBtke_PnTlrT4qSZ3dAjpt9RZtsMXdEEOY',
    authDomain: 'round-tuit-4b1d9.firebaseapp.com',
    projectId: 'round-tuit-4b1d9',
    appId: '1:433292677239:web:af14bf95e6e027428f3672',
  },
  bridge: '', // the Cloudflare Worker's address, for example https://round-tuit-bridge.example.workers.dev
};
