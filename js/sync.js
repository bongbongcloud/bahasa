// Optional cloud sync: Google sign-in + one Firestore document per user.
// Only loads Firebase when a config is provided; the app works offline without it.

const V = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

let auth, db, au, fs, timer = null, hooks = {};

export const Sync = {
  enabled: false,
  ready: false,
  user: null,
  status: 'off', // off | signed-out | syncing | synced | error | offline
  lastSync: 0,
  error: '',

  async init(config, h) {
    hooks = h;
    if (!config) return;
    this.enabled = true;
    try {
      const [appMod, authMod, fsMod] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-auth.js`),
        import(`${CDN}/firebase-firestore.js`),
      ]);
      au = authMod; fs = fsMod;
      const app = appMod.initializeApp(config);
      auth = au.getAuth(app);
      db = fs.getFirestore(app);
      this.ready = true;
      this.status = 'signed-out';
      try { await au.getRedirectResult(auth); } catch (e) { /* ignore */ }
      au.onAuthStateChanged(auth, async (u) => {
        this.user = u;
        if (u) await this.pull();
        else this.status = 'signed-out';
        hooks.onChange && hooks.onChange();
      });
      window.addEventListener('online', () => this.push());
    } catch (e) {
      // Usually: offline on first load, so the Firebase SDK can't be fetched.
      this.status = 'offline';
      this.error = String(e.message || e);
    }
  },

  async signIn() {
    if (!this.ready) throw new Error('Cloud sync is not available right now.');
    const provider = new au.GoogleAuthProvider();
    try {
      await au.signInWithPopup(auth, provider);
    } catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
        await au.signInWithRedirect(auth, provider);
      } else {
        throw e;
      }
    }
  },

  async signOut() {
    if (this.ready) await au.signOut(auth);
  },

  async pull() {
    if (!this.user) return;
    this.status = 'syncing'; hooks.onChange && hooks.onChange();
    try {
      const snap = await fs.getDoc(fs.doc(db, 'users', this.user.uid));
      if (snap.exists()) {
        const remote = JSON.parse(snap.data().state || '{}');
        hooks.mergeRemote(remote);
      }
      await this.push();
    } catch (e) {
      this.status = navigator.onLine ? 'error' : 'offline';
      this.error = String(e.message || e);
    }
  },

  schedulePush() {
    if (!this.user) return;
    clearTimeout(timer);
    timer = setTimeout(() => this.push(), 2500);
  },

  async push() {
    if (!this.user) return;
    if (!navigator.onLine) { this.status = 'offline'; return; }
    this.status = 'syncing'; hooks.onChange && hooks.onChange();
    try {
      await fs.setDoc(fs.doc(db, 'users', this.user.uid), {
        state: JSON.stringify(hooks.getState()),
        updatedAt: fs.serverTimestamp(),
      });
      this.status = 'synced';
      this.lastSync = Date.now();
      this.error = '';
    } catch (e) {
      this.status = 'error';
      this.error = String(e.message || e);
    }
    hooks.onChange && hooks.onChange();
  },
};
