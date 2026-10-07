// ============================================================
// DJCUEJOHN KaraokeHub — app.js
// Real-time queue synced via Firebase Realtime Database.
// Search + metadata via YouTube Data API v3.
// ============================================================

(function () {
  "use strict";

  const CFG = window.KARAOKEHUB_CONFIG;
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 to avoid confusion

  let db = null;
  let ytPlayer = null;
  let ytApiReady = false;
  let currentRoomRef = null;
  let currentRoomCode = null;
  let currentRole = null; // "host" | "singer"
  let currentUserName = null;
  let pendingAutoplayVideoId = null;
  let currentLoadedVideoId = null;

  // ---------------- Boot ----------------
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!configLooksFilledIn()) {
      showToast("⚠️ Add your Firebase + YouTube keys in config.js first — see README.md", 8000);
    } else {
      try {
        firebase.initializeApp(CFG.firebase);
        db = firebase.database();
      } catch (err) {
        console.error("[KaraokeHub] Firebase init failed — check config.js values match your Firebase console exactly:", err);
        showToast("⚠️ Firebase config looks invalid — check the browser console (F12) for details.", 8000);
      }
    }

    document.getElementById("btn-host").addEventListener("click", handleHost);
    document.getElementById("btn-join").addEventListener("click", handleJoin);
    document.getElementById("btn-host-leave").addEventListener("click", () => location.reload());
    document.getElementById("btn-singer-leave").addEventListener("click", () => location.reload());
    document.getElementById("btn-prev").addEventListener("click", goToPrevious);
    document.getElementById("btn-playpause").addEventListener("click", togglePlayPause);
    document.getElementById("btn-next").addEventListener("click", skipToNext);
    document.getElementById("btn-search").addEventListener("click", runSearch);
    document.getElementById("search-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
    setupVolumeControls();
    setupSizeControls();
  }

  // ---------------- Player size mode (Default / Theater / Full) ----------------
  let playerSizeMode = "default";

  function setupSizeControls() {
    document.querySelectorAll(".size-btn").forEach((btn) => {
      btn.addEventListener("click", () => setSizeMode(btn.dataset.mode));
    });
    document.getElementById("btn-exit-full").addEventListener("click", () => setSizeMode("default"));

    // Keep UI in sync if the user exits fullscreen via Esc or the browser's
    // own controls rather than our Exit button.
    ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach((evt) => {
      document.addEventListener(evt, () => {
        if (!getFullscreenElement() && playerSizeMode === "full") {
          setSizeMode("default", { skipFullscreenExit: true });
        }
      });
    });
  }

  function setSizeMode(mode, opts) {
    opts = opts || {};
    playerSizeMode = mode;
    const hostScreen = document.getElementById("screen-host");
    hostScreen.classList.remove("theater", "full");
    if (mode !== "default") hostScreen.classList.add(mode);

    document.querySelectorAll(".size-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
    document.getElementById("btn-exit-full").hidden = mode !== "full";

    if (mode === "full") {
      requestFullscreenSafe(document.getElementById("player-wrap"));
    } else if (!opts.skipFullscreenExit) {
      exitFullscreenSafe();
    }
  }

  function getFullscreenElement() {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null
    );
  }

  function requestFullscreenSafe(el) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (!fn) return; // CSS-only fallback (e.g. iOS Safari) still applies via the .full class
    try {
      const result = fn.call(el);
      if (result && result.catch) result.catch(() => {});
    } catch (err) {
      // Fullscreen request rejected (e.g. not called from a direct user
      // gesture in some browsers) — the .full CSS class still gives an
      // in-page maximized view, so playback isn't affected.
    }
  }

  function exitFullscreenSafe() {
    if (!getFullscreenElement()) return;
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (fn) fn.call(document);
  }

  function configLooksFilledIn() {
    return (
      CFG &&
      CFG.firebase &&
      CFG.firebase.apiKey &&
      !CFG.firebase.apiKey.startsWith("PASTE_") &&
      CFG.youtubeApiKey &&
      !CFG.youtubeApiKey.startsWith("PASTE_")
    );
  }

  function requireConfig() {
    if (!db) {
      showToast("⚠️ Firebase isn't configured yet — edit config.js first.", 5000);
      return false;
    }
    return true;
  }

  // ---------------- YouTube IFrame API ----------------
  // Called automatically by the YouTube iframe_api script once loaded.
  window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
    if (pendingAutoplayVideoId) {
      createOrLoadPlayer(pendingAutoplayVideoId);
      pendingAutoplayVideoId = null;
    }
  };

  let isMuted = false;
  let volumeLevel = 100;

  function createOrLoadPlayer(videoId) {
    if (!ytApiReady) {
      pendingAutoplayVideoId = videoId;
      return;
    }
    if (!ytPlayer) {
      ytPlayer = new YT.Player("player", {
        videoId,
        // Try unmuted autoplay first. If the browser blocks it (no user
        // gesture on this page yet), checkAutoplayBlocked() below falls
        // back to muted playback automatically so the party never stalls.
        playerVars: { autoplay: 1, rel: 0, mute: 0 },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange,
          onError: onPlayerError
        }
      });
    } else {
      ytPlayer.loadVideoById(videoId);
      ytPlayer.playVideo();
    }
  }

  function onPlayerReady(event) {
    event.target.setVolume(volumeLevel);
    event.target.playVideo();
    // Give the browser a moment, then check whether unmuted autoplay
    // actually took — if blocked, fall back to muted + show the mute
    // button so the host can turn sound on with one tap.
    setTimeout(checkAutoplayBlocked, 1200);
  }

  function checkAutoplayBlocked() {
    if (!ytPlayer) return;
    const state = ytPlayer.getPlayerState();
    if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
      isMuted = true;
      ytPlayer.mute();
      ytPlayer.playVideo();
      updateMuteButton();
      showToast("Browser blocked sound autoplay — tap 🔇 to unmute.", 5000);
    } else {
      isMuted = false;
      updateMuteButton();
    }
  }

  function toggleMute() {
    if (!ytPlayer) return;
    isMuted = !isMuted;
    if (isMuted) {
      ytPlayer.mute();
    } else {
      ytPlayer.unMute();
      if (ytPlayer.getVolume() === 0) {
        volumeLevel = 100;
        ytPlayer.setVolume(volumeLevel);
        updateVolumeSlider(volumeLevel);
      }
    }
    updateMuteButton();
  }

  function updateMuteButton() {
    const btn = document.getElementById("btn-mute");
    if (!btn) return;
    btn.textContent = isMuted ? "🔇" : "🔊";
    btn.setAttribute("aria-label", isMuted ? "Unmute" : "Mute");
  }

  function setupVolumeControls() {
    const muteBtn = document.getElementById("btn-mute");
    const slider = document.getElementById("volume-slider");
    if (muteBtn) muteBtn.addEventListener("click", toggleMute);
    if (slider) {
      updateVolumeSlider(volumeLevel);
      slider.addEventListener("input", (e) => {
        const val = Number(e.target.value);
        volumeLevel = val;
        updateVolumeSlider(val);
        if (!ytPlayer) return;
        ytPlayer.setVolume(val);
        isMuted = val === 0;
        if (isMuted) {
          ytPlayer.mute();
        } else {
          ytPlayer.unMute();
        }
        updateMuteButton();
      });
    }
  }

  function updateVolumeSlider(val) {
    const slider = document.getElementById("volume-slider");
    if (!slider) return;
    slider.value = val;
    slider.style.background =
      `linear-gradient(to right, var(--accent) 0%, var(--accent) ${val}%, var(--border) ${val}%, var(--border) 100%)`;
  }

  function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
      setPlayPauseButton(true);
    } else if (event.data === YT.PlayerState.PAUSED) {
      setPlayPauseButton(false);
    }
    if (event.data === YT.PlayerState.ENDED && currentRole === "host") {
      advanceQueue();
    }
  }

  // Error codes 101 / 150 = embedding disabled by the video owner.
  // 100 = video removed/private. 2 = invalid video id.
  function onPlayerError(event) {
    if (currentRole !== "host") return;
    const messages = {
      2: "That video link was invalid — skipping.",
      100: "That video was removed or is private — skipping.",
      101: "That video can't be played outside YouTube — skipping.",
      150: "That video can't be played outside YouTube — skipping."
    };
    showToast(messages[event.data] || "That video couldn't play — skipping.", 4000);
    advanceQueue();
  }

  // ---------------- Network helper ----------------
  // Prevents "stuck on Starting…" — if Firebase doesn't respond within
  // TIMEOUT_MS (wrong databaseURL, locked rules, or a blocked connection),
  // this fails with a clear message instead of hanging forever.
  const TIMEOUT_MS = 8000;
  function withTimeout(promise, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(message)), TIMEOUT_MS)
      )
    ]);
  }

  // ---------------- Room code ----------------
  function generateRoomCode() {
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  async function generateUniqueRoomCode() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateRoomCode();
      const snap = await withTimeout(
        db.ref("rooms/" + code).once("value"),
        "Couldn't reach Firebase (timed out). Check config.js databaseURL and your database rules."
      );
      if (!snap.exists()) return code;
    }
    throw new Error("Could not generate a free room code, please try again.");
  }

  // ---------------- Host flow ----------------
  async function handleHost() {
    if (!requireConfig()) return;
    const nameInput = document.getElementById("host-name");
    const errorEl = document.getElementById("host-error");
    const name = nameInput.value.trim();
    errorEl.hidden = true;

    if (!name) {
      errorEl.textContent = "Enter your name to start the party.";
      errorEl.hidden = false;
      return;
    }

    const btn = document.getElementById("btn-host");
    btn.disabled = true;
    btn.textContent = "Starting…";

    try {
      const code = await generateUniqueRoomCode();
      await withTimeout(
        db.ref("rooms/" + code).set({
          hostName: name,
          createdAt: firebase.database.ServerValue.TIMESTAMP,
          currentSong: null,
          queue: {}
        }),
        "Couldn't reach Firebase (timed out). Check config.js databaseURL and your database rules."
      );
      enterHostRoom(code, name);
    } catch (err) {
      console.error("[KaraokeHub] handleHost failed:", err);
      errorEl.textContent = err.message || "Couldn't create a room. Try again.";
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Start Party";
    }
  }

  function enterHostRoom(code, name) {
    currentRoomCode = code;
    currentRole = "host";
    currentUserName = name;
    currentRoomRef = db.ref("rooms/" + code);

    document.getElementById("host-room-code").textContent = code;
    document.getElementById("host-display-name").textContent = name;
    showScreen("screen-host");

    currentRoomRef.on("value", (snap) => renderHostRoom(snap.val()));
  }

  function renderHostRoom(room) {
    if (!room) return;
    const queueArr = queueObjectToArray(room.queue);

    // Now playing
    const emptyEl = document.getElementById("now-playing-empty");
    const infoEl = document.getElementById("now-playing-info");
    const controlsBar = document.getElementById("player-controls");

    if (room.currentSong) {
      emptyEl.hidden = true;
      infoEl.hidden = false;
      controlsBar.hidden = false;
      document.getElementById("np-title").textContent = room.currentSong.title;
      document.getElementById("np-singer").textContent = room.currentSong.singerName;
      // Only touch the player if the song actually changed — re-running
      // createOrLoadPlayer on every queue update was restarting playback
      // every time someone added a new song.
      if (room.currentSong.videoId !== currentLoadedVideoId) {
        currentLoadedVideoId = room.currentSong.videoId;
        createOrLoadPlayer(room.currentSong.videoId);
      }
    } else if (queueArr.length > 0) {
      // Auto-advance if nothing is playing but songs are queued
      advanceQueue();
      return;
    } else {
      emptyEl.hidden = false;
      infoEl.hidden = true;
      controlsBar.hidden = true;
      currentLoadedVideoId = null;
    }

    renderQueueList("queue-list", "queue-count", queueArr, true);
  }

  async function advanceQueue() {
    if (!currentRoomRef) return;
    const snap = await currentRoomRef.once("value");
    const room = snap.val();
    if (!room) return;
    const queueArr = queueObjectToArray(room.queue);

    const updates = {};
    if (room.currentSong) {
      const histKey = currentRoomRef.child("history").push().key;
      updates["history/" + histKey] = {
        videoId: room.currentSong.videoId,
        title: room.currentSong.title,
        singerName: room.currentSong.singerName,
        playedAt: firebase.database.ServerValue.TIMESTAMP
      };
    }

    if (queueArr.length === 0) {
      updates["currentSong"] = null;
      await currentRoomRef.update(updates);
      return;
    }

    const next = queueArr[0];
    updates["currentSong"] = {
      videoId: next.videoId,
      title: next.title,
      singerName: next.singerName,
      startedAt: firebase.database.ServerValue.TIMESTAMP
    };
    updates["queue/" + next.key] = null;
    await currentRoomRef.update(updates);
  }

  function historyObjectToArray(historyObj) {
    if (!historyObj) return [];
    return Object.entries(historyObj)
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => (a.playedAt || 0) - (b.playedAt || 0));
  }

  async function goToPrevious() {
    if (!currentRoomRef) return;
    const snap = await currentRoomRef.once("value");
    const room = snap.val();
    if (!room) return;

    const historyArr = historyObjectToArray(room.history);
    if (historyArr.length === 0) {
      showToast("No previous song to go back to.");
      return;
    }

    const prevItem = historyArr[historyArr.length - 1];
    const queueArr = queueObjectToArray(room.queue);
    const updates = {};

    // Put the song that was just interrupted back at the FRONT of the queue
    // (instead of losing it) so it plays again right after this one.
    if (room.currentSong) {
      const frontOrder = queueArr.length
        ? Math.min(...queueArr.map((i) => i.addedAt || Date.now())) - 1000
        : Date.now();
      const requeueKey = currentRoomRef.child("queue").push().key;
      updates["queue/" + requeueKey] = {
        videoId: room.currentSong.videoId,
        title: room.currentSong.title,
        singerName: room.currentSong.singerName,
        channelTitle: room.currentSong.channelTitle || "",
        thumbnail: room.currentSong.thumbnail || "",
        addedAt: frontOrder
      };
    }

    updates["currentSong"] = {
      videoId: prevItem.videoId,
      title: prevItem.title,
      singerName: prevItem.singerName,
      startedAt: firebase.database.ServerValue.TIMESTAMP
    };
    updates["history/" + prevItem.key] = null;
    await currentRoomRef.update(updates);
  }

  function skipToNext() {
    advanceQueue();
  }

  function togglePlayPause() {
    if (!ytPlayer) return;
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      ytPlayer.pauseVideo();
    } else {
      ytPlayer.playVideo();
    }
  }

  function setPlayPauseButton(playing) {
    const btn = document.getElementById("btn-playpause");
    if (!btn) return;
    btn.textContent = playing ? "⏸" : "▶";
    btn.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  // ---------------- Singer flow ----------------
  async function handleJoin() {
    if (!requireConfig()) return;
    const nameInput = document.getElementById("join-name");
    const codeInput = document.getElementById("join-code");
    const errorEl = document.getElementById("join-error");
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    errorEl.hidden = true;

    if (!name || !code) {
      errorEl.textContent = "Enter your name and a room code.";
      errorEl.hidden = false;
      return;
    }

    const btn = document.getElementById("btn-join");
    btn.disabled = true;
    btn.textContent = "Joining…";

    try {
      const snap = await withTimeout(
        db.ref("rooms/" + code).once("value"),
        "Couldn't reach Firebase (timed out). Check config.js databaseURL and your database rules."
      );
      if (!snap.exists()) {
        errorEl.textContent = "No room found with that code.";
        errorEl.hidden = false;
        return;
      }
      enterSingerRoom(code, name);
    } catch (err) {
      console.error("[KaraokeHub] handleJoin failed:", err);
      errorEl.textContent = err.message || "Couldn't join that room. Try again.";
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Join Room";
    }
  }

  function enterSingerRoom(code, name) {
    currentRoomCode = code;
    currentRole = "singer";
    currentUserName = name;
    currentRoomRef = db.ref("rooms/" + code);

    document.getElementById("singer-room-code").textContent = code;
    document.getElementById("singer-display-name").textContent = name;
    showScreen("screen-singer");

    currentRoomRef.on("value", (snap) => renderSingerRoom(snap.val()));
  }

  function renderSingerRoom(room) {
    if (!room) return;
    const queueArr = queueObjectToArray(room.queue);

    document.getElementById("singer-np-title").textContent = room.currentSong
      ? `${room.currentSong.title} — ${room.currentSong.singerName}`
      : "Nothing yet";

    renderQueueList("singer-queue-list", "singer-queue-count", queueArr, false);
  }

  // ---------------- Queue rendering (shared) ----------------
  function queueObjectToArray(queueObj) {
    if (!queueObj) return [];
    return Object.entries(queueObj)
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  }

  function renderQueueList(listId, countId, queueArr, allowRemove) {
    const listEl = document.getElementById(listId);
    document.getElementById(countId).textContent = queueArr.length;
    listEl.innerHTML = "";

    if (queueArr.length === 0) {
      const li = document.createElement("li");
      li.className = "queue-empty";
      li.textContent = "Queue is empty.";
      listEl.appendChild(li);
      return;
    }

    queueArr.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "queue-item";
      li.innerHTML = `
        <span class="queue-item__position">#${idx + 1}</span>
        <img class="queue-item__thumb" src="${item.thumbnail || ""}" alt="" />
        <div class="queue-item__body">
          <p class="queue-item__title">${escapeHtml(item.title)}</p>
          <p class="queue-item__singer">${escapeHtml(item.singerName)}</p>
        </div>
      `;
      if (allowRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "queue-item__remove";
        removeBtn.textContent = "✕";
        removeBtn.title = "Remove from queue";
        removeBtn.addEventListener("click", () => {
          currentRoomRef.child("queue/" + item.key).remove();
        });
        li.appendChild(removeBtn);
      }
      listEl.appendChild(li);
    });
  }

  // ---------------- YouTube search ----------------
  async function runSearch() {
    const input = document.getElementById("search-input");
    const statusEl = document.getElementById("search-status");
    const resultsEl = document.getElementById("search-results");
    const query = input.value.trim();
    statusEl.hidden = true;
    resultsEl.innerHTML = "";

    if (!query) return;

    statusEl.textContent = "Searching…";
    statusEl.hidden = false;

    try {
      const url =
        "https://www.googleapis.com/youtube/v3/search" +
        "?part=snippet&type=video&maxResults=10&videoCategoryId=10" +
        "&videoEmbeddable=true" +
        "&q=" + encodeURIComponent(query + " karaoke") +
        "&key=" + CFG.youtubeApiKey;

      const res = await fetch(url);
      const data = await res.json();

      if (data.error) {
        statusEl.textContent = "YouTube API error: " + data.error.message;
        statusEl.hidden = false;
        return;
      }

      statusEl.hidden = true;
      renderSearchResults(data.items || []);
    } catch (err) {
      statusEl.textContent = "Search failed. Check your connection or API key.";
      statusEl.hidden = false;
    }
  }

  function renderSearchResults(items) {
    const resultsEl = document.getElementById("search-results");
    resultsEl.innerHTML = "";

    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "queue-empty";
      li.textContent = "No results. Try a different search.";
      resultsEl.appendChild(li);
      return;
    }

    items.forEach((item) => {
      const videoId = item.id.videoId;
      const title = item.snippet.title;
      const channelTitle = item.snippet.channelTitle;
      const thumbnail = item.snippet.thumbnails?.default?.url || "";

      const li = document.createElement("li");
      li.className = "result-item";
      li.innerHTML = `
        <img class="result-item__thumb" src="${thumbnail}" alt="" />
        <div class="result-item__body">
          <p class="result-item__title">${escapeHtml(title)}</p>
          <p class="result-item__channel">${escapeHtml(channelTitle)}</p>
        </div>
      `;
      const addBtn = document.createElement("button");
      addBtn.className = "btn btn--primary";
      addBtn.textContent = "Add";
      addBtn.addEventListener("click", () =>
        addSongToQueue({ videoId, title, channelTitle, thumbnail })
      );
      li.appendChild(addBtn);
      resultsEl.appendChild(li);
    });
  }

  function addSongToQueue(song) {
    if (!currentRoomRef) return;
    currentRoomRef.child("queue").push({
      videoId: song.videoId,
      title: song.title,
      channelTitle: song.channelTitle,
      thumbnail: song.thumbnail,
      singerName: currentUserName,
      addedAt: firebase.database.ServerValue.TIMESTAMP
    });
    showToast(`Added "${song.title}" to the queue`);
  }

  // ---------------- Helpers ----------------
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.remove("screen--active"));
    document.getElementById(id).classList.add("screen--active");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  let toastTimer = null;
  function showToast(msg, duration = 3000) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), duration);
  }
})();
