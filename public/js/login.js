const googleBtn = document.getElementById("google-btn");
const guestBtn = document.getElementById("guest-btn");
const flag = document.getElementById("config-flag");

const params = new URLSearchParams(location.search);

function showFlag(text) {
  flag.textContent = text;
  flag.classList.add("show");
}

if (params.get("error") === "google_not_configured") {
  showFlag("Google sign-in isn't configured on this server yet — use 'Continue as guest', or add Google OAuth credentials in .env.");
} else if (params.get("error") === "google") {
  showFlag("Google sign-in didn't complete. Please try again.");
}

// If the API isn't reachable at all (e.g. this file was opened directly,
// or the backend isn't running), fall back to a local preview so the
// design is still visible and interactive without a server.
let backendReachable = true;
async function checkBackend() {
  try {
    const res = await fetch("/auth/status", { credentials: "include" });
    if (!res.ok) throw new Error("bad status");
    const data = await res.json();
    if (!data.googleAuthEnabled) {
      googleBtn.addEventListener("click", (e) => {
        // Let the server's own redirect message handle this — no need to preempt.
      });
    }
  } catch {
    backendReachable = false;
    showFlag("Preview mode — no backend detected. 'Continue as guest' will show the interface with sample data.");
  }
}
checkBackend();

googleBtn.addEventListener("click", () => {
  window.location.href = "/auth/google";
});

guestBtn.addEventListener("click", async () => {
  guestBtn.disabled = true;
  guestBtn.textContent = "Signing in…";

  if (!backendReachable) {
    sessionStorage.setItem("inkling_preview", "1");
    window.location.href = "app.html";
    return;
  }

  try {
    const res = await fetch("/auth/guest", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error("guest sign-in failed");
    window.location.href = "app.html";
  } catch {
    sessionStorage.setItem("inkling_preview", "1");
    window.location.href = "app.html";
  }
});
