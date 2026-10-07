/* ============================================================
   DJCUEJOHN VideoKaraoke-Lounge — welcome + optional donation pop-up
   Opens once when the site loads. Everything is optional: visitors can
   close it with Continue, the X, the Escape key, or by clicking outside.
   "Don't show this again" is remembered in this browser (localStorage).

   >>> EDIT THE SETTINGS BELOW — nothing else in this file needs changes <<<
   ============================================================ */
(function () {
  const WELCOME = {
    appName: "VideoKaraoke-Lounge",
    tagline: "A real-time karaoke room where everyone can search, queue, and enjoy karaoke together.",

    developerName: "Johnrey Dadula Lawan",          // shown in the "Developed by" box

    // Donation (optional for visitors). Leave gcashNumber as "" to hide this section.
    donationEnabled: true,
    donationMethod: "GCASH",
    gcashNumber: "0908 107 1010",             // <-- put your own GCash number here
    donationMessage:
      "If you enjoy using VideoKaraoke-Lounge and want to support its development, donations are appreciated!",

    // Only list features your app really has.
    features: [
      "Real-time Karaoke Queue",
      "Room Code Joining",
      "YouTube Song Search",
      "Embeddable Videos Only",
      "Song History",
      "Host Playback Controls",
      "Auto Play Next Song",
      "Volume & Mute Control",
      "Default / Theater / Full Size",
      "Multi-device Support",
      "Mobile Friendly",
      "Responsive Design"
    ],

    storageKey: "djcuejohn_welcome_hidden_v1"  // change the "v1" to show it again to everyone
  };

  const modal = document.getElementById("welcome-modal");
  if (!modal) return;

  const $ = (sel) => modal.querySelector(sel);

  // ---- remember "don't show again" (safe if storage is blocked) ----
  function isHidden() {
    try { return localStorage.getItem(WELCOME.storageKey) === "1"; } catch (e) { return false; }
  }
  function remember() {
    try { localStorage.setItem(WELCOME.storageKey, "1"); } catch (e) { /* ignore */ }
  }

  if (isHidden()) return;

  // ---- fill in content ----
  $("#welcome-app-name").textContent = WELCOME.appName;
  $("#welcome-tagline").textContent = WELCOME.tagline;
  $("#welcome-dev-name").textContent = WELCOME.developerName;

  const list = $("#welcome-features");
  WELCOME.features.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });

  const donate = $("#welcome-donate");
  if (WELCOME.donationEnabled && WELCOME.gcashNumber) {
    $("#welcome-donate-msg").textContent = WELCOME.donationMessage;
    $("#welcome-donate-method").textContent = WELCOME.donationMethod;
    $("#welcome-donate-number").textContent = WELCOME.gcashNumber;
  } else {
    donate.hidden = true;
  }

  // ---- open / close ----
  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    $("#welcome-continue").focus();
  }

  function close() {
    if ($("#welcome-dont-show").checked) remember();
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $("#welcome-continue").addEventListener("click", close);
  $("#welcome-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  document.addEventListener("keydown", (e) => {
    if (modal.hidden) return;
    if (e.key === "Escape") { close(); return; }
    if (e.key === "Tab") {                       // keep keyboard focus inside the pop-up
      const f = modal.querySelectorAll("button, input, [href]");
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ---- copy GCash number ----
  const copyBtn = $("#welcome-copy");
  copyBtn.addEventListener("click", async () => {
    const number = WELCOME.gcashNumber.replace(/\s+/g, "");
    try {
      await navigator.clipboard.writeText(number);
    } catch (e) {
      const t = document.createElement("textarea");
      t.value = number; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch (err) { /* ignore */ }
      t.remove();
    }
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1600);
  });

  open();
})();
