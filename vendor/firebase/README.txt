Firebase JavaScript SDK 10.14.1 (app, auth, firestore), copied from the "firebase" npm package.
Copyright Google LLC. Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
The only change: each file's import of firebase-app.js points at the copy beside it instead of gstatic.com,
so the app opens with no signal and inside the TestFlight build.
