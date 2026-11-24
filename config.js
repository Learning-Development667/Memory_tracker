// Public settings for Round TUIT. Nothing secret goes in this file: the repository is public.
// The Firebase web config is public by design. Access is controlled by sign-in and firestore.rules.
// While apiKey is empty the app keeps everything on the phone and shows no sharing. See docs/SETUP-SHARING.md.
window.ROUND_TUIT_CONFIG = {
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
  },
  bridge: '', // the Cloudflare Worker's address, for example https://round-tuit-bridge.example.workers.dev
};
